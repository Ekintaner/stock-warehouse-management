import { createHash, randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";
import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  TransferReturnOrigin,
  TransferStatus,
  Unit,
} from "../../generated/prisma/enums.js";
import { getPrismaClient } from "../../database/prisma.js";
import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireWarehouseMutation,
  type AuthenticatedUser,
} from "../auth/authorization.js";
import { ApiError } from "../../shared/api-error.js";

type Database = PrismaClient | Prisma.TransactionClient;

interface IdParams {
  id: string;
}

interface TransferLineBody {
  productId: string;
  quantity: string;
}

interface CreateTransferBody {
  sourceWarehouseId: string;
  targetWarehouseId: string;
  description?: string | null;
  lines: TransferLineBody[];
}

interface UpdateTransferBody {
  expectedUpdatedAt: string;
  description?: string | null;
  lines: TransferLineBody[];
}

interface StateChangeBody {
  expectedUpdatedAt: string;
}

interface ReturnBody extends StateChangeBody {
  reason: string;
}

interface TransferQuery {
  warehouseId?: string;
  sourceWarehouseId?: string;
  targetWarehouseId?: string;
  status?: TransferStatus;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "transferNumber" | "createdAt" | "status";
  direction?: "asc" | "desc";
}

interface TransferRecord {
  id: string;
  transferNumber: bigint;
  sourceWarehouseId: string;
  targetWarehouseId: string;
  status: TransferStatus;
  returnOrigin: TransferReturnOrigin | null;
  returnReason: string | null;
  description: string | null;
  createdById: string;
  shippedById: string | null;
  receivedById: string | null;
  cancelledById: string | null;
  returnedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  shippedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  returnedAt: Date | null;
  sourceWarehouse: { id: string; code: string; name: string };
  targetWarehouse: { id: string; code: string; name: string };
  createdBy: { id: string; username: string; displayName: string };
  shippedBy: { id: string; username: string; displayName: string } | null;
  receivedBy: { id: string; username: string; displayName: string } | null;
  cancelledBy: { id: string; username: string; displayName: string } | null;
  returnedBy: { id: string; username: string; displayName: string } | null;
  lines: Array<{
    id: string;
    productId: string;
    quantity: Prisma.Decimal;
    unit: Unit;
    product: { id: string; sku: string; name: string; unit: Unit };
  }>;
}

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const transferLinesSchema = {
  type: "array",
  minItems: 1,
  maxItems: 200,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["productId", "quantity"],
    properties: {
      productId: { type: "string", format: "uuid" },
      quantity: { type: "string", minLength: 1, maxLength: 19 },
    },
  },
} as const;

const createOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["sourceWarehouseId", "targetWarehouseId", "lines"],
      properties: {
        warehouseId: { type: "string", format: "uuid" },
        sourceWarehouseId: { type: "string", format: "uuid" },
        targetWarehouseId: { type: "string", format: "uuid" },
        description: {
          anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }],
        },
        lines: transferLinesSchema,
      },
    },
  },
};

const updateOptions: RouteShorthandOptions = {
  schema: {
    params: idParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["expectedUpdatedAt", "lines"],
      properties: {
        expectedUpdatedAt: { type: "string", format: "date-time" },
        description: {
          anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }],
        },
        lines: transferLinesSchema,
      },
    },
  },
};

const stateOptions: RouteShorthandOptions = {
  schema: {
    params: idParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["expectedUpdatedAt"],
      properties: {
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

const returnOptions: RouteShorthandOptions = {
  schema: {
    params: idParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["expectedUpdatedAt", "reason"],
      properties: {
        expectedUpdatedAt: { type: "string", format: "date-time" },
        reason: { type: "string", minLength: 1, maxLength: 1000 },
      },
    },
  },
};

const listOptions: RouteShorthandOptions = {
  preValidation: (request, _reply, done) => {
    const allowed = new Set([
      "warehouseId",
      "sourceWarehouseId",
      "targetWarehouseId",
      "status",
      "from",
      "to",
      "q",
      "page",
      "pageSize",
      "sort",
      "direction",
    ]);
    const queryString = request.raw.url?.split("?", 2)[1] ?? "";
    for (const key of new URLSearchParams(queryString).keys()) {
      if (!allowed.has(key)) {
        done(new ApiError(400, "INVALID_REQUEST", "İstek bilgileri geçersiz."));
        return;
      }
    }
    done();
  },
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        sourceWarehouseId: { type: "string", format: "uuid" },
        targetWarehouseId: { type: "string", format: "uuid" },
        status: {
          type: "string",
          enum: ["DRAFT", "SHIPPED", "RECEIVED", "CANCELLED", "RETURNED"],
        },
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        q: { type: "string", maxLength: 120 },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        sort: { type: "string", enum: ["transferNumber", "createdAt", "status"] },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
};

function invalid(message: string): never {
  throw new ApiError(400, "INVALID_REQUEST", message);
}

function notFound(message = "Transfer bulunamadı."): never {
  throw new ApiError(404, "NOT_FOUND", message);
}

function conflict(message: string, details?: unknown): never {
  throw new ApiError(409, "CONFLICT", message, details);
}

function currentUser(request: FastifyRequest): AuthenticatedUser {
  return requireAuthenticatedUser(request.authenticatedUser);
}

function ensureTransferRead(user: AuthenticatedUser, record: {
  sourceWarehouseId: string;
  targetWarehouseId: string;
}): void {
  if (
    user.role !== "ADMIN" &&
    !user.warehouseIds.includes(record.sourceWarehouseId) &&
    !user.warehouseIds.includes(record.targetWarehouseId)
  ) {
    notFound();
  }
}

function pageArgs(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function normalizeText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (text.length > max) invalid(`Metin en fazla ${max} karakter olabilir.`);
  return text || null;
}

function parseQuantity(value: string, unit: Unit): Prisma.Decimal {
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(value)) {
    invalid("Miktar pozitif olmalı ve en fazla üç ondalık basamak içermelidir.");
  }
  const quantity = new Prisma.Decimal(value);
  if (quantity.lte(0)) invalid("Miktar sıfırdan büyük olmalıdır.");
  if (unit === "EACH" && !quantity.isInteger()) {
    invalid("Adet birimindeki miktar tam sayı olmalıdır.");
  }
  return quantity;
}

function ensureNotStale(actual: Date, expected: string): void {
  const date = new Date(expected);
  if (!Number.isFinite(date.getTime())) {
    invalid("Düzenleme sürümü geçerli bir tarih olmalıdır.");
  }
  if (actual.getTime() !== date.getTime()) {
    conflict("Transfer başka bir kullanıcı tarafından değiştirildi. Güncel transferi yeniden açın.");
  }
}

function ensureUniqueProducts(lines: readonly TransferLineBody[]): void {
  const seen = new Set<string>();
  for (const line of lines) {
    const id = line.productId.toLowerCase();
    if (seen.has(id)) invalid("Aynı ürün transfere birden fazla kez eklenemez.");
    seen.add(id);
  }
}

async function validateLines(
  db: Database,
  lines: readonly TransferLineBody[],
  requireActive: boolean,
) {
  ensureUniqueProducts(lines);
  const ids = lines.map((line) => line.productId.toLowerCase());
  for (const id of [...ids].sort()) {
    await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id"::text AS "id"
      FROM "Product"
      WHERE "id" = ${id}::uuid
      FOR SHARE
    `;
  }
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, name: true, unit: true, isActive: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  if (products.length !== ids.length) invalid("Seçilen ürünlerden biri bulunamadı.");
  return lines.map((line) => {
    const product = productById.get(line.productId.toLowerCase());
    if (!product) invalid("Seçilen ürünlerden biri bulunamadı.");
    if (requireActive && !product.isActive) {
      conflict(`Pasif ürün ${product.sku} transferde kullanılamaz.`);
    }
    return {
      productId: product.id,
      unit: product.unit,
      quantity: parseQuantity(line.quantity, product.unit),
    };
  });
}

const transferInclude = {
  sourceWarehouse: { select: { id: true, code: true, name: true } },
  targetWarehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, username: true, displayName: true } },
  shippedBy: { select: { id: true, username: true, displayName: true } },
  receivedBy: { select: { id: true, username: true, displayName: true } },
  cancelledBy: { select: { id: true, username: true, displayName: true } },
  returnedBy: { select: { id: true, username: true, displayName: true } },
  lines: {
    orderBy: [{ productId: "asc" as const }, { id: "asc" as const }],
    include: {
      product: { select: { id: true, sku: true, name: true, unit: true } },
    },
  },
};

function transferResponse(transfer: TransferRecord) {
  return {
    ...transfer,
    transferNumber: transfer.transferNumber.toString(),
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
    shippedAt: transfer.shippedAt?.toISOString() ?? null,
    receivedAt: transfer.receivedAt?.toISOString() ?? null,
    cancelledAt: transfer.cancelledAt?.toISOString() ?? null,
    returnedAt: transfer.returnedAt?.toISOString() ?? null,
    lines: transfer.lines.map((line) => ({
      ...line,
      quantity: line.quantity.toFixed(3),
    })),
  };
}

function transferSummary(transfer: TransferRecord) {
  return {
    id: transfer.id,
    transferNumber: transfer.transferNumber.toString(),
    sourceWarehouseId: transfer.sourceWarehouseId,
    targetWarehouseId: transfer.targetWarehouseId,
    status: transfer.status,
    returnOrigin: transfer.returnOrigin,
    returnReason: transfer.returnReason,
    description: transfer.description,
    updatedAt: transfer.updatedAt.toISOString(),
    lines: transfer.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      quantity: line.quantity.toFixed(3),
      unit: line.unit,
    })),
  };
}

async function lockTransfer(
  tx: Prisma.TransactionClient,
  transferId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "Transfer"
    WHERE "id" = ${transferId}::uuid
    FOR UPDATE
  `;
  if (!rows.length) notFound();
}

async function lockWarehouses(
  tx: Prisma.TransactionClient,
  warehouseIds: readonly string[],
): Promise<void> {
  for (const warehouseId of [...new Set(warehouseIds)].sort()) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"::text AS "id"
      FROM "Warehouse"
      WHERE "id" = ${warehouseId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) notFound("Depo bulunamadı.");
  }
}

async function lockTransferLines(
  tx: Prisma.TransactionClient,
  transferId: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "TransferLine"
    WHERE "transferId" = ${transferId}::uuid
    ORDER BY "productId", "id"
    FOR UPDATE
  `;
}

async function refreshUser(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
): Promise<AuthenticatedUser> {
  const current = await tx.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      warehouseAssignments: { select: { warehouseId: true } },
    },
  });
  if (!current || !current.isActive) {
    throw new AuthorizationError("UNAUTHENTICATED", "Devam etmek için giriş yapın.");
  }
  return {
    id: current.id,
    username: current.username,
    displayName: current.displayName,
    role: current.role,
    warehouseIds: current.warehouseAssignments.map((item) => item.warehouseId),
  };
}

async function ensureWarehouseAccess(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  requireActive: boolean,
) {
  const warehouse = await tx.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!warehouse) notFound("Depo bulunamadı.");
  if (requireActive && !warehouse.isActive) {
    conflict("Pasif depoda transfer yapılamaz.");
  }
  return warehouse;
}

async function assertNoOpenCount(
  tx: Prisma.TransactionClient,
  warehouseIds: readonly string[],
): Promise<void> {
  const count = await tx.stockCount.findFirst({
    where: { warehouseId: { in: [...warehouseIds] }, status: "OPEN" },
    select: { id: true, countNumber: true },
  });
  if (count) {
    conflict("Açık sayımı bulunan depoda transfer hareketi yapılamaz.", {
      countId: count.id,
      countNumber: count.countNumber.toString(),
    });
  }
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  transferId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      userId,
      action,
      relatedType: "Transfer",
      relatedId: transferId,
      changeSummary: { before, after },
    },
  });
}

function phaseKey(request: FastifyRequest): string {
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

async function createIdempotency(
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

async function validateProductsForMovement(
  tx: Prisma.TransactionClient,
  lines: TransferRecord["lines"],
): Promise<void> {
  for (const productId of [...new Set(lines.map((line) => line.productId))].sort()) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"::text AS "id"
      FROM "Product"
      WHERE "id" = ${productId}::uuid
      FOR SHARE
    `;
  }
  const products = await tx.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    select: { id: true, sku: true, unit: true, isActive: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product || !product.isActive) {
      conflict("Pasif veya kullanılamayan ürün içeren transfer işlenemez.");
    }
    if (product.unit !== line.unit) {
      conflict("Ürünün birimi transfer taslağından sonra değişmiştir.");
    }
    parseQuantity(line.quantity.toString(), line.unit);
  }
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
    conflict("Bu güvenli tekrar anahtarı farklı bir transfer isteğinde kullanılmış.");
  }
  if (!prior.completedAt || !prior.response) {
    conflict("İşlem sonucu tamamlanmamış. Aynı anahtarla tekrar deneyin.");
  }
  return prior.response;
}

export function registerTransferRoutes(
  app: FastifyInstance,
  injectedPrisma?: PrismaClient,
): void {
  const databaseClient = () => injectedPrisma ?? getPrismaClient();

  app.get("/api/transfer-warehouses", async (request) => {
    currentUser(request);
    const warehouses = await databaseClient().warehouse.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ name: "asc" }, { code: "asc" }, { id: "asc" }],
    });
    return { items: warehouses };
  });

  app.get<{ Querystring: TransferQuery }>(
    "/api/transfers",
    listOptions,
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      if (user.role !== "ADMIN" && user.warehouseIds.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      const visibility: Prisma.TransferWhereInput =
        user.role === "ADMIN"
          ? {}
          : {
              OR: [
                { sourceWarehouseId: { in: user.warehouseIds } },
                { targetWarehouseId: { in: user.warehouseIds } },
              ],
            };
      const q = request.query.q?.trim();
      const conditions: Prisma.TransferWhereInput[] = [visibility];
      if (request.query.sourceWarehouseId) {
        conditions.push({ sourceWarehouseId: request.query.sourceWarehouseId });
      }
      if (request.query.targetWarehouseId) {
        conditions.push({ targetWarehouseId: request.query.targetWarehouseId });
      }
      if (request.query.warehouseId) {
        conditions.push({
          OR: [
            { sourceWarehouseId: request.query.warehouseId },
            { targetWarehouseId: request.query.warehouseId },
          ],
        });
      }
      if (request.query.status) conditions.push({ status: request.query.status });
      const from = request.query.from ? new Date(request.query.from) : undefined;
      const to = request.query.to ? new Date(request.query.to) : undefined;
      if (from && to && from > to) {
        invalid("Başlangıç tarihi bitiş tarihinden sonra olamaz.");
      }
      if (from || to) {
        conditions.push({
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        });
      }
      if (q) {
        conditions.push({
          OR: [
            { description: { contains: q, mode: "insensitive" } },
            { transferNumber: /^\d+$/.test(q) ? BigInt(q) : -1n },
          ],
        });
      }
      const where: Prisma.TransferWhereInput = { AND: conditions };
      const sort = request.query.sort ?? "createdAt";
      const direction = request.query.direction ?? "desc";
      const [rows, total] = await Promise.all([
        databaseClient().transfer.findMany({
          where,
          include: {
            sourceWarehouse: { select: { id: true, code: true, name: true } },
            targetWarehouse: { select: { id: true, code: true, name: true } },
            createdBy: { select: { id: true, displayName: true } },
            _count: { select: { lines: true } },
          },
          orderBy: [{ [sort]: direction }, { transferNumber: "desc" }, { id: "desc" }],
          skip,
          take,
        }),
        databaseClient().transfer.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          transferNumber: row.transferNumber.toString(),
          sourceWarehouse: row.sourceWarehouse,
          targetWarehouse: row.targetWarehouse,
          status: row.status,
          description: row.description,
          createdBy: row.createdBy,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          lineCount: row._count.lines,
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/transfers/:id",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const user = currentUser(request);
      const transfer = await databaseClient().transfer.findUnique({
        where: { id: request.params.id },
        include: transferInclude,
      });
      if (!transfer) notFound();
      ensureTransferRead(user, transfer);
      return transferResponse(transfer);
    },
  );

  app.post<{ Body: CreateTransferBody }>(
    "/api/transfers",
    createOptions,
    async (request, reply) => {
      const user = currentUser(request);
      const sourceWarehouseId = request.body.sourceWarehouseId.toLowerCase();
      const targetWarehouseId = request.body.targetWarehouseId.toLowerCase();
      requireWarehouseMutation(user, sourceWarehouseId);
      if (sourceWarehouseId === targetWarehouseId) {
        invalid("Kaynak ve hedef depo farklı olmalıdır.");
      }
      const created = await databaseClient().$transaction(async (tx) => {
        const currentUser = await refreshUser(tx, user);
        requireWarehouseMutation(currentUser, sourceWarehouseId);
        await lockWarehouses(tx, [
          sourceWarehouseId,
          targetWarehouseId,
        ]);
        const source = await ensureWarehouseAccess(
          tx,
          sourceWarehouseId,
          true,
        );
        const target = await ensureWarehouseAccess(
          tx,
          targetWarehouseId,
          true,
        );
        const lines = await validateLines(tx, request.body.lines, true);
        const transfer = await tx.transfer.create({
          data: {
            sourceWarehouseId: source.id,
            targetWarehouseId: target.id,
            description: normalizeText(request.body.description, 1000),
            createdById: currentUser.id,
            lines: {
              create: lines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unit: line.unit,
              })),
            },
          },
          include: transferInclude,
        });
        await writeAudit(
          tx,
          currentUser.id,
          "TRANSFER_CREATED",
          transfer.id,
          null,
          transferSummary(transfer),
        );
        return transfer;
      });
      return reply.code(201).send(transferResponse(created));
    },
  );

  app.patch<{ Params: IdParams; Body: UpdateTransferBody }>(
    "/api/transfers/:id",
    updateOptions,
    async (request) => {
      const user = currentUser(request);
      const candidate = await databaseClient().transfer.findUnique({
        where: { id: request.params.id },
        select: { sourceWarehouseId: true },
      });
      if (!candidate) notFound();
      requireWarehouseMutation(user, candidate.sourceWarehouseId);
      const updated = await databaseClient().$transaction(async (tx) => {
        await lockTransfer(tx, request.params.id);
        const header = await tx.transfer.findUnique({
          where: { id: request.params.id },
          select: { sourceWarehouseId: true, targetWarehouseId: true },
        });
        if (!header) notFound();
        await lockWarehouses(tx, [header.sourceWarehouseId, header.targetWarehouseId]);
        await lockTransferLines(tx, request.params.id);
        const currentUser = await refreshUser(tx, user);
        requireWarehouseMutation(currentUser, header.sourceWarehouseId);
        const before = await tx.transfer.findUnique({
          where: { id: request.params.id },
          include: transferInclude,
        });
        if (!before) notFound();
        ensureTransferRead(currentUser, before);
        if (before.status !== "DRAFT") conflict("Yalnızca taslak transferler düzenlenebilir.");
        ensureNotStale(before.updatedAt, request.body.expectedUpdatedAt);
        await ensureWarehouseAccess(tx, before.sourceWarehouseId, true);
        await ensureWarehouseAccess(tx, before.targetWarehouseId, true);
        const lines = await validateLines(tx, request.body.lines, true);
        await tx.transferLine.deleteMany({ where: { transferId: before.id } });
        const next = await tx.transfer.update({
          where: { id: before.id },
          data: {
            description: normalizeText(request.body.description, 1000),
            updatedAt: new Date(),
            lines: {
              create: lines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unit: line.unit,
              })),
            },
          },
          include: transferInclude,
        });
        await writeAudit(
          tx,
          currentUser.id,
          "TRANSFER_UPDATED",
          next.id,
          transferSummary(before),
          transferSummary(next),
        );
        return next;
      });
      return transferResponse(updated);
    },
  );

  app.post<{ Params: IdParams; Body: StateChangeBody }>(
    "/api/transfers/:id/cancel",
    stateOptions,
    async (request) => {
      const user = currentUser(request);
      const key = phaseKey(request);
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            transferId: request.params.id,
            expectedUpdatedAt: request.body.expectedUpdatedAt,
          }),
        )
        .digest("hex");
      const candidate = await databaseClient().transfer.findUnique({
        where: { id: request.params.id },
        select: { sourceWarehouseId: true },
      });
      if (!candidate) notFound();
      requireWarehouseMutation(user, candidate.sourceWarehouseId);
      const updated = await databaseClient().$transaction(async (tx) => {
        await lockTransfer(tx, request.params.id);
        const header = await tx.transfer.findUnique({
          where: { id: request.params.id },
          select: { sourceWarehouseId: true, targetWarehouseId: true },
        });
        if (!header) notFound();
        await lockWarehouses(tx, [header.sourceWarehouseId, header.targetWarehouseId]);
        await lockTransferLines(tx, request.params.id);
        const currentUser = await refreshUser(tx, user);
        requireWarehouseMutation(currentUser, header.sourceWarehouseId);
        await ensureWarehouseAccess(tx, header.sourceWarehouseId, true);
        await ensureWarehouseAccess(tx, header.targetWarehouseId, true);
        const before = await tx.transfer.findUnique({
          where: { id: request.params.id },
          include: transferInclude,
        });
        if (!before) notFound();
        ensureTransferRead(currentUser, before);
        const scope = "TRANSFER_CANCELLATION";
        const uniqueId = await createIdempotency(
          tx,
          currentUser.id,
          scope,
          key,
          requestHash,
        );
        if (!uniqueId) {
          return readIdempotentResult(
            tx,
            currentUser.id,
            scope,
            key,
            requestHash,
          );
        }
        if (before.status !== "DRAFT") conflict("Yalnızca taslak transfer iptal edilebilir.");
        ensureNotStale(before.updatedAt, request.body.expectedUpdatedAt);
        const at = new Date();
        const next = await tx.transfer.update({
          where: { id: before.id },
          data: {
            status: "CANCELLED",
            cancelledById: currentUser.id,
            cancelledAt: at,
            updatedAt: at,
          },
          include: transferInclude,
        });
        await writeAudit(
          tx,
          currentUser.id,
          "TRANSFER_CANCELLED",
          next.id,
          transferSummary(before),
          transferSummary(next),
        );
        const response = transferResponse(next);
        await tx.idempotencyRecord.update({
          where: { id: uniqueId },
          data: {
            resultType: "Transfer",
            resultReference: next.id,
            response,
            completedAt: at,
          },
        });
        return response;
      });
      return updated;
    },
  );

  const transition = async (
    request: FastifyRequest<{ Params: IdParams; Body: StateChangeBody | ReturnBody }>,
    phase: "SHIPMENT" | "RECEIPT" | "RETURN",
  ) => {
    const user = currentUser(request);
    if (phase === "RETURN" && user.role !== "ADMIN") {
      throw new AuthorizationError("FORBIDDEN", "Yalnızca yönetici transferi geri alabilir.");
    }
    const body = request.body as StateChangeBody | ReturnBody;
    const key = phaseKey(request);
    const scope =
      phase === "SHIPMENT"
        ? "TRANSFER_SHIPMENT"
        : phase === "RECEIPT"
          ? "TRANSFER_RECEIPT"
          : "TRANSFER_RETURN";
    const reason =
      phase === "RETURN" ? normalizeText((body as ReturnBody).reason, 1000) : null;
    if (phase === "RETURN" && !reason) invalid("Transfer iade nedeni zorunludur.");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          transferId: request.params.id,
          expectedUpdatedAt: body.expectedUpdatedAt,
          reason,
        }),
      )
      .digest("hex");

    return databaseClient().$transaction(async (tx) => {
      await lockTransfer(tx, request.params.id);
      const header = await tx.transfer.findUnique({
        where: { id: request.params.id },
        select: { sourceWarehouseId: true, targetWarehouseId: true },
      });
      if (!header) notFound();
      await lockWarehouses(tx, [header.sourceWarehouseId, header.targetWarehouseId]);
      await lockTransferLines(tx, request.params.id);

      const currentUser = await refreshUser(tx, user);
      if (phase === "RETURN" && currentUser.role !== "ADMIN") {
        throw new AuthorizationError("FORBIDDEN", "Yalnızca yönetici transferi geri alabilir.");
      }
      if (phase === "RECEIPT") {
        requireWarehouseMutation(currentUser, header.targetWarehouseId);
      } else {
        requireWarehouseMutation(currentUser, header.sourceWarehouseId);
      }

      const before = await tx.transfer.findUnique({
        where: { id: request.params.id },
        include: transferInclude,
      });
      if (!before) notFound();
      ensureTransferRead(currentUser, before);
      await ensureWarehouseAccess(tx, before.sourceWarehouseId, true);
      await ensureWarehouseAccess(tx, before.targetWarehouseId, true);

      const uniqueId = await createIdempotency(
        tx,
        currentUser.id,
        scope,
        key,
        requestHash,
      );
      if (!uniqueId) {
        return readIdempotentResult(tx, currentUser.id, scope, key, requestHash);
      }

      const expectedStatus =
        phase === "SHIPMENT"
          ? "DRAFT"
          : phase === "RECEIPT"
            ? "SHIPPED"
            : before.status;
      if (
        phase === "RETURN"
          ? before.status !== "SHIPPED"
          : before.status !== expectedStatus
      ) {
        conflict(
          phase === "SHIPMENT"
            ? "Yalnızca taslak transfer sevk edilebilir."
            : phase === "RECEIPT"
              ? "Yalnızca sevk edilmiş transfer teslim alınabilir."
              : "Yalnızca sevk edilmiş transfer geri döndürülebilir.",
        );
      }
      ensureNotStale(before.updatedAt, body.expectedUpdatedAt);
      if (!before.lines.length) invalid("İşlem için transferde en az bir ürün satırı olmalıdır.");
      await assertNoOpenCount(
        tx,
        phase === "SHIPMENT"
          ? [before.sourceWarehouseId]
          : phase === "RECEIPT"
            ? [before.targetWarehouseId]
            : [before.sourceWarehouseId],
      );
      await validateProductsForMovement(tx, before.lines);

      const removalWarehouseId =
        phase === "SHIPMENT" ? before.sourceWarehouseId : null;
      if (removalWarehouseId) {
        const balances = await tx.stockBalance.findMany({
          where: {
            warehouseId: removalWarehouseId,
            productId: { in: before.lines.map((line) => line.productId) },
          },
          select: { productId: true, quantity: true },
        });
        const byProduct = new Map(balances.map((item) => [item.productId, item.quantity]));
        for (const line of before.lines) {
          const available = byProduct.get(line.productId) ?? new Prisma.Decimal(0);
          if (available.lt(line.quantity)) {
            const product = before.lines.find((item) => item.productId === line.productId)?.product;
            conflict(
              `${product?.sku ?? "Ürün"} için kaynak depoda stok yetersiz. Mevcut miktar: ${available.toFixed(3)}.`,
            );
          }
        }
      }

      const at = new Date();
      const returnOrigin: TransferReturnOrigin | null =
        phase === "RETURN" ? "SHIPPED" : null;
      await tx.transfer.update({
        where: { id: before.id },
        data:
          phase === "SHIPMENT"
            ? { status: "SHIPPED", shippedById: currentUser.id, shippedAt: at, updatedAt: at }
            : phase === "RECEIPT"
              ? { status: "RECEIVED", receivedById: currentUser.id, receivedAt: at, updatedAt: at }
              : {
                  status: "RETURNED",
                  returnOrigin: returnOrigin!,
                  returnReason: reason,
                  returnedById: currentUser.id,
                  returnedAt: at,
                  updatedAt: at,
                },
      });

      for (const line of before.lines) {
        if (phase === "SHIPMENT") {
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              warehouseId: before.sourceWarehouseId,
              direction: "OUT",
              quantity: line.quantity,
              unit: line.unit,
              type: "TRANSFER_SHIPMENT",
              createdById: currentUser.id,
              transferLineId: line.id,
              transferPhase: "SHIPMENT",
            },
          });
        } else if (phase === "RECEIPT") {
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              warehouseId: before.targetWarehouseId,
              direction: "IN",
              quantity: line.quantity,
              unit: line.unit,
              type: "TRANSFER_RECEIPT",
              createdById: currentUser.id,
              transferLineId: line.id,
              transferPhase: "RECEIPT",
            },
          });
        } else {
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              warehouseId: before.sourceWarehouseId,
              direction: "IN",
              quantity: line.quantity,
              unit: line.unit,
              type: "TRANSFER_RETURN",
              createdById: currentUser.id,
              transferLineId: line.id,
              transferPhase: "RETURN_FROM_TRANSIT",
              reason,
            },
          });
        }
      }
      const after = await tx.transfer.findUniqueOrThrow({
        where: { id: before.id },
        include: transferInclude,
      });
      await writeAudit(
        tx,
        currentUser.id,
        phase === "SHIPMENT"
          ? "TRANSFER_SHIPPED"
          : phase === "RECEIPT"
            ? "TRANSFER_RECEIVED"
            : "TRANSFER_RETURNED",
        after.id,
        transferSummary(before),
        transferSummary(after),
      );
      const response = transferResponse(after);
      await tx.idempotencyRecord.update({
        where: { id: uniqueId },
        data: {
          resultType: "Transfer",
          resultReference: after.id,
          response,
          completedAt: at,
        },
      });
      return response;
    });
  };

  app.post<{ Params: IdParams; Body: StateChangeBody }>(
    "/api/transfers/:id/ship",
    stateOptions,
    async (request) => transition(request, "SHIPMENT"),
  );

  app.post<{ Params: IdParams; Body: StateChangeBody }>(
    "/api/transfers/:id/receive",
    stateOptions,
    async (request) => transition(request, "RECEIPT"),
  );

  app.post<{ Params: IdParams; Body: ReturnBody }>(
    "/api/transfers/:id/return",
    returnOptions,
    async (request) => transition(request, "RETURN"),
  );
}
