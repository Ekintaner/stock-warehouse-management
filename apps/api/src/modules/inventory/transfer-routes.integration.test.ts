import "dotenv/config";
import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { after, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { buildApp } from "../../app.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import type { AppRole, AuthenticatedUser } from "../auth/authorization.js";
import type { AuthStore, SessionWithUser } from "../auth/auth-store.js";
import {
  DEVELOPMENT_DATABASE_NAME,
  TEST_DATABASE_NAME,
  parseLocalDatabaseTarget,
} from "../../database/local-database-target.js";
import { ensureWarehouseCanBeDeactivated } from "../catalog/catalog-routes.js";

const enabled = Boolean(
  process.env.DATABASE_URL &&
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_MIGRATION_DATABASE_URL,
);
let prisma: PrismaClient | undefined;
let pool: Pool | undefined;
let adminPool: Pool | undefined;
if (enabled) {
  const testTarget = parseLocalDatabaseTarget(
    process.env.TEST_DATABASE_URL,
    TEST_DATABASE_NAME,
  );
  const developmentTarget = parseLocalDatabaseTarget(
    process.env.DATABASE_URL,
    DEVELOPMENT_DATABASE_NAME,
  );
  const migrationTarget = parseLocalDatabaseTarget(
    process.env.TEST_MIGRATION_DATABASE_URL,
    TEST_DATABASE_NAME,
  );
  assert.notEqual(
    testTarget.databaseName,
    developmentTarget.databaseName,
    "Transfer integration tests must use the separate test database.",
  );
  assert.notEqual(
    migrationTarget.databaseName,
    developmentTarget.databaseName,
    "Transfer integration test setup must not use the development database.",
  );
  pool = new Pool({
    connectionString: testTarget.connectionString,
    connectionTimeoutMillis: 3_000,
    max: 12,
  });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  adminPool = new Pool({
    connectionString: migrationTarget.connectionString,
    connectionTimeoutMillis: 3_000,
    max: 2,
  });
}

interface Identity {
  user: AuthenticatedUser & {
    isActive: boolean;
    passwordHash: string;
  };
}

class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, Identity["user"]>();
  readonly sessions = new Map<string, SessionWithUser>();

  add(user: Identity["user"]): void {
    this.users.set(user.id, user);
  }

  async findUserByUsername(username: string) {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async updatePasswordHash(): Promise<void> {}

  async createSession(
    userId: string,
    _tokenHash: string,
    _expiresAt: Date,
  ): Promise<{ id: string }> {
    void _tokenHash;
    void _expiresAt;
    return { id: userId };
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async updateSessionLastSeen(): Promise<void> {}

  async revokeSession(): Promise<void> {}
}

interface AuthHeaders {
  cookie: string;
  csrf: string;
}

function testUser(id: string, role: AppRole, warehouseIds: string[]) {
  return {
    id,
    username: `transfer-test-${id.slice(0, 8)}`,
    displayName: "Transfer Test",
    role,
    warehouseIds,
    isActive: true,
    passwordHash: "not-used-in-transfer-tests",
  };
}

function issueSession(store: MemoryAuthStore, user: Identity["user"]): AuthHeaders {
  const rawToken = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  store.sessions.set(tokenHash, {
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    revokedAt: null,
    user,
  });
  return {
    cookie: `stock_session=${rawToken}`,
    csrf: createHmac("sha256", rawToken)
      .update(`stock-warehouse-csrf:v1:${sessionId}`)
      .digest("base64url"),
  };
}

const origin = "http://127.0.0.1:5173";

async function inject(
  app: ReturnType<typeof buildApp>,
  method: "GET" | "POST" | "PATCH",
  url: string,
  auth: AuthHeaders,
  payload?: Record<string, unknown>,
  options: { csrf?: boolean; idempotencyKey?: string } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie: auth.cookie,
      origin,
      ...(options.csrf === false ? {} : { "x-csrf-token": auth.csrf }),
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    ...(payload ? { payload } : {}),
  });
}

async function installTransferAuditFailureTrigger(): Promise<void> {
  await adminPool!.query(
    `DROP TRIGGER IF EXISTS "transfer_test_fail_audit" ON "AuditEvent"`,
  );
  await adminPool!.query(`DROP FUNCTION IF EXISTS transfer_test_fail_audit()`);
  await adminPool!.query(`
    CREATE FUNCTION transfer_test_fail_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."action" = 'TRANSFER_SHIPPED' THEN
        RAISE EXCEPTION 'Transfer integration audit failure'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await adminPool!.query(`
    CREATE TRIGGER "transfer_test_fail_audit"
    BEFORE INSERT ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION transfer_test_fail_audit()
  `);
}

async function dropTransferAuditFailureTrigger(): Promise<void> {
  if (!adminPool) return;
  await adminPool.query(
    `DROP TRIGGER IF EXISTS "transfer_test_fail_audit" ON "AuditEvent"`,
  );
  await adminPool.query(`DROP FUNCTION IF EXISTS transfer_test_fail_audit()`);
}

after(async () => {
  await dropTransferAuditFailureTrigger();
  await prisma?.$disconnect();
  await pool?.end();
  await adminPool?.end();
});

test(
  "transfer routes enforce assignment, status, idempotency, and PostgreSQL atomicity",
  { skip: !enabled && "Configure separate local DATABASE_URL, TEST_DATABASE_URL, and TEST_MIGRATION_DATABASE_URL." },
  async () => {
    const db = prisma!;
    const suffix = randomUUID().replaceAll("-", "").toUpperCase();
    const userIds = {
      admin: randomUUID(),
      sourceManager: randomUUID(),
      targetManager: randomUUID(),
      viewer: randomUUID(),
    };
    const warehouseIds = [randomUUID(), randomUUID()];
    const inactiveWarehouseId = randomUUID();
    const category = await db.category.create({
      data: { code: `TR-${suffix.slice(0, 42)}`, name: `Transfer Test ${suffix}` },
    });
    const roleByUser = [
      ["admin", "ADMIN"],
      ["sourceManager", "WAREHOUSE_MANAGER"],
      ["targetManager", "WAREHOUSE_MANAGER"],
      ["viewer", "VIEWER"],
    ] as const;
    for (const [key, role] of roleByUser) {
      await db.user.create({
        data: {
          id: userIds[key],
          username: `transfer-test-${suffix}-${key}`.toLowerCase(),
          displayName: "Transfer Test",
          passwordHash: "not-used-in-transfer-tests",
          role,
        },
      });
    }
    await Promise.all(
      warehouseIds.map((id, index) =>
        db.warehouse.create({
          data: {
            id,
            code: `TR-${suffix.slice(0, 40)}-${index}`,
            name: `Transfer Test Warehouse ${suffix} ${index}`,
          },
        }),
      ),
    );
    await db.warehouse.create({
      data: {
        id: inactiveWarehouseId,
        code: `TR-${suffix.slice(0, 36)}-INACT`.toUpperCase(),
        name: `Inactive Transfer Test Warehouse ${suffix}`,
        isActive: false,
      },
    });
    await db.userWarehouse.createMany({
      data: [
        { userId: userIds.sourceManager, warehouseId: warehouseIds[0]! },
        { userId: userIds.targetManager, warehouseId: warehouseIds[1]! },
        { userId: userIds.viewer, warehouseId: warehouseIds[1]! },
      ],
    });
    const products = await Promise.all([
      db.product.create({
        data: {
          sku: `TR-E-${suffix.slice(0, 40)}`,
          name: "Transfer test each",
          categoryId: category.id,
          unit: "EACH",
        },
      }),
      db.product.create({
        data: {
          sku: `TR-K-${suffix.slice(0, 40)}`,
          name: "Transfer test kilogram",
          categoryId: category.id,
          unit: "KILOGRAM",
        },
      }),
    ]);

    const store = new MemoryAuthStore();
    const adminUser = testUser(userIds.admin, "ADMIN", []);
    const sourceManagerUser = testUser(userIds.sourceManager, "WAREHOUSE_MANAGER", [
      warehouseIds[0]!,
    ]);
    const targetManagerUser = testUser(userIds.targetManager, "WAREHOUSE_MANAGER", [
      warehouseIds[1]!,
    ]);
    const viewerUser = testUser(userIds.viewer, "VIEWER", [warehouseIds[1]!]);
    for (const user of [adminUser, sourceManagerUser, targetManagerUser, viewerUser]) {
      store.add(user);
    }
    const admin = issueSession(store, adminUser);
    const sourceManager = issueSession(store, sourceManagerUser);
    const targetManager = issueSession(store, targetManagerUser);
    const viewer = issueSession(store, viewerUser);
    const app = buildApp(
      { store, appOrigin: origin, secureCookies: false },
      db,
    );

    try {
      const createDocument = async () =>
        inject(
          app,
          "POST",
          "/api/stock-documents",
          admin,
          {
            type: "RECEIPT",
            warehouseId: warehouseIds[0],
            description: `transfer test ${suffix}`,
            lines: [
              { productId: products[0]!.id, quantity: "30" },
              { productId: products[1]!.id, quantity: "8.250" },
            ],
          },
        );
      const receipt = await createDocument();
      assert.equal(receipt.statusCode, 201, receipt.body);
      const receiptBody = receipt.json();
      const approved = await inject(
        app,
        "POST",
        `/api/stock-documents/${receiptBody.id}/approve`,
        admin,
        { expectedUpdatedAt: receiptBody.updatedAt },
        { idempotencyKey: `transfer-seed-${suffix}` },
      );
      assert.equal(approved.statusCode, 200, approved.body);

      const warehouseOptions = await inject(
        app,
        "GET",
        "/api/transfer-warehouses",
        sourceManager,
      );
      assert.equal(warehouseOptions.statusCode, 200);
      const selectableWarehouseIds = warehouseOptions.json().items.map(
        (item: { id: string }) => item.id,
      );
      for (const id of warehouseIds) {
        assert.ok(selectableWarehouseIds.includes(id));
      }
      assert.ok(!selectableWarehouseIds.includes(inactiveWarehouseId));
      for (const option of warehouseOptions.json().items) {
        assert.deepEqual(Object.keys(option).sort(), ["code", "id", "name"]);
      }

      const draftResponse = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          description: `Main transfer ${suffix}`,
          lines: [
            { productId: products[0]!.id, quantity: "2" },
            { productId: products[1]!.id, quantity: "1.125" },
          ],
        },
      );
      assert.equal(draftResponse.statusCode, 201, draftResponse.body);
      const draft = draftResponse.json();
      assert.equal(draft.status, "DRAFT");
      const filteredByEitherWarehouse = await inject(
        app,
        "GET",
        `/api/transfers?warehouseId=${warehouseIds[1]}&from=${encodeURIComponent(draft.createdAt)}&to=${encodeURIComponent(draft.createdAt)}`,
        sourceManager,
      );
      assert.equal(filteredByEitherWarehouse.statusCode, 200);
      assert.equal(filteredByEitherWarehouse.json().total, 1);
      assert.equal(filteredByEitherWarehouse.json().items[0].id, draft.id);
      const filteredBySourceAndTarget = await inject(
        app,
        "GET",
        `/api/transfers?sourceWarehouseId=${warehouseIds[0]}&targetWarehouseId=${warehouseIds[1]}&from=${encodeURIComponent(draft.createdAt)}`,
        sourceManager,
      );
      assert.equal(filteredBySourceAndTarget.statusCode, 200);
      assert.equal(filteredBySourceAndTarget.json().total, 1);
      const reversedDateRange = await inject(
        app,
        "GET",
        `/api/transfers?from=${encodeURIComponent(draft.createdAt)}&to=2020-01-01T00%3A00%3A00.000Z`,
        sourceManager,
      );
      assert.equal(reversedDateRange.statusCode, 400);
      const unsupportedListFilter = await inject(
        app,
        "GET",
        "/api/transfers?warehouseName=unsupported",
        sourceManager,
      );
      assert.equal(unsupportedListFilter.statusCode, 400);
      assert.equal(
        (await db.stockBalance.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: warehouseIds[0]!,
              productId: products[0]!.id,
            },
          },
        })).quantity.toFixed(3),
        "30.000",
      );

      const duplicateLine = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [
            { productId: products[0]!.id, quantity: "1" },
            { productId: products[0]!.id, quantity: "2" },
          ],
        },
      );
      assert.equal(duplicateLine.statusCode, 400);
      const fractionalEach = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [{ productId: products[0]!.id, quantity: "1.5" }],
        },
      );
      assert.equal(fractionalEach.statusCode, 400);
      const tooPrecise = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [{ productId: products[1]!.id, quantity: "1.0001" }],
        },
      );
      assert.equal(tooPrecise.statusCode, 400);
      const sameWarehouse = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[0],
          lines: [{ productId: products[0]!.id, quantity: "1" }],
        },
      );
      assert.equal(sameWarehouse.statusCode, 400);

      const hiddenFromUnassigned = await inject(
        app,
        "GET",
        `/api/transfers/${draft.id}`,
        admin,
      );
      assert.equal(hiddenFromUnassigned.statusCode, 200);
      assert.equal(
        (
          await inject(
            app,
            "GET",
            `/api/transfers/${draft.id}`,
            viewer,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await inject(
            app,
            "GET",
            `/api/stock?warehouseId=${warehouseIds[0]}`,
            viewer,
          )
        ).statusCode,
        404,
      );
      const viewerWrite = await inject(
        app,
        "POST",
        `/api/transfers/${draft.id}/ship`,
        viewer,
        { expectedUpdatedAt: draft.updatedAt },
        { idempotencyKey: `viewer-${suffix}` },
      );
      assert.equal(viewerWrite.statusCode, 403);
      const missingCsrf = await inject(
        app,
        "POST",
        `/api/transfers/${draft.id}/cancel`,
        sourceManager,
        { expectedUpdatedAt: draft.updatedAt },
        { csrf: false },
      );
      assert.equal(missingCsrf.statusCode, 403);

      const staleEdit = await inject(
        app,
        "PATCH",
        `/api/transfers/${draft.id}`,
        sourceManager,
        {
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
          lines: [{ productId: products[0]!.id, quantity: "2" }],
        },
      );
      assert.equal(staleEdit.statusCode, 409);
      const cancelDraft = await inject(
        app,
        "POST",
        `/api/transfers/${draft.id}/cancel`,
        sourceManager,
        { expectedUpdatedAt: draft.updatedAt },
        { idempotencyKey: `cancel-${suffix}` },
      );
      assert.equal(cancelDraft.statusCode, 200, cancelDraft.body);
      assert.equal(cancelDraft.json().status, "CANCELLED");
      const repeatedCancel = await inject(
        app,
        "POST",
        `/api/transfers/${draft.id}/cancel`,
        sourceManager,
        { expectedUpdatedAt: draft.updatedAt },
        { idempotencyKey: `cancel-${suffix}` },
      );
      assert.equal(repeatedCancel.statusCode, 200);
      assert.equal(repeatedCancel.json().status, "CANCELLED");
      assert.equal(
        await db.stockMovement.count({
          where: { transferLine: { transferId: draft.id } },
        }),
        0,
      );

      const activeTransferResponse = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          description: `Lifecycle ${suffix}`,
          lines: [
            { productId: products[0]!.id, quantity: "2" },
            { productId: products[1]!.id, quantity: "1.125" },
          ],
        },
      );
      assert.equal(activeTransferResponse.statusCode, 201);
      const activeTransfer = activeTransferResponse.json();
      await assert.rejects(
        ensureWarehouseCanBeDeactivated(db, warehouseIds[1]!),
        /Devam eden transferi bulunan depo pasifleştirilemez/,
      );
      const insufficientDraftResponse = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [
            { productId: products[0]!.id, quantity: "1" },
            { productId: products[1]!.id, quantity: "999" },
          ],
        },
      );
      assert.equal(insufficientDraftResponse.statusCode, 201);
      const insufficientDraft = insufficientDraftResponse.json();
      const insufficientShipment = await inject(
        app,
        "POST",
        `/api/transfers/${insufficientDraft.id}/ship`,
        sourceManager,
        { expectedUpdatedAt: insufficientDraft.updatedAt },
        { idempotencyKey: `insufficient-${suffix}` },
      );
      assert.equal(insufficientShipment.statusCode, 409);
      assert.equal(
        (await db.transfer.findUniqueOrThrow({
          where: { id: insufficientDraft.id },
        })).status,
        "DRAFT",
      );
      assert.equal(
        await db.stockMovement.count({
          where: { transferLine: { transferId: insufficientDraft.id } },
        }),
        0,
      );
      const unauthorizedShipment = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/ship`,
        targetManager,
        { expectedUpdatedAt: activeTransfer.updatedAt },
        { idempotencyKey: `wrong-source-${suffix}` },
      );
      assert.equal(unauthorizedShipment.statusCode, 403);

      const sharedShipmentKey = `ship-${suffix}`;
      const concurrentShipment = await Promise.all([
        inject(
          app,
          "POST",
          `/api/transfers/${activeTransfer.id}/ship`,
          sourceManager,
          { expectedUpdatedAt: activeTransfer.updatedAt },
          { idempotencyKey: sharedShipmentKey },
        ),
        inject(
          app,
          "POST",
          `/api/transfers/${activeTransfer.id}/ship`,
          sourceManager,
          { expectedUpdatedAt: activeTransfer.updatedAt },
          { idempotencyKey: sharedShipmentKey },
        ),
      ]);
      assert.deepEqual(
        concurrentShipment.map((response) => response.statusCode),
        [200, 200],
      );
      assert.deepEqual(
        concurrentShipment.map((response) => response.json().status),
        ["SHIPPED", "SHIPPED"],
      );
      const receiveDraft = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/receive`,
        targetManager,
        { expectedUpdatedAt: activeTransfer.updatedAt },
        { idempotencyKey: `receive-before-ship-${suffix}` },
      );
      assert.equal(receiveDraft.statusCode, 409);
      const cancelShipped = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/cancel`,
        sourceManager,
        { expectedUpdatedAt: concurrentShipment[0]!.json().updatedAt },
        { idempotencyKey: `cancel-shipped-${suffix}` },
      );
      assert.equal(cancelShipped.statusCode, 409);
      assert.equal(
        await db.stockMovement.count({
          where: {
            transferLine: { transferId: activeTransfer.id },
            transferPhase: "SHIPMENT",
          },
        }),
        2,
      );
      const sourceStockInTransit = await inject(
        app,
        "GET",
        `/api/stock?warehouseId=${warehouseIds[0]}&q=${products[0]!.sku}`,
        sourceManager,
      );
      assert.equal(sourceStockInTransit.statusCode, 200);
      assert.equal(sourceStockInTransit.json().items[0].quantity, "28.000");
      assert.equal(
        sourceStockInTransit.json().items[0].inTransitOutgoing,
        "2.000",
      );
      assert.equal(
        sourceStockInTransit.json().items[0].inTransitIncoming,
        "0.000",
      );
      const targetStockInTransit = await inject(
        app,
        "GET",
        `/api/stock?warehouseId=${warehouseIds[1]}&q=${products[0]!.sku}`,
        targetManager,
      );
      assert.equal(targetStockInTransit.statusCode, 200);
      assert.equal(targetStockInTransit.json().items[0].quantity, "0.000");
      assert.equal(
        targetStockInTransit.json().items[0].inTransitIncoming,
        "2.000",
      );
      assert.equal(
        targetStockInTransit.json().items[0].inTransitOutgoing,
        "0.000",
      );
      await assert.rejects(
        ensureWarehouseCanBeDeactivated(db, warehouseIds[1]!),
        /Devam eden transferi bulunan depo pasifleştirilemez/,
      );
      const sameKeyChangedPayload = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/ship`,
        sourceManager,
        { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
        { idempotencyKey: sharedShipmentKey },
      );
      assert.equal(sameKeyChangedPayload.statusCode, 409);
      assert.equal(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              warehouseId_productId: {
                warehouseId: warehouseIds[0]!,
                productId: products[0]!.id,
              },
            },
          })
        ).quantity.toFixed(3),
        "28.000",
      );
      assert.equal(
        await db.stockBalance.findFirst({
          where: { warehouseId: warehouseIds[1]! },
        }),
        null,
      );
      const sourceCanNotReceive = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/receive`,
        sourceManager,
        { expectedUpdatedAt: concurrentShipment[0]!.json().updatedAt },
        { idempotencyKey: `wrong-target-${suffix}` },
      );
      assert.equal(sourceCanNotReceive.statusCode, 403);
      const viewerCanNotReceive = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/receive`,
        viewer,
        { expectedUpdatedAt: concurrentShipment[0]!.json().updatedAt },
        { idempotencyKey: `viewer-receive-${suffix}` },
      );
      assert.equal(viewerCanNotReceive.statusCode, 403);

      const received = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/receive`,
        targetManager,
        { expectedUpdatedAt: concurrentShipment[0]!.json().updatedAt },
        { idempotencyKey: sharedShipmentKey },
      );
      assert.equal(received.statusCode, 200, received.body);
      assert.equal(received.json().status, "RECEIVED");
      const targetStockReceived = await inject(
        app,
        "GET",
        `/api/stock?warehouseId=${warehouseIds[1]}&q=${products[0]!.sku}`,
        targetManager,
      );
      assert.equal(targetStockReceived.statusCode, 200);
      assert.equal(targetStockReceived.json().items[0].quantity, "2.000");
      assert.equal(
        targetStockReceived.json().items[0].inTransitIncoming,
        "0.000",
      );
      assert.equal(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              warehouseId_productId: {
                warehouseId: warehouseIds[1]!,
                productId: products[0]!.id,
              },
            },
          })
        ).quantity.toFixed(3),
        "2.000",
      );
      const managerReturn = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/return`,
        targetManager,
        { expectedUpdatedAt: received.json().updatedAt, reason: "Reddedilmemeli" },
        { idempotencyKey: `manager-return-${suffix}` },
      );
      assert.equal(managerReturn.statusCode, 403);
      const deliveredReturn = await inject(
        app,
        "POST",
        `/api/transfers/${activeTransfer.id}/return`,
        admin,
        { expectedUpdatedAt: received.json().updatedAt, reason: `Out-of-scope return ${suffix}` },
        { idempotencyKey: `delivered-return-${suffix}` },
      );
      assert.equal(deliveredReturn.statusCode, 409);
      await assert.rejects(
        db.transfer.update({
          where: { id: activeTransfer.id },
          data: {
            status: "RETURNED",
            returnOrigin: "RECEIVED",
            returnReason: `Out-of-scope direct transition ${suffix}`,
            returnedById: userIds.admin,
            returnedAt: new Date(),
          },
        }),
      );
      assert.equal(
        (await db.transfer.findUniqueOrThrow({ where: { id: activeTransfer.id } })).status,
        "RECEIVED",
      );
      assert.equal(
        await db.stockMovement.count({
          where: { transferLine: { transferId: activeTransfer.id } },
        }),
        4,
      );
      assert.equal(
        (await db.stockBalance.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: warehouseIds[0]!,
              productId: products[0]!.id,
            },
          },
        })).quantity.toFixed(3),
        "28.000",
      );
      assert.equal(
        (await db.stockBalance.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: warehouseIds[1]!,
              productId: products[0]!.id,
            },
          },
        })).quantity.toFixed(3),
        "2.000",
      );
      const listAsTarget = await inject(
        app,
        "GET",
        `/api/transfers?status=RETURNED&targetWarehouseId=${warehouseIds[1]}`,
        viewer,
      );
      assert.equal(listAsTarget.statusCode, 200);
      assert.equal(listAsTarget.json().total, 0);

      const depletedReturnDraft = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [{ productId: products[0]!.id, quantity: "1" }],
        },
      );
      assert.equal(depletedReturnDraft.statusCode, 201);
      const depletedDraft = depletedReturnDraft.json();
      const depletedShipped = await inject(
        app,
        "POST",
        `/api/transfers/${depletedDraft.id}/ship`,
        sourceManager,
        { expectedUpdatedAt: depletedDraft.updatedAt },
        { idempotencyKey: `depleted-ship-${suffix}` },
      );
      assert.equal(depletedShipped.statusCode, 200);
      const depletedReceived = await inject(
        app,
        "POST",
        `/api/transfers/${depletedDraft.id}/receive`,
        targetManager,
        { expectedUpdatedAt: depletedShipped.json().updatedAt },
        { idempotencyKey: `depleted-receive-${suffix}` },
      );
      assert.equal(depletedReceived.statusCode, 200);
      const consumeReceipt = await inject(
        app,
        "POST",
        "/api/stock-documents",
        admin,
        {
          type: "ISSUE",
          warehouseId: warehouseIds[1],
          lines: [{ productId: products[0]!.id, quantity: "1" }],
        },
      );
      assert.equal(consumeReceipt.statusCode, 201);
      const consumeDraft = consumeReceipt.json();
      const consumeIssue = await inject(
        app,
        "POST",
        `/api/stock-documents/${consumeDraft.id}/approve`,
        admin,
        { expectedUpdatedAt: consumeDraft.updatedAt },
        { idempotencyKey: `consume-${suffix}` },
      );
      assert.equal(consumeIssue.statusCode, 200);
      const refusedReturn = await inject(
        app,
        "POST",
        `/api/transfers/${depletedDraft.id}/return`,
        admin,
        {
          expectedUpdatedAt: depletedReceived.json().updatedAt,
          reason: `Delivered return is out of scope ${suffix}`,
        },
        { idempotencyKey: `delivered-return-stock-${suffix}` },
      );
      assert.equal(refusedReturn.statusCode, 409);
      assert.equal(
        (await db.transfer.findUniqueOrThrow({
          where: { id: depletedDraft.id },
        })).status,
        "RECEIVED",
      );

      const transitReturnDraft = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [{ productId: products[0]!.id, quantity: "3" }],
        },
      );
      assert.equal(transitReturnDraft.statusCode, 201);
      const transitDraft = transitReturnDraft.json();
      const transitShipped = await inject(
        app,
        "POST",
        `/api/transfers/${transitDraft.id}/ship`,
        sourceManager,
        { expectedUpdatedAt: transitDraft.updatedAt },
        { idempotencyKey: `transit-ship-${suffix}` },
      );
      assert.equal(transitShipped.statusCode, 200);
      const missingTransitReturnReason = await inject(
        app,
        "POST",
        `/api/transfers/${transitDraft.id}/return`,
        admin,
        {
          expectedUpdatedAt: transitShipped.json().updatedAt,
          reason: " ",
        },
        { idempotencyKey: `missing-transit-return-${suffix}` },
      );
      assert.equal(missingTransitReturnReason.statusCode, 400);
      const competingTransitions = await Promise.all([
        inject(
          app,
          "POST",
          `/api/transfers/${transitDraft.id}/receive`,
          targetManager,
          { expectedUpdatedAt: transitShipped.json().updatedAt },
          { idempotencyKey: `concurrent-receive-${suffix}` },
        ),
        inject(
          app,
          "POST",
          `/api/transfers/${transitDraft.id}/return`,
          admin,
          {
            expectedUpdatedAt: transitShipped.json().updatedAt,
            reason: `Concurrent transit return ${suffix}`,
          },
          { idempotencyKey: `concurrent-return-${suffix}` },
        ),
      ]);
      const successfulTransitions = competingTransitions.filter(
        (response) => response.statusCode === 200,
      );
      const refusedTransitions = competingTransitions.filter(
        (response) => response.statusCode === 409,
      );
      assert.equal(successfulTransitions.length, 1);
      assert.equal(refusedTransitions.length, 1);
      const finalTransit = await db.transfer.findUniqueOrThrow({
        where: { id: transitDraft.id },
      });
      assert.ok(finalTransit.status === "RECEIVED" || finalTransit.status === "RETURNED");
      const winnerIndex = competingTransitions.findIndex(
        (response) => response.statusCode === 200,
      );
      const replay = winnerIndex === 0
        ? await inject(
            app,
            "POST",
            `/api/transfers/${transitDraft.id}/receive`,
            targetManager,
            { expectedUpdatedAt: transitShipped.json().updatedAt },
            { idempotencyKey: `concurrent-receive-${suffix}` },
          )
        : await inject(
            app,
            "POST",
            `/api/transfers/${transitDraft.id}/return`,
            admin,
            {
              expectedUpdatedAt: transitShipped.json().updatedAt,
              reason: `Concurrent transit return ${suffix}`,
            },
            { idempotencyKey: `concurrent-return-${suffix}` },
          );
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.json().status, finalTransit.status);
      if (finalTransit.status === "RETURNED") {
        assert.equal(finalTransit.returnOrigin, "SHIPPED");
        assert.equal(
          (
            await db.stockBalance.findUniqueOrThrow({
              where: {
                warehouseId_productId: {
                  warehouseId: warehouseIds[0]!,
                  productId: products[0]!.id,
                },
              },
            })
          ).quantity.toFixed(3),
          "27.000",
        );
        assert.equal(
          (
            await db.stockBalance.findUniqueOrThrow({
              where: {
                warehouseId_productId: {
                  warehouseId: warehouseIds[1]!,
                  productId: products[0]!.id,
                },
              },
            })
          ).quantity.toFixed(3),
          "2.000",
        );
      } else {
        assert.equal(
          (
            await db.stockBalance.findUniqueOrThrow({
              where: {
                warehouseId_productId: {
                  warehouseId: warehouseIds[0]!,
                  productId: products[0]!.id,
                },
              },
            })
          ).quantity.toFixed(3),
          "24.000",
        );
        assert.equal(
          (
            await db.stockBalance.findUniqueOrThrow({
              where: {
                warehouseId_productId: {
                  warehouseId: warehouseIds[1]!,
                  productId: products[0]!.id,
                },
              },
            })
          ).quantity.toFixed(3),
          "5.000",
        );
      }
      assert.equal(
        await db.stockMovement.count({
          where: {
            transferLine: { transferId: transitDraft.id },
            transferPhase: {
              in: ["SHIPMENT", "RECEIPT", "RETURN_FROM_TRANSIT"],
            },
          },
        }),
        2,
      );
      const incomingTransit = await inject(
        app,
        "GET",
        `/api/stock?warehouseId=${warehouseIds[1]}&q=${products[0]!.sku}`,
        targetManager,
      );
      assert.equal(incomingTransit.statusCode, 200);
      assert.equal(incomingTransit.json().items[0].inTransitIncoming, "0.000");

      const failureDraftResponse = await inject(
        app,
        "POST",
        "/api/transfers",
        sourceManager,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [{ productId: products[0]!.id, quantity: "1" }],
        },
      );
      assert.equal(failureDraftResponse.statusCode, 201);
      const failureDraft = failureDraftResponse.json();
      const movementCountBeforeFailure = await db.stockMovement.count({
        where: { transferLine: { transferId: failureDraft.id } },
      });
      const sourceBalanceBeforeFailure = await db.stockBalance.findUniqueOrThrow({
        where: {
          warehouseId_productId: {
            warehouseId: warehouseIds[0]!,
            productId: products[0]!.id,
          },
        },
      });
      await installTransferAuditFailureTrigger();
      try {
        const failedShipment = await inject(
          app,
          "POST",
          `/api/transfers/${failureDraft.id}/ship`,
          sourceManager,
          { expectedUpdatedAt: failureDraft.updatedAt },
          { idempotencyKey: `audit-fail-${suffix}` },
        );
        assert.equal(failedShipment.statusCode, 500);
      } finally {
        await dropTransferAuditFailureTrigger();
      }
      const afterAuditFailure = await db.transfer.findUniqueOrThrow({
        where: { id: failureDraft.id },
      });
      assert.equal(afterAuditFailure.status, "DRAFT");
      assert.equal(
        await db.stockMovement.count({
          where: { transferLine: { transferId: failureDraft.id } },
        }),
        movementCountBeforeFailure,
      );
      assert.equal(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              warehouseId_productId: {
                warehouseId: warehouseIds[0]!,
                productId: products[0]!.id,
              },
            },
          })
        ).quantity.toFixed(3),
        sourceBalanceBeforeFailure.quantity.toFixed(3),
      );
      assert.equal(
        await db.idempotencyRecord.count({
          where: {
            userId: userIds.sourceManager,
            operationScope: "TRANSFER_SHIPMENT",
            key: `audit-fail-${suffix}`,
          },
        }),
        0,
      );

      await db.warehouse.update({
        where: { id: warehouseIds[1]! },
        data: { isActive: false },
      });
      const transferToInactive = await inject(
        app,
        "POST",
        "/api/transfers",
        admin,
        {
          sourceWarehouseId: warehouseIds[0],
          targetWarehouseId: warehouseIds[1],
          lines: [{ productId: products[0]!.id, quantity: "1" }],
        },
      );
      assert.equal(transferToInactive.statusCode, 409);
      await db.warehouse.update({
        where: { id: warehouseIds[1]! },
        data: { isActive: true },
      });
    } finally {
      await app.close();
    }
  },
);
