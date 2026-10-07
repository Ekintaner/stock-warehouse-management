import "dotenv/config";
import { Pool } from "pg";
import {
  DatabaseTargetError,
  DEVELOPMENT_DATABASE_NAME,
  TEST_DATABASE_NAME,
  parseLocalDatabaseTarget,
} from "../src/database/local-database-target.js";

type Mode =
  | "migrate"
  | "seed"
  | "test-migrate"
  | "grants"
  | "test-grants";

async function verifyDatabase(mode: Mode): Promise<void> {
  const migrationMode = mode !== "seed";
  const testMode = mode === "test-migrate" || mode === "test-grants";
  const connectionString = migrationMode
    ? testMode
      ? process.env.TEST_MIGRATION_DATABASE_URL
      : process.env.MIGRATION_DATABASE_URL
    : process.env.DATABASE_URL;
  const databaseName = testMode
    ? TEST_DATABASE_NAME
    : DEVELOPMENT_DATABASE_NAME;
  const target = parseLocalDatabaseTarget(
    connectionString,
    databaseName,
  );
  if (testMode) {
    parseLocalDatabaseTarget(
      process.env.TEST_DATABASE_URL,
      TEST_DATABASE_NAME,
    );
  }
  const pool = new Pool({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 3_000,
    max: 1,
  });

  try {
    const connection = await pool.query<{
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
    if (connection.rows[0]?.databaseName !== target.databaseName) {
      throw new DatabaseTargetError(
        "PostgreSQL connected to a database other than the dedicated project database; no database command was run.",
      );
    }
    const serverAddress = connection.rows[0]?.serverAddress;
    if (serverAddress !== null && serverAddress !== undefined) {
      const normalizedAddress = serverAddress.replace(/^\[|\]$/g, "").toLowerCase();
      if (
        normalizedAddress !== "::1" &&
        normalizedAddress !== "127.0.0.1" &&
        !normalizedAddress.startsWith("127.")
      ) {
        throw new DatabaseTargetError(
          "PostgreSQL resolved to a non-loopback server; no database command was run.",
        );
      }
    }
    const expectedRole =
      migrationMode ? "stock_warehouse_migrator" : "stock_warehouse_app";
    if (
      connection.rows[0]?.currentUser !== expectedRole ||
      connection.rows[0]?.isSuperuser ||
      connection.rows[0]?.canCreateDatabases ||
      connection.rows[0]?.canCreateRoles ||
      connection.rows[0]?.databaseOwner !== "stock_warehouse_migrator" ||
      connection.rows[0]?.appHasMigrationMembership
    ) {
      throw new DatabaseTargetError(
        `Use the dedicated non-superuser ${expectedRole} role; no database command was run.`,
      );
    }

    const ownershipTable = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public."_app_migration_guard"') IS NOT NULL AS "exists"`,
    );

    if (!ownershipTable.rows[0]?.exists) {
      const tables = await pool.query<{ tableName: string }>(
        `SELECT relation.relname AS "tableName"
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         WHERE relation.relkind IN ('r', 'p', 'f', 'm', 'v', 'S')
           AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
           AND namespace.nspname NOT LIKE 'pg_toast%'
           AND namespace.nspname NOT LIKE 'pg_temp_%'`,
      );
      if (tables.rowCount !== 0) {
        throw new DatabaseTargetError(
          "The target database is not an empty database owned by this project; no database command was run.",
        );
      }
      if (mode === "seed") {
        throw new DatabaseTargetError(
          "The project migration has not been applied; no seed data was written.",
        );
      }
    } else {
      const marker = await pool.query<{ owned: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM public."_app_migration_guard"
           WHERE "projectKey" = $1
         ) AS "owned"`,
        ["local-stock-warehouse"],
      );
      if (!marker.rows[0]?.owned) {
        throw new DatabaseTargetError(
          "The database ownership marker does not match this project; no database command was run.",
        );
      }

      const migrationHistory = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS "exists"`,
      );
      if (!migrationHistory.rows[0]?.exists) {
        throw new DatabaseTargetError(
          "The project migration history is missing; no database command was run.",
        );
      }

      const migrationState = await pool.query<{
        initialApplied: boolean;
        failedMigration: boolean;
      }>(
        `SELECT
           EXISTS (
             SELECT 1
             FROM public."_prisma_migrations"
             WHERE "migration_name" = '20261006000000_initial'
               AND "finished_at" IS NOT NULL
               AND "rolled_back_at" IS NULL
           ) AS "initialApplied",
           EXISTS (
             SELECT 1
             FROM public."_prisma_migrations"
             WHERE "finished_at" IS NULL
               AND "rolled_back_at" IS NULL
           ) AS "failedMigration"`,
      );
      if (!migrationState.rows[0]?.initialApplied) {
        throw new DatabaseTargetError(
          "The completed initial project migration is missing; no database command was run.",
        );
      }
      if (migrationState.rows[0]?.failedMigration) {
        throw new DatabaseTargetError(
          "An incomplete project migration exists; review it before running another database command.",
        );
      }

      if (mode === "seed") {
        const appPrivileges = await pool.query<{
          canWriteBalance: boolean;
          canUpdateMovement: boolean;
          canDeleteMovement: boolean;
          canTruncateMovement: boolean;
          canInsertMovement: boolean;
          canCreateInPublicSchema: boolean;
        }>(
          `SELECT
             has_table_privilege(current_user, 'public."StockBalance"', 'INSERT')
               OR has_table_privilege(current_user, 'public."StockBalance"', 'UPDATE')
               OR has_table_privilege(current_user, 'public."StockBalance"', 'DELETE')
               OR has_table_privilege(current_user, 'public."StockBalance"', 'TRUNCATE')
               AS "canWriteBalance",
             has_table_privilege(current_user, 'public."StockMovement"', 'UPDATE')
               AS "canUpdateMovement",
             has_table_privilege(current_user, 'public."StockMovement"', 'DELETE')
               AS "canDeleteMovement",
             has_table_privilege(current_user, 'public."StockMovement"', 'TRUNCATE')
               AS "canTruncateMovement",
             has_table_privilege(current_user, 'public."StockMovement"', 'INSERT')
               AS "canInsertMovement",
             has_schema_privilege(current_user, 'public', 'CREATE')
               AS "canCreateInPublicSchema"`,
        );
        const privileges = appPrivileges.rows[0];
        if (
          !privileges ||
          privileges.canWriteBalance ||
          privileges.canUpdateMovement ||
          privileges.canDeleteMovement ||
          privileges.canTruncateMovement ||
          !privileges.canInsertMovement ||
          privileges.canCreateInPublicSchema
        ) {
          throw new DatabaseTargetError(
            "The application role has unsafe or incomplete stock-table privileges; apply grant-app-access.sql before seeding.",
          );
        }
      }
    }

    const successMessage =
      mode === "migrate"
        ? "Local dedicated database preflight passed; migration may proceed."
        : mode === "grants"
          ? "Local dedicated database preflight passed; application grants may be applied."
          : mode === "test-migrate"
          ? "Local test database preflight passed; test migration may proceed."
          : mode === "test-grants"
            ? "Local test database preflight passed; application grants may be applied."
            : "Local project database preflight passed; explicit demo seeding may proceed.";
    console.info(successMessage);
  } finally {
    await pool.end();
  }
}

const mode = process.argv[2];
if (
  mode !== "migrate" &&
  mode !== "seed" &&
  mode !== "test-migrate" &&
  mode !== "grants" &&
  mode !== "test-grants"
) {
  console.error("Specify migrate, seed, test-migrate, grants, or test-grants preflight mode.");
  process.exitCode = 1;
} else {
  try {
    await verifyDatabase(mode);
  } catch (error) {
    if (error instanceof DatabaseTargetError) {
      console.error(error.message);
    } else {
      console.error(
        "Could not verify the local database target. No migration or seed was run; check PostgreSQL and .env without sharing connection details.",
      );
    }
    process.exitCode = 1;
  }
}
