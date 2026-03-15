-- Migration: create documentos_compartidos table
CREATE TABLE IF NOT EXISTS documentos_compartidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token varchar(128) UNIQUE NOT NULL,
  filename varchar(255) NOT NULL,
  original_name varchar(255),
  s3_key varchar(512) NOT NULL,
  s3_url varchar(1024),
  expires_at timestamptz,
  signed boolean DEFAULT false,
  signature_s3_key varchar(512),
  signature_url varchar(1024),
  ip_address inet,
  user_agent varchar(1024),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_compartidos_expires ON documentos_compartidos (expires_at);
