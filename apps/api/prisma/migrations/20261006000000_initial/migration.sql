-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;

-- This marker allows the project to distinguish its own local database
-- from a non-empty database before migration deployment.
CREATE TABLE "_app_migration_guard" (
    "projectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_app_migration_guard_pkey" PRIMARY KEY ("projectKey"),
    CONSTRAINT "_app_migration_guard_projectKey_check"
        CHECK ("projectKey" = 'local-stock-warehouse')
);

INSERT INTO "_app_migration_guard" ("projectKey")
VALUES ('local-stock-warehouse');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'WAREHOUSE_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('EACH', 'KILOGRAM', 'METER');

-- CreateEnum
CREATE TYPE "StockDocumentType" AS ENUM ('RECEIPT', 'ISSUE');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'SHIPPED', 'RECEIVED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "TransferMovementPhase" AS ENUM ('SHIPMENT', 'RECEIPT', 'RETURN_FROM_TRANSIT', 'RETURN_SHIPMENT', 'RETURN_RECEIPT');

-- CreateEnum
CREATE TYPE "TransferReturnOrigin" AS ENUM ('SHIPPED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_SHIPMENT', 'TRANSFER_RECEIPT', 'TRANSFER_RETURN', 'COUNT_ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWarehouse" (
    "userId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWarehouse_pkey" PRIMARY KEY ("userId","warehouseId")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "name" VARCHAR(180) NOT NULL,
    "unit" "Unit" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "contactName" VARCHAR(120),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseProductSetting" (
    "id" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "minimumStock" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "WarehouseProductSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("warehouseId","productId")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" UUID NOT NULL,
    "documentNumber" BIGSERIAL NOT NULL,
    "type" "StockDocumentType" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "warehouseId" UUID NOT NULL,
    "supplierId" UUID,
    "reference" VARCHAR(120),
    "description" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "cancelledById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "approvedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocumentLine" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "locationId" UUID,
    "unit" "Unit" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "StockDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" UUID NOT NULL,
    "transferNumber" BIGSERIAL NOT NULL,
    "sourceWarehouseId" UUID NOT NULL,
    "targetWarehouseId" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "returnOrigin" "TransferReturnOrigin",
    "returnReason" VARCHAR(1000),
    "description" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "shippedById" UUID,
    "receivedById" UUID,
    "cancelledById" UUID,
    "returnedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "shippedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "returnedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "countNumber" BIGSERIAL NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" UUID NOT NULL,
    "responsibleUserId" UUID NOT NULL,
    "approvedById" UUID,
    "cancelledById" UUID,
    "description" VARCHAR(1000),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unit" "Unit" NOT NULL,
    "snapshotQuantity" DECIMAL(18,3) NOT NULL,
    "countedQuantity" DECIMAL(18,3),

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentLineId" UUID,
    "transferLineId" UUID,
    "transferPhase" "TransferMovementPhase",
    "countLineId" UUID,
    "reversesMovementId" UUID,
    "reason" VARCHAR(1000),

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operationScope" VARCHAR(80) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "resultType" VARCHAR(80),
    "resultReference" VARCHAR(200),
    "response" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "relatedType" VARCHAR(80) NOT NULL,
    "relatedId" VARCHAR(200) NOT NULL,
    "changeSummary" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "UserWarehouse_warehouseId_userId_idx" ON "UserWarehouse"("warehouseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_isActive_idx" ON "Product"("categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "WarehouseLocation_warehouseId_isActive_idx" ON "WarehouseLocation"("warehouseId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key" ON "WarehouseLocation"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseProductSetting_warehouseId_productId_key" ON "WarehouseProductSetting"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "StockBalance_productId_warehouseId_idx" ON "StockBalance"("productId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_documentNumber_key" ON "StockDocument"("documentNumber");

-- CreateIndex
CREATE INDEX "StockDocument_warehouseId_status_createdAt_idx" ON "StockDocument"("warehouseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StockDocument_createdAt_idx" ON "StockDocument"("createdAt");

-- CreateIndex
CREATE INDEX "StockDocumentLine_productId_idx" ON "StockDocumentLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocumentLine_documentId_productId_key" ON "StockDocumentLine"("documentId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_transferNumber_key" ON "Transfer"("transferNumber");

-- CreateIndex
CREATE INDEX "Transfer_sourceWarehouseId_status_createdAt_idx" ON "Transfer"("sourceWarehouseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_targetWarehouseId_status_createdAt_idx" ON "Transfer"("targetWarehouseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TransferLine_productId_idx" ON "TransferLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLine_transferId_productId_key" ON "TransferLine"("transferId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_countNumber_key" ON "StockCount"("countNumber");

-- CreateIndex
CREATE INDEX "StockCount_warehouseId_startedAt_idx" ON "StockCount"("warehouseId", "startedAt");

-- CreateIndex
CREATE INDEX "StockCountLine_productId_idx" ON "StockCountLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_productId_key" ON "StockCountLine"("countId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversesMovementId_key" ON "StockMovement"("reversesMovementId");

-- CreateIndex
CREATE INDEX "StockMovement_warehouseId_createdAt_idx" ON "StockMovement"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_warehouseId_createdAt_idx" ON "StockMovement"("productId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_createdById_createdAt_idx" ON "StockMovement"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_transferLineId_transferPhase_key" ON "StockMovement"("transferLineId", "transferPhase");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_documentLineId_key" ON "StockMovement"("documentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_countLineId_key" ON "StockMovement"("countLineId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operationScope_key_key" ON "IdempotencyRecord"("userId", "operationScope", "key");

-- CreateIndex
CREATE INDEX "AuditEvent_relatedType_relatedId_createdAt_idx" ON "AuditEvent"("relatedType", "relatedId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouse" ADD CONSTRAINT "UserWarehouse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouse" ADD CONSTRAINT "UserWarehouse_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseProductSetting" ADD CONSTRAINT "WarehouseProductSetting_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseProductSetting" ADD CONSTRAINT "WarehouseProductSetting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StockDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "StockDocumentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "TransferLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_countLineId_fkey" FOREIGN KEY ("countLineId") REFERENCES "StockCountLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversesMovementId_fkey" FOREIGN KEY ("reversesMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot currently express these PostgreSQL checks, partial indexes, and triggers.
ALTER TABLE "User"
    ADD CONSTRAINT "User_username_normalized_check"
    CHECK ("username" = lower(btrim("username")) AND length("username") > 0);

ALTER TABLE "Session"
    ADD CONSTRAINT "Session_tokenHash_sha256_check"
    CHECK (btrim("tokenHash") ~ '^[0-9a-f]{64}$');

ALTER TABLE "Category"
    ADD CONSTRAINT "Category_code_normalized_check"
    CHECK ("code" = upper(btrim("code")) AND length("code") > 0);

ALTER TABLE "Product"
    ADD CONSTRAINT "Product_sku_normalized_check"
        CHECK ("sku" = upper(btrim("sku")) AND length("sku") > 0),
    ADD CONSTRAINT "Product_barcode_trimmed_check"
        CHECK ("barcode" IS NULL OR ("barcode" = btrim("barcode") AND length("barcode") > 0));

ALTER TABLE "Warehouse"
    ADD CONSTRAINT "Warehouse_code_normalized_check"
    CHECK ("code" = upper(btrim("code")) AND length("code") > 0);

ALTER TABLE "WarehouseLocation"
    ADD CONSTRAINT "WarehouseLocation_code_normalized_check"
    CHECK ("code" = upper(btrim("code")) AND length("code") > 0);

ALTER TABLE "Supplier"
    ADD CONSTRAINT "Supplier_code_normalized_check"
    CHECK ("code" = upper(btrim("code")) AND length("code") > 0);

ALTER TABLE "WarehouseProductSetting"
    ADD CONSTRAINT "WarehouseProductSetting_minimumStock_nonnegative_check"
    CHECK ("minimumStock" >= 0);

ALTER TABLE "StockBalance"
    ADD CONSTRAINT "StockBalance_quantity_nonnegative_check"
    CHECK ("quantity" >= 0);

ALTER TABLE "StockDocument"
    ADD CONSTRAINT "StockDocument_status_timestamps_check"
    CHECK (
        ("status" = 'DRAFT' AND "approvedById" IS NULL AND "approvedAt" IS NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'APPROVED' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'CANCELLED' AND "approvedById" IS NULL AND "approvedAt" IS NULL AND "cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL)
    );

ALTER TABLE "StockDocumentLine"
    ADD CONSTRAINT "StockDocumentLine_quantity_positive_check"
    CHECK ("quantity" > 0);

ALTER TABLE "Transfer"
    ADD CONSTRAINT "Transfer_distinct_warehouses_check"
        CHECK ("sourceWarehouseId" <> "targetWarehouseId"),
    ADD CONSTRAINT "Transfer_status_timestamps_check"
        CHECK (
            ("status" = 'DRAFT' AND "returnOrigin" IS NULL AND "returnReason" IS NULL AND "shippedById" IS NULL AND "shippedAt" IS NULL AND "receivedById" IS NULL AND "receivedAt" IS NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "returnedById" IS NULL AND "returnedAt" IS NULL)
            OR ("status" = 'SHIPPED' AND "returnOrigin" IS NULL AND "returnReason" IS NULL AND "shippedById" IS NOT NULL AND "shippedAt" IS NOT NULL AND "receivedById" IS NULL AND "receivedAt" IS NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "returnedById" IS NULL AND "returnedAt" IS NULL)
            OR ("status" = 'RECEIVED' AND "returnOrigin" IS NULL AND "returnReason" IS NULL AND "shippedById" IS NOT NULL AND "shippedAt" IS NOT NULL AND "receivedById" IS NOT NULL AND "receivedAt" IS NOT NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "returnedById" IS NULL AND "returnedAt" IS NULL)
            OR ("status" = 'CANCELLED' AND "returnOrigin" IS NULL AND "returnReason" IS NULL AND "shippedById" IS NULL AND "shippedAt" IS NULL AND "receivedById" IS NULL AND "receivedAt" IS NULL AND "cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "returnedById" IS NULL AND "returnedAt" IS NULL)
            OR ("status" = 'RETURNED' AND "returnOrigin" IS NOT NULL AND "returnReason" IS NOT NULL AND btrim("returnReason") <> '' AND (
                ("returnOrigin" = 'SHIPPED' AND "shippedById" IS NOT NULL AND "shippedAt" IS NOT NULL AND "receivedById" IS NULL AND "receivedAt" IS NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "returnedById" IS NOT NULL AND "returnedAt" IS NOT NULL)
                OR ("returnOrigin" = 'RECEIVED' AND "shippedById" IS NOT NULL AND "shippedAt" IS NOT NULL AND "receivedById" IS NOT NULL AND "receivedAt" IS NOT NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "returnedById" IS NOT NULL AND "returnedAt" IS NOT NULL)
            ))
        );

ALTER TABLE "TransferLine"
    ADD CONSTRAINT "TransferLine_quantity_positive_check"
    CHECK ("quantity" > 0);

ALTER TABLE "StockCount"
    ADD CONSTRAINT "StockCount_status_timestamps_check"
    CHECK (
        ("status" = 'OPEN' AND "closedAt" IS NULL AND "approvedById" IS NULL AND "approvedAt" IS NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'APPROVED' AND "closedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL AND "approvedById" IS NULL AND "approvedAt" IS NULL AND "cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL)
    );

ALTER TABLE "StockCountLine"
    ADD CONSTRAINT "StockCountLine_snapshot_nonnegative_check"
        CHECK ("snapshotQuantity" >= 0),
    ADD CONSTRAINT "StockCountLine_counted_nonnegative_check"
        CHECK ("countedQuantity" IS NULL OR "countedQuantity" >= 0);

ALTER TABLE "StockMovement"
    ADD CONSTRAINT "StockMovement_quantity_positive_check"
        CHECK ("quantity" > 0),
    ADD CONSTRAINT "StockMovement_one_source_check"
        CHECK (num_nonnulls("documentLineId", "transferLineId", "countLineId", "reversesMovementId") = 1),
    ADD CONSTRAINT "StockMovement_source_type_check"
        CHECK (
            ("documentLineId" IS NOT NULL AND "transferPhase" IS NULL AND (("type" = 'RECEIPT' AND "direction" = 'IN') OR ("type" = 'ISSUE' AND "direction" = 'OUT')))
            OR ("transferLineId" IS NOT NULL AND "transferPhase" IS NOT NULL AND (
                ("transferPhase" = 'SHIPMENT' AND "type" = 'TRANSFER_SHIPMENT' AND "direction" = 'OUT')
                OR ("transferPhase" = 'RECEIPT' AND "type" = 'TRANSFER_RECEIPT' AND "direction" = 'IN')
                OR ("transferPhase" = 'RETURN_FROM_TRANSIT' AND "type" = 'TRANSFER_RETURN' AND "direction" = 'IN')
                OR ("transferPhase" = 'RETURN_SHIPMENT' AND "type" = 'TRANSFER_RETURN' AND "direction" = 'OUT')
                OR ("transferPhase" = 'RETURN_RECEIPT' AND "type" = 'TRANSFER_RETURN' AND "direction" = 'IN')
            ))
            OR ("countLineId" IS NOT NULL AND "transferPhase" IS NULL AND "type" = 'COUNT_ADJUSTMENT')
            OR ("reversesMovementId" IS NOT NULL AND "transferPhase" IS NULL AND "type" = 'REVERSAL')
        );

ALTER TABLE "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_key_nonempty_check"
        CHECK (length(btrim("key")) > 0),
    ADD CONSTRAINT "IdempotencyRecord_requestHash_sha256_check"
        CHECK ("requestHash" ~ '^[0-9a-f]{64}$');

-- Only one active (open) count is allowed for a warehouse.
CREATE UNIQUE INDEX "StockCount_one_open_per_warehouse_key"
    ON "StockCount"("warehouseId")
    WHERE "status" = 'OPEN';

CREATE FUNCTION lock_count_warehouse()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    warehouse_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."warehouseId" IS DISTINCT FROM OLD."warehouseId" THEN
        RAISE EXCEPTION 'A stock count cannot be moved to another warehouse.'
            USING ERRCODE = '23514';
    END IF;

    warehouse_id := NEW."warehouseId";
    PERFORM 1 FROM "Warehouse" WHERE "id" = warehouse_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock count warehouse does not exist.'
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockCount_lock_warehouse"
BEFORE INSERT OR UPDATE ON "StockCount"
FOR EACH ROW EXECUTE FUNCTION lock_count_warehouse();

CREATE FUNCTION guard_stock_document_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    document_status "StockDocumentStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        document_status := OLD."status";
    ELSE
        document_status := OLD."status";
    END IF;

    IF document_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only draft stock documents may be changed or deleted.'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW."status" NOT IN ('DRAFT', 'APPROVED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid stock document status.'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockDocument_guard_changes"
BEFORE UPDATE OR DELETE ON "StockDocument"
FOR EACH ROW EXECUTE FUNCTION guard_stock_document_changes();

CREATE FUNCTION guard_stock_document_line_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_document_id UUID;
    parent_status "StockDocumentStatus";
BEGIN
    parent_document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
    SELECT "status" INTO parent_status
    FROM "StockDocument"
    WHERE "id" = parent_document_id
    FOR UPDATE;

    IF NOT FOUND AND TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    IF NOT FOUND OR parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only lines of draft stock documents may be changed or deleted.'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW."documentId" IS DISTINCT FROM OLD."documentId" THEN
        RAISE EXCEPTION 'A stock document line cannot be moved to another document.'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockDocumentLine_guard_changes"
BEFORE INSERT OR UPDATE OR DELETE ON "StockDocumentLine"
FOR EACH ROW EXECUTE FUNCTION guard_stock_document_line_changes();

CREATE FUNCTION guard_transfer_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    first_warehouse UUID;
    second_warehouse UUID;
    status_transition_valid BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Only draft transfers may be deleted.'
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;

    first_warehouse := LEAST(OLD."sourceWarehouseId", OLD."targetWarehouseId");
    second_warehouse := GREATEST(OLD."sourceWarehouseId", OLD."targetWarehouseId");
    PERFORM 1 FROM "Warehouse" WHERE "id" = first_warehouse FOR UPDATE;
    PERFORM 1 FROM "Warehouse" WHERE "id" = second_warehouse FOR UPDATE;

    IF OLD."status" = 'DRAFT' THEN
        IF NEW."status" = 'DRAFT' THEN
            RETURN NEW;
        END IF;
        status_transition_valid :=
            (NEW."status" = 'SHIPPED')
            OR (NEW."status" = 'CANCELLED');
    ELSE
        IF NEW."sourceWarehouseId" IS DISTINCT FROM OLD."sourceWarehouseId"
            OR NEW."targetWarehouseId" IS DISTINCT FROM OLD."targetWarehouseId"
            OR NEW."description" IS DISTINCT FROM OLD."description"
            OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
            OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
            OR NEW."transferNumber" IS DISTINCT FROM OLD."transferNumber"
            OR (NEW."status" <> 'RETURNED' AND NEW."returnReason" IS DISTINCT FROM OLD."returnReason")
            OR (NEW."status" <> 'RETURNED' AND NEW."returnOrigin" IS DISTINCT FROM OLD."returnOrigin")
        THEN
            RAISE EXCEPTION 'Transfer details cannot be changed after leaving draft.'
                USING ERRCODE = '55000';
        END IF;

        status_transition_valid :=
            (OLD."status" = 'SHIPPED' AND NEW."status" IN ('RECEIVED', 'RETURNED'))
            OR (OLD."status" = 'RECEIVED' AND NEW."status" = 'RETURNED');
    END IF;

    IF NOT status_transition_valid THEN
        RAISE EXCEPTION 'Invalid transfer status transition.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Transfer_guard_changes"
BEFORE UPDATE OR DELETE ON "Transfer"
FOR EACH ROW EXECUTE FUNCTION guard_transfer_changes();

CREATE FUNCTION guard_transfer_line_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_transfer_id UUID;
    parent_status "TransferStatus";
BEGIN
    parent_transfer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."transferId" ELSE NEW."transferId" END;
    SELECT "status" INTO parent_status
    FROM "Transfer"
    WHERE "id" = parent_transfer_id
    FOR UPDATE;

    IF NOT FOUND AND TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    IF NOT FOUND OR parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only lines of draft transfers may be changed or deleted.'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW."transferId" IS DISTINCT FROM OLD."transferId" THEN
        RAISE EXCEPTION 'A transfer line cannot be moved to another transfer.'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "TransferLine_guard_changes"
BEFORE INSERT OR UPDATE OR DELETE ON "TransferLine"
FOR EACH ROW EXECUTE FUNCTION guard_transfer_line_changes();

CREATE FUNCTION guard_stock_count_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    status_transition_valid BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Stock counts must be cancelled, not deleted.'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF NEW."warehouseId" IS DISTINCT FROM OLD."warehouseId"
        OR NEW."countNumber" IS DISTINCT FROM OLD."countNumber"
        OR NEW."openedById" IS DISTINCT FROM OLD."openedById"
        OR NEW."responsibleUserId" IS DISTINCT FROM OLD."responsibleUserId"
        OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    THEN
        RAISE EXCEPTION 'Stock count identity and start snapshot cannot be changed.'
            USING ERRCODE = '55000';
    END IF;

    IF OLD."status" <> 'OPEN' THEN
        RAISE EXCEPTION 'Only open stock counts may be changed.'
            USING ERRCODE = '55000';
    END IF;

    status_transition_valid := NEW."status" IN ('OPEN', 'APPROVED', 'CANCELLED');
    IF NOT status_transition_valid THEN
        RAISE EXCEPTION 'Invalid stock count status transition.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockCount_guard_changes"
BEFORE UPDATE OR DELETE ON "StockCount"
FOR EACH ROW EXECUTE FUNCTION guard_stock_count_changes();

CREATE FUNCTION guard_stock_count_line_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_count_id UUID;
    parent_status "CountStatus";
BEGIN
    parent_count_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."countId" ELSE NEW."countId" END;
    SELECT "status" INTO parent_status
    FROM "StockCount"
    WHERE "id" = parent_count_id
    FOR UPDATE;

    IF NOT FOUND OR parent_status <> 'OPEN' THEN
        RAISE EXCEPTION 'Only lines of open stock counts may be changed or deleted.'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW."countId" IS DISTINCT FROM OLD."countId"
        OR NEW."productId" IS DISTINCT FROM OLD."productId"
        OR NEW."unit" IS DISTINCT FROM OLD."unit"
        OR NEW."snapshotQuantity" IS DISTINCT FROM OLD."snapshotQuantity"
    ) THEN
        RAISE EXCEPTION 'Count line identity and snapshot cannot be changed.'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockCountLine_guard_changes"
BEFORE INSERT OR UPDATE OR DELETE ON "StockCountLine"
FOR EACH ROW EXECUTE FUNCTION guard_stock_count_line_changes();

CREATE FUNCTION reject_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Stock movements are immutable; create a linked reversal instead.'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "StockMovement_immutable_update_delete"
BEFORE UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();

CREATE TRIGGER "StockMovement_immutable_truncate"
BEFORE TRUNCATE ON "StockMovement"
FOR EACH STATEMENT EXECUTE FUNCTION reject_stock_movement_mutation();

CREATE FUNCTION lock_and_check_stock_movement_warehouse()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1 FROM "Warehouse" WHERE "id" = NEW."warehouseId" FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock movement warehouse does not exist.'
            USING ERRCODE = '23503';
    END IF;

    IF NEW."countLineId" IS NULL AND EXISTS (
        SELECT 1 FROM "StockCount"
        WHERE "warehouseId" = NEW."warehouseId"
          AND "status" = 'OPEN'
    ) THEN
        RAISE EXCEPTION 'Stock movements are blocked while a warehouse count is open.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockMovement_lock_warehouse_and_count"
BEFORE INSERT ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION lock_and_check_stock_movement_warehouse();

CREATE FUNCTION validate_stock_movement_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    document_type "StockDocumentType";
    document_status "StockDocumentStatus";
    source_warehouse_id UUID;
    source_product_id UUID;
    source_quantity DECIMAL(18, 3);
    source_unit "Unit";
    transfer_status "TransferStatus";
    transfer_return_origin "TransferReturnOrigin";
    transfer_source_warehouse_id UUID;
    transfer_target_warehouse_id UUID;
    count_status "CountStatus";
    snapshot_quantity DECIMAL(18, 3);
    counted_quantity DECIMAL(18, 3);
    reversal_type "StockMovementType";
    reversal_direction "StockDirection";
BEGIN
    IF NEW."documentLineId" IS NOT NULL THEN
        SELECT d."type", d."status", d."warehouseId", l."productId", l."quantity", l."unit"
        INTO document_type, document_status, source_warehouse_id, source_product_id, source_quantity, source_unit
        FROM "StockDocumentLine" l
        JOIN "StockDocument" d ON d."id" = l."documentId"
        WHERE l."id" = NEW."documentLineId";

        IF NOT FOUND
            OR document_status <> 'APPROVED'
            OR source_product_id IS DISTINCT FROM NEW."productId"
            OR source_warehouse_id IS DISTINCT FROM NEW."warehouseId"
            OR source_quantity IS DISTINCT FROM NEW."quantity"
            OR source_unit IS DISTINCT FROM NEW."unit"
            OR (document_type = 'RECEIPT' AND (NEW."type" <> 'RECEIPT' OR NEW."direction" <> 'IN'))
            OR (document_type = 'ISSUE' AND (NEW."type" <> 'ISSUE' OR NEW."direction" <> 'OUT'))
        THEN
            RAISE EXCEPTION 'Stock movement does not match an approved document line.'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."transferLineId" IS NOT NULL THEN
        SELECT t."status", t."returnOrigin", t."sourceWarehouseId", t."targetWarehouseId",
               l."productId", l."quantity", l."unit"
        INTO transfer_status, transfer_return_origin, transfer_source_warehouse_id, transfer_target_warehouse_id,
             source_product_id, source_quantity, source_unit
        FROM "TransferLine" l
        JOIN "Transfer" t ON t."id" = l."transferId"
        WHERE l."id" = NEW."transferLineId";

        IF NOT FOUND
            OR source_product_id IS DISTINCT FROM NEW."productId"
            OR source_quantity IS DISTINCT FROM NEW."quantity"
            OR source_unit IS DISTINCT FROM NEW."unit"
            OR (NEW."transferPhase" = 'SHIPMENT' AND (
                transfer_status <> 'SHIPPED'
                OR NEW."warehouseId" IS DISTINCT FROM transfer_source_warehouse_id
            ))
            OR (NEW."transferPhase" = 'RECEIPT' AND (
                transfer_status <> 'RECEIVED'
                OR NEW."warehouseId" IS DISTINCT FROM transfer_target_warehouse_id
            ))
            OR (NEW."transferPhase" = 'RETURN_FROM_TRANSIT' AND (
                transfer_status <> 'RETURNED'
                OR transfer_return_origin <> 'SHIPPED'
                OR NEW."warehouseId" IS DISTINCT FROM transfer_source_warehouse_id
            ))
            OR (NEW."transferPhase" = 'RETURN_SHIPMENT' AND (
                transfer_status <> 'RETURNED'
                OR transfer_return_origin <> 'RECEIVED'
                OR NEW."warehouseId" IS DISTINCT FROM transfer_target_warehouse_id
            ))
            OR (NEW."transferPhase" = 'RETURN_RECEIPT' AND (
                transfer_status <> 'RETURNED'
                OR transfer_return_origin <> 'RECEIVED'
                OR NEW."warehouseId" IS DISTINCT FROM transfer_source_warehouse_id
            ))
        THEN
            RAISE EXCEPTION 'Stock movement does not match the transfer phase.'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."countLineId" IS NOT NULL THEN
        SELECT c."status", c."warehouseId", l."productId", l."snapshotQuantity",
               l."countedQuantity", l."unit"
        INTO count_status, source_warehouse_id, source_product_id, snapshot_quantity,
             counted_quantity, source_unit
        FROM "StockCountLine" l
        JOIN "StockCount" c ON c."id" = l."countId"
        WHERE l."id" = NEW."countLineId";

        IF NOT FOUND
            OR count_status <> 'APPROVED'
            OR source_warehouse_id IS DISTINCT FROM NEW."warehouseId"
            OR source_product_id IS DISTINCT FROM NEW."productId"
            OR source_unit IS DISTINCT FROM NEW."unit"
            OR counted_quantity IS NULL
            OR counted_quantity = snapshot_quantity
            OR NEW."quantity" IS DISTINCT FROM abs(counted_quantity - snapshot_quantity)
            OR (counted_quantity > snapshot_quantity AND NEW."direction" <> 'IN')
            OR (counted_quantity < snapshot_quantity AND NEW."direction" <> 'OUT')
        THEN
            RAISE EXCEPTION 'Stock movement does not match an approved count difference.'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT m."type", m."direction", m."productId", m."warehouseId", m."quantity", m."unit"
        INTO reversal_type, reversal_direction, source_product_id, source_warehouse_id, source_quantity, source_unit
        FROM "StockMovement" m
        WHERE m."id" = NEW."reversesMovementId";

        IF NOT FOUND
            OR reversal_type NOT IN ('RECEIPT', 'ISSUE')
            OR NEW."type" <> 'REVERSAL'
            OR source_product_id IS DISTINCT FROM NEW."productId"
            OR source_warehouse_id IS DISTINCT FROM NEW."warehouseId"
            OR source_quantity IS DISTINCT FROM NEW."quantity"
            OR source_unit IS DISTINCT FROM NEW."unit"
            OR (reversal_direction = 'IN' AND NEW."direction" <> 'OUT')
            OR (reversal_direction = 'OUT' AND NEW."direction" <> 'IN')
        THEN
            RAISE EXCEPTION 'Reversal must exactly reverse one receipt or issue movement.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockMovement_validate_source"
BEFORE INSERT ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION validate_stock_movement_source();

CREATE FUNCTION apply_stock_movement_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    quantity_delta DECIMAL(18, 3);
BEGIN
    quantity_delta := CASE
        WHEN NEW."direction" = 'IN' THEN NEW."quantity"
        ELSE -NEW."quantity"
    END;

    INSERT INTO "StockBalance" ("warehouseId", "productId", "quantity", "updatedAt")
    VALUES (NEW."warehouseId", NEW."productId", quantity_delta, CURRENT_TIMESTAMP)
    ON CONFLICT ("warehouseId", "productId")
    DO UPDATE SET
        "quantity" = "StockBalance"."quantity" + EXCLUDED."quantity",
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "StockBalance"."quantity" + EXCLUDED."quantity" >= 0;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock movement would create a negative balance.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "StockMovement_update_balance"
AFTER INSERT ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION apply_stock_movement_to_balance();
