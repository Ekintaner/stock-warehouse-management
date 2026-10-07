import { randomUUID, createHash } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";
import {
  Prisma,
  type PrismaClient,
  type Unit,
  type CountStatus,
} from "../../generated/prisma/client.js";
import { getPrismaClient } from "../../database/prisma.js";
import {
  requireAuthenticatedUser,
  type AuthenticatedUser,
} from "../auth/authorization.js";
import { ApiError } from "../../shared/api-error.js";

function invalid(message: string): never {
  throw new ApiError(400, "INVALID_REQUEST", message);
}

function notFound(message = "Sayım bulunamadı."): never {
  throw new ApiError(404, "NOT_FOUND", message);
}

function conflict(message: string, details?: unknown): never {
  throw new ApiError(409, "CONFLICT", message, details);
}

function forbidden(message = "Bu işlem için yetkiniz yok."): never {
  throw new ApiError(403, "FORBIDDEN", message);
}

function currentUser(request: FastifyRequest): AuthenticatedUser {
  return requireAuthenticatedUser(request.authenticatedUser);
}

function canReadWarehouse(user: AuthenticatedUser, warehouseId: string): void {
  if (user.role !== "ADMIN" && !user.warehouseIds.includes(warehouseId)) {
    notFound("Sayım bulunamadı.");
  }
}

function canWriteWarehouse(user: AuthenticatedUser, warehouseId: string): void {
  if (user.role === "VIEWER") {
    forbidden("Görüntüleme rolü sayım işlemi yapamaz.");
  }
  if (user.role !== "ADMIN" && !user.warehouseIds.includes(warehouseId)) {
    forbidden("Bu depo için sayım yetkiniz yok.");
  }
}

function ensureAdmin(user: AuthenticatedUser): void {
  if (user.role !== "ADMIN") {
    forbidden("Yalnızca yönetici bu işlemi yapabilir.");
  }
}

function normalizeText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (text.length > max) invalid(`Metin en fazla ${max} karakter olabilir.`);
  return text || null;
}

function parseCountedQuantity(raw: string, unit: Unit): Prisma.Decimal {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(cleaned)) {
    invalid("Sayılan miktar pozitif veya sıfır olmalı ve en fazla üç ondalık basamak içermelidir.");
  }
  const quantity = new Prisma.Decimal(cleaned);
  if (quantity.lt(0)) {
    invalid("Sayılan miktar negatif olamaz.");
  }
  if (unit === "EACH" && !quantity.isInteger()) {
    invalid("Adet birimindeki miktar tam sayı olmalıdır.");
  }
  return quantity;
}

function expectedDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    invalid("Düzenleme sürümü geçerli bir tarih olmalıdır.");
  }
  return date;
}

function ensureNotStale(actual: Date, expected: string): void {
  if (actual.getTime() !== expectedDate(expected).getTime()) {
    conflict("Sayım başka bir kullanıcı tarafından değiştirildi. Güncel verileri yeniden açın.");
  }
}

function pageArgs(query: {
  page?: number | string;
  pageSize?: number | string;
}) {
  const parse = (
    value: number | string | undefined,
    fallback: number,
    max: number,
    label: string,
  ) => {
    if (value === undefined) return fallback;
    const parsed =
      typeof value === "number"
        ? value
        : /^\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      invalid(`${label} değeri geçersiz.`);
    }
    return parsed;
  };
  const page = parse(query.page, 1, 100_000, "Sayfa");
  const pageSize = parse(query.pageSize, 25, 100, "Sayfa boyutu");
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

async function lockWarehouse(
  tx: Prisma.TransactionClient,
  warehouseId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id" FROM "Warehouse" WHERE "id" = ${warehouseId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) {
    notFound("Depo bulunamadı.");
  }
}

async function lockCount(
  tx: Prisma.TransactionClient,
  countId: string,
): Promise<{
  id: string;
  warehouseId: string;
  status: CountStatus;
  countNumber: bigint;
  updatedAt: Date;
}> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      warehouseId: string;
      status: CountStatus;
      countNumber: bigint;
      updatedAt: Date;
    }>
  >`
    SELECT "id"::text AS "id",
           "warehouseId"::text AS "warehouseId",
           "status",
           "countNumber",
           "updatedAt"
    FROM "StockCount"
    WHERE "id" = ${countId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    notFound("Sayım bulunamadı.");
  }
  return rows[0]!;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  countId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      userId,
      action,
      relatedType: "StockCount",
      relatedId: countId,
      changeSummary: { before, after },
    },
  });
}

function hashRequestPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload ?? null))
    .digest("hex");
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  const key = Array.isArray(value) ? value[0] : value;
  if (
    !key ||
    key.length < 8 ||
    key.length > 200 ||
    !/^[A-Za-z0-9._~-]+$/.test(key)
  ) {
    invalid("İşlem için güvenli tekrar anahtarı geçersiz veya eksik.");
  }
  return key;
}

async function beginIdempotentOperation(
  tx: Prisma.TransactionClient,
  userId: string,
  scope: string,
  key: string,
  requestHash: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "IdempotencyRecord"
      ("id", "userId", "operationScope", "key", "requestHash", "createdAt")
    VALUES
      (${randomUUID()}::uuid, ${userId}::uuid, ${scope}, ${key}, ${requestHash}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "operationScope", "key") DO NOTHING
    RETURNING "id"::text AS "id"
  `;
  return rows[0]?.id ?? null;
}

async function readIdempotentResult(
  tx: Prisma.TransactionClient,
  userId: string,
  scope: string,
  key: string,
  requestHash: string,
) {
  const prior = await tx.idempotencyRecord.findUnique({
    where: {
      userId_operationScope_key: { userId, operationScope: scope, key },
    },
  });
  if (!prior) conflict("İşlem sonucu doğrulanamadı. Aynı anahtarla tekrar deneyin.");
  if (prior.requestHash !== requestHash) {
    conflict("Bu güvenli tekrar anahtarı farklı bir sayım isteğinde kullanılmış.");
  }
  if (!prior.completedAt || !prior.response) {
    conflict("İşlem sonucu tamamlanmamış. Aynı anahtarla tekrar deneyin.");
  }
  return prior.response;
}

const listCountsOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        warehouseId: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["OPEN", "APPROVED", "CANCELLED"] },
        startDate: { type: "string", format: "date-time" },
        endDate: { type: "string", format: "date-time" },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
};

const createCountOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      required: ["warehouseId", "responsibleUserId"],
      additionalProperties: false,
      properties: {
        warehouseId: { type: "string", format: "uuid" },
        responsibleUserId: { type: "string", format: "uuid" },
        description: {
          anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }],
        },
      },
    },
  },
};

const updateLinesOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      required: ["expectedUpdatedAt", "lines"],
      additionalProperties: false,
      properties: {
        expectedUpdatedAt: { type: "string", format: "date-time" },
        lines: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            required: ["lineId"],
            additionalProperties: false,
            properties: {
              lineId: { type: "string", format: "uuid" },
              countedQuantity: {
                anyOf: [
                  { type: "string", maxLength: 30 },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
    },
  },
};

const approveCountOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      required: ["expectedUpdatedAt"],
      additionalProperties: false,
      properties: {
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

const cancelCountOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      required: ["expectedUpdatedAt"],
      additionalProperties: false,
      properties: {
        expectedUpdatedAt: { type: "string", format: "date-time" },
        reason: {
          anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }],
        },
      },
    },
  },
};

export function registerCountRoutes(
  app: FastifyInstance,
  injectedPrisma?: PrismaClient,
): void {
  const getDb = () => injectedPrisma ?? getPrismaClient();

  /**
   * GET /api/counts
   * List stock counts with filters and pagination
   */
  app.get<{
    Querystring: {
      warehouseId?: string;
      status?: "OPEN" | "APPROVED" | "CANCELLED";
      startDate?: string;
      endDate?: string;
      page?: number | string;
      pageSize?: number | string;
    };
  }>("/api/counts", listCountsOptions, async (request) => {
    const user = currentUser(request);
    const db = getDb();
    const { page, pageSize, skip, take } = pageArgs(request.query);

    let warehouseFilter: Prisma.StringFilter | string | undefined;
    if (user.role === "ADMIN") {
      warehouseFilter = request.query.warehouseId;
    } else {
      if (request.query.warehouseId) {
        canReadWarehouse(user, request.query.warehouseId);
        warehouseFilter = request.query.warehouseId;
      } else {
        warehouseFilter = { in: user.warehouseIds };
      }
    }

    const where: Prisma.StockCountWhereInput = {
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
      ...(request.query.status ? { status: request.query.status } : {}),
      ...(request.query.startDate || request.query.endDate
        ? {
            startedAt: {
              ...(request.query.startDate
                ? { gte: new Date(request.query.startDate) }
                : {}),
              ...(request.query.endDate
                ? { lte: new Date(request.query.endDate) }
                : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      db.stockCount.count({ where }),
      db.stockCount.findMany({
        where,
        skip,
        take,
        orderBy: [{ startedAt: "desc" }, { countNumber: "desc" }],
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          openedBy: { select: { id: true, username: true, displayName: true } },
          responsibleUser: { select: { id: true, username: true, displayName: true } },
          approvedBy: { select: { id: true, username: true, displayName: true } },
          cancelledBy: { select: { id: true, username: true, displayName: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    const countIds = items.map((c: { id: string }) => c.id);
    const countedAggregations = countIds.length
      ? await db.stockCountLine.groupBy({
          by: ["countId"],
          where: {
            countId: { in: countIds },
            countedQuantity: { not: null },
          },
          _count: { id: true },
        })
      : [];
    const countedMap = new Map<string, number>(
      countedAggregations.map((a: { countId: string; _count: { id: number } }) => [
        a.countId,
        a._count.id,
      ]),
    );

    return {
      items: items.map((c) => ({
        id: c.id,
        countNumber: c.countNumber.toString(),
        warehouseId: c.warehouseId,
        status: c.status,
        description: c.description,
        startedAt: c.startedAt.toISOString(),
        closedAt: c.closedAt?.toISOString() ?? null,
        approvedAt: c.approvedAt?.toISOString() ?? null,
        cancelledAt: c.cancelledAt?.toISOString() ?? null,
        updatedAt: c.updatedAt.toISOString(),
        warehouse: c.warehouse,
        openedBy: c.openedBy,
        responsibleUser: c.responsibleUser,
        approvedBy: c.approvedBy,
        cancelledBy: c.cancelledBy,
        totalLines: c._count.lines,
        countedLines: countedMap.get(c.id) ?? 0,
      })),
      total,
      page,
      pageSize,
    };
  });

  /**
   * GET /api/counts/:id
   * Get single stock count with stats and filtered/paginated lines
   */
  app.get<{
    Params: { id: string };
    Querystring: {
      q?: string;
      filter?: "all" | "uncounted" | "difference";
      page?: number | string;
      pageSize?: number | string;
    };
  }>("/api/counts/:id", async (request) => {
    const user = currentUser(request);
    const db = getDb();
    const count = await db.stockCount.findUnique({
      where: { id: request.params.id },
      include: {
        warehouse: { select: { id: true, code: true, name: true, isActive: true } },
        openedBy: { select: { id: true, username: true, displayName: true } },
        responsibleUser: { select: { id: true, username: true, displayName: true } },
        approvedBy: { select: { id: true, username: true, displayName: true } },
        cancelledBy: { select: { id: true, username: true, displayName: true } },
      },
    });
    if (!count) notFound();
    canReadWarehouse(user, count.warehouseId);

    // Load all lines for summary stats
    const allLines = await db.stockCountLine.findMany({
      where: { countId: count.id },
      select: {
        id: true,
        snapshotQuantity: true,
        countedQuantity: true,
      },
    });

    let countedLinesCount = 0;
    let uncountedLinesCount = 0;
    let differenceLinesCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let zeroCount = 0;

    for (const line of allLines) {
      if (line.countedQuantity === null) {
        uncountedLinesCount++;
      } else {
        countedLinesCount++;
        const diff = line.countedQuantity.minus(line.snapshotQuantity);
        if (diff.gt(0)) {
          positiveCount++;
          differenceLinesCount++;
        } else if (diff.lt(0)) {
          negativeCount++;
          differenceLinesCount++;
        } else {
          zeroCount++;
        }
      }
    }

    const { page, pageSize, skip, take } = pageArgs(request.query);
    const q = request.query.q?.trim().toLowerCase();
    const filter = request.query.filter ?? "all";

    const lineWhere: Prisma.StockCountLineWhereInput = {
      countId: count.id,
      ...(q
        ? {
            product: {
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      ...(filter === "uncounted"
        ? { countedQuantity: null }
        : {}),
    };

    let pagedLines;
    let linesTotal: number;

    if (filter === "difference") {
      const candidates = await db.stockCountLine.findMany({
        where: {
          countId: count.id,
          countedQuantity: { not: null },
          ...(q
            ? {
                product: {
                  OR: [
                    { sku: { contains: q, mode: "insensitive" } },
                    { name: { contains: q, mode: "insensitive" } },
                  ],
                },
              }
            : {}),
        },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true, isActive: true } },
        },
        orderBy: [{ product: { sku: "asc" } }, { id: "asc" }],
      });
      const diffLines = candidates.filter(
        (l: { countedQuantity: Prisma.Decimal | null; snapshotQuantity: Prisma.Decimal }) =>
          l.countedQuantity !== null && !l.countedQuantity.equals(l.snapshotQuantity),
      );
      linesTotal = diffLines.length;
      pagedLines = diffLines.slice(skip, skip + take);
    } else {
      const [totalCount, fetched] = await Promise.all([
        db.stockCountLine.count({ where: lineWhere }),
        db.stockCountLine.findMany({
          where: lineWhere,
          skip,
          take,
          orderBy: [{ product: { sku: "asc" } }, { id: "asc" }],
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true, isActive: true } },
          },
        }),
      ]);
      linesTotal = totalCount;
      pagedLines = fetched;
    }

    return {
      count: {
        id: count.id,
        countNumber: count.countNumber.toString(),
        warehouseId: count.warehouseId,
        status: count.status,
        description: count.description,
        startedAt: count.startedAt.toISOString(),
        closedAt: count.closedAt?.toISOString() ?? null,
        approvedAt: count.approvedAt?.toISOString() ?? null,
        cancelledAt: count.cancelledAt?.toISOString() ?? null,
        updatedAt: count.updatedAt.toISOString(),
        warehouse: count.warehouse,
        openedBy: count.openedBy,
        responsibleUser: count.responsibleUser,
        approvedBy: count.approvedBy,
        cancelledBy: count.cancelledBy,
      },
      stats: {
        totalLines: allLines.length,
        countedLines: countedLinesCount,
        uncountedLines: uncountedLinesCount,
        differenceLines: differenceLinesCount,
        positiveCount,
        negativeCount,
        zeroCount,
      },
      lines: pagedLines.map((line: {
        id: string;
        productId: string;
        unit: Unit;
        snapshotQuantity: Prisma.Decimal;
        countedQuantity: Prisma.Decimal | null;
        product: { id: string; sku: string; name: string; unit: Unit; isActive: boolean };
      }) => {
        const diff =
          line.countedQuantity !== null
            ? line.countedQuantity.minus(line.snapshotQuantity).toFixed(3)
            : null;
        return {
          id: line.id,
          productId: line.productId,
          unit: line.unit,
          snapshotQuantity: line.snapshotQuantity.toFixed(3),
          countedQuantity:
            line.countedQuantity !== null
              ? line.countedQuantity.toFixed(3)
              : null,
          difference: diff,
          product: line.product,
        };
      }),
      linesTotal,
      page,
      pageSize,
    };
  });

  /**
   * POST /api/counts
   * Open a new stock count for a warehouse
   * Policy: Include all active products, plus inactive products with non-zero stock balance in this warehouse.
   */
  app.post<{
    Body: {
      warehouseId: string;
      responsibleUserId: string;
      description?: string | null;
    };
  }>("/api/counts", createCountOptions, async (request, reply) => {
    const user = currentUser(request);
    const db = getDb();
    const { warehouseId, responsibleUserId, description } = request.body;

    canWriteWarehouse(user, warehouseId);

    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Lock warehouse row FOR UPDATE
      await lockWarehouse(tx, warehouseId);

      const warehouse = await tx.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, code: true, name: true, isActive: true },
      });
      if (!warehouse) notFound("Depo bulunamadı.");
      if (!warehouse.isActive) {
        conflict("Pasif depoda sayım açılamaz.");
      }

      // Verify responsible user
      const responsible = await tx.user.findUnique({
        where: { id: responsibleUserId },
        select: { id: true, role: true, isActive: true },
      });
      if (!responsible || !responsible.isActive) {
        invalid("Seçilen sorumlu kullanıcı bulunamadı veya pasif durumda.");
      }

      // Check if open count exists
      const existingOpen = await tx.stockCount.findFirst({
        where: { warehouseId, status: "OPEN" },
        select: { id: true, countNumber: true },
      });
      if (existingOpen) {
        conflict("Bu depoda zaten açık bir sayım bulunmaktadır.", {
          countId: existingOpen.id,
          countNumber: existingOpen.countNumber.toString(),
        });
      }

      // 2. Gather products to include in the count snapshot:
      // Policy:
      // - All active products (Product.isActive = true)
      // - PLUS inactive products that have positive balance (quantity > 0) in this warehouse.
      const activeProducts = await tx.product.findMany({
        where: { isActive: true },
        select: { id: true, unit: true, sku: true, name: true },
      });

      const inactiveProductsWithBalance = await tx.stockBalance.findMany({
        where: {
          warehouseId,
          quantity: { gt: 0 },
          product: { isActive: false },
        },
        select: {
          product: { select: { id: true, unit: true, sku: true, name: true } },
        },
      });

      const productMap = new Map<string, { id: string; unit: Unit; sku: string; name: string }>();
      for (const p of activeProducts) {
        productMap.set(p.id, p);
      }
      for (const row of inactiveProductsWithBalance) {
        if (!productMap.has(row.product.id)) {
          productMap.set(row.product.id, row.product);
        }
      }

      if (productMap.size === 0) {
        invalid("Sayım için sayılacak kayıtlı ürün bulunamadı.");
      }

      const productIds = Array.from(productMap.keys());

      // 3. Read current stock balances in this warehouse for snapshot
      const balances = await tx.stockBalance.findMany({
        where: {
          warehouseId,
          productId: { in: productIds },
        },
        select: { productId: true, quantity: true },
      });
      const balanceMap = new Map<string, Prisma.Decimal>(
        balances.map((b: { productId: string; quantity: Prisma.Decimal }) => [
          b.productId,
          b.quantity,
        ]),
      );

      // 4. Create StockCount
      const cleanDescription = normalizeText(description, 1000);
      const createdCount = await tx.stockCount.create({
        data: {
          warehouseId,
          status: "OPEN",
          openedById: user.id,
          responsibleUserId,
          description: cleanDescription,
        },
      });

      // 5. Create StockCountLines
      const lineData = productIds
        .sort()
        .map((productId: string) => {
          const product = productMap.get(productId)!;
          const snapshotQuantity = balanceMap.get(productId) ?? new Prisma.Decimal(0);
          return {
            countId: createdCount.id,
            productId,
            unit: product.unit,
            snapshotQuantity,
            countedQuantity: null,
          };
        });

      await tx.stockCountLine.createMany({
        data: lineData,
      });

      // 6. Write AuditEvent
      await writeAudit(
        tx,
        user.id,
        "COUNT_OPENED",
        createdCount.id,
        null,
        {
          warehouseId,
          countNumber: createdCount.countNumber.toString(),
          totalProducts: productMap.size,
          description: cleanDescription,
        },
      );

      return {
        id: createdCount.id,
        countNumber: createdCount.countNumber.toString(),
        warehouseId,
        status: createdCount.status,
        description: createdCount.description,
        startedAt: createdCount.startedAt.toISOString(),
        updatedAt: createdCount.updatedAt.toISOString(),
        totalLines: productMap.size,
      };
    });

    return reply.code(201).send(result);
  });

  /**
   * PATCH /api/counts/:id/lines
   * Enter / update counted quantities for open count
   */
  app.patch<{
    Params: { id: string };
    Body: {
      expectedUpdatedAt: string;
      lines: Array<{
        lineId: string;
        countedQuantity: string | null;
      }>;
    };
  }>("/api/counts/:id/lines", updateLinesOptions, async (request) => {
    const user = currentUser(request);
    const db = getDb();
    const countId = request.params.id;
    const { expectedUpdatedAt, lines } = request.body;

    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const countPeek = await tx.stockCount.findUnique({
        where: { id: countId },
        select: { warehouseId: true },
      });
      if (!countPeek) notFound();
      await lockWarehouse(tx, countPeek.warehouseId);

      // Use the same warehouse -> count lock order as approval and cancellation.
      const count = await lockCount(tx, countId);
      canWriteWarehouse(user, count.warehouseId);

      if (count.status !== "OPEN") {
        conflict("Yalnızca açık durumdaki sayımlarda miktar girilebilir.");
      }
      ensureNotStale(count.updatedAt, expectedUpdatedAt);

      const lineIds = lines.map((l: { lineId: string }) => l.lineId);
      const dbLines = await tx.stockCountLine.findMany({
        where: {
          id: { in: lineIds },
          countId,
        },
        select: {
          id: true,
          unit: true,
          snapshotQuantity: true,
          countedQuantity: true,
        },
      });

      if (dbLines.length !== lineIds.length) {
        invalid("Sayım satırlarından biri bulunamadı veya bu sayıma ait değil.");
      }

      const dbLineMap = new Map(
        dbLines.map((l: { id: string; unit: Unit; snapshotQuantity: Prisma.Decimal; countedQuantity: Prisma.Decimal | null }) => [
          l.id,
          l,
        ]),
      );

      // 2. Validate and update each line
      const updatedLines = [];
      for (const lineInput of lines) {
        const dbLine = dbLineMap.get(lineInput.lineId);
        if (!dbLine) invalid("Sayım satırı bulunamadı.");

        let newCounted: Prisma.Decimal | null = null;
        if (lineInput.countedQuantity !== null) {
          newCounted = parseCountedQuantity(lineInput.countedQuantity, dbLine.unit);
        }

        const updated = await tx.stockCountLine.update({
          where: { id: dbLine.id },
          data: { countedQuantity: newCounted },
          select: {
            id: true,
            productId: true,
            unit: true,
            snapshotQuantity: true,
            countedQuantity: true,
          },
        });
        updatedLines.push(updated);
      }

      // 3. Touch count.updatedAt
      const touchedCount = await tx.stockCount.update({
        where: { id: countId },
        data: { updatedAt: new Date() },
        select: { updatedAt: true },
      });

      // 4. Audit
      await writeAudit(
        tx,
        user.id,
        "COUNT_LINES_UPDATED",
        countId,
        { lineCount: lines.length },
        { lineCount: lines.length, updatedAt: touchedCount.updatedAt.toISOString() },
      );

      return {
        id: countId,
        updatedAt: touchedCount.updatedAt.toISOString(),
        updatedLines: updatedLines.map((l) => ({
          id: l.id,
          productId: l.productId,
          unit: l.unit,
          snapshotQuantity: l.snapshotQuantity.toFixed(3),
          countedQuantity:
            l.countedQuantity !== null ? l.countedQuantity.toFixed(3) : null,
          difference:
            l.countedQuantity !== null
              ? l.countedQuantity.minus(l.snapshotQuantity).toFixed(3)
              : null,
        })),
      };
    });

    return result;
  });

  /**
   * POST /api/counts/:id/approve
   * Approve stock count and apply differences to inventory
   * Role: ADMIN only!
   */
  app.post<{
    Params: { id: string };
    Body: {
      expectedUpdatedAt: string;
    };
  }>("/api/counts/:id/approve", approveCountOptions, async (request) => {
    const user = currentUser(request);
    ensureAdmin(user);
    const db = getDb();
    const countId = request.params.id;
    const { expectedUpdatedAt } = request.body;

    const idempotencyKey = requireIdempotencyKey(request);
    const requestHash = hashRequestPayload(request.body);
    const scope = `stock_count:approve:${countId}`;

    return db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Idempotency preflight
      const idempotencyRecordId = await beginIdempotentOperation(
        tx,
        user.id,
        scope,
        idempotencyKey,
        requestHash,
      );
      if (!idempotencyRecordId) {
        return readIdempotentResult(
          tx,
          user.id,
          scope,
          idempotencyKey,
          requestHash,
        );
      }

      // 1. Lock warehouse row
      const countPeek = await tx.stockCount.findUnique({
        where: { id: countId },
        select: { warehouseId: true },
      });
      if (!countPeek) notFound();
      await lockWarehouse(tx, countPeek.warehouseId);

      // 2. Lock count row
      const count = await lockCount(tx, countId);
      if (count.status !== "OPEN") {
        conflict("Yalnızca açık durumdaki sayımlar onaylanabilir.");
      }
      ensureNotStale(count.updatedAt, expectedUpdatedAt);

      // 3. Fetch all lines of the count
      const lines = await tx.stockCountLine.findMany({
        where: { countId },
        orderBy: [{ id: "asc" }],
      });

      // 4. Validate that ALL lines are counted
      const uncounted = lines.filter((l: { countedQuantity: Prisma.Decimal | null }) => l.countedQuantity === null);
      if (uncounted.length > 0) {
        conflict(
          `Sayım onaylanmadan önce bütün satırlar sayılmış olmalıdır (${uncounted.length} satır eksik).`,
        );
      }

      // 5. Update StockCount status to APPROVED inside the transaction
      // This is required before StockMovement insert because validate_stock_movement_source
      // checks that StockCount status = 'APPROVED'!
      const now = new Date();
      const updatedCount = await tx.stockCount.update({
        where: { id: countId },
        data: {
          status: "APPROVED",
          closedAt: now,
          approvedAt: now,
          approvedById: user.id,
          updatedAt: now,
        },
      });

      // 6. Generate stock movements for lines with non-zero difference
      // Positive difference: IN
      // Negative difference: OUT
      // Zero difference: NO movement created!
      let adjustmentMovementsCount = 0;
      for (const line of lines) {
        const counted = line.countedQuantity!;
        const snapshot = line.snapshotQuantity;
        const diff = counted.minus(snapshot);

        if (diff.isZero()) {
          // Zero difference -> no movement
          continue;
        }

        const isPositive = diff.gt(0);
        const direction = isPositive ? "IN" : "OUT";
        const quantity = diff.abs();

        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            warehouseId: count.warehouseId,
            direction,
            quantity,
            unit: line.unit,
            type: "COUNT_ADJUSTMENT",
            createdById: user.id,
            countLineId: line.id,
            reason: `Sayım farkı: #${count.countNumber}`,
          },
        });
        adjustmentMovementsCount++;
      }

      // 7. Write AuditEvent
      await writeAudit(
        tx,
        user.id,
        "COUNT_APPROVED",
        countId,
        { status: "OPEN" },
        {
          status: "APPROVED",
          approvedById: user.id,
          closedAt: now.toISOString(),
          totalLines: lines.length,
          adjustmentMovementsCount,
        },
      );

      const responsePayload = {
        id: updatedCount.id,
        countNumber: updatedCount.countNumber.toString(),
        warehouseId: updatedCount.warehouseId,
        status: updatedCount.status,
        closedAt: updatedCount.closedAt!.toISOString(),
        approvedAt: updatedCount.approvedAt!.toISOString(),
        updatedAt: updatedCount.updatedAt.toISOString(),
        adjustmentMovementsCount,
      };

      if (idempotencyRecordId) {
        await tx.idempotencyRecord.update({
          where: { id: idempotencyRecordId },
          data: {
            resultType: "StockCount",
            resultReference: updatedCount.id,
            response: responsePayload,
            completedAt: new Date(),
          },
        });
      }

      return responsePayload;
    });
  });

  /**
   * POST /api/counts/:id/cancel
   * Cancel an open stock count
   * Role: ADMIN only!
   */
  app.post<{
    Params: { id: string };
    Body: {
      expectedUpdatedAt: string;
      reason?: string | null;
    };
  }>("/api/counts/:id/cancel", cancelCountOptions, async (request) => {
    const user = currentUser(request);
    ensureAdmin(user);
    const db = getDb();
    const countId = request.params.id;
    const { expectedUpdatedAt, reason } = request.body;

    const idempotencyKey = requireIdempotencyKey(request);
    const requestHash = hashRequestPayload(request.body);
    const scope = `stock_count:cancel:${countId}`;

    return db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Idempotency preflight
      const idempotencyRecordId = await beginIdempotentOperation(
        tx,
        user.id,
        scope,
        idempotencyKey,
        requestHash,
      );
      if (!idempotencyRecordId) {
        return readIdempotentResult(
          tx,
          user.id,
          scope,
          idempotencyKey,
          requestHash,
        );
      }

      // 1. Lock warehouse row
      const countPeek = await tx.stockCount.findUnique({
        where: { id: countId },
        select: { warehouseId: true },
      });
      if (!countPeek) notFound();
      await lockWarehouse(tx, countPeek.warehouseId);

      // 2. Lock count row
      const count = await lockCount(tx, countId);
      if (count.status !== "OPEN") {
        conflict("Yalnızca açık durumdaki sayımlar iptal edilebilir.");
      }
      ensureNotStale(count.updatedAt, expectedUpdatedAt);

      // 3. Update status to CANCELLED
      const now = new Date();
      const cleanReason = normalizeText(reason, 1000);
      const updatedCount = await tx.stockCount.update({
        where: { id: countId },
        data: {
          status: "CANCELLED",
          closedAt: now,
          cancelledAt: now,
          cancelledById: user.id,
          ...(cleanReason !== null ? { description: cleanReason } : {}),
          updatedAt: now,
        },
      });

      // 4. Audit
      await writeAudit(
        tx,
        user.id,
        "COUNT_CANCELLED",
        countId,
        { status: "OPEN" },
        {
          status: "CANCELLED",
          cancelledById: user.id,
          closedAt: now.toISOString(),
          reason: cleanReason,
        },
      );

      const responsePayload = {
        id: updatedCount.id,
        countNumber: updatedCount.countNumber.toString(),
        warehouseId: updatedCount.warehouseId,
        status: updatedCount.status,
        closedAt: updatedCount.closedAt!.toISOString(),
        cancelledAt: updatedCount.cancelledAt!.toISOString(),
        updatedAt: updatedCount.updatedAt.toISOString(),
      };

      if (idempotencyRecordId) {
        await tx.idempotencyRecord.update({
          where: { id: idempotencyRecordId },
          data: {
            resultType: "StockCount",
            resultReference: updatedCount.id,
            response: responsePayload,
            completedAt: new Date(),
          },
        });
      }

      return responsePayload;
    });
  });
}
