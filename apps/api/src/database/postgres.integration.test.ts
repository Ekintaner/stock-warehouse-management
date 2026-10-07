import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  DEVELOPMENT_DATABASE_NAME,
  TEST_DATABASE_NAME,
  parseLocalDatabaseTarget,
} from "./local-database-target.js";

interface Fixture {
  userId: string;
  warehouseIds: [string, string];
  productId: string;
  categoryId: string;
}

interface StockDocumentFixture {
  id: string;
  lineId: string;
}

const testTarget = parseLocalDatabaseTarget(
  process.env.TEST_DATABASE_URL,
  TEST_DATABASE_NAME,
);
const developmentTarget = parseLocalDatabaseTarget(
  process.env.DATABASE_URL,
  DEVELOPMENT_DATABASE_NAME,
);
assert.ok(
  !new URL(testTarget.connectionString).password.includes("REPLACE_WITH"),
  "Set the local test application password in .env before running PostgreSQL integration tests.",
);
assert.ok(
  !new URL(developmentTarget.connectionString).password.includes("REPLACE_WITH"),
  "Set the local development application password in .env before running PostgreSQL integration tests.",
);
assert.notEqual(
  testTarget.databaseName,
  developmentTarget.databaseName,
  "PostgreSQL tests must use a database separate from development.",
);

const pool = new Pool({
  connectionString: testTarget.connectionString,
  connectionTimeoutMillis: 3_000,
  max: 8,
});

before(async () => {
  const result = await pool.query<{
    databaseName: string;
    serverAddress: string | null;
    currentUser: string;
    isSuperuser: boolean;
    canCreateDatabases: boolean;
    canCreateRoles: boolean;
    databaseOwner: string;
    appHasMigrationMembership: boolean;
  }>(
    `SELECT current_database() AS "databaseName",
            inet_server_addr()::text AS "serverAddress",
            current_user AS "currentUser",
            role.rolsuper AS "isSuperuser",
            role.rolcreatedb AS "canCreateDatabases",
            role.rolcreaterole AS "canCreateRoles",
            (SELECT pg_catalog.pg_get_userbyid(database_row.datdba)
             FROM pg_catalog.pg_database AS database_row
             WHERE database_row.datname = current_database()) AS "databaseOwner",
            pg_catalog.pg_has_role(
              'stock_warehouse_app',
              'stock_warehouse_migrator',
              'MEMBER'
            ) AS "appHasMigrationMembership"
     FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user`,
  );
  const connection = result.rows[0];
  assert.ok(connection);
  assert.equal(connection.databaseName, TEST_DATABASE_NAME);
  assert.equal(connection.currentUser, "stock_warehouse_app");
  assert.equal(connection.isSuperuser, false);
  assert.equal(connection.canCreateDatabases, false);
  assert.equal(connection.canCreateRoles, false);
  assert.equal(connection.databaseOwner, "stock_warehouse_migrator");
  assert.equal(connection.appHasMigrationMembership, false);
  assert.ok(
    connection.serverAddress === null ||
      connection.serverAddress === "::1" ||
      connection.serverAddress === "127.0.0.1" ||
      connection.serverAddress.startsWith("127."),
    "Integration tests must connect over loopback.",
  );
});

after(async () => {
  await pool.end();
});

async function createFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").toUpperCase();
  const userId = randomUUID();
  const categoryId = randomUUID();
  const warehouseIds: [string, string] = [randomUUID(), randomUUID()];
  const productId = randomUUID();

  await client.query(
    `INSERT INTO "User" ("id", "username", "displayName", "passwordHash", "updatedAt")
     VALUES ($1, $2, 'DB Integration Fixture', 'unusable-test-hash', CURRENT_TIMESTAMP)`,
    [userId, `DBTEST-${suffix}`.toLowerCase()],
  );
  await client.query(
    `INSERT INTO "Category" ("id", "code", "name", "updatedAt")
     VALUES ($1, $2, 'DB Integration Fixture', CURRENT_TIMESTAMP)`,
    [categoryId, `DBTEST-${suffix}`],
  );
  for (const [index, warehouseId] of warehouseIds.entries()) {
    await client.query(
      `INSERT INTO "Warehouse" ("id", "code", "name", "updatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [warehouseId, `DBTEST-${suffix}-${index}`, `DB Test ${index}`],
    );
  }
  await client.query(
    `INSERT INTO "Product" ("id", "sku", "name", "unit", "categoryId", "updatedAt")
     VALUES ($1, $2, 'DB Integration Fixture', 'EACH', $3, CURRENT_TIMESTAMP)`,
    [productId, `DBTEST-${suffix}`, categoryId],
  );

  return { userId, warehouseIds, productId, categoryId };
}

async function createDocument(
  client: PoolClient,
  fixture: Fixture,
  warehouseId: string,
  type: "RECEIPT" | "ISSUE",
  quantity: string,
): Promise<StockDocumentFixture> {
  const documentId = randomUUID();
  const lineId = randomUUID();
  const documentType = type === "RECEIPT" ? "RECEIPT" : "ISSUE";

  await client.query(
    `INSERT INTO "StockDocument"
       ("id", "type", "status", "warehouseId", "createdById", "approvedById",
        "createdAt", "updatedAt", "approvedAt")
     VALUES ($1, $2, 'DRAFT', $3, $4, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`,
    [documentId, documentType, warehouseId, fixture.userId],
  );
  await client.query(
    `INSERT INTO "StockDocumentLine"
       ("id", "documentId", "productId", "unit", "quantity")
     VALUES ($1, $2, $3, 'EACH', $4)`,
    [lineId, documentId, fixture.productId, quantity],
  );
  await client.query(
    `UPDATE "StockDocument"
     SET "status" = 'APPROVED', "approvedById" = $2,
         "approvedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [documentId, fixture.userId],
  );

  return { id: documentId, lineId };
}

async function insertDocumentMovement(
  client: PoolClient,
  fixture: Fixture,
  warehouseId: string,
  document: StockDocumentFixture,
  direction: "IN" | "OUT",
  quantity: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "StockMovement"
       ("id", "productId", "warehouseId", "direction", "quantity", "unit",
        "type", "createdById", "documentLineId")
     VALUES ($1, $2, $3, $4, $5, 'EACH', $6, $7, $8)`,
    [
      id,
      fixture.productId,
      warehouseId,
      direction,
      quantity,
      direction === "IN" ? "RECEIPT" : "ISSUE",
      fixture.userId,
      document.lineId,
    ],
  );
  return id;
}

async function withRollbackFixture(
  run: (client: PoolClient, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fixture = await createFixture(client);
    await run(client, fixture);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function expectRejectedAndRecover(
  client: PoolClient,
  query: () => Promise<unknown>,
  expectedCodes: string[],
): Promise<void> {
  await client.query("SAVEPOINT expected_failure");
  try {
    await assert.rejects(query(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(
        expectedCodes.includes(
          (error as Error & { code?: string }).code ?? "",
        ),
        `Unexpected PostgreSQL error code: ${(error as Error & { code?: string }).code ?? "unknown"}`,
      );
      return true;
    });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    await client.query("RELEASE SAVEPOINT expected_failure");
  }
}

async function getBalance(
  client: PoolClient,
  warehouseId: string,
  productId: string,
): Promise<string> {
  const result = await client.query<{ quantity: string }>(
    `SELECT COALESCE(
       (SELECT "quantity"::text FROM "StockBalance"
        WHERE "warehouseId" = $1 AND "productId" = $2),
       '0'
     ) AS "quantity"`,
    [warehouseId, productId],
  );
  return result.rows[0]?.quantity ?? "0";
}

test("a valid movement updates the balance once and duplicate source stages fail", async () => {
  await withRollbackFixture(async (client, fixture) => {
    const warehouseId = fixture.warehouseIds[0];
    const receipt = await createDocument(
      client,
      fixture,
      warehouseId,
      "RECEIPT",
      "10",
    );
    const movementId = await insertDocumentMovement(
      client,
      fixture,
      warehouseId,
      receipt,
      "IN",
      "10",
    );

    assert.equal(await getBalance(client, warehouseId, fixture.productId), "10.000");
    const movementCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count"
       FROM "StockMovement" WHERE "documentLineId" = $1`,
      [receipt.lineId],
    );
    assert.equal(movementCount.rows[0]?.count, "1");

    await expectRejectedAndRecover(
      client,
      () =>
        insertDocumentMovement(
          client,
          fixture,
          warehouseId,
          receipt,
          "IN",
          "10",
        ),
      ["23505"],
    );
    const originalStillExists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "StockMovement" WHERE "id" = $1) AS "exists"`,
      [movementId],
    );
    assert.equal(originalStillExists.rows[0]?.exists, true);
    assert.equal(await getBalance(client, warehouseId, fixture.productId), "10.000");
  });
});

test("insufficient stock rolls back the movement and leaves the balance unchanged", async () => {
  await withRollbackFixture(async (client, fixture) => {
    const warehouseId = fixture.warehouseIds[0];
    const receipt = await createDocument(
      client,
      fixture,
      warehouseId,
      "RECEIPT",
      "10",
    );
    await insertDocumentMovement(client, fixture, warehouseId, receipt, "IN", "10");
    const issue = await createDocument(
      client,
      fixture,
      warehouseId,
      "ISSUE",
      "11",
    );

    await expectRejectedAndRecover(
      client,
      () =>
        insertDocumentMovement(
          client,
          fixture,
          warehouseId,
          issue,
          "OUT",
          "11",
        ),
      ["23514"],
    );
    assert.equal(await getBalance(client, warehouseId, fixture.productId), "10.000");
    const failedMovement = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "StockMovement" WHERE "documentLineId" = $1`,
      [issue.lineId],
    );
    assert.equal(failedMovement.rows[0]?.count, "0");
  });
});

test("two separate concurrent connections cannot oversell the same stock", async () => {
  const setup = await pool.connect();
  const first = await pool.connect();
  const second = await pool.connect();
  const observer = await pool.connect();
  let firstTransactionOpen = false;
  let secondTransactionOpen = false;
  let setupTransactionOpen = false;
  let firstCommitted = false;

  try {
    await setup.query("BEGIN");
    setupTransactionOpen = true;
    const fixture = await createFixture(setup);
    const warehouseId = fixture.warehouseIds[0];
    const receipt = await createDocument(
      setup,
      fixture,
      warehouseId,
      "RECEIPT",
      "10",
    );
    await insertDocumentMovement(setup, fixture, warehouseId, receipt, "IN", "10");
    const firstIssue = await createDocument(
      setup,
      fixture,
      warehouseId,
      "ISSUE",
      "7",
    );
    const secondIssue = await createDocument(
      setup,
      fixture,
      warehouseId,
      "ISSUE",
      "7",
    );
    await setup.query("COMMIT");
    setupTransactionOpen = false;

    await first.query("BEGIN");
    firstTransactionOpen = true;
    await insertDocumentMovement(
      first,
      fixture,
      warehouseId,
      firstIssue,
      "OUT",
      "7",
    );

    await second.query("BEGIN");
    secondTransactionOpen = true;
    const secondPid = await second.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const secondInsert = insertDocumentMovement(
      second,
      fixture,
      warehouseId,
      secondIssue,
      "OUT",
      "7",
    ).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    );

    let observedLockWait = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const activity = await observer.query<{ waitEventType: string | null }>(
        `SELECT wait_event_type AS "waitEventType"
         FROM pg_catalog.pg_stat_activity WHERE pid = $1`,
        [secondPid.rows[0]?.pid],
      );
      if (activity.rows[0]?.waitEventType === "Lock") {
        observedLockWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      observedLockWait,
      true,
      "Second movement must wait on the same locked warehouse row before the first commits.",
    );

    await first.query("COMMIT");
    firstCommitted = true;
    firstTransactionOpen = false;
    const secondResult = await secondInsert;
    assert.ok(secondResult.error instanceof Error);
    assert.equal(
      (secondResult.error as Error & { code?: string }).code,
      "23514",
    );
    await second.query("ROLLBACK");
    secondTransactionOpen = false;

    assert.equal(await getBalance(observer, warehouseId, fixture.productId), "3.000");
    const movements = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS "count"
       FROM "StockMovement"
       WHERE "warehouseId" = $1 AND "productId" = $2`,
      [warehouseId, fixture.productId],
    );
    assert.equal(movements.rows[0]?.count, "2");
  } finally {
    if (setupTransactionOpen) {
      await setup.query("ROLLBACK").catch(() => undefined);
    }
    if (firstTransactionOpen && !firstCommitted) {
      await first.query("ROLLBACK").catch(() => undefined);
    }
    if (secondTransactionOpen) {
      await second.query("ROLLBACK").catch(() => undefined);
    }
    setup.release();
    first.release();
    second.release();
    observer.release();
  }
});

test("application privileges reject direct balance writes and ledger mutation", async () => {
  await withRollbackFixture(async (client, fixture) => {
    const warehouseId = fixture.warehouseIds[0];
    const receipt = await createDocument(
      client,
      fixture,
      warehouseId,
      "RECEIPT",
      "1",
    );
    const movementId = await insertDocumentMovement(
      client,
      fixture,
      warehouseId,
      receipt,
      "IN",
      "1",
    );

    for (const statement of [
      `UPDATE "StockMovement" SET "reason" = "reason" WHERE "id" = '${movementId}'`,
      `DELETE FROM "StockMovement" WHERE "id" = '${movementId}'`,
      `TRUNCATE TABLE "StockMovement"`,
      `ALTER TABLE "StockMovement" DISABLE TRIGGER "StockMovement_immutable_update_delete"`,
      `UPDATE "StockBalance" SET "quantity" = 999
       WHERE "warehouseId" = '${warehouseId}' AND "productId" = '${fixture.productId}'`,
      `INSERT INTO "StockBalance" ("warehouseId", "productId", "quantity", "updatedAt")
       VALUES ('${warehouseId}', '${fixture.productId}', 99, CURRENT_TIMESTAMP)`,
      `DELETE FROM "StockBalance"
       WHERE "warehouseId" = '${warehouseId}' AND "productId" = '${fixture.productId}'`,
    ]) {
      await expectRejectedAndRecover(
        client,
        () => client.query(statement),
        ["42501", "55000"],
      );
    }

    const permissions = await client.query<{
      updateMovement: boolean;
      deleteMovement: boolean;
      truncateMovement: boolean;
      insertBalance: boolean;
      updateBalance: boolean;
      createInPublicSchema: boolean;
    }>(
      `SELECT
         has_table_privilege(current_user, 'public."StockMovement"', 'UPDATE') AS "updateMovement",
         has_table_privilege(current_user, 'public."StockMovement"', 'DELETE') AS "deleteMovement",
         has_table_privilege(current_user, 'public."StockMovement"', 'TRUNCATE') AS "truncateMovement",
         has_table_privilege(current_user, 'public."StockBalance"', 'INSERT') AS "insertBalance",
         has_table_privilege(current_user, 'public."StockBalance"', 'UPDATE') AS "updateBalance",
         has_schema_privilege(current_user, 'public', 'CREATE') AS "createInPublicSchema"`,
    );
    assert.deepEqual(permissions.rows[0], {
      updateMovement: false,
      deleteMovement: false,
      truncateMovement: false,
      insertBalance: false,
      updateBalance: false,
      createInPublicSchema: false,
    });
    const balancePrimaryKey = await client.query<{ constraintName: string | null }>(
      `SELECT constraint_row.conname AS "constraintName"
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public."StockBalance"'::regclass
         AND constraint_row.contype = 'p'`,
    );
    assert.equal(balancePrimaryKey.rows[0]?.constraintName, "StockBalance_pkey");
    const ledgerGuards = await client.query<{ triggerName: string }>(
      `SELECT tgname AS "triggerName"
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public."StockMovement"'::regclass
         AND NOT tgisinternal`,
    );
    assert.deepEqual(
      ledgerGuards.rows.map((row) => row.triggerName).sort(),
      [
        "StockMovement_immutable_truncate",
        "StockMovement_immutable_update_delete",
        "StockMovement_lock_warehouse_and_count",
        "StockMovement_update_balance",
        "StockMovement_validate_source",
      ].sort(),
    );
  });
});

test("source rows cannot be deleted after an immutable movement references them", async () => {
  await withRollbackFixture(async (client, fixture) => {
    const receipt = await createDocument(
      client,
      fixture,
      fixture.warehouseIds[0],
      "RECEIPT",
      "2",
    );
    const movementId = await insertDocumentMovement(
      client,
      fixture,
      fixture.warehouseIds[0],
      receipt,
      "IN",
      "2",
    );

    await expectRejectedAndRecover(
      client,
      () =>
        client.query(`DELETE FROM "StockDocumentLine" WHERE "id" = $1`, [
          receipt.lineId,
        ]),
      ["55000"],
    );
    const sourceForeignKey = await client.query<{ deleteAction: string }>(
      `SELECT confdeltype::text AS "deleteAction"
       FROM pg_catalog.pg_constraint
       WHERE conname = 'StockMovement_documentLineId_fkey'
         AND conrelid = 'public."StockMovement"'::regclass`,
    );
    assert.equal(sourceForeignKey.rows[0]?.deleteAction, "r");
    await expectRejectedAndRecover(
      client,
      () =>
        client.query(`DELETE FROM "Product" WHERE "id" = $1`, [
          fixture.productId,
        ]),
      ["23001"],
    );
    const movement = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "StockMovement" WHERE "id" = $1) AS "exists"`,
      [movementId],
    );
    assert.equal(movement.rows[0]?.exists, true);
  });
});

test("one open count per warehouse and same-warehouse transfers are rejected", async () => {
  await withRollbackFixture(async (client, fixture) => {
    await client.query(
      `INSERT INTO "StockCount"
         ("id", "warehouseId", "status", "openedById", "responsibleUserId")
       VALUES ($1, $2, 'OPEN', $3, $3)`,
      [randomUUID(), fixture.warehouseIds[0], fixture.userId],
    );
    await expectRejectedAndRecover(
      client,
      () =>
        client.query(
          `INSERT INTO "StockCount"
             ("id", "warehouseId", "status", "openedById", "responsibleUserId")
           VALUES ($1, $2, 'OPEN', $3, $3)`,
          [randomUUID(), fixture.warehouseIds[0], fixture.userId],
        ),
      ["23505"],
    );

    await expectRejectedAndRecover(
      client,
      () =>
        client.query(
          `INSERT INTO "Transfer"
             ("id", "sourceWarehouseId", "targetWarehouseId", "createdById", "updatedAt")
           VALUES ($1, $2, $2, $3, CURRENT_TIMESTAMP)`,
          [randomUUID(), fixture.warehouseIds[0], fixture.userId],
        ),
      ["23514"],
    );
  });
});

test("stock document quantities must be strictly positive", async () => {
  await withRollbackFixture(async (client, fixture) => {
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO "StockDocument"
         ("id", "type", "status", "warehouseId", "createdById", "updatedAt")
       VALUES ($1, 'RECEIPT', 'DRAFT', $2, $3, CURRENT_TIMESTAMP)`,
      [documentId, fixture.warehouseIds[0], fixture.userId],
    );

    for (const quantity of ["0", "-1"]) {
      await expectRejectedAndRecover(
        client,
        () =>
          client.query(
            `INSERT INTO "StockDocumentLine"
               ("id", "documentId", "productId", "unit", "quantity")
             VALUES ($1, $2, $3, 'EACH', $4)`,
            [randomUUID(), documentId, fixture.productId, quantity],
          ),
        ["23514"],
      );
    }
  });
});

test("a second transfer movement for the same source and phase is rejected", async () => {
  await withRollbackFixture(async (client, fixture) => {
    const [sourceWarehouseId, targetWarehouseId] = fixture.warehouseIds;
    const receipt = await createDocument(
      client,
      fixture,
      sourceWarehouseId,
      "RECEIPT",
      "10",
    );
    await insertDocumentMovement(
      client,
      fixture,
      sourceWarehouseId,
      receipt,
      "IN",
      "10",
    );

    const transferId = randomUUID();
    const transferLineId = randomUUID();
    await client.query(
      `INSERT INTO "Transfer"
         ("id", "sourceWarehouseId", "targetWarehouseId", "createdById", "updatedAt")
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [transferId, sourceWarehouseId, targetWarehouseId, fixture.userId],
    );
    await client.query(
      `INSERT INTO "TransferLine" ("id", "transferId", "productId", "unit", "quantity")
       VALUES ($1, $2, $3, 'EACH', '1')`,
      [transferLineId, transferId, fixture.productId],
    );
    await client.query(
      `UPDATE "Transfer"
       SET "status" = 'SHIPPED', "shippedById" = $2, "shippedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [transferId, fixture.userId],
    );

    const insertShipment = () =>
      client.query(
        `INSERT INTO "StockMovement"
           ("id", "productId", "warehouseId", "direction", "quantity", "unit",
            "type", "createdById", "transferLineId", "transferPhase")
         VALUES ($1, $2, $3, 'OUT', '1', 'EACH', 'TRANSFER_SHIPMENT', $4, $5, 'SHIPMENT')`,
        [
          randomUUID(),
          fixture.productId,
          sourceWarehouseId,
          fixture.userId,
          transferLineId,
        ],
      );
    const movementId = randomUUID();
    await client.query(
      `INSERT INTO "StockMovement"
         ("id", "productId", "warehouseId", "direction", "quantity", "unit",
          "type", "createdById", "transferLineId", "transferPhase")
       VALUES ($1, $2, $3, 'OUT', '1', 'EACH', 'TRANSFER_SHIPMENT', $4, $5, 'SHIPMENT')`,
      [
        movementId,
        fixture.productId,
        sourceWarehouseId,
        fixture.userId,
        transferLineId,
      ],
    );
    await expectRejectedAndRecover(
      client,
      insertShipment,
      ["23505"],
    );
    assert.equal(await getBalance(client, sourceWarehouseId, fixture.productId), "9.000");
  });
});
