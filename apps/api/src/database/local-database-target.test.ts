import assert from "node:assert/strict";
import test from "node:test";
import {
  DatabaseTargetError,
  TEST_DATABASE_NAME,
  parseLocalDatabaseTarget,
} from "./local-database-target.js";

test("accepts a dedicated local PostgreSQL database URL", () => {
  const target = parseLocalDatabaseTarget(
    "postgresql://local-user:example@127.0.0.1:5432/stock_warehouse_local?schema=public",
  );

  assert.equal(target.databaseName, "stock_warehouse_local");
  assert.equal(target.host, "127.0.0.1");
});

test("accepts only the dedicated local test database when requested", () => {
  const target = parseLocalDatabaseTarget(
    "postgresql://127.0.0.1:5432/stock_warehouse_test?schema=public",
    TEST_DATABASE_NAME,
  );

  assert.equal(target.databaseName, TEST_DATABASE_NAME);
  assert.throws(() =>
    parseLocalDatabaseTarget(
      "postgresql://127.0.0.1:5432/stock_warehouse_local?schema=public",
      TEST_DATABASE_NAME,
    ),
  );
});

test("rejects remote database hosts without disclosing connection details", () => {
  assert.throws(
    () =>
      parseLocalDatabaseTarget(
        "postgresql://user:secret@db.example.invalid:5432/stock_warehouse_local",
      ),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseTargetError);
      assert.doesNotMatch(error.message, /secret|db\.example\.invalid/);
      return true;
    },
  );
});

test("rejects an unrelated local database", () => {
  assert.throws(
    () =>
      parseLocalDatabaseTarget(
        "postgresql://user:secret@localhost:5432/postgres",
      ),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseTargetError);
      assert.doesNotMatch(error.message, /secret|localhost/);
      return true;
    },
  );
});

test("rejects malformed database names without echoing URL contents", () => {
  assert.throws(
    () =>
      parseLocalDatabaseTarget(
        "postgresql://user:secret@localhost:5432/%ZZ",
      ),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseTargetError);
      assert.doesNotMatch(error.message, /secret|%ZZ/);
      return true;
    },
  );
});
