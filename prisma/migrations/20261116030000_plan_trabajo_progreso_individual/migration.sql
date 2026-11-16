CREATE TABLE plan_trabajo_participacion (
  id UUID PRIMARY KEY,
  ocurrencia_id UUID NOT NULL REFERENCES plan_trabajo_ocurrencia(id) ON DELETE CASCADE,
  destinatario_tipo VARCHAR(15) NOT NULL,
  destinatario_id UUID NOT NULL,
  cuota INTEGER NOT NULL DEFAULT 1 CHECK (cuota BETWEEN 1 AND 31),
  form_assignment_id UUID REFERENCES form_assignments(id) ON DELETE SET NULL,
  completada_at TIMESTAMPTZ(6),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_participacion_persona_key UNIQUE (ocurrencia_id, destinatario_tipo, destinatario_id),
  CONSTRAINT plan_trabajo_participacion_tipo_check CHECK (destinatario_tipo IN ('ADMIN', 'CONDUCTOR'))
);
CREATE INDEX plan_trabajo_participacion_destinatario_idx
  ON plan_trabajo_participacion(destinatario_tipo, destinatario_id, activa);

INSERT INTO plan_trabajo_participacion
  (id, ocurrencia_id, destinatario_tipo, destinatario_id, completada_at)
SELECT gen_random_uuid(), a.ocurrencia_id, a.destinatario_tipo, a.destinatario_id,
  CASE WHEN o.estado = 'COMPLETADA' THEN o.completada_at ELSE NULL END
FROM plan_trabajo_asignacion a
JOIN plan_trabajo_ocurrencia o ON o.id = a.ocurrencia_id
GROUP BY a.ocurrencia_id, a.destinatario_tipo, a.destinatario_id, o.estado, o.completada_at
ON CONFLICT (ocurrencia_id, destinatario_tipo, destinatario_id) DO NOTHING;
