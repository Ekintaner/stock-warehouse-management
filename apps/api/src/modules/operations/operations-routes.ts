import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  Prisma,
  type PrismaClient,
  type UserRole,
} from "../../generated/prisma/client.js";
import { getPrismaClient } from "../../database/prisma.js";
import {
  requireAuthenticatedUser,
  requireRole,
  requireWarehouseAccess,
} from "../auth/authorization.js";
import { hashPassword } from "../auth/password.js";
import { ApiError } from "../../shared/api-error.js";

function userOf(r: FastifyRequest) {
  return requireAuthenticatedUser(r.authenticatedUser);
}
function fail(status: 400 | 403 | 404 | 409, message: string): never {
  throw new ApiError(
    status,
    status === 409
      ? "CONFLICT"
      : status === 404
        ? "NOT_FOUND"
        : "INVALID_REQUEST",
    message,
  );
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    fail(400, "Metin alanı geçersiz.");
  }
  const result = value.trim();
  if (result.length > max || (required && !result))
    fail(400, "Alan uzunluğunu kontrol edin.");
  return result;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(400, "Kayıt kimliği geçersiz.");
  return value;
}
function paging(query: { page?: string; pageSize?: string }) {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 25);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail(400, "Sayfalama geçersiz.");
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
function version(actual: Date, expected: unknown) {
  if (
    typeof expected !== "string" ||
    actual.getTime() !== new Date(expected).getTime()
  )
    fail(409, "Kayıt değişmiş. Güncel veriyi yeniden yükleyin.");
}
async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  relatedType: string,
  relatedId: string,
  summary: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({
    data: { userId, action, relatedType, relatedId, changeSummary: summary },
  });
}
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function registerOperationsRoutes(
  app: FastifyInstance,
  injected?: PrismaClient,
) {
  const db = () => injected ?? getPrismaClient();
  app.addHook("preValidation", async (r) => {
    if (
      ["POST", "PUT", "PATCH"].includes(r.method) &&
      [
        "/api/users",
        "/api/suppliers",
        "/api/thresholds",
        "/api/stock-documents",
      ].some((p) => r.url.startsWith(p))
    ) {
      if (!r.body || typeof r.body !== "object" || Array.isArray(r.body))
        fail(400, "İstek gövdesi geçersiz.");
    }
  });
  app.post<{ Body: Record<string, unknown> }>(
    "/api/suppliers",
    async (r, reply) => {
      const user = userOf(r);
      requireRole(user, ["ADMIN"]);
      const code = text(r.body.code, 48, true).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(code))
        fail(400, "Tedarikçi kodu geçersiz.");
      const data = {
        code,
        name: text(r.body.name, 160, true),
        contactName: text(r.body.contactName, 120) || null,
        email: text(r.body.email, 254) || null,
        phone: text(r.body.phone, 40) || null,
      };
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
        fail(400, "E-posta adresi geçersiz.");
      const saved = await db().$transaction(async (tx) => {
        const row = await tx.supplier.create({ data });
        await audit(tx, user.id, "SUPPLIER_CREATED", "Supplier", row.id, data);
        return row;
      });
      return reply.code(201).send(saved);
    },
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/suppliers/:id",
    async (r) => {
      const user = userOf(r);
      requireRole(user, ["ADMIN"]);
      const id = uuid(r.params.id);
      return db().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "id"=${id}::uuid FOR UPDATE`;
        const old = await tx.supplier.findUnique({ where: { id } });
        if (!old) fail(404, "Tedarikçi bulunamadı.");
        version(old.updatedAt, r.body.expectedUpdatedAt);
        const data = {
          name: text(r.body.name, 160, true),
          contactName: text(r.body.contactName, 120) || null,
          email: text(r.body.email, 254) || null,
          phone: text(r.body.phone, 40) || null,
          isActive: r.body.isActive,
        };
        if (typeof data.isActive !== "boolean") fail(400, "Aktiflik geçersiz.");
        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
          fail(400, "E-posta adresi geçersiz.");
        const row = await tx.supplier.update({
          where: { id },
          data: { ...data, isActive: data.isActive as boolean },
        });
        await audit(tx, user.id, "SUPPLIER_UPDATED", "Supplier", id, {
          name: data.name,
          isActive: data.isActive as boolean,
        });
        return row;
      });
    },
  );
  const publicUser = {
    id: true,
    username: true,
    displayName: true,
    role: true,
    isActive: true,
    updatedAt: true,
    warehouseAssignments: {
      select: { warehouseId: true, warehouse: { select: { name: true } } },
    },
  } as const;
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/users",
    async (r) => {
      requireRole(userOf(r), ["ADMIN"]);
      const p = paging(r.query);
      const [items, total] = await Promise.all([
        db().user.findMany({
          select: publicUser,
          skip: p.skip,
          take: p.take,
          orderBy: { username: "asc" },
        }),
        db().user.count(),
      ]);
      return { items, total, page: p.page, pageSize: p.pageSize };
    },
  );
  app.post<{ Body: Record<string, unknown> }>(
    "/api/users",
    async (r, reply) => {
      const user = userOf(r);
      requireRole(user, ["ADMIN"]);
      const username = text(r.body.username, 64, true).toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username))
        fail(
          400,
          "Kullanıcı adı 3–64 karakter olmalı; harf, rakam, nokta, alt çizgi veya tire kullanın.",
        );
      const password = r.body.password;
      if (
        typeof password !== "string" ||
        password.length < 14 ||
        Buffer.byteLength(password, "utf8") > 1024
      )
        fail(400, "Parola 14–1024 karakter olmalı.");
      const role = text(r.body.role, 40, true) as UserRole;
      if (!["ADMIN", "WAREHOUSE_MANAGER", "VIEWER"].includes(role))
        fail(400, "Rol geçersiz.");
      const warehouseIds = parseWarehouses(r.body.warehouseIds);
      const passwordHash = await hashPassword(password);
      const saved = await db().$transaction(async (tx) => {
        await validateWarehouses(tx, warehouseIds);
        const row = await tx.user.create({
          data: {
            username,
            displayName: text(r.body.displayName, 120, true),
            passwordHash,
            role,
            warehouseAssignments: {
              create: warehouseIds.map((warehouseId) => ({ warehouseId })),
            },
          },
          select: publicUser,
        });
        await audit(tx, user.id, "USER_CREATED", "User", row.id, {
          username,
          role,
          warehouseIds,
          passwordChanged: Boolean(passwordHash),
        });
        return row;
      });
      return reply.code(201).send(saved);
    },
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/users/:id",
    async (r) => {
      const user = userOf(r);
      requireRole(user, ["ADMIN"]);
      const id = uuid(r.params.id);
      const role = text(r.body.role, 40, true) as UserRole;
      if (
        !["ADMIN", "WAREHOUSE_MANAGER", "VIEWER"].includes(role) ||
        typeof r.body.isActive !== "boolean"
      )
        fail(400, "Rol veya aktiflik geçersiz.");
      let passwordHash: string | undefined;
      if (r.body.password !== undefined) {
        if (
          typeof r.body.password !== "string" ||
          r.body.password.length < 14 ||
          Buffer.byteLength(r.body.password, "utf8") > 1024
        )
          fail(400, "Parola en az 14 karakter, en fazla 1024 bayt olmalı.");
        passwordHash = await hashPassword(r.body.password);
      }
      const isActive = r.body.isActive as boolean;
      const warehouseIds = parseWarehouses(r.body.warehouseIds);
      return db().$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261017001::bigint)`;
        const old = await tx.user.findUnique({ where: { id } });
        if (!old) fail(404, "Kullanıcı bulunamadı.");
        version(old.updatedAt, r.body.expectedUpdatedAt);
        if (
          old.role === "ADMIN" &&
          old.isActive &&
          (role !== "ADMIN" || !isActive) &&
          (await tx.user.count({ where: { role: "ADMIN", isActive: true } })) <=
            1
        )
          fail(
            409,
            "Son aktif yönetici pasifleştirilemez veya rolü değiştirilemez.",
          );
        await validateWarehouses(tx, warehouseIds);
        await tx.userWarehouse.deleteMany({ where: { userId: id } });
        const row = await tx.user.update({
          where: { id },
          data: {
            displayName: text(r.body.displayName, 120, true),
            role,
            isActive,
            ...(passwordHash ? { passwordHash } : {}),
            warehouseAssignments: {
              create: warehouseIds.map((warehouseId) => ({ warehouseId })),
            },
          },
          select: publicUser,
        });
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit(tx, user.id, "USER_UPDATED", "User", id, {
          role,
          isActive,
          warehouseIds,
          passwordChanged: Boolean(passwordHash),
        });
        return row;
      });
    },
  );
  app.put<{
    Params: { warehouseId: string; productId: string };
    Body: { minimumStock: string };
  }>("/api/thresholds/:warehouseId/:productId", async (r) => {
    const user = userOf(r);
    requireRole(user, ["ADMIN"]);
    const warehouseId = uuid(r.params.warehouseId),
      productId = uuid(r.params.productId);
    const raw = r.body.minimumStock;
    if (typeof raw !== "string" || !/^\d{1,15}(\.\d{1,3})?$/.test(raw))
      fail(400, "Eşik miktarı geçersiz.");
    const minimumStock = new Prisma.Decimal(raw);
    return db().$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) fail(404, "Ürün bulunamadı.");
      if (product.unit === "EACH" && !minimumStock.isInteger())
        fail(400, "Adet eşiği tam sayı olmalı.");
      await validateWarehouses(tx, [warehouseId]);
      const row = await tx.warehouseProductSetting.upsert({
        where: { warehouseId_productId: { warehouseId, productId } },
        create: { warehouseId, productId, minimumStock },
        update: { minimumStock },
      });
      await audit(
        tx,
        user.id,
        "THRESHOLD_UPDATED",
        "WarehouseProductSetting",
        row.id,
        { warehouseId, productId, minimumStock: raw },
      );
      return { minimumStock: row.minimumStock.toFixed(3) };
    });
  });
  interface ReportQuery {
    warehouseId?: string;
    startDate?: string;
    endDate?: string;
    q?: string;
    lowOnly?: string;
    page?: string;
    pageSize?: string;
    format?: string;
  }
  app.get<{ Querystring: ReportQuery }>(
    "/api/reports/stock",
    async (r, reply) => {
      const user = userOf(r);
      const p = paging(r.query);
      const warehouseId = r.query.warehouseId
        ? uuid(r.query.warehouseId)
        : null;
      if (warehouseId) requireWarehouseAccess(user, warehouseId);
      const scope = warehouseId
        ? Prisma.sql`w."id"=${warehouseId}::uuid`
        : user.role === "ADMIN"
          ? Prisma.sql`TRUE`
          : user.warehouseIds.length
            ? Prisma.sql`w."id" IN (${Prisma.join(user.warehouseIds.map((id) => Prisma.sql`${id}::uuid`))})`
            : Prisma.sql`FALSE`;
      const search = `%${text(r.query.q ?? "", 120)}%`;
      const where = Prisma.sql`${scope} AND (p."isActive" OR COALESCE(b."quantity",0)>0) AND (p."sku" ILIKE ${search} OR p."name" ILIKE ${search}) AND (${r.query.lowOnly === "true"} = FALSE OR COALESCE(b."quantity",0)<COALESCE(s."minimumStock",0))`;
      const base = Prisma.sql`FROM "Warehouse" w CROSS JOIN "Product" p LEFT JOIN "StockBalance" b ON b."warehouseId"=w."id" AND b."productId"=p."id" LEFT JOIN "WarehouseProductSetting" s ON s."warehouseId"=w."id" AND s."productId"=p."id" WHERE ${where}`;
      const totalRows = await db().$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) AS total ${base}`,
      );
      const total = Number(totalRows[0]?.total ?? 0);
      if (r.query.format === "csv" && total > 10000)
        fail(400, "CSV en fazla 10000 satır içerebilir. Filtreyi daraltın.");
      const items = await db().$queryRaw<
        Array<{
          warehouseId: string;
          productId: string;
          warehouse: string;
          sku: string;
          name: string;
          unit: string;
          quantity: string;
          minimumStock: string;
        }>
      >(
        Prisma.sql`SELECT w."id" AS "warehouseId", p."id" AS "productId", w."name" AS warehouse, p."sku", p."name", p."unit"::text AS unit, COALESCE(b."quantity",0)::text AS quantity, COALESCE(s."minimumStock",0)::text AS "minimumStock" ${base} ORDER BY w."code", p."sku", p."id" LIMIT ${r.query.format === "csv" ? 10000 : p.take} OFFSET ${r.query.format === "csv" ? 0 : p.skip}`,
      );
      if (r.query.format === "csv")
        return reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            'attachment; filename="stok-raporu.csv"',
          )
          .send(
            "\uFEFF" +
              [
                ["Depo", "SKU", "Ürün", "Birim", "Miktar", "Minimum stok"],
                ...items.map((i) => [
                  i.warehouse,
                  i.sku,
                  i.name,
                  i.unit,
                  i.quantity,
                  i.minimumStock,
                ]),
              ]
                .map((row) => row.map(csvCell).join(";"))
                .join("\r\n"),
          );
      return { items, total, page: p.page, pageSize: p.pageSize };
    },
  );
  app.get<{ Querystring: ReportQuery }>(
    "/api/reports/warehouses",
    async (r) => {
      const user = userOf(r);
      const p = paging(r.query);
      const warehouseId = r.query.warehouseId
        ? uuid(r.query.warehouseId)
        : null;
      if (warehouseId) requireWarehouseAccess(user, warehouseId);
      const scope = warehouseId
        ? Prisma.sql`w."id"=${warehouseId}::uuid`
        : user.role === "ADMIN"
          ? Prisma.sql`TRUE`
          : user.warehouseIds.length
            ? Prisma.sql`w."id" IN (${Prisma.join(user.warehouseIds.map((id) => Prisma.sql`${id}::uuid`))})`
            : Prisma.sql`FALSE`;
      const items = await db().$queryRaw<
        Array<{
          warehouse: string;
          unit: string;
          productCount: bigint;
          quantity: string;
        }>
      >(
        Prisma.sql`SELECT w."name" AS warehouse, p."unit"::text AS unit, COUNT(*) AS "productCount", SUM(b.quantity)::text AS quantity FROM "StockBalance" b JOIN "Warehouse" w ON w.id=b."warehouseId" JOIN "Product" p ON p.id=b."productId" WHERE b.quantity>0 AND ${scope} GROUP BY w.id,w.name,p.unit ORDER BY w.name,w.id,p.unit LIMIT ${p.take} OFFSET ${p.skip}`,
      );
      return {
        items: items.map((i) => ({
          ...i,
          productCount: Number(i.productCount),
        })),
        page: p.page,
        pageSize: p.pageSize,
      };
    },
  );
  app.get<{ Querystring: ReportQuery }>(
    "/api/reports/activity",
    async (r, reply) => {
      const user = userOf(r);
      const warehouseId = r.query.warehouseId
        ? uuid(r.query.warehouseId)
        : null;
      if (warehouseId) requireWarehouseAccess(user, warehouseId);
      const start = r.query.startDate ? new Date(r.query.startDate) : undefined,
        end = r.query.endDate ? new Date(r.query.endDate) : undefined;
      if (
        (start && !Number.isFinite(start.getTime())) ||
        (end && !Number.isFinite(end.getTime())) ||
        (start && end && start > end)
      )
        fail(400, "Tarih aralığı geçersiz.");
      const grouped = await db().stockMovement.groupBy({
        by: ["warehouseId", "unit", "direction", "type"],
        where: {
          ...(warehouseId
            ? { warehouseId }
            : user.role === "ADMIN"
              ? {}
              : { warehouseId: { in: user.warehouseIds } }),
          createdAt: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {}),
          },
        },
        _sum: { quantity: true },
        _count: { id: true },
      });
      const warehouses = await db().warehouse.findMany({
        where: { id: { in: grouped.map((g) => g.warehouseId) } },
        select: { id: true, name: true },
      });
      const names = new Map(warehouses.map((w) => [w.id, w.name]));
      const items = grouped.map((g) => ({
        warehouse: names.get(g.warehouseId),
        unit: g.unit,
        direction: g.direction,
        type: g.type,
        quantity: g._sum.quantity?.toFixed(3) ?? "0.000",
        count: g._count.id,
      }));
      if (r.query.format === "csv")
        return reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            'attachment; filename="hareket-ozeti.csv"',
          )
          .send(
            "\uFEFF" +
              [
                ["Depo", "Birim", "Yön", "Tür", "Miktar", "Hareket sayısı"],
                ...items.map((i) => [
                  i.warehouse,
                  i.unit,
                  i.direction,
                  i.type,
                  i.quantity,
                  i.count,
                ]),
              ]
                .map((row) => row.map(csvCell).join(";"))
                .join("\r\n"),
          );
      return { items };
    },
  );
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/audit",
    async (r) => {
      requireRole(userOf(r), ["ADMIN"]);
      const p = paging(r.query);
      const [items, total] = await Promise.all([
        db().auditEvent.findMany({
          skip: p.skip,
          take: p.take,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { user: { select: { displayName: true } } },
        }),
        db().auditEvent.count(),
      ]);
      return { items, total, page: p.page, pageSize: p.pageSize };
    },
  );
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    "/api/stock-documents/:id/reverse",
    async (r) => {
      const user = userOf(r);
      requireRole(user, ["ADMIN"]);
      const id = uuid(r.params.id);
      const reason = text(r.body.reason, 1000, true);
      const key = text(r.headers["idempotency-key"], 200, true);
      const scope = `reverse:${id}`,
        requestHash = createHash("sha256")
          .update(JSON.stringify({ id, reason }))
          .digest("hex");
      return db().$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))`;
        const previous = await tx.idempotencyRecord.findUnique({
          where: {
            userId_operationScope_key: {
              userId: user.id,
              operationScope: scope,
              key,
            },
          },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            fail(409, "Aynı anahtar farklı içerikle kullanılamaz.");
          return previous.response;
        }
        const peek = await tx.stockDocument.findUnique({
          where: { id },
          select: { warehouseId: true },
        });
        if (!peek) fail(404, "Belge bulunamadı.");
        await tx.$queryRaw`SELECT "id" FROM "Warehouse" WHERE "id"=${peek.warehouseId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "StockDocument" WHERE "id"=${id}::uuid FOR UPDATE`;
        const document = await tx.stockDocument.findUnique({
          where: { id },
          include: {
            lines: { include: { movements: { include: { reversal: true } } } },
          },
        });
        if (!document || document.status !== "APPROVED")
          fail(409, "Yalnızca onaylı belge terslenebilir.");
        const movements = document.lines.flatMap((line) => line.movements);
        if (!movements.length || movements.some((m) => !m || m.reversal))
          fail(409, "Belge daha önce terslenmiş veya hareketleri eksik.");
        if (
          await tx.stockCount.findFirst({
            where: { warehouseId: document.warehouseId, status: "OPEN" },
          })
        )
          fail(409, "Depoda açık sayım var; tersleme yapılamaz.");
        for (const original of movements) {
          if (!original) continue;
          if (original.direction === "IN") {
            const balance = await tx.stockBalance.findUnique({
              where: {
                warehouseId_productId: {
                  warehouseId: original.warehouseId,
                  productId: original.productId,
                },
              },
            });
            if (!balance || balance.quantity.lt(original.quantity))
              fail(409, "Tersleme için yeterli stok yok.");
          }
          await tx.stockMovement.create({
            data: {
              warehouseId: original.warehouseId,
              productId: original.productId,
              unit: original.unit,
              quantity: original.quantity,
              direction: original.direction === "IN" ? "OUT" : "IN",
              type: "REVERSAL",
              reversesMovementId: original.id,
              createdById: user.id,
              reason,
            },
          });
        }
        await audit(tx, user.id, "DOCUMENT_REVERSED", "StockDocument", id, {
          reason,
        });
        const response = { id, reversed: true };
        await tx.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            operationScope: scope,
            key,
            requestHash,
            resultType: "StockDocument",
            resultReference: id,
            response,
            completedAt: new Date(),
          },
        });
        return response;
      });
    },
  );
  app.get("/api/reconciliation", async (r) => {
    requireRole(userOf(r), ["ADMIN"]);
    const items = await db().$queryRaw<
      Array<{
        warehouseId: string;
        productId: string;
        balance: string;
        ledger: string;
      }>
    >`WITH ledger AS (SELECT "warehouseId", "productId", SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END) AS quantity FROM "StockMovement" GROUP BY "warehouseId", "productId") SELECT COALESCE(b."warehouseId",l."warehouseId") AS "warehouseId", COALESCE(b."productId",l."productId") AS "productId", COALESCE(b.quantity,0)::text AS balance, COALESCE(l.quantity,0)::text AS ledger FROM "StockBalance" b FULL JOIN ledger l ON b."warehouseId"=l."warehouseId" AND b."productId"=l."productId" WHERE COALESCE(b.quantity,0)<>COALESCE(l.quantity,0) LIMIT 101`;
    return {
      consistent: items.length === 0,
      items: items.slice(0, 100),
      truncated: items.length > 100,
    };
  });
}
function parseWarehouses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100)
    fail(400, "Depo atamaları geçersiz.");
  return [...new Set(value.map(uuid))];
}
async function validateWarehouses(tx: Prisma.TransactionClient, ids: string[]) {
  if (
    (await tx.warehouse.count({
      where: { id: { in: ids }, isActive: true },
    })) !== ids.length
  )
    fail(400, "Depo atamalarında pasif veya bulunamayan kayıt var.");
}
