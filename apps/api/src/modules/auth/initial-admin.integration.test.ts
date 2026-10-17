import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client.js";
import {
  DEVELOPMENT_DATABASE_NAME,
  TEST_DATABASE_NAME,
  parseLocalDatabaseTarget,
} from "../../database/local-database-target.js";
import {
  createInitialAdmin,
  InitialAdminAlreadyExistsError,
} from "./initial-admin.js";

const testTarget = parseLocalDatabaseTarget(
  process.env.TEST_DATABASE_URL,
  TEST_DATABASE_NAME,
);
const developmentTarget = parseLocalDatabaseTarget(
  process.env.DATABASE_URL,
  DEVELOPMENT_DATABASE_NAME,
);
assert.notEqual(testTarget.databaseName, developmentTarget.databaseName);

const pool = new Pool({
  connectionString: testTarget.connectionString,
  connectionTimeoutMillis: 3_000,
  max: 4,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

before(async () => {
  const result = await pool.query<{
    databaseName: string;
    currentUser: string;
    serverAddress: string | null;
  }>(
    `SELECT current_database() AS "databaseName",
            current_user AS "currentUser",
            inet_server_addr()::text AS "serverAddress"`,
  );
  const connection = result.rows[0];
  assert.ok(connection);
  assert.equal(connection.databaseName, TEST_DATABASE_NAME);
  assert.equal(connection.currentUser, "stock_warehouse_app");
  assert.ok(
    connection.serverAddress === null ||
      connection.serverAddress === "::1" ||
      connection.serverAddress === "127.0.0.1" ||
      connection.serverAddress.startsWith("127."),
    "Initial-admin integration tests must connect over loopback.",
  );
});

after(async () => {
  await prisma.$disconnect();
  await pool.end();
});

function createAdmin(
  transaction: Prisma.TransactionClient,
  input: {
    username: string;
    displayName: string;
    passwordHash: string;
  },
) {
  return createInitialAdmin(transaction, input);
}

test("first admin is created once and concurrent/repeated attempts preserve it", async () => {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (existingAdmin) {
    const before = await prisma.user.findUnique({
      where: { id: existingAdmin.id },
    });
    const attempts = await Promise.allSettled(
      [1, 2].map((n) =>
        prisma.$transaction((tx) =>
          createAdmin(tx, {
            username: `blocked-admin-${randomUUID()}-${n}`,
            displayName: "Must not replace existing administrator",
            passwordHash: "unused-regression-hash",
          }),
        ),
      ),
    );
    for (const attempt of attempts) {
      assert.equal(attempt.status, "rejected");
      if (attempt.status === "rejected")
        assert.ok(attempt.reason instanceof InitialAdminAlreadyExistsError);
    }
    assert.deepEqual(
      await prisma.user.findUnique({ where: { id: existingAdmin.id } }),
      before,
    );
    return;
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const candidates = [
    {
      username: `it-admin-a-${suffix}`,
      displayName: "Initial Admin Test A",
      passwordHash: "regression-hash-a",
    },
    {
      username: `it-admin-b-${suffix}`,
      displayName: "Initial Admin Test B",
      passwordHash: "regression-hash-b",
    },
  ] as const;
  let createdAdminId: string | undefined;

  try {
    const attempts = await Promise.allSettled(
      candidates.map((candidate) =>
        prisma.$transaction((transaction) =>
          createAdmin(transaction, candidate),
        ),
      ),
    );
    const created = attempts.filter(
      (result): result is PromiseFulfilledResult<{ id: string }> =>
        result.status === "fulfilled",
    );
    const createdResult = created[0];
    if (createdResult) {
      createdAdminId = createdResult.value.id;
    }
    const rejected = attempts.filter((result) => result.status === "rejected");
    assert.equal(created.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof InitialAdminAlreadyExistsError);
    assert.ok(createdResult);

    const createdAdmin = await prisma.user.findUnique({
      where: { id: createdResult.value.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
      },
    });
    assert.ok(createdAdmin);
    const unchangedSnapshot = { ...createdAdmin };

    await assert.rejects(
      prisma.$transaction((transaction) =>
        createAdmin(transaction, {
          username: `it-admin-repeat-${suffix}`,
          displayName: "Should Not Replace Admin",
          passwordHash: "regression-hash-repeat",
        }),
      ),
      InitialAdminAlreadyExistsError,
    );

    const afterRepeat = await prisma.user.findUnique({
      where: { id: createdAdmin.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
      },
    });
    assert.deepEqual(afterRepeat, unchangedSnapshot);
  } finally {
    if (createdAdminId) {
      await prisma.user.deleteMany({ where: { id: createdAdminId } });
    }
  }
});

test("fresh isolated schema creates exactly one initial administrator", async () => {
  const migrationTarget = parseLocalDatabaseTarget(
    process.env.TEST_MIGRATION_DATABASE_URL,
    TEST_DATABASE_NAME,
  );
  const ownerPool = new Pool({
    connectionString: migrationTarget.connectionString,
    max: 2,
  });
  const schema = `initial_admin_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^initial_admin_[a-f0-9]{32}$/);
  const isolated = new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
  });
  try {
    await ownerPool.query(`CREATE SCHEMA "${schema}"`);
    await ownerPool.query(
      `CREATE TYPE "${schema}"."UserRole" AS ENUM ('ADMIN', 'WAREHOUSE_MANAGER', 'VIEWER')`,
    );
    await ownerPool.query(
      `CREATE TABLE "${schema}"."User" (LIKE public."User" INCLUDING ALL)`,
    );
    await ownerPool.query(
      `ALTER TABLE "${schema}"."User" ALTER COLUMN role DROP DEFAULT, ALTER COLUMN role TYPE "${schema}"."UserRole" USING role::text::"${schema}"."UserRole", ALTER COLUMN role SET DEFAULT 'VIEWER'::"${schema}"."UserRole"`,
    );
    await ownerPool.query(
      `GRANT USAGE ON SCHEMA "${schema}" TO stock_warehouse_app`,
    );
    await ownerPool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}"."User" TO stock_warehouse_app`,
    );
    const input = {
      username: "isolated-admin",
      displayName: "Isolated administrator",
      passwordHash: "test-only-hash",
    };
    const results = await Promise.allSettled(
      [1, 2].map((n) =>
        isolated.$transaction((tx) =>
          createInitialAdmin(tx, {
            ...input,
            username: `${input.username}-${n}`,
          }),
        ),
      ),
    );
    assert.equal(
      results.filter((r) => r.status === "fulfilled").length,
      1,
      results
        .map((r) => (r.status === "rejected" ? String(r.reason) : "created"))
        .join("; "),
    );
    assert.equal(
      results.filter(
        (r) =>
          r.status === "rejected" &&
          r.reason instanceof InitialAdminAlreadyExistsError,
      ).length,
      1,
    );
    const before = await isolated.user.findMany();
    await assert.rejects(
      isolated.$transaction((tx) => createInitialAdmin(tx, input)),
      InitialAdminAlreadyExistsError,
    );
    assert.deepEqual(await isolated.user.findMany(), before);
  } finally {
    await isolated.$disconnect();
    // Only this test's random schema in the already-validated dedicated test DB.
    await ownerPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ownerPool.end();
  }
});
