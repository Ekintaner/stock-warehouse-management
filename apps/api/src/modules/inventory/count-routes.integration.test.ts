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
    "Count integration tests must use the separate test database.",
  );
  assert.notEqual(
    migrationTarget.databaseName,
    developmentTarget.databaseName,
    "Count integration test setup must not use the development database.",
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

interface CountLineResponse {
  id: string;
  productId: string;
  snapshotQuantity: string;
  countedQuantity: string | null;
}

interface CountDetailResponse {
  count: { id: string; updatedAt: string };
  stats: {
    totalLines: number;
    countedLines: number;
    uncountedLines: number;
  };
  lines: CountLineResponse[];
  linesTotal: number;
}

function testUser(id: string, role: AppRole, warehouseIds: string[]) {
  return {
    id,
    username: `count-test-${id.slice(0, 8)}`,
    displayName: "Count Test User",
    role,
    warehouseIds,
    isActive: true,
    passwordHash: "not-used-in-count-tests",
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

async function allCountLines(
  app: ReturnType<typeof buildApp>,
  countId: string,
  auth: AuthHeaders,
): Promise<CountLineResponse[]> {
  const lines: CountLineResponse[] = [];
  for (let page = 1; ; page++) {
    const response = await inject(
      app,
      "GET",
      `/api/counts/${countId}?page=${page}&pageSize=100`,
      auth,
    );
    assert.equal(response.statusCode, 200);
    const pageData = response.json<CountDetailResponse>();
    lines.push(...pageData.lines);
    if (lines.length >= pageData.linesTotal) return lines;
  }
}

async function installCountAuditFailureTrigger(): Promise<void> {
  await adminPool!.query(
    `DROP TRIGGER IF EXISTS "count_test_fail_audit" ON "AuditEvent"`,
  );
  await adminPool!.query(`DROP FUNCTION IF EXISTS count_test_fail_audit()`);
  await adminPool!.query(`
    CREATE FUNCTION count_test_fail_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."action" = 'COUNT_APPROVED' THEN
        RAISE EXCEPTION 'Count integration audit failure'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await adminPool!.query(`
    CREATE TRIGGER "count_test_fail_audit"
    BEFORE INSERT ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION count_test_fail_audit()
  `);
}

async function dropCountAuditFailureTrigger(): Promise<void> {
  if (!adminPool) return;
  await adminPool.query(
    `DROP TRIGGER IF EXISTS "count_test_fail_audit" ON "AuditEvent"`,
  );
  await adminPool.query(`DROP FUNCTION IF EXISTS count_test_fail_audit()`);
}

async function installCountMovementFailureTrigger(): Promise<void> {
  await adminPool!.query(
    `DROP TRIGGER IF EXISTS "count_test_fail_movement" ON "StockMovement"`,
  );
  await adminPool!.query(`DROP FUNCTION IF EXISTS count_test_fail_movement()`);
  await adminPool!.query(`
    CREATE FUNCTION count_test_fail_movement()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."type" = 'COUNT_ADJUSTMENT' THEN
        RAISE EXCEPTION 'Count integration movement failure'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await adminPool!.query(`
    CREATE TRIGGER "count_test_fail_movement"
    BEFORE INSERT ON "StockMovement"
    FOR EACH ROW EXECUTE FUNCTION count_test_fail_movement()
  `);
}

async function dropCountMovementFailureTrigger(): Promise<void> {
  if (!adminPool) return;
  await adminPool.query(
    `DROP TRIGGER IF EXISTS "count_test_fail_movement" ON "StockMovement"`,
  );
  await adminPool.query(`DROP FUNCTION IF EXISTS count_test_fail_movement()`);
}


after(async () => {
  await dropCountAuditFailureTrigger();
  await dropCountMovementFailureTrigger();
  await prisma?.$disconnect();
  await pool?.end();
  await adminPool?.end();
});

test(
  "stock count routes enforce permissions, snapshot isolation, movement blocking, differences, idempotency, and PostgreSQL atomicity",
  {
    skip:
      !enabled &&
      "Configure separate local DATABASE_URL, TEST_DATABASE_URL, and TEST_MIGRATION_DATABASE_URL.",
  },
  async () => {
    const db = prisma!;
    const suffix = randomUUID().replaceAll("-", "").toUpperCase();
    const userIds = {
      admin: randomUUID(),
      manager1: randomUUID(),
      manager2: randomUUID(),
      viewer: randomUUID(),
    };
    const warehouseIds = [randomUUID(), randomUUID()];
    const category = await db.category.create({
      data: {
        code: `CNT-${suffix.slice(0, 40)}`,
        name: `Count Test Category ${suffix}`,
      },
    });

    const roleByUser = [
      ["admin", "ADMIN"],
      ["manager1", "WAREHOUSE_MANAGER"],
      ["manager2", "WAREHOUSE_MANAGER"],
      ["viewer", "VIEWER"],
    ] as const;

    for (const [key, role] of roleByUser) {
      await db.user.create({
        data: {
          id: userIds[key],
          username: `count-test-${suffix}-${key}`.toLowerCase(),
          displayName: `Count Test User ${key}`,
          passwordHash: "not-used",
          role,
        },
      });
    }

    // Two warehouses
    await Promise.all([
      db.warehouse.create({
        data: {
          id: warehouseIds[0]!,
          code: `CNT-W1-${suffix.slice(0, 36)}`,
          name: `Count Test Warehouse 1 ${suffix}`,
        },
      }),
      db.warehouse.create({
        data: {
          id: warehouseIds[1]!,
          code: `CNT-W2-${suffix.slice(0, 36)}`,
          name: `Count Test Warehouse 2 ${suffix}`,
        },
      }),
    ]);

    // Assignments: manager1 -> warehouse 0, manager2 -> warehouse 1, viewer -> warehouse 0
    await db.userWarehouse.createMany({
      data: [
        { userId: userIds.manager1, warehouseId: warehouseIds[0]! },
        { userId: userIds.manager2, warehouseId: warehouseIds[1]! },
        { userId: userIds.viewer, warehouseId: warehouseIds[0]! },
      ],
    });

    // Create products:
    // P1: EACH (Adet)
    // P2: KILOGRAM (Kilogram)
    // P3: METER (Metre) - initially will have zero balance
    // P4: positive stock then inactive; P5: inactive with zero balance
    const [prodEach, prodKg, prodMeter, prodInactiveStock, prodInactiveZero] = await Promise.all([
      db.product.create({
        data: {
          sku: `CNT-E-${suffix.slice(0, 36)}`,
          name: "Count Test Each Product",
          categoryId: category.id,
          unit: "EACH",
        },
      }),
      db.product.create({
        data: {
          sku: `CNT-K-${suffix.slice(0, 36)}`,
          name: "Count Test Kg Product",
          categoryId: category.id,
          unit: "KILOGRAM",
        },
      }),
      db.product.create({
        data: {
          sku: `CNT-M-${suffix.slice(0, 36)}`,
          name: "Count Test Meter Product",
          categoryId: category.id,
          unit: "METER",
        },
      }),
      db.product.create({
        data: {
          sku: `CNT-I-${suffix.slice(0, 36)}`,
          name: "Count Test Inactive Stock Product",
          categoryId: category.id,
          unit: "EACH",
        },
      }),
      db.product.create({
        data: {
          sku: `CNT-Z-${suffix.slice(0, 36)}`,
          name: "Count Test Inactive Zero Product",
          categoryId: category.id,
          unit: "EACH",
          isActive: false,
        },
      }),
    ]);

    const store = new MemoryAuthStore();
    const adminUser = testUser(userIds.admin, "ADMIN", []);
    const manager1User = testUser(userIds.manager1, "WAREHOUSE_MANAGER", [warehouseIds[0]!]);
    const manager2User = testUser(userIds.manager2, "WAREHOUSE_MANAGER", [warehouseIds[1]!]);
    const viewerUser = testUser(userIds.viewer, "VIEWER", [warehouseIds[0]!]);

    for (const u of [adminUser, manager1User, manager2User, viewerUser]) {
      store.add(u);
    }

    const admin = issueSession(store, adminUser);
    const manager1 = issueSession(store, manager1User);
    const manager2 = issueSession(store, manager2User);
    const viewer = issueSession(store, viewerUser);

    const app = buildApp({ store, appOrigin: origin, secureCookies: false }, db);

    // Initial stock setup via approved stock document (never direct balance write):
    // Warehouse 0: P1 = 20, P2 = 10.500, P3 = 0, P4 = 3.
    // Warehouse 1: P1 = 5.
    const docResp = await inject(
      app,
      "POST",
      "/api/stock-documents",
      admin,
      {
        type: "RECEIPT",
        warehouseId: warehouseIds[0],
        description: `Count seed doc ${suffix}`,
        lines: [
          { productId: prodEach.id, quantity: "20" },
          { productId: prodKg.id, quantity: "10.500" },
          { productId: prodInactiveStock.id, quantity: "3" },
        ],
      },
    );
    assert.equal(docResp.statusCode, 201, docResp.body);
    const docData = docResp.json();
    const approveDocResp = await inject(
      app,
      "POST",
      `/api/stock-documents/${docData.id}/approve`,
      admin,
      { expectedUpdatedAt: docData.updatedAt },
      { idempotencyKey: `count-seed-doc-${suffix}` },
    );
    assert.equal(approveDocResp.statusCode, 200, approveDocResp.body);

    const inactiveProduct = await db.product.findUniqueOrThrow({
      where: { id: prodInactiveStock.id },
    });
    const deactivateProduct = await inject(
      app,
      "PATCH",
      `/api/products/${prodInactiveStock.id}`,
      admin,
      {
        expectedUpdatedAt: inactiveProduct.updatedAt.toISOString(),
        isActive: false,
      },
    );
    assert.equal(deactivateProduct.statusCode, 200, deactivateProduct.body);

    // Document in Warehouse 1 for cross-warehouse test
    const docW2 = await inject(
      app,
      "POST",
      "/api/stock-documents",
      admin,
      {
        type: "RECEIPT",
        warehouseId: warehouseIds[1],
        description: `Count seed doc W2 ${suffix}`,
        lines: [{ productId: prodEach.id, quantity: "5" }],
      },
    );
    assert.equal(docW2.statusCode, 201);
    const docW2Data = docW2.json();
    const cancelConcurrentSnapshot = await inject(
      app,
      "POST",
      `/api/stock-documents/${docW2Data.id}/approve`,
      admin,
      { expectedUpdatedAt: docW2Data.updatedAt },
      { idempotencyKey: `count-seed-doc-w2-${suffix}` },
    );

    // Verify initial balances
    const balP1 = await db.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouseIds[0]!, productId: prodEach.id } },
    });
    assert.equal(balP1?.quantity.toFixed(3), "20.000");

    // 1. ROLE & PERMISSION TESTS
    // Viewer cannot open count
    const viewerOpen = await inject(
      app,
      "POST",
      "/api/counts",
      viewer,
      { warehouseId: warehouseIds[0], responsibleUserId: userIds.viewer },
    );
    assert.equal(viewerOpen.statusCode, 403);

    // Manager2 cannot open count in warehouse 0 (unassigned)
    const unassignedOpen = await inject(
      app,
      "POST",
      "/api/counts",
      manager2,
      { warehouseId: warehouseIds[0], responsibleUserId: userIds.manager1 },
    );
    assert.equal(unassignedOpen.statusCode, 403);

    // CSRF check
    const noCsrfOpen = await inject(
      app,
      "POST",
      "/api/counts",
      manager1,
      { warehouseId: warehouseIds[0], responsibleUserId: userIds.manager1 },
      { csrf: false },
    );
    assert.equal(noCsrfOpen.statusCode, 403);

    // 2. OPEN COUNT IN WAREHOUSE 0
    // manager1 opens count in warehouse 0
    const openResp = await inject(
      app,
      "POST",
      "/api/counts",
      manager1,
      {
        warehouseId: warehouseIds[0],
        responsibleUserId: userIds.manager1,
        description: `Year-end count ${suffix}`,
      },
    );
    assert.equal(openResp.statusCode, 201, openResp.body);
    const openData = openResp.json();
    assert.equal(openData.status, "OPEN");
    assert.ok(openData.countNumber);
    const countId = openData.id;
    const inaccessibleDetail = await inject(
      app,
      "GET",
      `/api/counts/${countId}`,
      manager2,
    );
    assert.equal(inaccessibleDetail.statusCode, 404);
    const inaccessibleList = await inject(
      app,
      "GET",
      `/api/counts?warehouseId=${warehouseIds[0]}`,
      manager2,
    );
    assert.equal(inaccessibleList.statusCode, 404);
    const pagedList = await inject(
      app,
      "GET",
      `/api/counts?warehouseId=${warehouseIds[0]}&page=1&pageSize=10`,
      manager1,
    );
    assert.equal(pagedList.statusCode, 200);
    assert.equal(pagedList.json().pageSize, 10);
    const invalidPageSize = await inject(
      app,
      "GET",
      `/api/counts/${countId}?pageSize=101`,
      manager1,
    );
    assert.equal(invalidPageSize.statusCode, 400);

    // Verify snapshot accuracy:
    // P1 snapshot = 20.000, countedQuantity = null
    // P2 snapshot = 10.500, countedQuantity = null
    // P3 snapshot = 0.000 (no balance row), countedQuantity = null
    const countDetail = await inject(app, "GET", `/api/counts/${countId}?pageSize=100`, manager1);
    assert.equal(countDetail.statusCode, 200);
    const countBody = countDetail.json<CountDetailResponse>();
    const initialCountLines = await allCountLines(app, countId, manager1);
    assert.equal(countBody.stats.totalLines >= 4, true);
    assert.equal(countBody.stats.uncountedLines, countBody.stats.totalLines);
    assert.equal(countBody.stats.countedLines, 0);

    const lineP1 = initialCountLines.find((line) => line.productId === prodEach.id);
    const lineP2 = initialCountLines.find((line) => line.productId === prodKg.id);
    const lineP3 = initialCountLines.find((line) => line.productId === prodMeter.id);
    const lineInactive = initialCountLines.find((line) => line.productId === prodInactiveStock.id);
    assert.ok(lineP1);
    assert.ok(lineP2);
    assert.ok(lineP3);
    assert.ok(lineInactive);
    assert.equal(
      initialCountLines.some((line) => line.productId === prodInactiveZero.id),
      false,
    );
    assert.equal(lineP1.snapshotQuantity, "20.000");
    assert.equal(lineP1.countedQuantity, null);
    assert.equal(lineP2.snapshotQuantity, "10.500");
    assert.equal(lineP2.countedQuantity, null);
    assert.equal(lineP3.snapshotQuantity, "0.000");
    assert.equal(lineP3.countedQuantity, null);
    assert.equal(lineInactive.snapshotQuantity, "3.000");
    assert.equal(lineInactive.countedQuantity, null);

    // Opening count did NOT alter balances
    const balCheck = await db.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouseIds[0]!, productId: prodEach.id } },
    });
    assert.equal(balCheck?.quantity.toFixed(3), "20.000");

    // 3. SECOND OPEN COUNT IN SAME WAREHOUSE IS REJECTED
    const secondOpen = await inject(
      app,
      "POST",
      "/api/counts",
      admin,
      { warehouseId: warehouseIds[0], responsibleUserId: userIds.admin },
    );
    assert.equal(secondOpen.statusCode, 409);
    assert.ok(secondOpen.json().error.details?.countId);

    // 4. OPEN COUNT BLOCKS STOCK MOVEMENTS IN WAREHOUSE 0
    // Try to approve a new receipt in warehouse 0 -> must be blocked
    const blockedDoc = await inject(
      app,
      "POST",
      "/api/stock-documents",
      admin,
      {
        type: "RECEIPT",
        warehouseId: warehouseIds[0],
        description: "Blocked doc",
        lines: [{ productId: prodEach.id, quantity: "5" }],
      },
    );
    assert.equal(blockedDoc.statusCode, 201);
    const blockedDocData = blockedDoc.json();

    const blockedApprove = await inject(
      app,
      "POST",
      `/api/stock-documents/${blockedDocData.id}/approve`,
      admin,
      { expectedUpdatedAt: blockedDocData.updatedAt },
      { idempotencyKey: `blocked-count-doc-${suffix}` },
    );
    assert.equal(blockedApprove.statusCode, 409, blockedApprove.body);
    assert.equal(blockedApprove.json().error.details?.countId, countId);

    // Try to ship a transfer from warehouse 0 -> must be blocked
    const blockedTransfer = await inject(
      app,
      "POST",
      "/api/transfers",
      manager1,
      {
        sourceWarehouseId: warehouseIds[0],
        targetWarehouseId: warehouseIds[1],
        lines: [{ productId: prodEach.id, quantity: "2" }],
      },
    );
    assert.equal(blockedTransfer.statusCode, 201);
    const blockedTransferData = blockedTransfer.json();

    const blockedShip = await inject(
      app,
      "POST",
      `/api/transfers/${blockedTransferData.id}/ship`,
      manager1,
      { expectedUpdatedAt: blockedTransferData.updatedAt },
      { idempotencyKey: `blocked-count-transfer-${suffix}` },
    );
    assert.equal(blockedShip.statusCode, 409);
    assert.equal(blockedShip.json().error.details?.countId, countId);

    // Other warehouse (Warehouse 1) is NOT blocked:
    const w2Doc = await inject(
      app,
      "POST",
      "/api/stock-documents",
      admin,
      {
        type: "ISSUE",
        warehouseId: warehouseIds[1],
        description: "W2 doc should work",
        lines: [{ productId: prodEach.id, quantity: "1" }],
      },
    );
    assert.equal(w2Doc.statusCode, 201);
    const w2DocData = w2Doc.json();
    const w2Approve = await inject(
      app,
      "POST",
      `/api/stock-documents/${w2DocData.id}/approve`,
      admin,
      { expectedUpdatedAt: w2DocData.updatedAt },
      { idempotencyKey: `w2-issue-${suffix}` },
    );
    assert.equal(w2Approve.statusCode, 200);

    // 5. PRODUCT UNIT CANNOT BE CHANGED WHILE IN STOCK COUNT LINE
    // P3 has no movement history, so this specifically verifies its open count line locks the unit.
    const unitChange = await inject(
      app,
      "PATCH",
      `/api/products/${prodMeter.id}`,
      admin,
      {
        expectedUpdatedAt: (await db.product.findUniqueOrThrow({ where: { id: prodMeter.id } })).updatedAt.toISOString(),
        unit: "KILOGRAM",
      },
    );
    assert.equal(unitChange.statusCode, 409);
    await assert.rejects(
      db.stockCountLine.update({
        where: { id: lineP3.id },
        data: { unit: "KILOGRAM" },
      }),
    );
    const tamperedLine = await db.stockCountLine.findUniqueOrThrow({
      where: { id: lineP3.id },
    });
    assert.equal(tamperedLine.unit, "METER");
    assert.equal(tamperedLine.snapshotQuantity.toFixed(3), "0.000");

    // 6. ENTER COUNTED QUANTITIES
    // Invalid quantities: negative, non-integer for EACH
    const badNeg = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      manager1,
      {
        expectedUpdatedAt: countBody.count.updatedAt,
        lines: [{ lineId: lineP1.id, countedQuantity: "-5" }],
      },
    );
    assert.equal(badNeg.statusCode, 400);

    const badDec = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      manager1,
      {
        expectedUpdatedAt: countBody.count.updatedAt,
        lines: [{ lineId: lineP1.id, countedQuantity: "15.5" }],
      },
    );
    assert.equal(badDec.statusCode, 400);

    // Valid update:
    // P1: counted 25 (difference +5, positive difference -> IN)
    // P2: counted 8.250 with Turkish comma "8,250" (snapshot was 10.500 -> diff -2.250 -> OUT)
    // Note: leave P3 uncounted for now
    const patch1 = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      manager1,
      {
        expectedUpdatedAt: countBody.count.updatedAt,
        lines: [
          { lineId: lineP1.id, countedQuantity: "25" },
          { lineId: lineP2.id, countedQuantity: "8,250" },
        ],
      },
    );
    assert.equal(patch1.statusCode, 200, patch1.body);
    const patch1Data = patch1.json();
    assert.ok(patch1Data.updatedAt);

    const viewerLineUpdate = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      viewer,
      {
        expectedUpdatedAt: patch1Data.updatedAt,
        lines: [{ lineId: lineP1.id, countedQuantity: "25" }],
      },
    );
    assert.equal(viewerLineUpdate.statusCode, 403);
    const noCsrfLineUpdate = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      manager1,
      {
        expectedUpdatedAt: patch1Data.updatedAt,
        lines: [{ lineId: lineP1.id, countedQuantity: "25" }],
      },
      { csrf: false },
    );
    assert.equal(noCsrfLineUpdate.statusCode, 403);

    const differenceFilter = await inject(
      app,
      "GET",
      `/api/counts/${countId}?filter=difference`,
      manager1,
    );
    assert.equal(differenceFilter.statusCode, 200);
    assert.equal(differenceFilter.json().linesTotal, 2);

    // Stale edit check: submitting with old expectedUpdatedAt gets 409
    const stalePatch = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      manager1,
      {
        expectedUpdatedAt: countBody.count.updatedAt, // old!
        lines: [{ lineId: lineP3.id, countedQuantity: "0" }],
      },
    );
    assert.equal(stalePatch.statusCode, 409);

    // 7. APPROVAL REJECTED IF ANY LINE IS UNCOUNTED
    // Manager cannot approve (admin only)
    const managerApprove = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      manager1,
      { expectedUpdatedAt: patch1Data.updatedAt },
    );
    assert.equal(managerApprove.statusCode, 403);

    const missingApprovalKey = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: patch1Data.updatedAt },
    );
    assert.equal(missingApprovalKey.statusCode, 400);

    // Admin tries to approve while P3 (and possibly others) is uncounted -> 409
    const uncountedApprove = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: patch1Data.updatedAt },
      { idempotencyKey: `count-uncounted-approve-${suffix}` },
    );
    assert.equal(uncountedApprove.statusCode, 409);

    // Now count all remaining lines:
    // P3: counted 0 (snapshot 0 -> difference 0 -> NO movement)
    // Any other products in the count: count as equal to their snapshot
    const uncountedLines: CountLineResponse[] = [];
    for (let page = 1; ; page++) {
      const refetched = await inject(
        app,
        "GET",
        `/api/counts/${countId}?filter=uncounted&page=${page}&pageSize=100`,
        manager1,
      );
      assert.equal(refetched.statusCode, 200);
      const pageData = refetched.json<CountDetailResponse>();
      uncountedLines.push(...pageData.lines);
      if (uncountedLines.length >= pageData.linesTotal) break;
    }

    let patch2Data = { updatedAt: patch1Data.updatedAt };
    for (let offset = 0; offset < uncountedLines.length; offset += 500) {
      const patch2 = await inject(
        app,
        "PATCH",
        `/api/counts/${countId}/lines`,
        manager1,
        {
          expectedUpdatedAt: patch2Data.updatedAt,
          lines: uncountedLines.slice(offset, offset + 500).map((line) => ({
            lineId: line.id,
            countedQuantity: line.snapshotQuantity,
          })),
        },
      );
      assert.equal(patch2.statusCode, 200, patch2.body);
      patch2Data = patch2.json<{ updatedAt: string }>();
    }

    // Verify stats: 0 uncounted
    const fullCheck = await inject(app, "GET", `/api/counts/${countId}`, manager1);
    const fullCheckData = fullCheck.json();
    assert.equal(fullCheckData.stats.uncountedLines, 0);

    // 8. AUDIT FAILURE TRANSACTION ROLLBACK
    await installCountAuditFailureTrigger();
    const failedApprove = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: patch2Data.updatedAt },
      { idempotencyKey: `count-audit-fail-${suffix}` },
    );
    assert.equal(failedApprove.statusCode, 500);
    await dropCountAuditFailureTrigger();

    // Verify count is STILL OPEN and no balance changed
    const stillOpen = await db.stockCount.findUniqueOrThrow({ where: { id: countId } });
    assert.equal(stillOpen.status, "OPEN");
    const balP1AfterRollback = await db.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouseIds[0]!, productId: prodEach.id } },
    });
    assert.equal(balP1AfterRollback?.quantity.toFixed(3), "20.000");

    await installCountMovementFailureTrigger();
    const failedMovementApprove = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: stillOpen.updatedAt.toISOString() },
      { idempotencyKey: `count-movement-fail-${suffix}` },
    );
    assert.equal(failedMovementApprove.statusCode, 500);
    await dropCountMovementFailureTrigger();
    const stillOpenAfterMovementFailure = await db.stockCount.findUniqueOrThrow({
      where: { id: countId },
    });
    assert.equal(stillOpenAfterMovementFailure.status, "OPEN");
    assert.equal(
      await db.stockMovement.count({ where: { countLine: { countId } } }),
      0,
    );
    assert.equal(
      (await db.stockBalance.findUniqueOrThrow({
        where: {
          warehouseId_productId: {
            warehouseId: warehouseIds[0]!,
            productId: prodEach.id,
          },
        },
      })).quantity.toFixed(3),
      "20.000",
    );

    // 9. APPROVE COUNT SUCCESSFULLY
    const approveKey = `count-approve-${suffix}`;
    const approveResp = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: stillOpen.updatedAt.toISOString() },
      { idempotencyKey: approveKey },
    );
    assert.equal(approveResp.statusCode, 200, approveResp.body);
    const approveData = approveResp.json();
    assert.equal(approveData.status, "APPROVED");
    assert.equal(approveData.adjustmentMovementsCount, 2); // P1 (+5) and P2 (-2.250)

    // Verify balances updated via StockMovement trigger:
    // P1 was 20.000 + 5.000 = 25.000
    // P2 was 10.500 - 2.250 = 8.250
    // P3 was 0.000 + 0 = 0 (or null)
    const finalBalP1 = await db.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouseIds[0]!, productId: prodEach.id } },
    });
    assert.equal(finalBalP1?.quantity.toFixed(3), "25.000");

    const finalBalP2 = await db.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouseIds[0]!, productId: prodKg.id } },
    });
    assert.equal(finalBalP2?.quantity.toFixed(3), "8.250");

    // Verify StockMovements created
    const countMovements = await db.stockMovement.findMany({
      where: { countLine: { countId } },
      include: { countLine: true },
    });
    assert.equal(countMovements.length, 2);
    const movP1 = countMovements.find((m) => m.productId === prodEach.id);
    const movP2 = countMovements.find((m) => m.productId === prodKg.id);
    assert.ok(movP1);
    assert.ok(movP2);
    assert.equal(movP1.direction, "IN");
    assert.equal(movP1.quantity.toFixed(3), "5.000");
    assert.equal(movP1.type, "COUNT_ADJUSTMENT");
    assert.equal(movP2.direction, "OUT");
    assert.equal(movP2.quantity.toFixed(3), "2.250");
    assert.equal(movP2.type, "COUNT_ADJUSTMENT");

    // 10. IDEMPOTENT RETRY RETURNS SAME RESPONSE AND NO NEW MOVEMENTS
    const retryApprove = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: stillOpen.updatedAt.toISOString() },
      { idempotencyKey: approveKey },
    );
    assert.equal(retryApprove.statusCode, 200);
    assert.equal(retryApprove.json().id, countId);

    const movementsAfterRetry = await db.stockMovement.count({
      where: { countLine: { countId } },
    });
    assert.equal(movementsAfterRetry, 2); // No duplicate movements!

    // Same idempotency key with different body -> 409
    const diffBodyRetry = await inject(
      app,
      "POST",
      `/api/counts/${countId}/approve`,
      admin,
      { expectedUpdatedAt: new Date(0).toISOString() },
      { idempotencyKey: approveKey },
    );
    assert.equal(diffBodyRetry.statusCode, 409);

    // 11. CLOSED COUNT CANNOT BE MODIFIED
    const updateClosed = await inject(
      app,
      "PATCH",
      `/api/counts/${countId}/lines`,
      manager1,
      {
        expectedUpdatedAt: approveData.updatedAt,
        lines: [{ lineId: lineP1.id, countedQuantity: "30" }],
      },
    );
    assert.equal(updateClosed.statusCode, 409);

    // 12. CANCELLATION FLOW TEST
    // Now that previous count is APPROVED, warehouse 0 has no open count.
    // Open a second count to test cancellation:
    const count2Open = await inject(
      app,
      "POST",
      "/api/counts",
      manager1,
      {
        warehouseId: warehouseIds[0],
        responsibleUserId: userIds.manager1,
        description: `Cancel test count ${suffix}`,
      },
    );
    assert.equal(count2Open.statusCode, 201);
    const count2Data = count2Open.json();
    const count2Detail = await inject(app, "GET", `/api/counts/${count2Data.id}`, manager1);
    assert.equal(count2Detail.statusCode, 200);
    const count2Line = count2Detail.json<CountDetailResponse>().lines[0]!;

    // Manager cannot cancel (admin only)
    const managerCancel = await inject(
      app,
      "POST",
      `/api/counts/${count2Data.id}/cancel`,
      manager1,
      { expectedUpdatedAt: count2Data.updatedAt },
    );
    assert.equal(managerCancel.statusCode, 403);

    const missingCancelKey = await inject(
      app,
      "POST",
      `/api/counts/${count2Data.id}/cancel`,
      admin,
      { expectedUpdatedAt: count2Data.updatedAt },
    );
    assert.equal(missingCancelKey.statusCode, 400);

    // Admin cancels count 2
    const cancelKey = `count-cancel-${suffix}`;
    const cancelResp = await inject(
      app,
      "POST",
      `/api/counts/${count2Data.id}/cancel`,
      admin,
      { expectedUpdatedAt: count2Data.updatedAt, reason: "Cancelled by admin" },
      { idempotencyKey: cancelKey },
    );
    assert.equal(cancelResp.statusCode, 200);
    assert.equal(cancelResp.json().status, "CANCELLED");

    // Cancellation does not create movements
    const movementsCount2 = await db.stockMovement.count({
      where: { countLine: { countId: count2Data.id } },
    });
    assert.equal(movementsCount2, 0);

    // Balances did not change
    const balP1AfterCancel = await db.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouseIds[0]!, productId: prodEach.id } },
    });
    assert.equal(balP1AfterCancel?.quantity.toFixed(3), "25.000");

    // Idempotent cancel retry
    const retryCancel = await inject(
      app,
      "POST",
      `/api/counts/${count2Data.id}/cancel`,
      admin,
      { expectedUpdatedAt: count2Data.updatedAt, reason: "Cancelled by admin" },
      { idempotencyKey: cancelKey },
    );
    assert.equal(retryCancel.statusCode, 200);
    const changedCancelRetry = await inject(
      app,
      "POST",
      `/api/counts/${count2Data.id}/cancel`,
      admin,
      { expectedUpdatedAt: count2Data.updatedAt, reason: "Different reason" },
      { idempotencyKey: cancelKey },
    );
    assert.equal(changedCancelRetry.statusCode, 409);
    const updateCancelled = await inject(
      app,
      "PATCH",
      `/api/counts/${count2Data.id}/lines`,
      manager1,
      {
        expectedUpdatedAt: retryCancel.json().updatedAt,
        lines: [{ lineId: count2Line.id, countedQuantity: "25" }],
      },
    );
    assert.equal(updateCancelled.statusCode, 409);

    // Warehouse 0 movement lock is lifted after cancellation!
    // Now we can approve the blocked document in warehouse 0:
    const unblockedApprove = await inject(
      app,
      "POST",
      `/api/stock-documents/${blockedDocData.id}/approve`,
      admin,
      { expectedUpdatedAt: blockedDocData.updatedAt },
      { idempotencyKey: `unblocked-doc-${suffix}` },
    );
    assert.equal(unblockedApprove.statusCode, 200);

    // 13. CONCURRENT OPEN COUNT VS STOCK MOVEMENT TEST
    // Test that opening a count and doing a stock movement concurrently serialize cleanly
    const concDoc = await inject(
      app,
      "POST",
      "/api/stock-documents",
      admin,
      {
        type: "RECEIPT",
        warehouseId: warehouseIds[0],
        description: `Concurrent doc ${suffix}`,
        lines: [{ productId: prodEach.id, quantity: "1" }],
      },
    );
    assert.equal(concDoc.statusCode, 201);
    const concDocData = concDoc.json();

    const [openConcResult, approveConcResult] = await Promise.allSettled([
      inject(
        app,
        "POST",
        "/api/counts",
        manager1,
        {
          warehouseId: warehouseIds[0],
          responsibleUserId: userIds.manager1,
          description: `Concurrent count ${suffix}`,
        },
      ),
      inject(
        app,
        "POST",
        `/api/stock-documents/${concDocData.id}/approve`,
        admin,
        { expectedUpdatedAt: concDocData.updatedAt },
        { idempotencyKey: `conc-doc-${suffix}` },
      ),
    ]);

    assert.equal(openConcResult.status, "fulfilled");
    assert.equal(approveConcResult.status, "fulfilled");
    const openStatus = (openConcResult as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value.statusCode;
    const approveStatus = (approveConcResult as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value.statusCode;

    // Either count opened first (201) and doc was blocked (409),
    // OR doc approved first (200) and count opened with updated snapshot (201).
    // In neither case does a corrupt state occur!
    assert.ok(
      (openStatus === 201 && approveStatus === 409) ||
        (openStatus === 201 && approveStatus === 200),
      `Concurrent race produced valid serialized result: open=${openStatus}, approve=${approveStatus}`,
    );

    const concurrentCount = (openConcResult as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value.json<{
      id: string;
      updatedAt: string;
    }>();
    const concurrentDetail = await inject(
      app,
      "GET",
      `/api/counts/${concurrentCount.id}`,
      manager1,
    );
    assert.equal(concurrentDetail.statusCode, 200);
    const concurrentLines = await allCountLines(app, concurrentCount.id, manager1);
    const concurrentLine = concurrentLines.find(
      (line) => line.productId === prodEach.id,
    );
    assert.ok(concurrentLine);
    const concurrentBalance = await db.stockBalance.findUniqueOrThrow({
      where: {
        warehouseId_productId: {
          warehouseId: warehouseIds[0]!,
          productId: prodEach.id,
        },
      },
    });
    assert.equal(concurrentLine.snapshotQuantity, concurrentBalance.quantity.toFixed(3));
    assert.equal(
      (await db.stockDocument.findUniqueOrThrow({ where: { id: concDocData.id } })).status,
      approveStatus === 200 ? "APPROVED" : "DRAFT",
    );

    await inject(
      app,
      "POST",
      `/api/counts/${concurrentCount.id}/cancel`,
      admin,
      { expectedUpdatedAt: concurrentCount.updatedAt, reason: "Race test cleanup" },
      { idempotencyKey: `cancel-concurrent-snapshot-${suffix}` },
    );
    assert.equal(cancelConcurrentSnapshot.statusCode, 200);

    // Count-line entry and approval share warehouse -> count locking.
    const updateRaceOpen = await inject(
      app,
      "POST",
      "/api/counts",
      manager1,
      {
        warehouseId: warehouseIds[0],
        responsibleUserId: userIds.manager1,
        description: `Count line race ${suffix}`,
      },
    );
    assert.equal(updateRaceOpen.statusCode, 201);
    const updateRaceCount = updateRaceOpen.json();
    const initialLines = await allCountLines(app, updateRaceCount.id, manager1);
    const initialLineUpdates = initialLines.map((line) => ({
      lineId: line.id,
      countedQuantity:
        line.productId === prodEach.id
          ? (BigInt(line.snapshotQuantity.split(".")[0]!) + 1n).toString()
          : line.snapshotQuantity,
    }));
    const initializeRaceLines = await inject(
      app,
      "PATCH",
      `/api/counts/${updateRaceCount.id}/lines`,
      manager1,
      {
        expectedUpdatedAt: updateRaceCount.updatedAt,
        lines: initialLineUpdates,
      },
    );
    assert.equal(initializeRaceLines.statusCode, 200);
    const raceLine = initialLines.find((line) => line.productId === prodEach.id);
    assert.ok(raceLine);
    const raceCountedQuantity =
      (BigInt(raceLine.snapshotQuantity.split(".")[0]!) + 1n).toString();
    const [lineUpdateRaceResult, approveRaceResult] = await Promise.all([
      inject(
        app,
        "PATCH",
        `/api/counts/${updateRaceCount.id}/lines`,
        manager1,
        {
          expectedUpdatedAt: initializeRaceLines.json().updatedAt,
          lines: [{ lineId: raceLine.id, countedQuantity: raceCountedQuantity }],
        },
      ),
      inject(
        app,
        "POST",
        `/api/counts/${updateRaceCount.id}/approve`,
        admin,
        { expectedUpdatedAt: initializeRaceLines.json().updatedAt },
        { idempotencyKey: `count-update-approve-race-${suffix}` },
      ),
    ]);
    assert.ok(
      (lineUpdateRaceResult.statusCode === 200 && approveRaceResult.statusCode === 409) ||
        (lineUpdateRaceResult.statusCode === 409 && approveRaceResult.statusCode === 200),
      `Count line/approval race serialized: update=${lineUpdateRaceResult.statusCode}, approve=${approveRaceResult.statusCode}`,
    );
    const updateRaceAfter = await db.stockCount.findUniqueOrThrow({
      where: { id: updateRaceCount.id },
    });
    if (updateRaceAfter.status === "OPEN") {
      const finishUpdateRace = await inject(
        app,
        "POST",
        `/api/counts/${updateRaceCount.id}/approve`,
        admin,
        { expectedUpdatedAt: updateRaceAfter.updatedAt.toISOString() },
        { idempotencyKey: `count-update-approve-retry-${suffix}` },
      );
      assert.equal(finishUpdateRace.statusCode, 200, finishUpdateRace.body);
    }

    // Approval and cancellation of one count must serialize to one winner.
    const closeRaceOpen = await inject(
      app,
      "POST",
      "/api/counts",
      manager1,
      {
        warehouseId: warehouseIds[0],
        responsibleUserId: userIds.manager1,
        description: `Count close race ${suffix}`,
      },
    );
    assert.equal(closeRaceOpen.statusCode, 201);
    const closeRaceCount = closeRaceOpen.json();
    const closeRaceLines = await allCountLines(app, closeRaceCount.id, manager1);
    const closeRaceEntry = await inject(
      app,
      "PATCH",
      `/api/counts/${closeRaceCount.id}/lines`,
      manager1,
      {
        expectedUpdatedAt: closeRaceCount.updatedAt,
        lines: closeRaceLines.map((line) => ({
          lineId: line.id,
          countedQuantity: line.snapshotQuantity,
        })),
      },
    );
    assert.equal(closeRaceEntry.statusCode, 200);
    const [concurrentApprove, concurrentCancel] = await Promise.all([
      inject(
        app,
        "POST",
        `/api/counts/${closeRaceCount.id}/approve`,
        admin,
        { expectedUpdatedAt: closeRaceEntry.json().updatedAt },
        { idempotencyKey: `count-approve-cancel-race-a-${suffix}` },
      ),
      inject(
        app,
        "POST",
        `/api/counts/${closeRaceCount.id}/cancel`,
        admin,
        { expectedUpdatedAt: closeRaceEntry.json().updatedAt, reason: "Concurrent cancel" },
        { idempotencyKey: `count-approve-cancel-race-c-${suffix}` },
      ),
    ]);
    assert.ok(
      (concurrentApprove.statusCode === 200 && concurrentCancel.statusCode === 409) ||
        (concurrentApprove.statusCode === 409 && concurrentCancel.statusCode === 200),
      `Count approval/cancellation race serialized: approve=${concurrentApprove.statusCode}, cancel=${concurrentCancel.statusCode}`,
    );
    const closeRaceAfter = await db.stockCount.findUniqueOrThrow({
      where: { id: closeRaceCount.id },
    });
    assert.equal(
      closeRaceAfter.status,
      concurrentApprove.statusCode === 200 ? "APPROVED" : "CANCELLED",
    );
    assert.equal(
      await db.stockMovement.count({
        where: { countLine: { countId: closeRaceCount.id } },
      }),
      0,
    );
  },
);
