\set ON_ERROR_STOP on

SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'stock_warehouse_migrator'
) AS create_migrator \gset
\if :create_migrator
CREATE ROLE stock_warehouse_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
\endif

SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'stock_warehouse_app'
) AS create_app \gset
\if :create_app
CREATE ROLE stock_warehouse_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
\endif

ALTER ROLE stock_warehouse_migrator
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE stock_warehouse_app
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
REVOKE stock_warehouse_migrator FROM stock_warehouse_app;

SELECT format(
    'CREATE DATABASE %I OWNER stock_warehouse_migrator',
    'stock_warehouse_local'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'stock_warehouse_local'
) \gexec

SELECT format(
    'CREATE DATABASE %I OWNER stock_warehouse_migrator',
    'stock_warehouse_test'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'stock_warehouse_test'
) \gexec

GRANT CONNECT ON DATABASE stock_warehouse_local TO stock_warehouse_app;
GRANT CONNECT ON DATABASE stock_warehouse_test TO stock_warehouse_app;

\connect stock_warehouse_local
\set project_marker false
SELECT to_regclass('public."_app_migration_guard"') IS NOT NULL AS marker_exists \gset
\if :marker_exists
SELECT EXISTS (
    SELECT 1 FROM public."_app_migration_guard"
    WHERE "projectKey" = 'local-stock-warehouse'
) AS project_marker \gset
\endif
SELECT (
    pg_catalog.pg_get_userbyid(database_row.datdba) = 'stock_warehouse_migrator'
    AND (
        NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS relation
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE relation.relkind IN ('r', 'p', 'f', 'm', 'v', 'S')
              AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
              AND namespace.nspname NOT LIKE 'pg_toast%'
              AND namespace.nspname NOT LIKE 'pg_temp_%'
        )
        OR :project_marker::boolean
    )
) AS safe_local_database
FROM pg_catalog.pg_database AS database_row
WHERE database_row.datname = current_database() \gset
\if :safe_local_database
GRANT CREATE ON SCHEMA public TO stock_warehouse_migrator;
REVOKE CREATE ON SCHEMA public FROM stock_warehouse_app;
\else
\echo 'Refusing to change a non-empty or differently owned development database.'
\quit 3
\endif

\connect stock_warehouse_test
\set project_marker false
SELECT to_regclass('public."_app_migration_guard"') IS NOT NULL AS marker_exists \gset
\if :marker_exists
SELECT EXISTS (
    SELECT 1 FROM public."_app_migration_guard"
    WHERE "projectKey" = 'local-stock-warehouse'
) AS project_marker \gset
\endif
SELECT (
    pg_catalog.pg_get_userbyid(database_row.datdba) = 'stock_warehouse_migrator'
    AND (
        NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS relation
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE relation.relkind IN ('r', 'p', 'f', 'm', 'v', 'S')
              AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
              AND namespace.nspname NOT LIKE 'pg_toast%'
              AND namespace.nspname NOT LIKE 'pg_temp_%'
        )
        OR :project_marker::boolean
    )
) AS safe_test_database
FROM pg_catalog.pg_database AS database_row
WHERE database_row.datname = current_database() \gset
\if :safe_test_database
GRANT CREATE ON SCHEMA public TO stock_warehouse_migrator;
REVOKE CREATE ON SCHEMA public FROM stock_warehouse_app;
\else
\echo 'Refusing to change a non-empty or differently owned test database.'
\quit 3
\endif

\echo 'Local roles and dedicated database targets are ready. Passwords were not displayed.'
