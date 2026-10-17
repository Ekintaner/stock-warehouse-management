import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaAuthStore } from "../apps/api/src/modules/auth/auth-store.js";
import { buildApp } from "../apps/api/src/app.js";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hashPassword } from "../apps/api/src/modules/auth/password.js";
import {
  parseLocalDatabaseTarget,
  TEST_DATABASE_NAME,
} from "../apps/api/src/database/local-database-target.js";
import { createServer } from "vite";

const target = parseLocalDatabaseTarget(
  process.env.TEST_DATABASE_URL,
  TEST_DATABASE_NAME,
);
const pool = new Pool({ connectionString: target.connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const suffix = randomUUID().slice(0, 8).toUpperCase(),
  password = randomUUID() + "Ab1!",
  username = `browser-${suffix.toLowerCase()}`;
const user = await prisma.user.create({
  data: {
    username,
    displayName: "Demo Yönetici",
    passwordHash: await hashPassword(password),
    role: "ADMIN",
  },
});
const app = buildApp(
  {
    store: new PrismaAuthStore(prisma),
    appOrigin: "http://127.0.0.1:5174",
    secureCookies: false,
  },
  prisma,
);
const vite = await createServer({
  configFile: false,
  root: "apps/web",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3101" },
  },
});
let browser: Browser | undefined;
let diagnosticPage: Page | undefined;
try {
  await app.listen({ host: "127.0.0.1", port: 3101 });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  diagnosticPage = page;
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on(
    "dialog",
    (dialog: { accept: (v?: string) => Promise<void> }) =>
      void dialog.accept("Tarayıcı kabul testi düzeltmesi"),
  );
  await page.goto("http://127.0.0.1:5174");
  await page.getByLabel("Kullanıcı adı", { exact: true }).fill(username);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.getByRole("heading", { name: "Ürünler", exact: true }).waitFor();
  const session = await (
    await page.request.get("http://127.0.0.1:5174/api/auth/session")
  ).json();
  const headers = {
    Origin: "http://127.0.0.1:5174",
    "X-CSRF-Token": session.csrfToken,
  };
  async function post(url: string, data: unknown, extra = {}) {
    const r = await page.request.post("http://127.0.0.1:5174" + url, {
      headers: { ...headers, ...extra },
      data,
    });
    if (!r.ok()) throw new Error(`${url} ${r.status()} ${await r.text()}`);
    return r.json();
  }
  const warehouse = await prisma.warehouse.create({
    data: { code: `BROWSER-${suffix}`, name: "Demo Ana Depo" },
  });
  const category = await prisma.category.create({
    data: { code: `BROWSER-${suffix}`, name: "Demo Teknik Malzemeler" },
  });
  const product = await prisma.product.create({
    data: {
      sku: `BROWSER-${suffix.toUpperCase()}`,
      name: "M8 Çelik Cıvata",
      unit: "EACH",
      categoryId: category.id,
    },
  });
  const doc = await post("/api/stock-documents", {
    type: "RECEIPT",
    warehouseId: warehouse.id,
    lines: [{ productId: product.id, quantity: "10" }],
  });
  await post(
    `/api/stock-documents/${doc.id}/approve`,
    { expectedUpdatedAt: doc.updatedAt },
    { "Idempotency-Key": randomUUID() },
  );
  await page.getByRole("link", { name: "Sayımlar", exact: true }).click();
  await page.getByRole("button", { name: "Sayım aç", exact: true }).click();
  await page.getByLabel("Depo", { exact: true }).selectOption(warehouse.id);
  await page
    .getByRole("button", { name: "Sayımı başlat", exact: true })
    .click();
  await page.waitForURL(/counts\/[0-9a-f-]+$/);
  const countId = page.url().split("/").at(-1)!;
  const all = await prisma.stockCountLine.findMany({ where: { countId } });
  // Pre-count all other catalogue entries through the same API; the selected item is entered in the UI.
  let current = await (
    await page.request.get(`http://127.0.0.1:5174/api/counts/${countId}`)
  ).json();
  for (let i = 0; i < all.length; i += 100) {
    const batch = all
      .slice(i, i + 100)
      .filter((l) => l.productId !== product.id);
    if (!batch.length) continue;
    const r = await page.request.patch(
      `http://127.0.0.1:5174/api/counts/${countId}/lines`,
      {
        headers,
        data: {
          expectedUpdatedAt: current.count.updatedAt,
          lines: batch.map((l) => ({
            lineId: l.id,
            countedQuantity: l.snapshotQuantity.toFixed(3),
          })),
        },
      },
    );
    if (!r.ok()) throw new Error(await r.text());
    current = await (
      await page.request.get(`http://127.0.0.1:5174/api/counts/${countId}`)
    ).json();
  }
  await page.reload();
  await page.getByLabel("Ürün ara", { exact: true }).fill(product.sku);
  await page
    .getByLabel(`${product.sku} sayılan miktar`, { exact: true })
    .fill("8");
  await page
    .getByRole("button", { name: "Miktarları kaydet", exact: true })
    .click();
  await page
    .getByText("Sayım miktarları kaydedildi.", { exact: true })
    .waitFor();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/sayim.png", fullPage: true });
  await page
    .getByRole("button", { name: "Farkları onayla", exact: true })
    .click();
  await page.getByText("Sayım kapatıldı.", { exact: true }).waitFor();
  const balance = await prisma.stockBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouse.id,
        productId: product.id,
      },
    },
  });
  if (!balance.quantity.equals(8)) throw new Error("Count expected stock 8");
  await page.getByRole("link", { name: "Raporlar", exact: true }).click();
  await page.getByLabel("Depo", { exact: true }).selectOption(warehouse.id);
  await page.getByLabel("Ara", { exact: true }).fill(product.sku);
  await page
    .getByRole("cell", { name: "8.000", exact: true })
    .first()
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/raporlar.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Stok CSV indir" }).click();
  await downloadPromise;
  const targetWarehouse = await prisma.warehouse.create({
    data: { code: `BROWSER2-${suffix}`, name: "Demo İkinci Depo" },
  });
  const transfer = await post("/api/transfers", {
    sourceWarehouseId: warehouse.id,
    targetWarehouseId: targetWarehouse.id,
    lines: [{ productId: product.id, quantity: "2" }],
    description: "Browser transfer",
  });
  await page.goto(`http://127.0.0.1:5174/transfers/${transfer.id}`);
  await page.getByRole("button", { name: "Sevk et", exact: true }).click();
  await page.getByRole("button", { name: "Teslim al", exact: true }).waitFor();
  await page.getByRole("button", { name: "Teslim al", exact: true }).click();
  await page.getByRole("heading", { name: "Ürünler", exact: true }).waitFor();
  await page.getByText("Teslim alındı", { exact: true }).first().waitFor();
  const delivered = await prisma.stockBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: targetWarehouse.id,
        productId: product.id,
      },
    },
  });
  if (!delivered.quantity.equals(2))
    throw new Error("Transfer delivery balance must be 2");
  const returnTransfer = await post("/api/transfers", {
    sourceWarehouseId: warehouse.id,
    targetWarehouseId: targetWarehouse.id,
    lines: [{ productId: product.id, quantity: "1" }],
    description: "Browser return",
  });
  await page.goto(`http://127.0.0.1:5174/transfers/${returnTransfer.id}`);
  await page.getByRole("button", { name: "Sevk et", exact: true }).click();
  await page
    .getByLabel("Geri dönüş gerekçesi", { exact: true })
    .fill("Tarayıcı kabul testi geri dönüşü");
  await page.getByRole("button", { name: "Geri döndür", exact: true }).click();
  await page.getByText("Geri döndü", { exact: true }).first().waitFor();
  const issueDoc = await post("/api/stock-documents", {
    type: "ISSUE",
    warehouseId: warehouse.id,
    lines: [{ productId: product.id, quantity: "1" }],
  });
  await post(
    `/api/stock-documents/${issueDoc.id}/approve`,
    { expectedUpdatedAt: issueDoc.updatedAt },
    { "Idempotency-Key": randomUUID() },
  );
  await page.goto(`http://127.0.0.1:5174/stock-documents/${issueDoc.id}`);
  await page
    .getByRole("button", { name: "Belgeyi ters hareketle düzelt", exact: true })
    .click();
  await page
    .getByText("Belgenin stok etkisi terslendi.", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByText("Belgenin stok etkisi terslendi.", { exact: true })
    .waitFor();
  const finalSource = await prisma.stockBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouse.id,
        productId: product.id,
      },
    },
  });
  if (!finalSource.quantity.equals(6))
    throw new Error(
      "Transfer return and reversal must preserve source stock 6",
    );
  await page.getByRole("link", { name: "Tedarikçiler", exact: true }).click();
  await page
    .getByRole("button", { name: "Yeni tedarikçi", exact: true })
    .click();
  await page.getByLabel("Kod", { exact: true }).fill(`DEMO-${suffix}`);
  await page
    .getByLabel("Firma adı", { exact: true })
    .fill("Demo Teknik Tedarik");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByText("Kayıt kaydedildi.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Kullanıcılar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Kullanıcılar ve depo atamaları" })
    .waitFor();
  await page
    .getByRole("link", { name: "Denetim kayıtları", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Denetim kayıtları", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Denetim kayıtları", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Çıkış", exact: true }).click();
  await page.getByRole("button", { name: "Giriş yap", exact: true }).waitFor();
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    "BROWSER CHECK PASSED: login, count 10→8, approval, report, CSV, transfer shipment/delivery/return, document reversal, supplier create, users, audit, refresh, logout.",
  );
} catch (e) {
  await diagnosticPage?.screenshot({ path: "browser-failure.png", fullPage: true });
  throw e;
} finally {
  await browser?.close();
  await vite.close();
  await app.close();
  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: false },
  });
  await prisma.session.updateMany({
    where: { userId: user.id },
    data: { revokedAt: new Date() },
  });
  await prisma.$disconnect();
  await pool.end();
}
