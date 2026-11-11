-- Migración aditiva. Es seguro ejecutarla más de una vez.
CREATE TABLE IF NOT EXISTS zonas_bloqueadas (
    id SERIAL PRIMARY KEY,
    latitud DOUBLE PRECISION NOT NULL,
    longitud DOUBLE PRECISION NOT NULL,
    radio_m DOUBLE PRECISION NOT NULL DEFAULT 100,
    motivo VARCHAR(30) NOT NULL,
    nota VARCHAR(200),
    creada_por VARCHAR(120) NOT NULL,
    institucion VARCHAR(120),
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    expira_en TIMESTAMP NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    levantada_por VARCHAR(120),
    levantada_en TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_zonas_bloqueadas_expira_en ON zonas_bloqueadas (expira_en);
CREATE INDEX IF NOT EXISTS ix_zonas_bloqueadas_activa ON zonas_bloqueadas (activa);
