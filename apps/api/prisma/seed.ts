import "dotenv/config";
import { closeDatabase, getPrismaClient } from "../src/database/prisma.js";

const categories = [
  { code: "FASTENERS", name: "Bağlantı Elemanları" },
  { code: "HAND_TOOLS", name: "El Aletleri" },
  { code: "ELECTRICAL", name: "Elektrik Malzemeleri" },
  { code: "CHEMICALS", name: "Yapı Kimyasalları" },
] as const;

const warehouses = [
  { code: "MERKEZ", name: "Merkez Depo" },
  { code: "TEKNIK", name: "Teknik Malzeme Deposu" },
] as const;

const products = [
  {
    sku: "CIVATA-M8-30",
    name: "Altı Köşe Başlı Cıvata M8 × 30",
    unit: "EACH" as const,
    categoryCode: "FASTENERS",
  },
  {
    sku: "SOMUN-M8",
    name: "Altı Köşe Somun M8",
    unit: "EACH" as const,
    categoryCode: "FASTENERS",
  },
  {
    sku: "PENSE-180",
    name: "Kombine Pense 180 mm",
    unit: "EACH" as const,
    categoryCode: "HAND_TOOLS",
  },
  {
    sku: "KABLO-NYM-3X15",
    name: "NYM Kablo 3 × 1,5 mm²",
    unit: "METER" as const,
    categoryCode: "ELECTRICAL",
  },
  {
    sku: "HARC-25KG",
    name: "Hızlı Tamir Harcı",
    unit: "KILOGRAM" as const,
    categoryCode: "CHEMICALS",
  },
  {
    sku: "IZOLE-BANT-19",
    name: "PVC Elektrik İzole Bandı 19 mm",
    unit: "EACH" as const,
    categoryCode: "ELECTRICAL",
  },
] as const;

async function seedDemoData(): Promise<void> {
  const prisma = getPrismaClient();

  try {
    const categoryIds = new Map<string, string>();
    for (const category of categories) {
      const record = await prisma.category.upsert({
        where: { code: category.code },
        update: {},
        create: category,
        select: { id: true },
      });
      categoryIds.set(category.code, record.id);
    }

    const warehouseIds = new Map<string, string>();
    for (const warehouse of warehouses) {
      const record = await prisma.warehouse.upsert({
        where: { code: warehouse.code },
        update: {},
        create: warehouse,
        select: { id: true },
      });
      warehouseIds.set(warehouse.code, record.id);

      const location = {
        warehouseId: record.id,
        code: "A-01",
      };
      await prisma.warehouseLocation.upsert({
        where: {
          warehouseId_code: location,
        },
        update: {},
        create: {
          ...location,
          name: "Raf A-01",
        },
      });
    }

    const productIds = new Map<string, string>();
    for (const product of products) {
      const categoryId = categoryIds.get(product.categoryCode);
      if (!categoryId) {
        throw new Error(`Demo category ${product.categoryCode} is missing.`);
      }

      const record = await prisma.product.upsert({
        where: { sku: product.sku },
        update: {},
        create: {
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          categoryId,
        },
        select: { id: true },
      });
      productIds.set(product.sku, record.id);
    }

    await prisma.supplier.upsert({
      where: { code: "SENTETIK-01" },
      update: {},
      create: {
        code: "SENTETIK-01",
        name: "Örnek Teknik Tedarikçi (Sentetik)",
        contactName: "Demo İrtibat",
      },
    });

    for (const warehouseId of warehouseIds.values()) {
      for (const productId of productIds.values()) {
        await prisma.warehouseProductSetting.upsert({
          where: {
            warehouseId_productId: { warehouseId, productId },
          },
          update: {},
          create: { warehouseId, productId },
        });
      }
    }

    console.info(
      "Sentetik demo katalogu hazırlandı. Henüz stok hareketi olmayan ürün-depo bakiyeleri sıfır kabul edilir; kullanıcı, parola veya stok hareketi oluşturulmadı.",
    );
  } finally {
    await closeDatabase();
  }
}

try {
  await seedDemoData();
} catch {
  console.error(
    "Sentetik demo verileri yazılamadı. Bağlantı ayrıntıları gösterilmedi.",
  );
  process.exitCode = 1;
}
