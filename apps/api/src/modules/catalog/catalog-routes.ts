import type {
  FastifyInstance,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { Unit } from "../../generated/prisma/enums.js";
import { getPrismaClient } from "../../database/prisma.js";
import {
  requireAuthenticatedUser,
  requireRole,
  type AuthenticatedUser,
} from "../auth/authorization.js";
import { ApiError } from "../../shared/api-error.js";

type Database = PrismaClient | Prisma.TransactionClient;
type Mutation = "PRODUCT" | "CATEGORY" | "WAREHOUSE" | "LOCATION";
type Direction = "asc" | "desc";

interface ProductQuery {
  q?: string;
  categoryId?: string;
  isActive?: "true" | "false";
  page?: number;
  pageSize?: number;
  sort?: "sku" | "name" | "category" | "unit" | "barcode" | "isActive";
  direction?: Direction;
}

interface EntityQuery {
  q?: string;
  isActive?: "true" | "false";
  page?: number;
  pageSize?: number;
  sort?: "code" | "name" | "isActive";
  direction?: Direction;
}

interface ProductBody {
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId: string;
  unit: Unit;
  isActive?: boolean;
}

interface ProductPatch extends Partial<ProductBody> {
  expectedUpdatedAt: string;
}

interface NamedBody {
  code: string;
  name: string;
  isActive?: boolean;
}

interface NamedPatch extends Partial<NamedBody> {
  expectedUpdatedAt: string;
}

interface LocationBody {
  code: string;
  name: string;
  isActive?: boolean;
}

interface LocationPatch extends Partial<LocationBody> {
  expectedUpdatedAt: string;
}

interface IdParams {
  id: string;
}

interface WarehouseParams {
  warehouseId: string;
}

interface LocationParams extends WarehouseParams {
  locationId: string;
}

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const warehouseParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["warehouseId"],
  properties: { warehouseId: { type: "string", format: "uuid" } },
} as const;

const locationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["warehouseId", "locationId"],
  properties: {
    warehouseId: { type: "string", format: "uuid" },
    locationId: { type: "string", format: "uuid" },
  },
} as const;

const productFields = {
  sku: { type: "string", minLength: 1, maxLength: 64 },
  barcode: { anyOf: [{ type: "string", maxLength: 64 }, { type: "null" }] },
  name: { type: "string", minLength: 1, maxLength: 180 },
  description: {
    anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }],
  },
  categoryId: { type: "string", format: "uuid" },
  unit: { type: "string", enum: ["EACH", "KILOGRAM", "METER"] },
  isActive: { type: "boolean" },
} as const;

const productCreateOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["sku", "name", "categoryId", "unit"],
      properties: productFields,
    },
  },
};

const productUpdateOptions: RouteShorthandOptions = {
  schema: {
    params: idParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["expectedUpdatedAt"],
      minProperties: 2,
      properties: {
        ...productFields,
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

const namedFields = {
  code: { type: "string", minLength: 1, maxLength: 48 },
  name: { type: "string", minLength: 1, maxLength: 120 },
  isActive: { type: "boolean" },
} as const;

const namedCreateOptions: RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["code", "name"],
      properties: namedFields,
    },
  },
};

const namedUpdateOptions: RouteShorthandOptions = {
  schema: {
    params: idParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["expectedUpdatedAt"],
      minProperties: 2,
      properties: {
        ...namedFields,
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

const locationFields = {
  code: { type: "string", minLength: 1, maxLength: 48 },
  name: { type: "string", minLength: 1, maxLength: 120 },
  isActive: { type: "boolean" },
} as const;

const locationCreateOptions: RouteShorthandOptions = {
  schema: {
    params: warehouseParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["code", "name"],
      properties: locationFields,
    },
  },
};

const locationUpdateOptions: RouteShorthandOptions = {
  schema: {
    params: locationParamsSchema,
    body: {
      type: "object",
      additionalProperties: false,
      required: ["expectedUpdatedAt"],
      minProperties: 2,
      properties: {
        ...locationFields,
        expectedUpdatedAt: { type: "string", format: "date-time" },
      },
    },
  },
};

const productListOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", maxLength: 120 },
        categoryId: { type: "string", format: "uuid" },
        isActive: { type: "string", enum: ["true", "false"] },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        sort: {
          type: "string",
          enum: ["sku", "name", "category", "unit", "barcode", "isActive"],
        },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
};

const entityListOptions: RouteShorthandOptions = {
  schema: {
    querystring: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", maxLength: 120 },
        isActive: { type: "string", enum: ["true", "false"] },
        page: { type: "integer", minimum: 1, maximum: 100_000 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        sort: { type: "string", enum: ["code", "name", "isActive"] },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
};

function currentUser(request: FastifyRequest): AuthenticatedUser {
  return requireAuthenticatedUser(request.authenticatedUser);
}

function adminOnly(request: FastifyRequest): AuthenticatedUser {
  const user = currentUser(request);
  requireRole(user, ["ADMIN"]);
  return user;
}

function invalid(message: string): never {
  throw new ApiError(400, "INVALID_INPUT", message);
}

function notFound(message = "Kayıt bulunamadı."): never {
  throw new ApiError(404, "NOT_FOUND", message);
}

function conflict(message: string): never {
  throw new ApiError(409, "CONFLICT", message);
}

function isAscii(value: string): boolean {
  return Array.from(value).every(
    (character) => character.charCodeAt(0) <= 0x7f,
  );
}

function normalizedCode(value: string, label: string): string {
  if (!isAscii(value)) {
    invalid(`${label}, ASCII harf ve rakamlardan oluşmalıdır.`);
  }
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,47}$/.test(code)) {
    invalid(
      `${label}, 1-48 karakter olmalı; A-Z, 0-9, nokta, alt çizgi ve kısa çizgi dışında karakter içermemelidir.`,
    );
  }
  return code;
}

function normalizedSku(value: string): string {
  if (!isAscii(value)) {
    invalid("SKU yalnızca ASCII harf ve rakamlardan oluşmalıdır.");
  }
  const sku = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku)) {
    invalid(
      "SKU 1-64 karakter olmalı; A-Z, 0-9, nokta, alt çizgi ve kısa çizgi dışında karakter içermemelidir.",
    );
  }
  return sku;
}

function normalizedBarcode(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const barcode = value.trim();
  if (barcode === "") {
    return null;
  }
  if (!/^[\x20-\x7e]{1,64}$/.test(barcode)) {
    invalid(
      "Barkod en fazla 64 karakter olmalı ve yalnızca görünür ASCII karakterleri içermelidir.",
    );
  }
  return barcode;
}

function normalizedName(
  value: string,
  label: string,
  maxLength: number,
): string {
  const name = value.trim();
  if (!name || name.length > maxLength) {
    invalid(`${label} boş olamaz ve en fazla ${maxLength} karakter olmalıdır.`);
  }
  return name;
}

function normalizedDescription(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  const description = value.trim();
  if (description.length > 1000) {
    invalid("Açıklama en fazla 1000 karakter olmalıdır.");
  }
  return description || null;
}

function expectedDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    invalid("Düzenleme sürümü geçerli bir tarih olmalıdır.");
  }
  return date;
}

function isPrismaError(
  error: unknown,
  code: string,
): error is { code: string; meta?: { target?: unknown } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function uniqueConflict(error: unknown, entity: Mutation): never {
  const target =
    isPrismaError(error, "P2002") && error.meta?.target
      ? String(error.meta.target).toLowerCase()
      : "";

  if (entity === "PRODUCT" && target.includes("barcode")) {
    conflict("Bu barkod başka bir üründe kullanılıyor.");
  }
  if (entity === "PRODUCT" && target.includes("sku")) {
    conflict("Bu SKU başka bir üründe kullanılıyor.");
  }
  if (entity === "CATEGORY") {
    conflict("Bu kategori kodu zaten kullanılıyor.");
  }
  if (entity === "WAREHOUSE") {
    conflict("Bu depo kodu zaten kullanılıyor.");
  }
  if (entity === "LOCATION") {
    conflict("Bu depoda aynı raf kodu zaten kullanılıyor.");
  }
  conflict(
    "Bu kayıt için benzersiz olması gereken bir değer zaten kullanılıyor.",
  );
}

async function withUniqueConflict<T>(
  entity: Mutation,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      uniqueConflict(error, entity);
    }
    if (isPrismaError(error, "P2003")) {
      invalid("İlişkili kayıt bulunamadı veya artık kullanılamıyor.");
    }
    throw error;
  }
}

function ensureWarehouseVisible(
  user: AuthenticatedUser,
  warehouseId: string,
): void {
  if (user.role !== "ADMIN" && !user.warehouseIds.includes(warehouseId)) {
    notFound("Depo bulunamadı.");
  }
}

function pageArgs(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function activeFilter(value: "true" | "false" | undefined) {
  return value === undefined ? undefined : value === "true";
}

function ensureNotStale(actual: Date, expected: string, message: string): void {
  if (actual.getTime() !== expectedDate(expected).getTime()) {
    conflict(message);
  }
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  relatedType: string,
  relatedId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      userId,
      action,
      relatedType,
      relatedId,
      changeSummary: { before, after },
    },
  });
}

function productSummary(product: {
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  unit: Unit;
  isActive: boolean;
}): Prisma.InputJsonValue {
  return {
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    unit: product.unit,
    isActive: product.isActive,
  };
}

function namedSummary(record: {
  code: string;
  name: string;
  isActive: boolean;
}): Prisma.InputJsonValue {
  return { code: record.code, name: record.name, isActive: record.isActive };
}

function locationSummary(record: {
  warehouseId: string;
  code: string;
  name: string;
  isActive: boolean;
}): Prisma.InputJsonValue {
  return {
    warehouseId: record.warehouseId,
    code: record.code,
    name: record.name,
    isActive: record.isActive,
  };
}

async function ensureActiveCategory(
  db: Database,
  categoryId: string,
  existingCategoryId?: string,
): Promise<void> {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { id: true, isActive: true },
  });
  if (!category) {
    invalid("Seçilen kategori bulunamadı.");
  }
  if (!category.isActive && category.id !== existingCategoryId) {
    invalid("Pasif kategori yeni ürünlere atanamaz.");
  }
}

async function isProductUnitInUse(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<boolean> {
  const [movement, documentLine, transferLine, countLine] = await Promise.all([
    tx.stockMovement.findFirst({ where: { productId }, select: { id: true } }),
    tx.stockDocumentLine.findFirst({
      where: { productId },
      select: { id: true },
    }),
    tx.transferLine.findFirst({ where: { productId }, select: { id: true } }),
    tx.stockCountLine.findFirst({ where: { productId }, select: { id: true } }),
  ]);
  return Boolean(movement || documentLine || transferLine || countLine);
}

async function lockWarehouse(
  tx: Prisma.TransactionClient,
  warehouseId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Warehouse" WHERE "id" = ${warehouseId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) {
    notFound("Depo bulunamadı.");
  }
}

export async function ensureWarehouseCanBeDeactivated(
  tx: Prisma.TransactionClient,
  warehouseId: string,
): Promise<void> {
  const [positiveBalance, openTransfer, openCount] = await Promise.all([
    tx.stockBalance.findFirst({
      where: { warehouseId, quantity: { gt: 0 } },
      select: { productId: true },
    }),
    tx.transfer.findFirst({
      where: {
        status: { in: ["DRAFT", "SHIPPED"] },
        OR: [
          { sourceWarehouseId: warehouseId },
          { targetWarehouseId: warehouseId },
        ],
      },
      select: { id: true },
    }),
    tx.stockCount.findFirst({
      where: { warehouseId, status: "OPEN" },
      select: { id: true },
    }),
  ]);
  if (positiveBalance) {
    conflict("Pozitif stok bakiyesi bulunan depo pasifleştirilemez.");
  }
  if (openTransfer) {
    conflict("Devam eden transferi bulunan depo pasifleştirilemez.");
  }
  if (openCount) {
    conflict("Açık sayımı bulunan depo pasifleştirilemez.");
  }
}

function forbiddenUnlessAdmin(request: FastifyRequest): AuthenticatedUser {
  return adminOnly(request);
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  injectedPrisma?: PrismaClient,
): void {
  const databaseClient = () => injectedPrisma ?? getPrismaClient();

  app.get<{ Querystring: ProductQuery }>(
    "/api/products",
    productListOptions,
    async (request) => {
      currentUser(request);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      const q = request.query.q?.trim();
      const isActive = activeFilter(request.query.isActive);
      const where: Prisma.ProductWhereInput = {
        ...(request.query.categoryId
          ? { categoryId: request.query.categoryId }
          : {}),
        ...(isActive === undefined ? {} : { isActive }),
        ...(q
          ? {
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                { barcode: { contains: q } },
              ],
            }
          : {}),
      };
      const direction = request.query.direction ?? "asc";
      const sort = request.query.sort ?? "sku";
      const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
        sort === "category"
          ? { category: { name: direction } }
          : { [sort]: direction },
        { sku: "asc" },
        { id: "asc" },
      ];
      const [items, total] = await Promise.all([
        databaseClient().product.findMany({
          where,
          include: {
            category: { select: { id: true, code: true, name: true } },
          },
          orderBy,
          skip,
          take,
        }),
        databaseClient().product.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/products/:id",
    { schema: { params: idParamsSchema } },
    async (request) => {
      currentUser(request);
      const product = await databaseClient().product.findUnique({
        where: { id: request.params.id },
        include: { category: { select: { id: true, code: true, name: true } } },
      });
      if (!product) {
        notFound("Ürün bulunamadı.");
      }
      return product;
    },
  );

  app.post<{ Body: ProductBody }>(
    "/api/products",
    productCreateOptions,
    async (request, reply) => {
      const user = forbiddenUnlessAdmin(request);
      const body = request.body;
      const sku = normalizedSku(body.sku);
      const barcode = normalizedBarcode(body.barcode);
      const name = normalizedName(body.name, "Ürün adı", 180);
      const description = normalizedDescription(body.description);

      const product = await withUniqueConflict("PRODUCT", () =>
        databaseClient().$transaction(async (tx) => {
          await ensureActiveCategory(tx, body.categoryId);
          const created = await tx.product.create({
            data: {
              sku,
              barcode,
              name,
              description,
              categoryId: body.categoryId,
              unit: body.unit,
              isActive: body.isActive ?? true,
            },
            include: {
              category: { select: { id: true, code: true, name: true } },
            },
          });
          await writeAudit(
            tx,
            user.id,
            "PRODUCT_CREATED",
            "Product",
            created.id,
            null,
            productSummary(created),
          );
          return created;
        }),
      );
      return reply.code(201).send(product);
    },
  );

  app.patch<{ Params: IdParams; Body: ProductPatch }>(
    "/api/products/:id",
    productUpdateOptions,
    async (request) => {
      const user = forbiddenUnlessAdmin(request);
      const body = request.body;
      const expected = expectedDate(body.expectedUpdatedAt);

      return withUniqueConflict("PRODUCT", () =>
        databaseClient().$transaction(async (tx) => {
          const before = await tx.product.findUnique({
            where: { id: request.params.id },
          });
          if (!before) {
            notFound("Ürün bulunamadı.");
          }
          ensureNotStale(
            before.updatedAt,
            body.expectedUpdatedAt,
            "Ürün başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
          );

          const nextCategoryId = body.categoryId ?? before.categoryId;
          if (body.categoryId && body.categoryId !== before.categoryId) {
            await ensureActiveCategory(tx, body.categoryId, before.categoryId);
          }
          await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${before.id}::uuid FOR UPDATE`;
          const nextUnit = body.unit ?? before.unit;
          if (
            nextUnit !== before.unit &&
            (await isProductUnitInUse(tx, before.id))
          ) {
            conflict(
              "Stok veya belge geçmişi bulunan ürünün birimi değiştirilemez.",
            );
          }
          const data: Prisma.ProductUpdateManyMutationInput = {
            ...(body.sku !== undefined ? { sku: normalizedSku(body.sku) } : {}),
            ...(body.barcode !== undefined
              ? { barcode: normalizedBarcode(body.barcode) }
              : {}),
            ...(body.name !== undefined
              ? { name: normalizedName(body.name, "Ürün adı", 180) }
              : {}),
            ...(body.description !== undefined
              ? { description: normalizedDescription(body.description) }
              : {}),
            ...(body.categoryId !== undefined
              ? { categoryId: nextCategoryId }
              : {}),
            ...(body.unit !== undefined ? { unit: body.unit } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            updatedAt: new Date(),
          };
          const updated = await tx.product.updateMany({
            where: { id: before.id, updatedAt: expected },
            data,
          });
          if (updated.count !== 1) {
            conflict(
              "Ürün başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
            );
          }
          const after = await tx.product.findUniqueOrThrow({
            where: { id: before.id },
            include: {
              category: { select: { id: true, code: true, name: true } },
            },
          });
          const statusChanged =
            body.isActive !== undefined && body.isActive !== before.isActive;
          await writeAudit(
            tx,
            user.id,
            statusChanged ? "PRODUCT_STATUS_CHANGED" : "PRODUCT_UPDATED",
            "Product",
            after.id,
            productSummary(before),
            productSummary(after),
          );
          return after;
        }),
      );
    },
  );

  app.get<{ Querystring: EntityQuery }>(
    "/api/categories",
    entityListOptions,
    async (request) => {
      currentUser(request);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      const q = request.query.q?.trim();
      const isActive = activeFilter(request.query.isActive);
      const where: Prisma.CategoryWhereInput = {
        ...(isActive === undefined ? {} : { isActive }),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const sort = request.query.sort ?? "name";
      const direction = request.query.direction ?? "asc";
      const [items, total] = await Promise.all([
        databaseClient().category.findMany({
          where,
          orderBy: [{ [sort]: direction }, { id: "asc" }],
          skip,
          take,
        }),
        databaseClient().category.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/categories/:id",
    { schema: { params: idParamsSchema } },
    async (request) => {
      currentUser(request);
      const category = await databaseClient().category.findUnique({
        where: { id: request.params.id },
      });
      if (!category) {
        notFound("Kategori bulunamadı.");
      }
      return category;
    },
  );

  app.post<{ Body: NamedBody }>(
    "/api/categories",
    namedCreateOptions,
    async (request, reply) => {
      const user = adminOnly(request);
      const code = normalizedCode(request.body.code, "Kategori kodu");
      const name = normalizedName(request.body.name, "Kategori adı", 120);
      const category = await withUniqueConflict("CATEGORY", () =>
        databaseClient().$transaction(async (tx) => {
          const created = await tx.category.create({
            data: {
              code,
              name,
              isActive: request.body.isActive ?? true,
            },
          });
          await writeAudit(
            tx,
            user.id,
            "CATEGORY_CREATED",
            "Category",
            created.id,
            null,
            namedSummary(created),
          );
          return created;
        }),
      );
      return reply.code(201).send(category);
    },
  );

  app.patch<{ Params: IdParams; Body: NamedPatch }>(
    "/api/categories/:id",
    namedUpdateOptions,
    async (request) => {
      const user = adminOnly(request);
      return withUniqueConflict("CATEGORY", () =>
        databaseClient().$transaction(async (tx) => {
          const before = await tx.category.findUnique({
            where: { id: request.params.id },
          });
          if (!before) {
            notFound("Kategori bulunamadı.");
          }
          ensureNotStale(
            before.updatedAt,
            request.body.expectedUpdatedAt,
            "Kategori başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
          );
          const updated = await tx.category.updateMany({
            where: {
              id: before.id,
              updatedAt: expectedDate(request.body.expectedUpdatedAt),
            },
            data: {
              ...(request.body.code !== undefined
                ? { code: normalizedCode(request.body.code, "Kategori kodu") }
                : {}),
              ...(request.body.name !== undefined
                ? {
                    name: normalizedName(
                      request.body.name,
                      "Kategori adı",
                      120,
                    ),
                  }
                : {}),
              ...(request.body.isActive !== undefined
                ? { isActive: request.body.isActive }
                : {}),
              updatedAt: new Date(),
            },
          });
          if (updated.count !== 1) {
            conflict(
              "Kategori başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
            );
          }
          const after = await tx.category.findUniqueOrThrow({
            where: { id: before.id },
          });
          const statusChanged =
            request.body.isActive !== undefined &&
            request.body.isActive !== before.isActive;
          await writeAudit(
            tx,
            user.id,
            statusChanged ? "CATEGORY_STATUS_CHANGED" : "CATEGORY_UPDATED",
            "Category",
            after.id,
            namedSummary(before),
            namedSummary(after),
          );
          return after;
        }),
      );
    },
  );

  app.get<{ Querystring: EntityQuery }>(
    "/api/warehouses",
    entityListOptions,
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize, skip, take } = pageArgs(request.query);
      const q = request.query.q?.trim();
      const isActive = activeFilter(request.query.isActive);
      const where: Prisma.WarehouseWhereInput = {
        ...(user.role === "ADMIN" ? {} : { id: { in: user.warehouseIds } }),
        ...(isActive === undefined ? {} : { isActive }),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const sort = request.query.sort ?? "code";
      const direction = request.query.direction ?? "asc";
      const [items, total] = await Promise.all([
        databaseClient().warehouse.findMany({
          where,
          include: { _count: { select: { locations: true } } },
          orderBy: [{ [sort]: direction }, { id: "asc" }],
          skip,
          take,
        }),
        databaseClient().warehouse.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/warehouses/:id",
    { schema: { params: idParamsSchema } },
    async (request) => {
      const user = currentUser(request);
      ensureWarehouseVisible(user, request.params.id);
      const warehouse = await databaseClient().warehouse.findUnique({
        where: { id: request.params.id },
        include: {
          locations: { orderBy: [{ code: "asc" }, { id: "asc" }] },
        },
      });
      if (!warehouse) {
        notFound("Depo bulunamadı.");
      }
      return warehouse;
    },
  );

  app.post<{ Body: NamedBody }>(
    "/api/warehouses",
    namedCreateOptions,
    async (request, reply) => {
      const user = adminOnly(request);
      const code = normalizedCode(request.body.code, "Depo kodu");
      const name = normalizedName(request.body.name, "Depo adı", 120);
      const warehouse = await withUniqueConflict("WAREHOUSE", () =>
        databaseClient().$transaction(async (tx) => {
          const created = await tx.warehouse.create({
            data: {
              code,
              name,
              isActive: request.body.isActive ?? true,
            },
          });
          await writeAudit(
            tx,
            user.id,
            "WAREHOUSE_CREATED",
            "Warehouse",
            created.id,
            null,
            namedSummary(created),
          );
          return created;
        }),
      );
      return reply.code(201).send(warehouse);
    },
  );

  app.patch<{ Params: IdParams; Body: NamedPatch }>(
    "/api/warehouses/:id",
    namedUpdateOptions,
    async (request) => {
      const user = adminOnly(request);
      return withUniqueConflict("WAREHOUSE", () =>
        databaseClient().$transaction(async (tx) => {
          await lockWarehouse(tx, request.params.id);
          const before = await tx.warehouse.findUnique({
            where: { id: request.params.id },
          });
          if (!before) {
            notFound("Depo bulunamadı.");
          }
          ensureNotStale(
            before.updatedAt,
            request.body.expectedUpdatedAt,
            "Depo başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
          );
          const isActive = request.body.isActive ?? before.isActive;
          if (before.isActive && !isActive) {
            await ensureWarehouseCanBeDeactivated(tx, before.id);
          }
          const updated = await tx.warehouse.updateMany({
            where: {
              id: before.id,
              updatedAt: expectedDate(request.body.expectedUpdatedAt),
            },
            data: {
              ...(request.body.code !== undefined
                ? { code: normalizedCode(request.body.code, "Depo kodu") }
                : {}),
              ...(request.body.name !== undefined
                ? { name: normalizedName(request.body.name, "Depo adı", 120) }
                : {}),
              ...(request.body.isActive !== undefined
                ? { isActive: request.body.isActive }
                : {}),
              updatedAt: new Date(),
            },
          });
          if (updated.count !== 1) {
            conflict(
              "Depo başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
            );
          }
          const after = await tx.warehouse.findUniqueOrThrow({
            where: { id: before.id },
          });
          const statusChanged =
            request.body.isActive !== undefined &&
            request.body.isActive !== before.isActive;
          await writeAudit(
            tx,
            user.id,
            statusChanged ? "WAREHOUSE_STATUS_CHANGED" : "WAREHOUSE_UPDATED",
            "Warehouse",
            after.id,
            namedSummary(before),
            namedSummary(after),
          );
          return after;
        }),
      );
    },
  );

  app.get<{ Params: WarehouseParams }>(
    "/api/warehouses/:warehouseId/locations",
    { schema: { params: warehouseParamsSchema } },
    async (request) => {
      const user = currentUser(request);
      ensureWarehouseVisible(user, request.params.warehouseId);
      const warehouse = await databaseClient().warehouse.findUnique({
        where: { id: request.params.warehouseId },
        select: { id: true },
      });
      if (!warehouse) {
        notFound("Depo bulunamadı.");
      }
      return databaseClient().warehouseLocation.findMany({
        where: { warehouseId: warehouse.id },
        orderBy: [{ code: "asc" }, { id: "asc" }],
      });
    },
  );

  app.get<{ Params: LocationParams }>(
    "/api/warehouses/:warehouseId/locations/:locationId",
    { schema: { params: locationParamsSchema } },
    async (request) => {
      const user = currentUser(request);
      ensureWarehouseVisible(user, request.params.warehouseId);
      const location = await databaseClient().warehouseLocation.findFirst({
        where: {
          id: request.params.locationId,
          warehouseId: request.params.warehouseId,
        },
      });
      if (!location) {
        notFound("Raf bulunamadı.");
      }
      return location;
    },
  );

  app.post<{ Params: WarehouseParams; Body: LocationBody }>(
    "/api/warehouses/:warehouseId/locations",
    locationCreateOptions,
    async (request, reply) => {
      const user = adminOnly(request);
      const code = normalizedCode(request.body.code, "Raf kodu");
      const name = normalizedName(request.body.name, "Raf adı", 120);
      const location = await withUniqueConflict("LOCATION", () =>
        databaseClient().$transaction(async (tx) => {
          const warehouse = await tx.warehouse.findUnique({
            where: { id: request.params.warehouseId },
          });
          if (!warehouse || !warehouse.isActive) {
            notFound("Aktif depo bulunamadı.");
          }
          const created = await tx.warehouseLocation.create({
            data: {
              warehouseId: warehouse.id,
              code,
              name,
              isActive: request.body.isActive ?? true,
            },
          });
          await writeAudit(
            tx,
            user.id,
            "LOCATION_CREATED",
            "WarehouseLocation",
            created.id,
            null,
            locationSummary(created),
          );
          return created;
        }),
      );
      return reply.code(201).send(location);
    },
  );

  app.patch<{ Params: LocationParams; Body: LocationPatch }>(
    "/api/warehouses/:warehouseId/locations/:locationId",
    locationUpdateOptions,
    async (request) => {
      const user = adminOnly(request);
      return withUniqueConflict("LOCATION", () =>
        databaseClient().$transaction(async (tx) => {
          const before = await tx.warehouseLocation.findFirst({
            where: {
              id: request.params.locationId,
              warehouseId: request.params.warehouseId,
            },
          });
          if (!before) {
            notFound("Raf bulunamadı.");
          }
          ensureNotStale(
            before.updatedAt,
            request.body.expectedUpdatedAt,
            "Raf başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
          );
          const updated = await tx.warehouseLocation.updateMany({
            where: {
              id: before.id,
              warehouseId: before.warehouseId,
              updatedAt: expectedDate(request.body.expectedUpdatedAt),
            },
            data: {
              ...(request.body.code !== undefined
                ? { code: normalizedCode(request.body.code, "Raf kodu") }
                : {}),
              ...(request.body.name !== undefined
                ? { name: normalizedName(request.body.name, "Raf adı", 120) }
                : {}),
              ...(request.body.isActive !== undefined
                ? { isActive: request.body.isActive }
                : {}),
              updatedAt: new Date(),
            },
          });
          if (updated.count !== 1) {
            conflict(
              "Raf başka bir kullanıcı tarafından değiştirildi. Güncel kaydı yeniden açın.",
            );
          }
          const after = await tx.warehouseLocation.findUniqueOrThrow({
            where: { id: before.id },
          });
          const statusChanged =
            request.body.isActive !== undefined &&
            request.body.isActive !== before.isActive;
          await writeAudit(
            tx,
            user.id,
            statusChanged ? "LOCATION_STATUS_CHANGED" : "LOCATION_UPDATED",
            "WarehouseLocation",
            after.id,
            locationSummary(before),
            locationSummary(after),
          );
          return after;
        }),
      );
    },
  );
}
