ALTER TABLE institution_accounts
    DROP COLUMN IF EXISTS base_lat,
    DROP COLUMN IF EXISTS base_lng,
    DROP COLUMN IF EXISTS base_direccion;
