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
  "Stock integration tests must use the separate test database.",
);
assert.notEqual(
  migrationTarget.databaseName,
  developmentTarget.databaseName,
  "Stock integration test cleanup must not use the development database.",
);

const pool = new Pool({
  connectionString: testTarget.connectionString,
  connectionTimeoutMillis: 3_000,
  max: 12,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const adminPool = new Pool({
  connectionString: migrationTarget.connectionString,
  connectionTimeoutMillis: 3_000,
  max: 2,
});

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
    username: `stock-test-${id.slice(0, 8)}`,
    displayName: "Stok Testi",
    role,
    warehouseIds,
    isActive: true,
    passwordHash: "not-used-in-stock-tests",
  };
}

function issueSession(
  store: MemoryAuthStore,
  user: Identity["user"],
): AuthHeaders {
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

async function installAuditFailureTrigger(): Promise<void> {
  await adminPool.query(
    `DROP TRIGGER IF EXISTS "stock_test_fail_approval_audit" ON "AuditEvent"`,
  );
  await adminPool.query(
    `DROP FUNCTION IF EXISTS stock_test_fail_approval_audit()`,
  );
  await adminPool.query(`
    CREATE FUNCTION stock_test_fail_approval_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."action" = 'STOCK_DOCUMENT_APPROVED' THEN
        RAISE EXCEPTION 'Stock integration audit failure'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await adminPool.query(`
    CREATE TRIGGER "stock_test_fail_approval_audit"
    BEFORE INSERT ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION stock_test_fail_approval_audit()
  `);
}

async function dropAuditFailureTrigger(): Promise<void> {
  await adminPool.query(
    `DROP TRIGGER IF EXISTS "stock_test_fail_approval_audit" ON "AuditEvent"`,
  );
  await adminPool.query(
    `DROP FUNCTION IF EXISTS stock_test_fail_approval_audit()`,
  );
}

after(async () => {
  await dropAuditFailureTrigger();
  await prisma.$disconnect();
  await pool.end();
  await adminPool.end();
});

test("stock document routes enforce inventory rules and PostgreSQL atomicity", async () => {
  const suffix = randomUUID().replaceAll("-", "").toUpperCase();
  const userIds = {
    admin: randomUUID(),
    manager: randomUUID(),
    viewer: randomUUID(),
  };
  const warehouseIds = [randomUUID(), randomUUID()];
  const category = await prisma.category.create({
    data: { code: `ST-${suffix.slice(0, 42)}`, name: `Stock Test ${suffix}` },
  });
  for (const [role, id] of Object.entries(userIds)) {
    await prisma.user.create({
      data: {
        id,
        username: `stock-test-${suffix}-${role}`.toLowerCase(),
        displayName: "Stok Testi",
        passwordHash: "not-used-in-stock-tests",
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
        code: `ST-${suffix.slice(0, 40)}-${index}`,
        name: `Stock Test Warehouse ${suffix} ${index}`,
      },
    });
  }
  const products = await Promise.all([
    prisma.product.create({
      data: {
        sku: `ST-E-${suffix.slice(0, 40)}`,
        name: "Stok test adet",
        categoryId: category.id,
        unit: "EACH",
      },
    }),
    prisma.product.create({
      data: {
        sku: `ST-K-${suffix.slice(0, 40)}`,
        name: "Stok test kilogram",
        categoryId: category.id,
        unit: "KILOGRAM",
      },
    }),
  ]);

  const store = new MemoryAuthStore();
  const adminUser = testUser(userIds.admin, "ADMIN", []);
  const managerUser = testUser(userIds.manager, "WAREHOUSE_MANAGER", [warehouseIds[0]!]);
  const viewerUser = testUser(userIds.viewer, "VIEWER", [warehouseIds[0]!]);
  store.add(adminUser);
  store.add(managerUser);
  store.add(viewerUser);
  const admin = issueSession(store, adminUser);
  const manager = issueSession(store, managerUser);
  const viewer = issueSession(store, viewerUser);
  const app = buildApp(
    { store, appOrigin: origin, secureCookies: false },
    prisma,
  );

  try {
    const createDocument = async (
      auth: AuthHeaders,
      type: "RECEIPT" | "ISSUE",
      warehouseId: string,
      lines: Array<{ productId: string; quantity: string }>,
      options: { csrf?: boolean } = {},
    ) =>
      inject(
        app,
        "POST",
        "/api/stock-documents",
        auth,
        {
          type,
          warehouseId,
          reference: `TEST-${suffix}`,
          lines,
        },
        options,
      );

    const receiptResponse = await createDocument(admin, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "10" },
      { productId: products[1]!.id, quantity: "2.500" },
    ]);
    assert.equal(receiptResponse.statusCode, 201, receiptResponse.body);
    const receipt = receiptResponse.json();
    assert.equal(receipt.status, "DRAFT");
    assert.equal(receipt.documentNumber, String(receipt.documentNumber));
    const beforeReceiptApproval = await prisma.stockBalance.findMany({
      where: { warehouseId: warehouseIds[0]! },
    });
    assert.equal(beforeReceiptApproval.length, 0, "Draft must not create balances.");

    const viewerWrite = await createDocument(viewer, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "1" },
    ]);
    assert.equal(viewerWrite.statusCode, 403);
    const managerWriteOtherWarehouse = await createDocument(
      manager,
      "RECEIPT",
      warehouseIds[1]!,
      [{ productId: products[0]!.id, quantity: "1" }],
    );
    assert.equal(managerWriteOtherWarehouse.statusCode, 403);
    const managerDraft = await createDocument(
      manager,
      "RECEIPT",
      warehouseIds[0]!,
      [{ productId: products[0]!.id, quantity: "1" }],
    );
    assert.equal(managerDraft.statusCode, 201);
    const managerDraftBody = managerDraft.json();
    const managerCancel = await inject(
      app,
      "POST",
      `/api/stock-documents/${managerDraftBody.id}/cancel`,
      manager,
      { expectedUpdatedAt: managerDraftBody.updatedAt },
    );
    assert.equal(managerCancel.statusCode, 200);
    const missingCsrf = await createDocument(
      admin,
      "RECEIPT",
      warehouseIds[0]!,
      [{ productId: products[0]!.id, quantity: "1" }],
      { csrf: false },
    );
    assert.equal(missingCsrf.statusCode, 403);
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/api/stock-documents/${receipt.id}`,
          manager,
        )
      ).statusCode,
      200,
    );
    const hiddenDraft = await createDocument(admin, "RECEIPT", warehouseIds[1]!, [
      { productId: products[0]!.id, quantity: "1" },
    ]);
    assert.equal(hiddenDraft.statusCode, 201);
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/api/stock-documents/${hiddenDraft.json().id}`,
          manager,
        )
      ).statusCode,
      404,
    );

    const invalidEach = await createDocument(admin, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "1.5" },
    ]);
    assert.equal(invalidEach.statusCode, 400);
    const invalidDecimal = await createDocument(
      admin,
      "RECEIPT",
      warehouseIds[0]!,
      [{ productId: products[1]!.id, quantity: "1.0001" }],
    );
    assert.equal(invalidDecimal.statusCode, 400);

    const approveHeaders = {
      idempotencyKey: `stock-${randomUUID()}`,
    };
    const approved = await inject(
      app,
      "POST",
      `/api/stock-documents/${receipt.id}/approve`,
      admin,
      { expectedUpdatedAt: receipt.updatedAt },
      approveHeaders,
    );
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().status, "APPROVED");
    const editApproved = await inject(
      app,
      "PATCH",
      `/api/stock-documents/${receipt.id}`,
      admin,
      {
        reference: "Değiştirilemez",
        expectedUpdatedAt: approved.json().updatedAt,
        lines: [{ productId: products[0]!.id, quantity: "10" }],
      },
    );
    assert.equal(editApproved.statusCode, 409);
    const movementCountAfterReceipt = await prisma.stockMovement.count({
      where: { warehouseId: warehouseIds[0]! },
    });
    const repeatedApproval = await inject(
      app,
      "POST",
      `/api/stock-documents/${receipt.id}/approve`,
      admin,
      { expectedUpdatedAt: receipt.updatedAt },
      approveHeaders,
    );
    assert.equal(repeatedApproval.statusCode, 200);
    assert.equal(
      await prisma.stockMovement.count({
        where: { warehouseId: warehouseIds[0]! },
      }),
      movementCountAfterReceipt,
    );
    const keyPayloadConflict = await inject(
      app,
      "POST",
      `/api/stock-documents/${receipt.id}/approve`,
      admin,
      { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
      approveHeaders,
    );
    assert.equal(keyPayloadConflict.statusCode, 409);

    const balancesAfterReceipt = await prisma.stockBalance.findMany({
      where: { warehouseId: warehouseIds[0]! },
      orderBy: { productId: "asc" },
    });
    assert.equal(
      balancesAfterReceipt.find(
        (balance) => balance.productId === products[0]!.id,
      )?.quantity.toFixed(3),
      "10.000",
    );
    assert.equal(
      balancesAfterReceipt.find(
        (balance) => balance.productId === products[1]!.id,
      )?.quantity.toFixed(3),
      "2.500",
    );

    const stockAsManager = await inject(
      app,
      "GET",
      `/api/stock?warehouseId=${warehouseIds[0]}&q=${products[0]!.sku}&pageSize=100`,
      manager,
    );
    assert.equal(stockAsManager.statusCode, 200);
    assert.equal(stockAsManager.json().items.length, 1);
    assert.equal(stockAsManager.json().items[0].quantity, "10.000");
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/api/stock?warehouseId=${warehouseIds[1]}`,
          manager,
        )
      ).statusCode,
      404,
    );
    const zeroStock = await inject(
      app,
      "GET",
      `/api/stock?warehouseId=${warehouseIds[1]}&q=${products[0]!.sku}`,
      admin,
    );
    assert.equal(zeroStock.statusCode, 200);
    assert.equal(zeroStock.json().items[0].quantity, "0.000");
    await prisma.warehouse.update({
      where: { id: warehouseIds[1]! },
      data: { isActive: false },
    });
    const passiveWarehouseDraftApproval = await inject(
      app,
      "POST",
      `/api/stock-documents/${hiddenDraft.json().id}/approve`,
      admin,
      { expectedUpdatedAt: hiddenDraft.json().updatedAt },
      { idempotencyKey: `stock-${randomUUID()}` },
    );
    assert.equal(passiveWarehouseDraftApproval.statusCode, 409);
    const createAtPassiveWarehouse = await createDocument(
      admin,
      "RECEIPT",
      warehouseIds[1]!,
      [{ productId: products[0]!.id, quantity: "1" }],
    );
    assert.equal(createAtPassiveWarehouse.statusCode, 409);
    const issueUnauthorized = await createDocument(
      viewer,
      "ISSUE",
      warehouseIds[0]!,
      [{ productId: products[0]!.id, quantity: "1" }],
    );
    assert.equal(issueUnauthorized.statusCode, 403);

    const atomicIssue = await createDocument(admin, "ISSUE", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "2" },
      { productId: products[1]!.id, quantity: "999" },
    ]);
    const atomicIssueDoc = atomicIssue.json();
    const atomicFailed = await inject(
      app,
      "POST",
      `/api/stock-documents/${atomicIssueDoc.id}/approve`,
      admin,
      { expectedUpdatedAt: atomicIssueDoc.updatedAt },
      { idempotencyKey: `stock-${randomUUID()}` },
    );
    assert.equal(atomicFailed.statusCode, 409);
    const unchangedBalances = await prisma.stockBalance.findMany({
      where: { warehouseId: warehouseIds[0]! },
    });
    assert.equal(
      unchangedBalances.find(
        (balance) => balance.productId === products[0]!.id,
      )?.quantity.toFixed(3),
      "10.000",
    );
    assert.equal(
      unchangedBalances.find(
        (balance) => balance.productId === products[1]!.id,
      )?.quantity.toFixed(3),
      "2.500",
    );
    assert.equal(
      await prisma.stockMovement.count({
        where: { documentLine: { documentId: atomicIssueDoc.id } },
      }),
      0,
    );

    const cancelled = await createDocument(admin, "ISSUE", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "1" },
    ]);
    const cancelledDoc = cancelled.json();
    const editedDraft = await inject(
      app,
      "PATCH",
      `/api/stock-documents/${cancelledDoc.id}`,
      admin,
      {
        reference: "Düzenlendi",
        expectedUpdatedAt: cancelledDoc.updatedAt,
        lines: [{ productId: products[0]!.id, quantity: "1" }],
      },
    );
    assert.equal(editedDraft.statusCode, 200);
    assert.equal(editedDraft.json().reference, "Düzenlendi");
    const cancelResponse = await inject(
      app,
      "POST",
      `/api/stock-documents/${cancelledDoc.id}/cancel`,
      admin,
      { expectedUpdatedAt: editedDraft.json().updatedAt },
    );
    assert.equal(cancelResponse.statusCode, 200);
    assert.equal(cancelResponse.json().status, "CANCELLED");
    assert.equal(
      await prisma.stockMovement.count({
        where: { documentLine: { documentId: cancelledDoc.id } },
      }),
      0,
    );

    const concurrentIssues = await Promise.all(
      [0, 1].map(async () => {
        const draft = await createDocument(admin, "ISSUE", warehouseIds[0]!, [
          { productId: products[0]!.id, quantity: "7" },
        ]);
        const document = draft.json();
        return {
          id: document.id as string,
          updatedAt: document.updatedAt as string,
        };
      }),
    );
    const concurrentResults = await Promise.all(
      concurrentIssues.map((document) =>
        inject(
          app,
          "POST",
          `/api/stock-documents/${document.id}/approve`,
          admin,
          { expectedUpdatedAt: document.updatedAt },
          { idempotencyKey: `stock-${randomUUID()}` },
        ),
      ),
    );
    assert.deepEqual(
      concurrentResults.map((response) => response.statusCode).sort(),
      [200, 409],
    );
    const afterConcurrent = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        warehouseId_productId: {
          warehouseId: warehouseIds[0]!,
          productId: products[0]!.id,
        },
      },
    });
    assert.equal(afterConcurrent.quantity.toFixed(3), "3.000");

    const sameDoc = await createDocument(admin, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "3" },
    ]);
    const sameDocBody = sameDoc.json();
    const sharedKey = `stock-${randomUUID()}`;
    const sameDocApprovals = await Promise.all([
      inject(
        app,
        "POST",
        `/api/stock-documents/${sameDocBody.id}/approve`,
        admin,
        { expectedUpdatedAt: sameDocBody.updatedAt },
        { idempotencyKey: sharedKey },
      ),
      inject(
        app,
        "POST",
        `/api/stock-documents/${sameDocBody.id}/approve`,
        admin,
        { expectedUpdatedAt: sameDocBody.updatedAt },
        { idempotencyKey: sharedKey },
      ),
    ]);
    assert.deepEqual(
      sameDocApprovals.map((response) => response.statusCode),
      [200, 200],
    );
    assert.equal(
      await prisma.stockMovement.count({
        where: { documentLine: { documentId: sameDocBody.id } },
      }),
      1,
    );

    const drafts = await createDocument(admin, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "1" },
    ]);
    const draftBody = drafts.json();
    const stalePatch = await inject(
      app,
      "PATCH",
      `/api/stock-documents/${draftBody.id}`,
      admin,
      {
        reference: "Güncellenmiş",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        lines: [{ productId: products[0]!.id, quantity: "1" }],
      },
    );
    assert.equal(stalePatch.statusCode, 409);

    const deactivatedProductDraft = await createDocument(
      admin,
      "RECEIPT",
      warehouseIds[0]!,
      [{ productId: products[1]!.id, quantity: "1.250" }],
    );
    const deactivatedProductDocument = deactivatedProductDraft.json();
    await prisma.product.update({
      where: { id: products[1]!.id },
      data: { isActive: false },
    });
    const passiveApproval = await inject(
      app,
      "POST",
      `/api/stock-documents/${deactivatedProductDocument.id}/approve`,
      admin,
      { expectedUpdatedAt: deactivatedProductDocument.updatedAt },
      { idempotencyKey: `stock-${randomUUID()}` },
    );
    assert.equal(passiveApproval.statusCode, 409);

    const countDraft = await createDocument(admin, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "1" },
    ]);
    const countDocument = countDraft.json();
    const openCount = await prisma.stockCount.create({
      data: {
        warehouseId: warehouseIds[0]!,
        openedById: userIds.admin,
        responsibleUserId: userIds.admin,
        description: `Stock test open count ${suffix}`,
      },
    });
    const countRejection = await inject(
      app,
      "POST",
      `/api/stock-documents/${countDocument.id}/approve`,
      admin,
      { expectedUpdatedAt: countDocument.updatedAt },
      { idempotencyKey: `stock-${randomUUID()}` },
    );
    assert.equal(countRejection.statusCode, 409);
    await prisma.stockCount.update({
      where: { id: openCount.id },
      data: {
        status: "CANCELLED",
        cancelledById: userIds.admin,
        cancelledAt: new Date(),
        closedAt: new Date(),
      },
    });

    const auditFailureDraft = await createDocument(admin, "RECEIPT", warehouseIds[0]!, [
      { productId: products[0]!.id, quantity: "1" },
    ]);
    const auditFailureDocument = auditFailureDraft.json();
    await installAuditFailureTrigger();
    try {
      const failedApproval = await inject(
        app,
        "POST",
        `/api/stock-documents/${auditFailureDocument.id}/approve`,
        admin,
        { expectedUpdatedAt: auditFailureDocument.updatedAt },
        { idempotencyKey: `stock-${randomUUID()}` },
      );
      assert.equal(failedApproval.statusCode, 500);
    } finally {
      await dropAuditFailureTrigger();
    }
    assert.equal(
      (
        await prisma.stockDocument.findUniqueOrThrow({
          where: { id: auditFailureDocument.id },
        })
      ).status,
      "DRAFT",
    );
    assert.equal(
      await prisma.stockMovement.count({
        where: { documentLine: { documentId: auditFailureDocument.id } },
      }),
      0,
    );
    assert.equal(
      (
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: warehouseIds[0]!,
              productId: products[0]!.id,
            },
          },
        })
      ).quantity.toFixed(3),
      "6.000",
    );

    const managerDocs = await inject(
      app,
      "GET",
      `/api/stock-documents?warehouseId=${warehouseIds[0]}&pageSize=100`,
      manager,
    );
    assert.equal(managerDocs.statusCode, 200);
    assert.ok(
      managerDocs.json().items.every(
        (document: { warehouseId: string }) =>
          document.warehouseId === warehouseIds[0],
      ),
    );
    const managerMovements = await inject(
      app,
      "GET",
      `/api/stock-movements?warehouseId=${warehouseIds[0]}&pageSize=100`,
      manager,
    );
    assert.equal(managerMovements.statusCode, 200);
    assert.ok(
      managerMovements.json().items.every(
        (movement: { warehouse: { id: string } }) =>
          movement.warehouse.id === warehouseIds[0],
      ),
    );
    const viewerMovements = await inject(
      app,
      "GET",
      `/api/stock-movements?warehouseId=${warehouseIds[0]}&direction=IN`,
      viewer,
    );
    assert.equal(viewerMovements.statusCode, 200);
    const movementForOtherWarehouse = await inject(
      app,
      "GET",
      `/api/stock-movements?warehouseId=${warehouseIds[1]}`,
      manager,
    );
    assert.equal(movementForOtherWarehouse.statusCode, 404);
    const movements = await inject(
      app,
      "GET",
      `/api/stock-movements?warehouseId=${warehouseIds[0]}&productId=${products[0]!.id}`,
      admin,
    );
    assert.equal(movements.statusCode, 200);
    assert.ok(movements.json().items.length >= 3);
  } finally {
    await dropAuditFailureTrigger();
    await app.close();
  }
});
