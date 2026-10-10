-- Cierres finales de terceros: FACTURADA pasa a llamarse PAGADA.
--
-- Con terceros quien factura es el propietario; la empresa le PAGA. El
-- estado «Marcar facturada» ya se usaba con el sentido de «ya se le pagó».
-- El código sigue leyendo FACTURADA como estado heredado (bloqueado, solo
-- se puede anular), así que esta migración puede correr antes o después
-- del despliegue sin romper nada.
--
-- El historial NO se reescribe: registra lo que pasó en su momento.
UPDATE liquidacion_tercero_final
SET estado = 'PAGADA'
WHERE estado = 'FACTURADA';
