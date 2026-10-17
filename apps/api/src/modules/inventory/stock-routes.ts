import { createHash, randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  StockDocumentStatus,
  StockDocumentType,
  Unit,
} from "../../generated/prisma/enums.js";
import { getPrismaClient } from "../../database/prisma.js";
import {
  requireAuthenticatedUser,
  requireWarehouseMutation,
  type AuthenticatedUser,
} from "../auth/authorization.js";
import { ApiError } from "../../shared/api-error.js";

type Database = PrismaClient | Prisma.TransactionClient;
type SortDirection = "asc" | "desc";

interface IdParams {
  id: string;
}

interface DocumentQuery {
  type?: StockDocumentType;
  status?: StockDocumentStatus;
  warehouseId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "documentNumber" | "createdAt" | "status" | "type";
  direction?: SortDirection;
}

interface StockQuery {
  warehouseId: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "sku" | "name";
  direction?: SortDirection;
}

interface MovementQuery {
  warehouseId?: string;
  productId?: string;
  direction?: "IN" | "OUT";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  directionOrder?: SortDirection;
}

interface SupplierQuery {
  q?: string;
  isActive?: "true" | "false";
  page?: number;
  pageSize?: number;
}

interface LineBody {
  productId: string;
  quantity: string;
  locationId?: string | null;
  description?: string | null;
}

interface DocumentBody {
  type: StockDocumentType;
  warehouseId: string;
  reference?: string | null;
  description?: string | null;
  supplierId?: string | null;
  lines: LineBody[];
}

interface DocumentPatch extends Omit<DocumentBody, "type" | "warehouseId"> {
  expectedUpdatedAt: string;
}

interface StateChangeBody {
  expectedUpdatedAt: string;
}

interface IdempotencyRow {
  id: string;
}

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const lineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["productId", "quantity"],
  properties: {
    productId: { type: "string", format: "uuid" },
    quantity: { type: "string", minLength: 1, maxLength: 19 },
    locationId: {
      anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
    },
    description: {
      anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }],
    },
  },
} as const;

const documentFields = {
  warehouseId: { type: "string", format: "uuid" },
  reference: {
    anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }],
  },
  description: {
    anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }],
  },
  supplierId: {
    anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  },
  lines: {
    type: "array",
    minItems: 1,
    maxItems: 200,
    items: lineSchema,
  },
} as const;

const createOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["type", "warehouseId", "lines"],
      properties: {
        ...documentFields,
        type: { type: "string", enum: ["RECEIPT", "ISSUE"] },
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
        reference: documentFields.reference,
        description: documentFields.description,
        supplierId: documentFields.supplierId,
        lines: documentFields.lines,
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

const stateChangeOptions: RouteShorthandOptions = {
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

const listOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["RECEIPT", "ISSUE"] },
        status: { type: "string", enum: ["DRAFT", "APPROVED", "CANCELLED"] },
        warehouseId: { type: "string", format: "uuid" },
        q: { type: "string", maxLength: 120 },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        sort: {
          type: "string",
          enum: ["documentNumber", "createdAt", "status", "type"],
        },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
};

const stockOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      required: ["warehouseId"],
      properties: {
        warehouseId: { type: "string", format: "uuid" },
        q: { type: "string", maxLength: 120 },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        sort: { type: "string", enum: ["sku", "name"] },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
};

const movementOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        warehouseId: { type: "string", format: "uuid" },
        productId: { type: "string", format: "uuid" },
        direction: { type: "string", enum: ["IN", "OUT"] },
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        directionOrder: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
};

const supplierOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", maxLength: 120 },
        isActive: { type: "string", enum: ["true", "false"] },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
};

function invalid(message: string): never {
  throw new ApiError(400, "INVALID_REQUEST", message);
}

function notFound(message = "Belge bulunamadı."): never {
  throw new ApiError(404, "NOT_FOUND", message);
}

function conflict(message: string, details?: unknown): never {
  throw new ApiError(409, "CONFLICT", message, details);
}

function currentUser(request: FastifyRequest): AuthenticatedUser {
  return requireAuthenticatedUser(request.authenticatedUser);
}

function canReadWarehouse(user: AuthenticatedUser, warehouseId: string): void {
  if (user.role !== "ADMIN" && !user.warehouseIds.includes(warehouseId)) {
    notFound("Belge bulunamadı.");
  }
}

function pageArgs(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function normalizeText(
  value: string | null | undefined,
  max: number,
): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (text.length > max) invalid(`Metin en fazla ${max} karakter olabilir.`);
  return text || null;
}

function parseQuantity(value: string, unit: Unit): Prisma.Decimal {
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(value)) {
    invalid(
      "Miktar pozitif olmalı ve en fazla üç ondalık basamak içermelidir.",
    );
  }
  const quantity = new Prisma.Decimal(value);
  if (quantity.lte(0)) {
    invalid("Miktar sıfırdan büyük olmalıdır.");
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
    conflict(
      "Belge başka bir kullanıcı tarafından değiştirildi. Güncel belgeyi yeniden açın.",
    );
  }
}

function ensureUniqueProducts(lines: readonly LineBody[]): void {
  const ids = new Set<string>();
  for (const line of lines) {
    const productId = line.productId.toLowerCase();
    if (ids.has(productId)) {
      invalid("Aynı ürün belgeye birden fazla kez eklenemez.");
    }
    ids.add(productId);
  }
}

async function ensureWarehouseAccess(
  db: Database,
  user: AuthenticatedUser,
  warehouseId: string,
  requireActive: boolean,
) {
  const warehouse = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!warehouse) notFound("Depo bulunamadı.");
  canReadWarehouse(user, warehouse.id);
  if (requireActive && !warehouse.isActive) {
    conflict("Pasif depoda stok işlemi yapılamaz.");
  }
  return warehouse;
}

async function validateLines(
  db: Database,
  warehouseId: string,
  lines: readonly LineBody[],
  requireActive: boolean,
) {
  ensureUniqueProducts(lines);
  const ids = lines.map((line) => line.productId);
  for (const id of [
    ...new Set(ids.map((productId) => productId.toLowerCase())),
  ].sort()) {
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
  const byId = new Map(products.map((product) => [product.id, product]));
  if (products.length !== ids.length)
    invalid("Seçilen ürünlerden biri bulunamadı.");

  const locations = lines.flatMap((line) =>
    line.locationId ? [line.locationId] : [],
  );
  const foundLocations = locations.length
    ? await db.warehouseLocation.findMany({
        where: { id: { in: locations } },
        select: { id: true, warehouseId: true, isActive: true },
      })
    : [];
  const locationById = new Map(
    foundLocations.map((location) => [location.id, location]),
  );
  const validated = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) invalid("Seçilen ürünlerden biri bulunamadı.");
    if (requireActive && !product.isActive) {
      conflict(`Pasif ürün ${product.sku} stok işleminde kullanılamaz.`);
    }
    const quantity = parseQuantity(line.quantity, product.unit);
    if (line.locationId) {
      const location = locationById.get(line.locationId);
      if (!location || location.warehouseId !== warehouseId) {
        invalid("Seçilen raf bu depoya ait değil.");
      }
      if (requireActive && !location.isActive) {
        conflict("Pasif raf stok işleminde kullanılamaz.");
      }
    }
    const description = normalizeText(line.description, 500);
    return { ...line, description, unit: product.unit, quantity };
  });
  if (foundLocations.length !== locations.length) {
    invalid("Seçilen raf bulunamadı.");
  }
  return validated;
}

function documentSummary(document: {
  id: string;
  documentNumber: bigint;
  type: StockDocumentType;
  status: StockDocumentStatus;
  warehouseId: string;
  supplierId: string | null;
  reference: string | null;
  description: string | null;
  updatedAt: Date;
  lines: Array<{
    id: string;
    productId: string;
    quantity: Prisma.Decimal;
    unit: Unit;
    locationId: string | null;
    description: string | null;
  }>;
}) {
  return {
    id: document.id,
    documentNumber: document.documentNumber.toString(),
    type: document.type,
    status: document.status,
    warehouseId: document.warehouseId,
    supplierId: document.supplierId,
    reference: document.reference,
    description: document.description,
    updatedAt: document.updatedAt.toISOString(),
    lines: document.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      quantity: line.quantity.toFixed(3),
      unit: line.unit,
      locationId: line.locationId,
      description: line.description,
    })),
  };
}

function documentResponse(document: {
  id: string;
  documentNumber: bigint;
  type: StockDocumentType;
  status: StockDocumentStatus;
  warehouseId: string;
  supplierId: string | null;
  reference: string | null;
  description: string | null;
  createdById: string;
  approvedById: string | null;
  cancelledById: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  warehouse: { id: string; code: string; name: string };
  supplier: { id: string; code: string; name: string } | null;
  createdBy: { id: string; username: string; displayName: string };
  approvedBy: { id: string; username: string; displayName: string } | null;
  cancelledBy: { id: string; username: string; displayName: string } | null;
  lines: Array<{
    id: string;
    productId: string;
    locationId: string | null;
    unit: Unit;
    quantity: Prisma.Decimal;
    description: string | null;
    product: { id: string; sku: string; name: string; unit: Unit };
    location: { id: string; code: string; name: string } | null;
  }>;
}) {
  return {
    ...document,
    documentNumber: document.documentNumber.toString(),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    approvedAt: document.approvedAt?.toISOString() ?? null,
    cancelledAt: document.cancelledAt?.toISOString() ?? null,
    lines: document.lines.map((line) => ({
      ...line,
      quantity: line.quantity.toFixed(3),
    })),
  };
}

const documentInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, username: true, displayName: true } },
  approvedBy: { select: { id: true, username: true, displayName: true } },
  cancelledBy: { select: { id: true, username: true, displayName: true } },
  lines: {
    orderBy: [{ productId: "asc" as const }, { id: "asc" as const }],
    include: {
      product: { select: { id: true, sku: true, name: true, unit: true } },
      location: { select: { id: true, code: true, name: true } },
    },
  },
};

async function writeAudit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  documentId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      userId,
      action,
      relatedType: "StockDocument",
      relatedId: documentId,
      changeSummary: { before, after },
    },
  });
}

async function lockWarehouse(
  tx: Prisma.TransactionClient,
  warehouseId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "Warehouse"
    WHERE "id" = ${warehouseId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) notFound("Depo bulunamadı.");
}

async function lockDocument(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "StockDocument"
    WHERE "id" = ${documentId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) notFound();
}

async function lockDocumentLines(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "StockDocumentLine"
    WHERE "documentId" = ${documentId}::uuid
    ORDER BY "productId", "id"
    FOR UPDATE
  `;
}

async function insertIdempotency(
  tx: Prisma.TransactionClient,
  userId: string,
  key: string,
  requestHash: string,
): Promise<string | null> {
  const inserted = await tx.$queryRaw<IdempotencyRow[]>`
    INSERT INTO "IdempotencyRecord"
      ("id", "userId", "operationScope", "key", "requestHash", "createdAt")
    VALUES
      (${randomUUID()}::uuid, ${userId}::uuid, 'STOCK_DOCUMENT_APPROVAL',
       ${key}, ${requestHash}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "operationScope", "key") DO NOTHING
    RETURNING "id"::text AS "id"
  `;
  return inserted[0]?.id ?? null;
}

async function ensureActiveSupplier(
  db: Database,
  supplierId: string | null | undefined,
  type: StockDocumentType,
): Promise<string | null> {
  const normalized = supplierId ?? null;
  if (normalized && type !== "RECEIPT") {
    invalid("Tedarikçi yalnızca stok giriş belgesinde seçilebilir.");
  }
  if (!normalized) return null;
  const supplier = await db.supplier.findUnique({
    where: { id: normalized },
    select: { id: true, isActive: true },
  });
  if (!supplier) invalid("Seçilen tedarikçi bulunamadı.");
  if (!supplier.isActive) conflict("Pasif tedarikçi seçilemez.");
  return supplier.id;
}

export function registerStockRoutes(
  app: FastifyInstance,
  injectedPrisma?: PrismaClient,
): void {
  const databaseClient = () => injectedPrisma ?? getPrismaClient();

  app.get<{ Querystring: SupplierQuery }>(
    "/api/suppliers",
    supplierOptions,
    async (request) => {
      currentUser(request);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      const q = request.query.q?.trim();
      const where: Prisma.SupplierWhereInput = {
        ...(request.query.isActive === undefined
          ? {}
          : { isActive: request.query.isActive === "true" }),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        databaseClient().supplier.findMany({
          where,
          orderBy: [{ name: "asc" }, { code: "asc" }, { id: "asc" }],
          skip,
          take,
        }),
        databaseClient().supplier.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },
  );

  app.get<{ Querystring: DocumentQuery }>(
    "/api/stock-documents",
    listOptions,
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      let warehouseIds: string[] | undefined;
      if (user.role !== "ADMIN") {
        warehouseIds = user.warehouseIds;
      }
      if (request.query.warehouseId) {
        canReadWarehouse(user, request.query.warehouseId);
        warehouseIds = [request.query.warehouseId];
      }
      const q = request.query.q?.trim();
      const where: Prisma.StockDocumentWhereInput = {
        ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}),
        ...(request.query.type ? { type: request.query.type } : {}),
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(q
          ? {
              OR: [
                { reference: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const sort = request.query.sort ?? "createdAt";
      const direction = request.query.direction ?? "desc";
      const orderBy: Prisma.StockDocumentOrderByWithRelationInput[] = [
        { [sort]: direction },
        { documentNumber: "desc" },
        { id: "desc" },
      ];
      const [items, total] = await Promise.all([
        databaseClient().stockDocument.findMany({
          where,
          include: {
            warehouse: { select: { id: true, code: true, name: true } },
            createdBy: { select: { id: true, displayName: true } },
            _count: { select: { lines: true } },
          },
          orderBy,
          skip,
          take,
        }),
        databaseClient().stockDocument.count({ where }),
      ]);
      return {
        items: items.map((item) => ({
          ...item,
          documentNumber: item.documentNumber.toString(),
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          approvedAt: item.approvedAt?.toISOString() ?? null,
          cancelledAt: item.cancelledAt?.toISOString() ?? null,
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/stock-documents/:id",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const user = currentUser(request);
      const document = await databaseClient().stockDocument.findUnique({
        where: { id: request.params.id },
        include: documentInclude,
      });
      if (!document) notFound();
      canReadWarehouse(user, document.warehouseId);
      const response = documentResponse(document);
      const reversalCount = await databaseClient().stockMovement.count({
        where: {
          reversesMovement: { documentLine: { documentId: document.id } },
        },
      });
      return { ...response, isReversed: reversalCount > 0 };
    },
  );

  app.post<{ Body: DocumentBody }>(
    "/api/stock-documents",
    createOptions,
    async (request, reply) => {
      const user = currentUser(request);
      requireWarehouseMutation(user, request.body.warehouseId);
      const db = databaseClient();
      const reference = normalizeText(request.body.reference, 120);
      const description = normalizeText(request.body.description, 1000);
      const created = await db.$transaction(async (tx) => {
        await lockWarehouse(tx, request.body.warehouseId);
        const warehouse = await ensureWarehouseAccess(
          tx,
          user,
          request.body.warehouseId,
          true,
        );
        const lines = await validateLines(
          tx,
          warehouse.id,
          request.body.lines,
          true,
        );
        const supplierId = await ensureActiveSupplier(
          tx,
          request.body.supplierId,
          request.body.type,
        );
        const document = await tx.stockDocument.create({
          data: {
            type: request.body.type,
            warehouseId: warehouse.id,
            supplierId,
            reference,
            description,
            createdById: user.id,
            lines: {
              create: lines.map((line) => ({
                productId: line.productId,
                locationId: line.locationId ?? null,
                unit: line.unit,
                quantity: line.quantity,
                description: line.description,
              })),
            },
          },
          include: documentInclude,
        });
        await writeAudit(
          tx,
          user.id,
          "STOCK_DOCUMENT_CREATED",
          document.id,
          null,
          documentSummary(document),
        );
        return document;
      });
      return reply.code(201).send(documentResponse(created));
    },
  );

  app.patch<{ Params: IdParams; Body: DocumentPatch }>(
    "/api/stock-documents/:id",
    updateOptions,
    async (request) => {
      const db = databaseClient();
      const user = currentUser(request);
      const candidate = await db.stockDocument.findUnique({
        where: { id: request.params.id },
        select: { warehouseId: true },
      });
      if (!candidate) notFound();
      canReadWarehouse(user, candidate.warehouseId);
      requireWarehouseMutation(user, candidate.warehouseId);
      const result = await db.$transaction(async (tx) => {
        await lockWarehouse(tx, candidate.warehouseId);
        await lockDocument(tx, request.params.id);
        await lockDocumentLines(tx, request.params.id);
        const before = await tx.stockDocument.findUnique({
          where: { id: request.params.id },
          include: { lines: true },
        });
        if (!before) notFound();
        canReadWarehouse(user, before.warehouseId);
        requireWarehouseMutation(user, before.warehouseId);
        if (before.status !== "DRAFT") {
          conflict("Yalnızca taslak belgeler düzenlenebilir.");
        }
        ensureNotStale(before.updatedAt, request.body.expectedUpdatedAt);
        const warehouse = await ensureWarehouseAccess(
          tx,
          user,
          before.warehouseId,
          true,
        );
        const lines = await validateLines(
          tx,
          warehouse.id,
          request.body.lines,
          true,
        );
        const supplierId = await ensureActiveSupplier(
          tx,
          request.body.supplierId,
          before.type,
        );
        const reference = normalizeText(request.body.reference, 120);
        const description = normalizeText(request.body.description, 1000);
        await tx.stockDocumentLine.deleteMany({
          where: { documentId: before.id },
        });
        const updated = await tx.stockDocument.update({
          where: { id: before.id },
          data: {
            supplierId,
            reference,
            description,
            updatedAt: new Date(),
            lines: {
              create: lines.map((line) => ({
                productId: line.productId,
                locationId: line.locationId ?? null,
                unit: line.unit,
                quantity: line.quantity,
                description: line.description,
              })),
            },
          },
          include: documentInclude,
        });
        await writeAudit(
          tx,
          user.id,
          "STOCK_DOCUMENT_UPDATED",
          updated.id,
          documentSummary({ ...before, lines: before.lines }),
          documentSummary(updated),
        );
        return updated;
      });
      return documentResponse(result);
    },
  );

  app.post<{ Params: IdParams; Body: StateChangeBody }>(
    "/api/stock-documents/:id/cancel",
    stateChangeOptions,
    async (request) => {
      const user = currentUser(request);
      const db = databaseClient();
      const existing = await db.stockDocument.findUnique({
        where: { id: request.params.id },
        select: { warehouseId: true },
      });
      if (!existing) notFound();
      canReadWarehouse(user, existing.warehouseId);
      requireWarehouseMutation(user, existing.warehouseId);
      const result = await db.$transaction(async (tx) => {
        await lockDocument(tx, request.params.id);
        await lockDocumentLines(tx, request.params.id);
        const before = await tx.stockDocument.findUnique({
          where: { id: request.params.id },
          include: documentInclude,
        });
        if (!before) notFound();
        canReadWarehouse(user, before.warehouseId);
        requireWarehouseMutation(user, before.warehouseId);
        if (before.status !== "DRAFT") {
          conflict("Yalnızca taslak belgeler iptal edilebilir.");
        }
        ensureNotStale(before.updatedAt, request.body.expectedUpdatedAt);
        const updated = await tx.stockDocument.update({
          where: { id: before.id },
          data: {
            status: "CANCELLED",
            cancelledById: user.id,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
          include: documentInclude,
        });
        await writeAudit(
          tx,
          user.id,
          "STOCK_DOCUMENT_CANCELLED",
          updated.id,
          documentSummary(before),
          documentSummary(updated),
        );
        return updated;
      });
      return documentResponse(result);
    },
  );

  app.post<{ Params: IdParams; Body: StateChangeBody }>(
    "/api/stock-documents/:id/approve",
    stateChangeOptions,
    async (request) => {
      const user = currentUser(request);
      const headerValue = request.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(headerValue)
        ? headerValue[0]
        : headerValue;
      if (
        !idempotencyKey ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 200 ||
        !/^[A-Za-z0-9._~-]+$/.test(idempotencyKey)
      ) {
        invalid("Onay isteğinin güvenli tekrar anahtarı geçersiz veya eksik.");
      }
      const db = databaseClient();
      const candidate = await db.stockDocument.findUnique({
        where: { id: request.params.id },
        select: { warehouseId: true },
      });
      if (!candidate) notFound();
      canReadWarehouse(user, candidate.warehouseId);
      requireWarehouseMutation(user, candidate.warehouseId);
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            documentId: request.params.id,
            expectedUpdatedAt: request.body.expectedUpdatedAt,
          }),
        )
        .digest("hex");

      const result = await db.$transaction(async (tx) => {
        await lockWarehouse(tx, candidate.warehouseId);
        await lockDocument(tx, request.params.id);
        await lockDocumentLines(tx, request.params.id);
        const before = await tx.stockDocument.findUnique({
          where: { id: request.params.id },
          include: {
            lines: { orderBy: [{ productId: "asc" }, { id: "asc" }] },
          },
        });
        if (!before) notFound();
        canReadWarehouse(user, before.warehouseId);
        requireWarehouseMutation(user, before.warehouseId);

        const uniqueId = await insertIdempotency(
          tx,
          user.id,
          idempotencyKey,
          requestHash,
        );
        if (!uniqueId) {
          const prior = await tx.idempotencyRecord.findUnique({
            where: {
              userId_operationScope_key: {
                userId: user.id,
                operationScope: "STOCK_DOCUMENT_APPROVAL",
                key: idempotencyKey,
              },
            },
          });
          if (!prior)
            conflict(
              "İşlem sonucu henüz doğrulanamadı. Aynı anahtarla tekrar deneyin.",
            );
          if (prior.requestHash !== requestHash) {
            conflict(
              "Bu güvenli tekrar anahtarı farklı bir onay isteğinde kullanılmış.",
            );
          }
          if (!prior.completedAt || !prior.response) {
            conflict(
              "Onay sonucu tamamlanmamış. Aynı anahtarla tekrar deneyin.",
            );
          }
          return prior.response;
        }

        if (before.status !== "DRAFT") {
          conflict("Yalnızca taslak belgeler onaylanabilir.");
        }
        ensureNotStale(before.updatedAt, request.body.expectedUpdatedAt);
        await ensureWarehouseAccess(tx, user, before.warehouseId, true);
        if (before.lines.length === 0) {
          invalid("Onay için belgede en az bir ürün satırı bulunmalıdır.");
        }
        const openCount = await tx.stockCount.findFirst({
          where: { warehouseId: before.warehouseId, status: "OPEN" },
          select: { id: true, countNumber: true },
        });
        if (openCount) {
          conflict("Açık sayımı bulunan depoda stok belgesi onaylanamaz.", {
            countId: openCount.id,
            countNumber: openCount.countNumber.toString(),
          });
        }
        const supplierId = await ensureActiveSupplier(
          tx,
          before.supplierId,
          before.type,
        );
        const productIds = before.lines.map((line) => line.productId);
        for (const productId of [...productIds].sort()) {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"::text AS "id"
            FROM "Product"
            WHERE "id" = ${productId}::uuid
            FOR SHARE
          `;
        }
        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, unit: true, isActive: true },
        });
        const productById = new Map(
          products.map((product) => [product.id, product]),
        );
        if (products.length !== productIds.length) {
          conflict("Belgedeki ürünlerden biri artık kullanılamıyor.");
        }
        for (const line of before.lines) {
          const product = productById.get(line.productId);
          if (!product || !product.isActive) {
            conflict("Pasif ürün içeren belge onaylanamaz.");
          }
          if (product.unit !== line.unit) {
            conflict("Ürünün birimi belge oluşturulduktan sonra değişmiş.");
          }
          parseQuantity(line.quantity.toString(), line.unit);
          if (line.locationId) {
            const location = await tx.warehouseLocation.findUnique({
              where: { id: line.locationId },
              select: { warehouseId: true, isActive: true },
            });
            if (
              !location ||
              location.warehouseId !== before.warehouseId ||
              !location.isActive
            ) {
              conflict("Belgedeki raf artık bu işlem için kullanılamıyor.");
            }
          }
        }

        if (before.type === "ISSUE") {
          const balances = await tx.stockBalance.findMany({
            where: {
              warehouseId: before.warehouseId,
              productId: { in: productIds },
            },
            select: { productId: true, quantity: true },
          });
          const balanceByProduct = new Map(
            balances.map((balance) => [balance.productId, balance.quantity]),
          );
          for (const line of before.lines) {
            const available =
              balanceByProduct.get(line.productId) ?? new Prisma.Decimal(0);
            if (available.lt(line.quantity)) {
              const product = productById.get(line.productId);
              conflict(
                `${product?.sku ?? "Ürün"} için stok yetersiz. Mevcut miktar: ${available.toFixed(3)}.`,
              );
            }
          }
        }

        const approvedAt = new Date();
        await tx.stockDocument.update({
          where: { id: before.id },
          data: {
            status: "APPROVED",
            supplierId,
            approvedById: user.id,
            approvedAt,
            updatedAt: approvedAt,
          },
        });
        for (const line of before.lines) {
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              warehouseId: before.warehouseId,
              direction: before.type === "RECEIPT" ? "IN" : "OUT",
              quantity: line.quantity,
              unit: line.unit,
              type: before.type === "RECEIPT" ? "RECEIPT" : "ISSUE",
              createdById: user.id,
              documentLineId: line.id,
            },
          });
        }
        const after = await tx.stockDocument.findUniqueOrThrow({
          where: { id: before.id },
          include: documentInclude,
        });
        await writeAudit(
          tx,
          user.id,
          "STOCK_DOCUMENT_APPROVED",
          after.id,
          documentSummary({ ...before, lines: before.lines }),
          documentSummary(after),
        );
        const response = documentResponse(after);
        await tx.idempotencyRecord.update({
          where: { id: uniqueId },
          data: {
            resultType: "StockDocument",
            resultReference: after.id,
            response,
            completedAt: approvedAt,
          },
        });
        return response;
      });
      return result;
    },
  );

  app.get<{ Querystring: StockQuery }>(
    "/api/stock",
    stockOptions,
    async (request) => {
      const user = currentUser(request);
      canReadWarehouse(user, request.query.warehouseId);
      const db = databaseClient();
      await ensureWarehouseAccess(db, user, request.query.warehouseId, false);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      const q = request.query.q?.trim();
      const where: Prisma.ProductWhereInput = q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q } },
            ],
          }
        : {};
      const direction = request.query.direction ?? "asc";
      const sort = request.query.sort ?? "sku";
      const [products, total] = await Promise.all([
        db.product.findMany({
          where,
          include: {
            balances: {
              where: { warehouseId: request.query.warehouseId },
              select: { quantity: true, updatedAt: true },
            },
          },
          orderBy: [{ [sort]: direction }, { sku: "asc" }, { id: "asc" }],
          skip,
          take,
        }),
        db.product.count({ where }),
      ]);
      const transferQuantities = products.length
        ? await db.$queryRaw<
            Array<{
              productId: string;
              incoming: string;
              outgoing: string;
            }>
          >`
            SELECT
              line."productId"::text AS "productId",
              COALESCE(
                SUM(line."quantity") FILTER (
                  WHERE transfer."targetWarehouseId" = ${request.query.warehouseId}::uuid
                ),
                0
              )::text AS "incoming",
              COALESCE(
                SUM(line."quantity") FILTER (
                  WHERE transfer."sourceWarehouseId" = ${request.query.warehouseId}::uuid
                ),
                0
              )::text AS "outgoing"
            FROM "TransferLine" line
            INNER JOIN "Transfer" transfer ON transfer."id" = line."transferId"
            WHERE transfer."status" = 'SHIPPED'
              AND (
                transfer."sourceWarehouseId" = ${request.query.warehouseId}::uuid
                OR transfer."targetWarehouseId" = ${request.query.warehouseId}::uuid
              )
              AND line."productId" IN (${Prisma.join(
                products.map((product) => Prisma.sql`${product.id}::uuid`),
              )})
            GROUP BY line."productId"
          `
        : [];
      const inTransitByProduct = new Map(
        transferQuantities.map((item) => [item.productId, item]),
      );
      return {
        items: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          isActive: product.isActive,
          quantity: product.balances[0]?.quantity.toFixed(3) ?? "0.000",
          updatedAt: product.balances[0]?.updatedAt.toISOString() ?? null,
          inTransitIncoming: new Prisma.Decimal(
            inTransitByProduct.get(product.id)?.incoming ?? "0",
          ).toFixed(3),
          inTransitOutgoing: new Prisma.Decimal(
            inTransitByProduct.get(product.id)?.outgoing ?? "0",
          ).toFixed(3),
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get<{ Querystring: MovementQuery }>(
    "/api/stock-movements",
    movementOptions,
    async (request) => {
      const user = currentUser(request);
      let warehouseIds: string[] | undefined;
      if (user.role !== "ADMIN") warehouseIds = user.warehouseIds;
      if (request.query.warehouseId) {
        canReadWarehouse(user, request.query.warehouseId);
        warehouseIds = [request.query.warehouseId];
      }
      const from = request.query.from
        ? new Date(request.query.from)
        : undefined;
      const to = request.query.to ? new Date(request.query.to) : undefined;
      if (from && to && from > to)
        invalid("Başlangıç tarihi bitiş tarihinden sonra olamaz.");
      const { page, pageSize, skip, take } = pageArgs(request.query);
      const where: Prisma.StockMovementWhereInput = {
        ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}),
        ...(request.query.productId
          ? { productId: request.query.productId }
          : {}),
        ...(request.query.direction
          ? { direction: request.query.direction }
          : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        databaseClient().stockMovement.findMany({
          where,
          include: {
            product: { select: { id: true, sku: true, name: true } },
            warehouse: { select: { id: true, code: true, name: true } },
            createdBy: {
              select: { id: true, username: true, displayName: true },
            },
            documentLine: {
              select: {
                document: {
                  select: {
                    id: true,
                    documentNumber: true,
                    type: true,
                    reference: true,
                  },
                },
              },
            },
          },
          orderBy: [
            { createdAt: request.query.directionOrder ?? "desc" },
            { id: request.query.directionOrder ?? "desc" },
          ],
          skip,
          take,
        }),
        databaseClient().stockMovement.count({ where }),
      ]);
      return {
        items: items.map((item) => ({
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          direction: item.direction,
          quantity: item.quantity.toFixed(3),
          type: item.type,
          product: item.product,
          warehouse: item.warehouse,
          createdBy: item.createdBy,
          document: item.documentLine
            ? {
                ...item.documentLine.document,
                documentNumber:
                  item.documentLine.document.documentNumber.toString(),
              }
            : null,
        })),
        total,
        page,
        pageSize,
      };
    },
  );
}
