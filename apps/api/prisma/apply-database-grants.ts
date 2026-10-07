import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  DEVELOPMENT_DATABASE_NAME,
  TEST_DATABASE_NAME,
  parseLocalDatabaseTarget,
} from "../src/database/local-database-target.js";

type TargetName = "development" | "test";

async function applyGrants(targetName: TargetName): Promise<void> {
  const isTest = targetName === "test";
  const databaseName = isTest
    ? TEST_DATABASE_NAME
    : DEVELOPMENT_DATABASE_NAME;
  const connectionString = isTest
    ? process.env.TEST_MIGRATION_DATABASE_URL
    : process.env.MIGRATION_DATABASE_URL;
  const target = parseLocalDatabaseTarget(connectionString, databaseName);
  const pool = new Pool({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 3_000,
    max: 1,
  });

  try {
    const connection = await pool.query<{
      databaseName: string;
      currentUser: string;
      serverAddress: string | null;
    }>(
      `SELECT current_database() AS "databaseName",
              current_user AS "currentUser",
              inet_server_addr()::text AS "serverAddress"`,
    );
    const row = connection.rows[0];
    if (
      row?.databaseName !== databaseName ||
      row.currentUser !== "stock_warehouse_migrator" ||
      (row.serverAddress !== null &&
        row.serverAddress !== "127.0.0.1" &&
        row.serverAddress !== "::1" &&
        !row.serverAddress.startsWith("127."))
    ) {
      throw new Error("Unexpected database target or role.");
    }

    const sql = await readFile(
      new URL("./grant-app-access.sql", import.meta.url),
      "utf8",
    );
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

const targetArgument = process.argv[2] ?? "all";
if (
  targetArgument !== "all" &&
  targetArgument !== "development" &&
  targetArgument !== "test"
) {
  console.error("Specify all, development, or test.");
  process.exitCode = 1;
} else {
  const targets: TargetName[] =
    targetArgument === "all"
      ? ["development", "test"]
      : [targetArgument];
  try {
    for (const target of targets) {
      await applyGrants(target);
    }
    console.info(
      `Application table grants applied to ${targets.length} local project database(s).`,
    );
  } catch {
    console.error(
      "Could not apply application database grants. Check the local migration role and project database state; connection details were withheld.",
    );
    process.exitCode = 1;
  }
}
