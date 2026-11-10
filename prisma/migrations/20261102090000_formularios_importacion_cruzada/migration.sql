CREATE TABLE "form_import_batches" (
    "id" UUID NOT NULL,
    "source_company" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    "requested_by_id" UUID NOT NULL,
    "selected_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "summary_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_import_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_form_import_batches_source"
        CHECK ("source_company" IN ('TRANSMERALDA', 'COTRANSMEQ')),
    CONSTRAINT "ck_form_import_batches_status"
        CHECK ("status" IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
    CONSTRAINT "ck_form_import_batches_counts"
        CHECK (
            "selected_count" >= 0
            AND "imported_count" >= 0
            AND "skipped_count" >= 0
            AND "failed_count" >= 0
        ),
    CONSTRAINT "form_import_batches_requested_by_id_fkey"
        FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "idx_form_import_batches_source_created"
ON "form_import_batches"("source_company", "created_at" DESC);

CREATE TABLE "form_submission_imports" (
    "id" UUID NOT NULL,
    "source_company" VARCHAR(20) NOT NULL,
    "source_submission_id" UUID NOT NULL,
    "source_form_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "source_assignment_id" UUID NOT NULL,
    "destination_submission_id" UUID,
    "source_fingerprint" VARCHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(50),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_submission_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_form_submission_imports_source"
        UNIQUE ("source_company", "source_submission_id"),
    CONSTRAINT "uq_form_submission_imports_destination"
        UNIQUE ("destination_submission_id"),
    CONSTRAINT "ck_form_submission_imports_source"
        CHECK ("source_company" IN ('TRANSMERALDA', 'COTRANSMEQ')),
    CONSTRAINT "ck_form_submission_imports_status"
        CHECK ("status" IN ('PENDING', 'IMPORTED', 'FAILED')),
    CONSTRAINT "ck_form_submission_imports_attempts"
        CHECK ("attempt_count" >= 0),
    CONSTRAINT "form_submission_imports_destination_submission_id_fkey"
        FOREIGN KEY ("destination_submission_id") REFERENCES "form_submissions"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "idx_form_submission_imports_version"
ON "form_submission_imports"("source_company", "source_version_id");

CREATE TABLE "form_import_batch_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "form_submission_import_id" UUID,
    "source_submission_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "source_fingerprint" VARCHAR(64),
    "error_code" VARCHAR(50),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_import_batch_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_form_import_batch_items_source"
        UNIQUE ("batch_id", "source_submission_id"),
    CONSTRAINT "ck_form_import_batch_items_status"
        CHECK ("status" IN ('PENDING', 'IMPORTED', 'ALREADY_IMPORTED', 'SKIPPED', 'FAILED')),
    CONSTRAINT "form_import_batch_items_batch_id_fkey"
        FOREIGN KEY ("batch_id") REFERENCES "form_import_batches"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "form_import_batch_items_form_submission_import_id_fkey"
        FOREIGN KEY ("form_submission_import_id") REFERENCES "form_submission_imports"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "idx_form_import_batch_items_status"
ON "form_import_batch_items"("batch_id", "status");
