-- Migración aditiva. Es seguro ejecutarla más de una vez.
-- Base de salida de cada institución (origen de las rutas de rescate).
ALTER TABLE institution_accounts
    ADD COLUMN IF NOT EXISTS base_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS base_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS base_direccion VARCHAR(200);
