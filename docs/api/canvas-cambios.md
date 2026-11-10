# Cambios de celdas de canvas

`GET /api/canvas-cambios?scope=&anio=&mes=&sheet_key=&limit=` devuelve los últimos cambios confirmados por socket. Requiere sesión vigente y permiso de lectura del módulo del canvas. `limit` se limita a 500. El resultado contiene actor, fecha, hoja, entidad, campo y valores anterior/nuevo.

La tabla `canvas_celda_cambio` se crea con la migración `20261108180000_canvas_celda_cambio`. Solo se inserta después de que el servicio confirma la escritura; conflictos y rechazos no generan eventos. El historial no bloquea una edición ya confirmada si la inserción falla. Los campos compuestos de nómina y bonos no tienen un valor SQL anterior directo y pueden registrar `null` como anterior; el diff del snapshot conserva el cambio de la hoja completa.

El socket de ingresos retransmite `incluir_adicional` sin persistirlo, por lo que ese mensaje no se registra como edición. Los guardados HTTP de ingresos y ocasional capturan snapshots atribuidos al usuario con diff del lote; no representan una edición individual por celda. Las capturas automáticas mantienen `usuario = null`.
