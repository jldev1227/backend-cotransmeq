-- Suscripciones Web Push del dashboard: un navegador por fila.
CREATE TABLE IF NOT EXISTS "usuario_web_push" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "user_agent" VARCHAR(500),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "usuario_web_push_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usuario_web_push_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "usuario_web_push_endpoint_key" ON "usuario_web_push"("endpoint");
CREATE INDEX IF NOT EXISTS "usuario_web_push_usuario_id_activo_idx" ON "usuario_web_push"("usuario_id", "activo");
