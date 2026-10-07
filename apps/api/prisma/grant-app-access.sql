-- Run as the local migration owner after every migration.
-- The application role must not own this schema or any of its tables.

GRANT USAGE ON SCHEMA public TO stock_warehouse_app;
REVOKE CREATE ON SCHEMA public FROM stock_warehouse_app;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public TO stock_warehouse_app;
GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA public TO stock_warehouse_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON TABLE "StockBalance" FROM stock_warehouse_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON TABLE "_app_migration_guard", "_prisma_migrations"
    FROM stock_warehouse_app;
REVOKE UPDATE, DELETE, TRUNCATE
    ON TABLE "StockMovement" FROM stock_warehouse_app;
GRANT INSERT ON TABLE "StockMovement" TO stock_warehouse_app;
REVOKE UPDATE, DELETE, TRUNCATE
    ON TABLE "AuditEvent" FROM stock_warehouse_app;

ALTER DEFAULT PRIVILEGES FOR ROLE stock_warehouse_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stock_warehouse_app;
ALTER DEFAULT PRIVILEGES FOR ROLE stock_warehouse_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO stock_warehouse_app;
