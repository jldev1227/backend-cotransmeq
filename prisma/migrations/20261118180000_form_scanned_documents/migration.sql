CREATE TABLE "form_scanned_documents" (
  "id" UUID PRIMARY KEY,
  "assignment_id" UUID NOT NULL REFERENCES "form_assignments"("id"),
  "version_id" UUID NOT NULL REFERENCES "form_versions"("id"),
  "conductor_id" UUID NOT NULL REFERENCES "conductores"("id"),
  "vehicle_id" UUID NOT NULL REFERENCES "vehiculos"("id"),
  "created_by_id" UUID NOT NULL REFERENCES "users"("id"),
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "explanation" TEXT NOT NULL,
  "details_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "object_key" VARCHAR(1024) NOT NULL UNIQUE,
  "original_name" VARCHAR(255) NOT NULL,
  "byte_size" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "uploaded_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "ck_form_scanned_documents_dates" CHECK ("date_to" >= "date_from"),
  CONSTRAINT "ck_form_scanned_documents_status" CHECK ("status" IN ('PENDING','UPLOADED'))
);
CREATE INDEX "form_scanned_documents_assignment_id_date_from_date_to_idx" ON "form_scanned_documents"("assignment_id", "date_from", "date_to");
CREATE INDEX "form_scanned_documents_conductor_id_date_from_idx" ON "form_scanned_documents"("conductor_id", "date_from");
CREATE INDEX "form_scanned_documents_vehicle_id_date_from_idx" ON "form_scanned_documents"("vehicle_id", "date_from");
