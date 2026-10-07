import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { parseLocalDatabaseTarget } from "./local-database-target.js";

interface PrismaResources {
  client: PrismaClient;
  pool: Pool;
}

let resources: PrismaResources | undefined;

export function getPrismaClient(): PrismaClient {
  if (resources) {
    return resources.client;
  }

  const target = parseLocalDatabaseTarget(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });
  resources = { client, pool };

  return client;
}

export async function closeDatabase(): Promise<void> {
  const current = resources;
  if (!current) {
    return;
  }
  resources = undefined;

  let disconnectError: unknown;
  try {
    await current.client.$disconnect();
  } catch (error) {
    disconnectError = error;
  }

  try {
    await current.pool.end();
  } catch (error) {
    if (disconnectError === undefined) {
      disconnectError = error;
    }
  }

  if (disconnectError !== undefined) {
    throw new Error("Could not close the local database client cleanly.", {
      cause: disconnectError,
    });
  }
}
