import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
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
import { ApiError } from "../../shared/api-error.js";
import { ensureWarehouseCanBeDeactivated } from "./catalog-routes.js";

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
assert.ok(
  !new URL(testTarget.connectionString).password.includes("REPLACE_WITH"),
  "Set the separate local test database password in .env before running catalog integration tests.",
);
assert.notEqual(
  testTarget.databaseName,
  developmentTarget.databaseName,
  "Catalog integration tests must not use the development database.",
);

const pool = new Pool({
  connectionString: testTarget.connectionString,
  connectionTimeoutMillis: 3_000,
  max: 8,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const cleanupPool = new Pool({
  connectionString: migrationTarget.connectionString,
  connectionTimeoutMillis: 3_000,
  max: 2,
});
const cleanupPrisma = new PrismaClient({ adapter: new PrismaPg(cleanupPool) });

async function cleanCatalogFixtures(): Promise<void> {
  // Unique fixtures are retained: completed counts and the stock ledger are immutable.
  // Never remove historical fixtures by broad prefixes shared with other test runs.
}

async function dropAuditFailureTrigger(): Promise<void> {
  await cleanupPool.query(
    `DROP TRIGGER IF EXISTS "catalog_test_fail_audit_insert" ON "AuditEvent"`,
  );
  await cleanupPool.query(
    `DROP FUNCTION IF EXISTS catalog_test_fail_audit_insert()`,
  );
}

async function installAuditFailureTrigger(): Promise<void> {
  await dropAuditFailureTrigger();
  await cleanupPool.query(`
    CREATE FUNCTION catalog_test_fail_audit_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."action" = 'PRODUCT_STATUS_CHANGED' THEN
        RAISE EXCEPTION 'Catalog integration audit failure'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await cleanupPool.query(`
    CREATE TRIGGER "catalog_test_fail_audit_insert"
    BEFORE INSERT ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION catalog_test_fail_audit_insert()
  `);
}

interface TestIdentity {
  user: AuthenticatedUser & { isActive: boolean; passwordHash: string };
  sessions: Map<string, SessionWithUser>;
}

class MemoryAuthStore implements AuthStore {
  readonly identities = new Map<string, TestIdentity>();
  readonly sessions = new Map<string, SessionWithUser>();

  addIdentity(
    user: AuthenticatedUser & { isActive: boolean; passwordHash: string },
  ): TestIdentity {
    const identity = { user, sessions: new Map<string, SessionWithUser>() };
    this.identities.set(user.id, identity);
    return identity;
  }

  async findUserByUsername(username: string) {
    return (
      [...this.identities.values()].find(
        ({ user }) => user.username === username,
      )?.user ?? null
    );
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const identity = this.identities.get(userId);
    if (identity) {
      identity.user.passwordHash = passwordHash;
    }
  }

  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<{ id: string }> {
    const identity = this.identities.get(userId);
    assert.ok(identity);
    const session: SessionWithUser = {
      id: randomUUID(),
      userId,
      expiresAt,
      revokedAt: null,
      user: identity.user,
    };
    this.sessions.set(tokenHash, session);
    return { id: session.id };
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async updateSessionLastSeen(): Promise<void> {}

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) {
      session.revokedAt = revokedAt;
    }
  }
}

interface AuthHeaders {
  cookie: string;
  "x-csrf-token": string;
}

function issueTestSession(
  store: MemoryAuthStore,
  user: TestIdentity["user"],
): AuthHeaders {
  const rawToken = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const session: SessionWithUser = {
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    revokedAt: null,
    user,
  };
  store.sessions.set(tokenHash, session);
  return {
    cookie: `stock_session=${rawToken}`,
    "x-csrf-token": createHmac("sha256", rawToken)
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
  csrf = true,
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie: auth.cookie,
      origin,
      ...(csrf ? { "x-csrf-token": auth["x-csrf-token"] } : {}),
    },
    ...(payload ? { payload } : {}),
  });
}

function identity(
  id: string,
  role: AppRole,
  warehouseIds: string[],
): TestIdentity["user"] {
  return {
    id,
    username: `catalog-${id.slice(0, 8)}`,
    displayName: "Catalog Test",
    role,
    warehouseIds,
    isActive: true,
    passwordHash: "not-used-by-catalog-tests",
  };
}

test("catalog API enforces authorization, integrity, audit, and concurrency rules", async () => {
  const suffix = randomUUID().replaceAll("-", "").toUpperCase();
  let categoryId = "";
  const warehouseIds: [string, string] = [randomUUID(), randomUUID()];
  const userIds = {
    admin: randomUUID(),
    manager: randomUUID(),
    viewer: randomUUID(),
  };

  for (const [role, id] of Object.entries(userIds)) {
    await prisma.user.create({
      data: {
        id,
        username: `catalog-${suffix}-${role}`.toLowerCase(),
        displayName: "Catalog Test",
        passwordHash: "not-used-by-catalog-tests",
        role:
          role === "admin"
            ? "ADMIN"
            : role === "manager"
              ? "WAREHOUSE_MANAGER"
              : "VIEWER",
      },
    });
  }
  for (const [index, id] of warehouseIds.entries()) {
    await prisma.warehouse.create({
      data: {
        id,
        code: `WH-${suffix}-${index}`,
        name: `Catalog Integration Warehouse ${suffix} ${index}`,
      },
    });
  }

  const store = new MemoryAuthStore();
  const adminIdentity = store.addIdentity(identity(userIds.admin, "ADMIN", []));
  const managerIdentity = store.addIdentity(
    identity(userIds.manager, "WAREHOUSE_MANAGER", [warehouseIds[0]]),
  );
  const viewerIdentity = store.addIdentity(
    identity(userIds.viewer, "VIEWER", [warehouseIds[0]]),
  );
  const admin = issueTestSession(store, adminIdentity.user);
  const manager = issueTestSession(store, managerIdentity.user);
  const viewer = issueTestSession(store, viewerIdentity.user);
  const app = buildApp(
    { store, appOrigin: origin, secureCookies: false },
    prisma,
  );

  try {
    const categoryResponse = await inject(
      app,
      "POST",
      "/api/categories",
      admin,
      {
        code: `  cat-${suffix}  `,
        name: `Catalog Integration Category ${suffix}`,
      },
    );
    assert.equal(categoryResponse.statusCode, 201);
    const category = categoryResponse.json();
    categoryId = category.id;
    assert.equal(category.code, `CAT-${suffix}`);

    const createProduct = async (sku: string, barcode?: string) =>
      inject(app, "POST", "/api/products", admin, {
        sku,
        name: "Test Ürünü",
        categoryId,
        unit: "EACH",
        ...(barcode === undefined ? {} : { barcode }),
      });

    const productResponse = await createProduct(
      `  ab-${suffix}  `,
      `000012345${suffix}`,
    );
    assert.equal(productResponse.statusCode, 201);
    const product = productResponse.json();
    assert.equal(product.sku, `AB-${suffix}`);
    assert.equal(product.barcode, `000012345${suffix}`);

    const emptyBarcodeResponse = await createProduct(`NULL-${suffix}`, "   ");
    assert.equal(emptyBarcodeResponse.statusCode, 201);
    const emptyBarcodeProduct = emptyBarcodeResponse.json();
    assert.equal(emptyBarcodeProduct.barcode, null);

    const duplicateSkuResponses = await Promise.all([
      createProduct(`race-${suffix}`),
      createProduct(` RACE-${suffix} `),
    ]);
    assert.deepEqual(
      duplicateSkuResponses.map((response) => response.statusCode).sort(),
      [201, 409],
    );
    for (const response of duplicateSkuResponses) {
      if (response.statusCode === 201) {
        assert.ok(response.json().id);
      }
    }
    const duplicateBarcode = await createProduct(
      `OTHER-${suffix}`,
      `000012345${suffix}`,
    );
    assert.equal(duplicateBarcode.statusCode, 409);

    const list = await inject(
      app,
      "GET",
      `/api/products?q=ab-${suffix}&isActive=true&page=1&pageSize=1&sort=sku`,
      manager,
    );
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().total, 1);
    assert.equal(list.json().items[0].sku, `AB-${suffix}`);

    const missingCsrf = await inject(
      app,
      "PATCH",
      `/api/products/${product.id}`,
      admin,
      {
        name: "Adı korumalı ürün",
        expectedUpdatedAt: product.updatedAt,
      },
      false,
    );
    assert.equal(missingCsrf.statusCode, 403);

    const managerWrite = await inject(
      app,
      "PATCH",
      `/api/products/${product.id}`,
      manager,
      { isActive: false, expectedUpdatedAt: product.updatedAt },
    );
    assert.equal(managerWrite.statusCode, 403);
    const viewerWrite = await inject(app, "POST", "/api/categories", viewer, {
      code: `NO-${suffix}`,
      name: "Denied",
    });
    assert.equal(viewerWrite.statusCode, 403);

    const productEdit = await inject(
      app,
      "PATCH",
      `/api/products/${product.id}`,
      admin,
      {
        name: "Güncel ürün adı",
        isActive: false,
        expectedUpdatedAt: product.updatedAt,
      },
    );
    assert.equal(productEdit.statusCode, 200);
    const editedProduct = productEdit.json();
    assert.equal(editedProduct.name, "Güncel ürün adı");
    assert.equal(editedProduct.isActive, false);
    await installAuditFailureTrigger();
    const rejectedByAudit = await inject(
      app,
      "PATCH",
      `/api/products/${product.id}`,
      admin,
      {
        isActive: true,
        expectedUpdatedAt: editedProduct.updatedAt,
      },
    );
    assert.equal(rejectedByAudit.statusCode, 500);
    const productAfterAuditFailure = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    assert.equal(productAfterAuditFailure.isActive, false);
    assert.equal(
      productAfterAuditFailure.updatedAt.toISOString(),
      editedProduct.updatedAt,
    );
    await dropAuditFailureTrigger();
    const staleProductEdit = await inject(
      app,
      "PATCH",
      `/api/products/${product.id}`,
      admin,
      {
        name: "Eski sürüm",
        expectedUpdatedAt: product.updatedAt,
      },
    );
    assert.equal(staleProductEdit.statusCode, 409);

    const historyProductResponse = await createProduct(`HISTORY-${suffix}`);
    assert.equal(historyProductResponse.statusCode, 201);
    const historyProduct = historyProductResponse.json();
    const document = await prisma.stockDocument.create({
      data: {
        type: "RECEIPT",
        warehouseId: warehouseIds[0],
        createdById: userIds.admin,
      },
    });
    await prisma.stockDocumentLine.create({
      data: {
        documentId: document.id,
        productId: historyProduct.id,
        unit: "EACH",
        quantity: 1,
      },
    });
    const unitChange = await inject(
      app,
      "PATCH",
      `/api/products/${historyProduct.id}`,
      admin,
      {
        unit: "METER",
        expectedUpdatedAt: historyProduct.updatedAt,
      },
    );
    assert.equal(unitChange.statusCode, 409);

    const inactiveCategory = await inject(
      app,
      "PATCH",
      `/api/categories/${categoryId}`,
      admin,
      {
        isActive: false,
        expectedUpdatedAt: category.updatedAt,
      },
    );
    assert.equal(inactiveCategory.statusCode, 200, inactiveCategory.body);
    const statusAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: userIds.admin,
        relatedType: "Category",
        relatedId: categoryId,
        action: "CATEGORY_STATUS_CHANGED",
      },
    });
    assert.ok(statusAudit);
    const inactiveCategoryAssignment = await createProduct(
      `INACTIVE-${suffix}`,
    );
    assert.equal(inactiveCategoryAssignment.statusCode, 400);

    const warehouseResponse = await inject(
      app,
      "GET",
      `/api/warehouses/${warehouseIds[0]}`,
      admin,
    );
    assert.equal(warehouseResponse.statusCode, 200);
    const locationResponse = await inject(
      app,
      "POST",
      `/api/warehouses/${warehouseIds[0]}/locations`,
      admin,
      { code: `A-${suffix}`, name: "Raf A" },
    );
    assert.equal(locationResponse.statusCode, 201);
    const location = locationResponse.json();
    const managerLocations = await inject(
      app,
      "GET",
      `/api/warehouses/${warehouseIds[0]}/locations`,
      manager,
    );
    assert.equal(managerLocations.statusCode, 200);
    assert.equal(managerLocations.json().length, 1);
    const hiddenWarehouse = await inject(
      app,
      "GET",
      `/api/warehouses/${warehouseIds[1]}`,
      manager,
    );
    assert.equal(hiddenWarehouse.statusCode, 404);
    const hiddenWarehouseList = await inject(
      app,
      "GET",
      "/api/warehouses",
      viewer,
    );
    assert.equal(hiddenWarehouseList.statusCode, 200);
    assert.deepEqual(
      hiddenWarehouseList.json().items.map((item: { id: string }) => item.id),
      [warehouseIds[0]],
    );
    const locationAcrossWarehouses = await inject(
      app,
      "GET",
      `/api/warehouses/${warehouseIds[1]}/locations/${location.id}`,
      admin,
    );
    assert.equal(locationAcrossWarehouses.statusCode, 404);
    const locationEditWrongWarehouse = await inject(
      app,
      "PATCH",
      `/api/warehouses/${warehouseIds[1]}/locations/${location.id}`,
      admin,
      { name: "Wrong depot", expectedUpdatedAt: location.updatedAt },
    );
    assert.equal(locationEditWrongWarehouse.statusCode, 404);
    const rackDuplicate = await inject(
      app,
      "POST",
      `/api/warehouses/${warehouseIds[0]}/locations`,
      admin,
      { code: `a-${suffix}`, name: "Duplicate" },
    );
    assert.equal(rackDuplicate.statusCode, 409);
    const rackSameCodeOtherWarehouse = await inject(
      app,
      "POST",
      `/api/warehouses/${warehouseIds[1]}/locations`,
      admin,
      { code: `A-${suffix}`, name: "Raf A" },
    );
    assert.equal(rackSameCodeOtherWarehouse.statusCode, 201);

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.transfer.create({
          data: {
            sourceWarehouseId: warehouseIds[0],
            targetWarehouseId: warehouseIds[1],
            createdById: userIds.admin,
          },
        });
        await assert.rejects(
          ensureWarehouseCanBeDeactivated(tx, warehouseIds[0]),
          (error: unknown) =>
            error instanceof ApiError && error.statusCode === 409,
        );
        throw new Error("rollback catalog transfer fixture");
      }),
      /rollback catalog transfer fixture/,
    );
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.stockCount.create({
          data: {
            warehouseId: warehouseIds[0],
            openedById: userIds.admin,
            responsibleUserId: userIds.admin,
          },
        });
        await assert.rejects(
          ensureWarehouseCanBeDeactivated(tx, warehouseIds[0]),
          (error: unknown) =>
            error instanceof ApiError && error.statusCode === 409,
        );
        throw new Error("rollback catalog count fixture");
      }),
      /rollback catalog count fixture/,
    );

    const auditBefore = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { name: true },
    });
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.category.update({
          where: { id: categoryId },
          data: { name: "Must Roll Back" },
        });
        await tx.auditEvent.create({
          data: {
            userId: userIds.admin,
            action: "TEST_AUDIT_FAILURE",
            relatedType: "x".repeat(81),
            relatedId: categoryId,
          },
        });
      }),
    );
    const auditAfter = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { name: true },
    });
    assert.deepEqual(auditAfter, auditBefore);

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const stockedWarehouse = await tx.warehouse.create({
          data: {
            code: `LOCK-${suffix}`,
            name: "Rollback stock lock test",
          },
        });
        const receipt = await tx.stockDocument.create({
          data: {
            type: "RECEIPT",
            warehouseId: stockedWarehouse.id,
            createdById: userIds.admin,
          },
        });
        const line = await tx.stockDocumentLine.create({
          data: {
            documentId: receipt.id,
            productId: historyProduct.id,
            unit: "EACH",
            quantity: 1,
          },
        });
        await tx.stockDocument.update({
          where: { id: receipt.id },
          data: {
            status: "APPROVED",
            approvedById: userIds.admin,
            approvedAt: new Date(),
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: historyProduct.id,
            warehouseId: stockedWarehouse.id,
            direction: "IN",
            quantity: 1,
            unit: "EACH",
            type: "RECEIPT",
            createdById: userIds.admin,
            documentLineId: line.id,
          },
        });
        await assert.rejects(
          ensureWarehouseCanBeDeactivated(tx, stockedWarehouse.id),
          (error: unknown) =>
            error instanceof ApiError && error.statusCode === 409,
        );
        throw new Error("rollback catalog stock lock fixture");
      }),
      /rollback catalog stock lock fixture/,
    );

    const secondWarehouse = await inject(
      app,
      "GET",
      `/api/warehouses/${warehouseIds[1]}`,
      admin,
    );
    assert.equal(secondWarehouse.statusCode, 200);
    const inactiveWarehouse = await inject(
      app,
      "PATCH",
      `/api/warehouses/${warehouseIds[1]}`,
      admin,
      {
        isActive: false,
        expectedUpdatedAt: secondWarehouse.json().updatedAt,
      },
    );
    assert.equal(inactiveWarehouse.statusCode, 200);
    assert.equal(inactiveWarehouse.json().isActive, false);
  } finally {
    await app.close();
    await dropAuditFailureTrigger();
    await cleanCatalogFixtures();
  }
});

before(async () => {
  const result = await pool.query<{
    databaseName: string;
    currentUser: string;
  }>(
    `SELECT current_database() AS "databaseName", current_user AS "currentUser"`,
  );
  assert.equal(result.rows[0]?.databaseName, TEST_DATABASE_NAME);
  assert.equal(result.rows[0]?.currentUser, "stock_warehouse_app");
  const cleanupIdentity = await cleanupPool.query<{
    databaseName: string;
    currentUser: string;
  }>(
    `SELECT current_database() AS "databaseName", current_user AS "currentUser"`,
  );
  assert.equal(cleanupIdentity.rows[0]?.databaseName, TEST_DATABASE_NAME);
  assert.equal(
    cleanupIdentity.rows[0]?.currentUser,
    "stock_warehouse_migrator",
  );
  await cleanCatalogFixtures();
});

after(async () => {
  await dropAuditFailureTrigger();
  await prisma.$disconnect();
  await pool.end();
  await cleanupPrisma.$disconnect();
  await cleanupPool.end();
});
