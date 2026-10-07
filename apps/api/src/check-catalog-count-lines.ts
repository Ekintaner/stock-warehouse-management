import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { parseLocalDatabaseTarget, TEST_DATABASE_NAME } from "./database/local-database-target.js";

const target = parseLocalDatabaseTarget(
  process.env.TEST_MIGRATION_DATABASE_URL,
  TEST_DATABASE_NAME,
);
const pool = new Pool({ connectionString: target.connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const cats = await prisma.category.findMany({
    where: { code: { startsWith: "CAT-" } },
    select: { id: true, code: true },
  });
  const catIds = cats.map((c) => c.id);
  const prods = await prisma.product.findMany({
    where: { categoryId: { in: catIds } },
    select: { id: true, sku: true },
  });
  const prodIds = prods.map((p) => p.id);
  const lines = await prisma.stockCountLine.findMany({
    where: { productId: { in: prodIds } },
    select: { id: true, productId: true },
  });
  console.log("CAT- categories:", cats.length, cats.map((c) => c.code).join(", "));
  console.log("Products in those categories:", prods.map((p) => p.sku).join(", "));
  console.log("StockCountLines linked to those products:", lines.length, JSON.stringify(lines));
} finally {
  await prisma.$disconnect();
  await pool.end();
}
