CREATE OR REPLACE FUNCTION guard_transfer_changes()
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
            (OLD."status" = 'SHIPPED' AND NEW."status" IN ('RECEIVED', 'RETURNED'));
    END IF;

    IF NOT status_transition_valid THEN
        RAISE EXCEPTION 'Invalid transfer status transition.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE "Transfer"
    ADD CONSTRAINT "Transfer_return_only_from_shipped_check"
    CHECK ("status" <> 'RETURNED' OR "returnOrigin" = 'SHIPPED')
    NOT VALID;
