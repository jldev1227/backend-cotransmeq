CREATE TABLE IF NOT EXISTS "conductor_push_device" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conductor_id" UUID NOT NULL,
  "expo_push_token" VARCHAR(255) NOT NULL,
  "plataforma" VARCHAR(20) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conductor_push_device_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conductor_push_device_conductor_id_fkey"
    FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "conductor_push_device_expo_push_token_key"
  ON "conductor_push_device" ("expo_push_token");
CREATE INDEX IF NOT EXISTS "conductor_push_device_conductor_id_activo_idx"
  ON "conductor_push_device" ("conductor_id", "activo");

CREATE TABLE IF NOT EXISTS "conductor_notification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conductor_id" UUID NOT NULL,
  "liquidacion_id" UUID,
  "tipo" VARCHAR(50) NOT NULL,
  "titulo" VARCHAR(160) NOT NULL,
  "cuerpo" TEXT NOT NULL,
  "datos" JSONB NOT NULL DEFAULT '{}',
  "estado_push" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  "expo_ticket_id" VARCHAR(255),
  "error_push" TEXT,
  "leida_at" TIMESTAMPTZ(6),
  "enviada_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conductor_notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conductor_notification_conductor_id_fkey"
    FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "conductor_notification_liquidacion_id_fkey"
    FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "conductor_notification_conductor_id_created_at_idx"
  ON "conductor_notification" ("conductor_id", "created_at");
CREATE INDEX IF NOT EXISTS "conductor_notification_liquidacion_id_idx"
  ON "conductor_notification" ("liquidacion_id");
CREATE INDEX IF NOT EXISTS "conductor_notification_estado_push_idx"
  ON "conductor_notification" ("estado_push");
