CREATE TABLE "mobile_app_activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "principal_kind" VARCHAR(20) NOT NULL,
    "principal_id" UUID NOT NULL,
    "platform" VARCHAR(20),
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessions_count" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "mobile_app_activity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_app_activity_principal_kind_principal_id_key"
    ON "mobile_app_activity"("principal_kind", "principal_id");
CREATE INDEX "mobile_app_activity_last_seen_at_idx" ON "mobile_app_activity"("last_seen_at");

-- Conserva los accesos móviles anteriores a esta versión. Un dispositivo push
-- prueba uso de la app del conductor, pero no cuántas veces la abrió.
INSERT INTO "mobile_app_activity" ("principal_kind", "principal_id", "platform", "first_seen_at", "last_seen_at", "sessions_count")
SELECT 'usuario', "usuario_id",
       (array_agg(CASE WHEN "user_agent" ILIKE '%Android%' THEN 'android' WHEN "user_agent" ILIKE '%iOS%' OR "user_agent" ILIKE '%iPhone%' THEN 'ios' ELSE NULL END ORDER BY "last_activity" DESC))[1],
       min("created_at"), max("last_activity"), count(*)::int
FROM "sesiones" WHERE "user_agent" LIKE 'App móvil%'
GROUP BY "usuario_id"
ON CONFLICT ("principal_kind", "principal_id") DO NOTHING;

INSERT INTO "mobile_app_activity" ("principal_kind", "principal_id", "platform", "first_seen_at", "last_seen_at", "sessions_count")
SELECT 'conductor', "conductor_id", (array_agg("plataforma" ORDER BY "last_seen_at" DESC))[1],
       min("created_at"), max("last_seen_at"), 1
FROM "conductor_push_device" GROUP BY "conductor_id"
ON CONFLICT ("principal_kind", "principal_id") DO NOTHING;
