export const DEVELOPMENT_DATABASE_NAME = "stock_warehouse_local";
export const TEST_DATABASE_NAME = "stock_warehouse_test";
const ALLOWED_SCHEMA = "public";

export class DatabaseTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseTargetError";
  }
}

export interface LocalDatabaseTarget {
  connectionString: string;
  databaseName: string;
  host: string;
}

export function parseLocalDatabaseTarget(
  value: string | undefined,
  expectedDatabaseName = DEVELOPMENT_DATABASE_NAME,
): LocalDatabaseTarget {
  if (!value) {
    throw new DatabaseTargetError(
      "DATABASE_URL is missing. Configure the local PostgreSQL database in the project-root .env file.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DatabaseTargetError(
      "DATABASE_URL must be a valid local PostgreSQL connection URL.",
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1";
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !isLoopback
  ) {
    throw new DatabaseTargetError(
      "DATABASE_URL must point to PostgreSQL on this computer; remote hosts are not allowed.",
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new DatabaseTargetError(
      "DATABASE_URL must target the dedicated local project database.",
    );
  }

  if (databaseName !== expectedDatabaseName) {
    throw new DatabaseTargetError(
      `DATABASE_URL must target the dedicated ${expectedDatabaseName} database.`,
    );
  }

  const schema = url.searchParams.get("schema");
  if (schema !== null && schema !== ALLOWED_SCHEMA) {
    throw new DatabaseTargetError(
      `DATABASE_URL must use the ${ALLOWED_SCHEMA} schema.`,
    );
  }

  return {
    connectionString: value,
    databaseName,
    host,
  };
}
