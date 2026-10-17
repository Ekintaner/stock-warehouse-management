import "dotenv/config";
import { verifyPassword } from "../auth/password.js";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
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
  method: "GET" | "POST" | "PATCH" | "PUT",
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

after(async () => {
  await prisma.$disconnect();
  await cleanupPrisma.$disconnect();
  await pool.end();
  await cleanupPool.end();
});
test("operations preserve permissions, audit, decimal reports, CSV, and atomic document reversals", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const adminId = randomUUID(),
    viewerId = randomUUID();
  const w1 = await prisma.warehouse.create({
    data: { code: `OP-A-${suffix}`, name: "Operations A" },
  });
  const w2 = await prisma.warehouse.create({
    data: { code: `OP-B-${suffix}`, name: "Operations B" },
  });
  for (const [id, role] of [
    [adminId, "ADMIN"],
    [viewerId, "VIEWER"],
  ] as const)
    await prisma.user.create({
      data: {
        id,
        username: `op-${id}`,
        displayName: "Operations test",
        passwordHash: "unused",
        role,
      },
    });
  const store = new MemoryAuthStore();
  const admin = issueTestSession(
    store,
    store.addIdentity(identity(adminId, "ADMIN", [])).user,
  );
  const viewer = issueTestSession(
    store,
    store.addIdentity(identity(viewerId, "VIEWER", [w1.id])).user,
  );
  const app = buildApp(
    { store, appOrigin: origin, secureCookies: false },
    prisma,
  );
  try {
    const anon = await app.inject({ method: "GET", url: "/api/reports/stock" });
    assert.equal(anon.statusCode, 401);
    const noCsrf = await inject(
      app,
      "POST",
      "/api/suppliers",
      admin,
      { code: `S-${suffix}`, name: "Supplier" },
      false,
    );
    assert.equal(noCsrf.statusCode, 403);
    assert.equal(
      (
        await inject(app, "POST", "/api/suppliers", viewer, {
          code: `S-${suffix}`,
          name: "Supplier",
        })
      ).statusCode,
      403,
    );
    const supplierResult = await inject(app, "POST", "/api/suppliers", admin, {
      code: `S-${suffix}`,
      name: "Supplier",
      email: "test@example.invalid",
    });
    assert.equal(supplierResult.statusCode, 201);
    const supplier = supplierResult.json();
    const supplierUpdate = await inject(
      app,
      "PATCH",
      `/api/suppliers/${supplier.id}`,
      admin,
      {
        name: "Updated supplier",
        isActive: false,
        expectedUpdatedAt: supplier.updatedAt,
      },
    );
    assert.equal(supplierUpdate.statusCode, 200);
    assert.equal(
      (
        await inject(app, "PATCH", `/api/suppliers/${supplier.id}`, admin, {
          name: "Stale",
          isActive: true,
          expectedUpdatedAt: supplier.updatedAt,
        })
      ).statusCode,
      409,
    );
    const category = await prisma.category.create({
      data: { code: `OP-C-${suffix}`, name: "Operations category" },
    });
    const product = await prisma.product.create({
      data: {
        sku: `OP-${suffix}`,
        name: "=FORMULA()",
        categoryId: category.id,
        unit: "EACH",
      },
    });
    const receipt = await inject(app, "POST", "/api/stock-documents", admin, {
      type: "RECEIPT",
      warehouseId: w1.id,
      lines: [{ productId: product.id, quantity: "10" }],
    });
    assert.equal(receipt.statusCode, 201);
    const doc = receipt.json();
    const approve = await app.inject({
      method: "POST",
      url: `/api/stock-documents/${doc.id}/approve`,
      headers: { ...admin, origin, "idempotency-key": `approve-${suffix}` },
      payload: { expectedUpdatedAt: doc.updatedAt },
    });
    assert.equal(approve.statusCode, 200, approve.body);
    const threshold = await inject(
      app,
      "PUT",
      `/api/thresholds/${w1.id}/${product.id}`,
      admin,
      { minimumStock: "12" },
    );
    assert.equal(threshold.statusCode, 200);
    assert.equal(
      (
        await inject(
          app,
          "PUT",
          `/api/thresholds/${w1.id}/${product.id}`,
          admin,
          { minimumStock: "1.5" },
        )
      ).statusCode,
      400,
    );
    const report = await inject(
      app,
      "GET",
      `/api/reports/stock?warehouseId=${w1.id}&q=OP-${suffix}&lowOnly=true`,
      viewer,
    );
    assert.equal(report.statusCode, 200);
    assert.equal(report.json().items[0].quantity, "10.000");
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/api/reports/stock?warehouseId=${w2.id}`,
          viewer,
        )
      ).statusCode,
      403,
    );
    const csv = await inject(
      app,
      "GET",
      `/api/reports/stock?warehouseId=${w1.id}&q=OP-${suffix}&format=csv`,
      viewer,
    );
    assert.equal(csv.statusCode, 200);
    assert.ok(csv.body.includes("'=FORMULA()"));
    const summary = await inject(
      app,
      "GET",
      `/api/reports/warehouses?warehouseId=${w1.id}`,
      viewer,
    );
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.json().items[0].quantity, "10.000");
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/api/reports/warehouses?warehouseId=${w2.id}`,
          viewer,
        )
      ).statusCode,
      403,
    );
    const activity = await inject(
      app,
      "GET",
      `/api/reports/activity?warehouseId=${w1.id}`,
      viewer,
    );
    assert.equal(activity.statusCode, 200);
    assert.ok(
      activity
        .json()
        .items.some((i: { quantity: string }) => i.quantity === "10.000"),
    );
    const reverse = (key: string, reason = "Test correction") =>
      app.inject({
        method: "POST",
        url: `/api/stock-documents/${doc.id}/reverse`,
        headers: { ...admin, origin, "idempotency-key": key },
        payload: { reason },
      });
    assert.equal(
      (
        await inject(
          app,
          "POST",
          `/api/stock-documents/${doc.id}/reverse`,
          viewer,
          { reason: "Denied" },
        )
      ).statusCode,
      403,
    );
    // Inject a failure for this exact document; the reversed stock must roll back too.
    await cleanupPool.query(
      `CREATE FUNCTION "op_fail_${suffix}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='DOCUMENT_REVERSED' AND NEW."relatedId"='${doc.id}' THEN RAISE EXCEPTION 'Operations test audit failure'; END IF; RETURN NEW; END $$`,
    );
    await cleanupPool.query(
      `CREATE TRIGGER "op_fail_${suffix}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "op_fail_${suffix}"()`,
    );
    try {
      assert.equal((await reverse(`audit-fail-${suffix}`)).statusCode, 500);
      const unchanged = await prisma.stockBalance.findUniqueOrThrow({
        where: {
          warehouseId_productId: { warehouseId: w1.id, productId: product.id },
        },
      });
      assert.equal(unchanged.quantity.toString(), "10");
    } finally {
      await cleanupPool.query(
        `DROP TRIGGER "op_fail_${suffix}" ON "AuditEvent"`,
      );
      await cleanupPool.query(`DROP FUNCTION "op_fail_${suffix}"()`);
    }
    const issue = await inject(app, "POST", "/api/stock-documents", admin, {
      type: "ISSUE",
      warehouseId: w1.id,
      lines: [{ productId: product.id, quantity: "9" }],
    });
    assert.equal(issue.statusCode, 201);
    const issueDoc = issue.json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/stock-documents/${issueDoc.id}/approve`,
          headers: { ...admin, origin, "idempotency-key": `issue-${suffix}` },
          payload: { expectedUpdatedAt: issueDoc.updatedAt },
        })
      ).statusCode,
      200,
    );
    assert.equal((await reverse(`insufficient-${suffix}`)).statusCode, 409);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/stock-documents/${issueDoc.id}/reverse`,
          headers: {
            ...admin,
            origin,
            "idempotency-key": `issue-reverse-${suffix}`,
          },
          payload: { reason: "Restore stock for receipt reversal" },
        })
      ).statusCode,
      200,
    );
    const reversal = await reverse(`rev-${suffix}`);
    assert.equal(reversal.statusCode, 200, reversal.body);
    assert.equal((await reverse(`rev-${suffix}`)).statusCode, 200);
    assert.equal(
      (await reverse(`rev-${suffix}`, "Other reason")).statusCode,
      409,
    );
    assert.equal((await reverse(`rev-again-${suffix}`)).statusCode, 409);
    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        warehouseId_productId: { warehouseId: w1.id, productId: product.id },
      },
    });
    assert.equal(balance.quantity.toString(), "0");
    const reconciliation = await inject(
      app,
      "GET",
      "/api/reconciliation",
      admin,
    );
    assert.equal(reconciliation.statusCode, 200);
    assert.equal(reconciliation.json().consistent, true);
    assert.equal(
      (await inject(app, "GET", "/api/audit", viewer)).statusCode,
      403,
    );
    const audit = await inject(app, "GET", "/api/audit", admin);
    assert.equal(audit.statusCode, 200);
    assert.ok(!audit.body.includes("passwordHash"));
    const createUser = await inject(app, "POST", "/api/users", admin, {
      username: `user-${suffix}`,
      displayName: "Assigned user",
      password: "Safe test password 12345",
      role: "WAREHOUSE_MANAGER",
      warehouseIds: [w1.id],
    });
    assert.equal(createUser.statusCode, 201, createUser.body);
    assert.ok(!createUser.body.includes("passwordHash"));
    const u = createUser.json();
    assert.equal(u.warehouseAssignments[0].warehouseId, w1.id);
    const editUser = await inject(app, "PATCH", `/api/users/${u.id}`, admin, {
      displayName: "Updated user",
      password: "Replaced safe test password 12345",
      role: "VIEWER",
      isActive: false,
      warehouseIds: [],
      expectedUpdatedAt: u.updatedAt,
    });
    assert.equal(editUser.statusCode, 200);
    const changedUser = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
    });
    assert.ok(
      await verifyPassword(
        "Replaced safe test password 12345",
        changedUser.passwordHash,
      ),
    );
    assert.ok(!editUser.body.includes(changedUser.passwordHash));
    assert.equal(
      (await inject(app, "POST", "/api/users", viewer, { username: "denied" }))
        .statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});
