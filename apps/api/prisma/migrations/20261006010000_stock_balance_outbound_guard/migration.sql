CREATE OR REPLACE FUNCTION apply_stock_movement_to_balance()
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

    IF quantity_delta < 0 THEN
        UPDATE "StockBalance"
        SET "quantity" = "quantity" + quantity_delta,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "warehouseId" = NEW."warehouseId"
          AND "productId" = NEW."productId"
          AND "quantity" + quantity_delta >= 0;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stock movement would create a negative balance.'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        INSERT INTO "StockBalance" ("warehouseId", "productId", "quantity", "updatedAt")
        VALUES (NEW."warehouseId", NEW."productId", quantity_delta, CURRENT_TIMESTAMP)
        ON CONFLICT ("warehouseId", "productId")
        DO UPDATE SET
            "quantity" = "StockBalance"."quantity" + EXCLUDED."quantity",
            "updatedAt" = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
END;
$$;
