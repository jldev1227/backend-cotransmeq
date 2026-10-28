# Inventario de rutas

> Archivo generado por `npm run docs:inventario` (`scripts/docs/inventario-rutas.ts`).
> No lo edites a mano: regenéralo cuando cambien las rutas.

786 rutas en 64 módulos, más `GET /` (salud) y las que
registran los plugins (`OPTIONS *` de CORS y `GET /assets/*`). Cada módulo
enlaza su referencia; ahí están la guarda, los parámetros y las respuestas.

| Módulo | Rutas |
|---|--:|
| [`acciones-correctivas`](./acciones-correctivas.md) | 26 |
| [`actividad`](./actividad.md) | 2 |
| [`analitica-individual`](./analitica-individual.md) | 1 |
| [`app-usuarios`](./app-usuarios.md) | 6 |
| [`asistencias`](./asistencias.md) | 16 |
| [`asistente`](./asistente.md) | 2 |
| [`auth`](./auth.md) | 11 |
| [`canvas-anotaciones`](./canvas-anotaciones.md) | 1 |
| [`cartera`](./cartera.md) | 7 |
| [`certificados-tributarios`](./certificados-tributarios.md) | 22 |
| [`clientes`](./clientes.md) | 15 |
| [`combustible`](./combustible.md) | 11 |
| [`conductor-portal`](./conductor-portal.md) | 42 |
| [`conductores`](./conductores.md) | 16 |
| [`conductores-documentos`](./conductores-documentos.md) | 6 |
| [`contabilidad`](./contabilidad.md) | 2 |
| [`custom-places`](./custom-places.md) | 5 |
| [`dashboard`](./dashboard.md) | 5 |
| [`dias-laborados`](./dias-laborados.md) | 19 |
| [`documentos`](./documentos.md) | 5 |
| [`encuestas`](./encuestas.md) | 14 |
| [`evaluaciones`](./evaluaciones.md) | 14 |
| [`extractos`](./extractos.md) | 14 |
| [`facturacion-liquidaciones`](./facturacion-liquidaciones.md) | 11 |
| [`formularios-dinamicos`](./formularios-dinamicos.md) | 62 |
| [`formularios-sarlaft`](./formularios-sarlaft.md) | 13 |
| [`incidentes`](./incidentes.md) | 17 |
| [`inducciones`](./inducciones.md) | 8 |
| [`invitaciones`](./invitaciones.md) | 5 |
| [`liquidaciones`](./liquidaciones.md) | 27 |
| [`liquidaciones-chat`](./liquidaciones-chat.md) | 7 |
| [`liquidaciones-servicios`](./liquidaciones-servicios.md) | 27 |
| [`liquidaciones-terceros`](./liquidaciones-terceros.md) | 4 |
| [`liquidaciones-terceros-adicionales`](./liquidaciones-terceros-adicionales.md) | 6 |
| [`liquidaciones-terceros-adicionales-snapshots`](./liquidaciones-terceros-adicionales-snapshots.md) | 5 |
| [`liquidaciones-terceros-descuentos`](./liquidaciones-terceros-descuentos.md) | 42 |
| [`liquidaciones-terceros-envios`](./liquidaciones-terceros-envios.md) | 6 |
| [`liquidaciones-terceros-ingresos`](./liquidaciones-terceros-ingresos.md) | 4 |
| [`liquidaciones-terceros-ocasional`](./liquidaciones-terceros-ocasional.md) | 19 |
| [`liquidaciones-terceros-ocasional-snapshots`](./liquidaciones-terceros-ocasional-snapshots.md) | 6 |
| [`liquidaciones-terceros-pagos`](./liquidaciones-terceros-pagos.md) | 5 |
| [`liquidaciones-terceros-pdf`](./liquidaciones-terceros-pdf.md) | 3 |
| [`liquidaciones-terceros-snapshots`](./liquidaciones-terceros-snapshots.md) | 5 |
| [`mantenimiento`](./mantenimiento.md) | 18 |
| [`maps`](./maps.md) | 2 |
| [`mcp`](./mcp.md) | 13 |
| [`mis-capacitaciones`](./mis-capacitaciones.md) | 5 |
| [`municipios`](./municipios.md) | 4 |
| [`nomina-canvas`](./nomina-canvas.md) | 29 |
| [`notificaciones`](./notificaciones.md) | 8 |
| [`operadoras`](./operadoras.md) | 4 |
| [`pdf`](./pdf.md) | 1 |
| [`primas`](./primas.md) | 8 |
| [`recargos`](./recargos.md) | 34 |
| [`recorridos-canvas`](./recorridos-canvas.md) | 11 |
| [`salidas-nc`](./salidas-nc.md) | 8 |
| [`servicios`](./servicios.md) | 19 |
| [`sesiones`](./sesiones.md) | 6 |
| [`solicitudes-web`](./solicitudes-web.md) | 5 |
| [`terceros`](./terceros.md) | 7 |
| [`usuarios`](./usuarios.md) | 13 |
| [`vehiculos`](./vehiculos.md) | 11 |
| [`vehiculos-documentos`](./vehiculos-documentos.md) | 6 |
| [`viaticos`](./viaticos.md) | 30 |

## acciones-correctivas

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/acciones-correctivas` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:121` |
| POST | `/api/acciones-correctivas` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:24` |
| DELETE | `/api/acciones-correctivas/:id` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:234` |
| GET | `/api/acciones-correctivas/:id` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:166` |
| PUT | `/api/acciones-correctivas/:id` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:204` |
| GET | `/api/acciones-correctivas/:id/aprobaciones` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:558` |
| POST | `/api/acciones-correctivas/:id/aprobaciones/aprobar` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:575` |
| POST | `/api/acciones-correctivas/:id/aprobaciones/rechazar` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:597` |
| POST | `/api/acciones-correctivas/:id/aprobaciones/reset` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:620` |
| POST | `/api/acciones-correctivas/:id/calcular-estado` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:642` |
| POST | `/api/acciones-correctivas/:id/causas` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:294` |
| PUT | `/api/acciones-correctivas/:id/causas/:causaId` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:330` |
| GET | `/api/acciones-correctivas/:id/causas/:causaId/seguimientos` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:365` |
| POST | `/api/acciones-correctivas/:id/causas/:causaId/seguimientos` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:385` |
| POST | `/api/acciones-correctivas/:id/duplicar` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:86` |
| POST | `/api/acciones-correctivas/:id/estado-global` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:660` |
| GET | `/api/acciones-correctivas/:id/exportar-pdf` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:419` |
| DELETE | `/api/acciones-correctivas/:id/permanente` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:274` |
| POST | `/api/acciones-correctivas/:id/restaurar` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:254` |
| GET | `/api/acciones-correctivas/:id/validar-cierre` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:502` |
| POST | `/api/acciones-correctivas/causas/:causa_id/cierre` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:464` |
| POST | `/api/acciones-correctivas/causas/:causa_id/sugerencias-seguimiento` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:521` |
| GET | `/api/acciones-correctivas/estadisticas` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:154` |
| GET | `/api/acciones-correctivas/numero/:accion_numero` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:185` |
| POST | `/api/acciones-correctivas/sugerencias-ia` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:438` |
| POST | `/api/acciones-correctivas/upload` | `src/modules/acciones-correctivas/acciones-correctivas.routes.ts:106` |

## actividad

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/actividad` | `src/modules/actividad/actividad.routes.ts:47` |
| GET | `/api/actividad/opciones` | `src/modules/actividad/actividad.routes.ts:105` |

## analitica-individual

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/analitica-individual/:tipo/:id` | `src/modules/analitica-individual/analitica-individual.routes.ts:18` |

## app-usuarios

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/app-usuarios/canjear` | `src/modules/app-usuarios/app-usuarios.routes.ts:89` |
| DELETE | `/api/app-usuarios/dispositivos-push` | `src/modules/app-usuarios/app-usuarios.routes.ts:122` |
| POST | `/api/app-usuarios/dispositivos-push` | `src/modules/app-usuarios/app-usuarios.routes.ts:109` |
| DELETE | `/api/app-usuarios/enlace` | `src/modules/app-usuarios/app-usuarios.routes.ts:75` |
| GET | `/api/app-usuarios/enlace` | `src/modules/app-usuarios/app-usuarios.routes.ts:48` |
| POST | `/api/app-usuarios/enlace` | `src/modules/app-usuarios/app-usuarios.routes.ts:64` |

## asistencias

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/asistencias/formularios` | `src/modules/asistencias/asistencias.routes.ts:60` |
| POST | `/api/asistencias/formularios` | `src/modules/asistencias/asistencias.routes.ts:23` |
| DELETE | `/api/asistencias/formularios/:id` | `src/modules/asistencias/asistencias.routes.ts:148` |
| GET | `/api/asistencias/formularios/:id` | `src/modules/asistencias/asistencias.routes.ts:93` |
| PUT | `/api/asistencias/formularios/:id` | `src/modules/asistencias/asistencias.routes.ts:120` |
| GET | `/api/asistencias/formularios/:id/exportar` | `src/modules/asistencias/asistencias.routes.ts:248` |
| GET | `/api/asistencias/formularios/:id/exportar-pdf` | `src/modules/asistencias/asistencias.routes.ts:263` |
| GET | `/api/asistencias/formularios/:id/respuestas` | `src/modules/asistencias/asistencias.routes.ts:224` |
| PATCH | `/api/asistencias/formularios/estado` | `src/modules/asistencias/asistencias.routes.ts:172` |
| POST | `/api/asistencias/formularios/exportar-seleccionados-pdf` | `src/modules/asistencias/asistencias.routes.ts:315` |
| GET | `/api/asistencias/formularios/exportar-todas-pdf` | `src/modules/asistencias/asistencias.routes.ts:296` |
| GET | `/api/asistencias/formularios/ids` | `src/modules/asistencias/asistencias.routes.ts:279` |
| DELETE | `/api/asistencias/respuestas` | `src/modules/asistencias/asistencias.routes.ts:199` |
| GET | `/api/public/asistencias/:token` | `src/modules/asistencias/asistencias.routes.ts:336` |
| POST | `/api/public/asistencias/:token/responder` | `src/modules/asistencias/asistencias.routes.ts:417` |
| GET | `/api/public/asistencias/:token/verificar` | `src/modules/asistencias/asistencias.routes.ts:377` |

## asistente

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/asistente/chat` | `src/modules/asistente/asistente.routes.ts:42` |
| GET | `/api/asistente/estado` | `src/modules/asistente/asistente.routes.ts:40` |

## auth

| Método | Ruta | Declarada en |
|---|---|---|
| PUT | `/api/auth/change-password` | `src/modules/auth/auth.routes.ts:15` |
| POST | `/api/auth/login` | `src/modules/auth/auth.routes.ts:12` |
| POST | `/api/auth/logout` | `src/modules/auth/auth.routes.ts:13` |
| DELETE | `/api/auth/my-firma` | `src/modules/auth/auth.routes.ts:20` |
| GET | `/api/auth/my-firma` | `src/modules/auth/auth.routes.ts:18` |
| POST | `/api/auth/my-firma` | `src/modules/auth/auth.routes.ts:19` |
| GET | `/api/auth/my-session` | `src/modules/auth/auth.routes.ts:17` |
| GET | `/api/auth/profile` | `src/modules/auth/auth.routes.ts:14` |
| POST | `/api/auth/recuperacion/aplicar` | `src/modules/auth/auth.routes.ts:26` |
| POST | `/api/auth/recuperacion/lookup` | `src/modules/auth/auth.routes.ts:25` |
| PUT | `/api/auth/update-profile` | `src/modules/auth/auth.routes.ts:16` |

## canvas-anotaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/canvas-anotaciones` | `src/modules/canvas-anotaciones/canvas-anotaciones.routes.ts:15` |

## cartera

| Método | Ruta | Declarada en |
|---|---|---|
| DELETE | `/api/cartera/abonos/:abonoId` | `src/modules/cartera/cartera.routes.ts:169` |
| GET | `/api/cartera/abonos/:abonoId/comprobante` | `src/modules/cartera/cartera.routes.ts:180` |
| GET | `/api/cartera/facturas` | `src/modules/cartera/cartera.routes.ts:117` |
| GET | `/api/cartera/facturas/:id` | `src/modules/cartera/cartera.routes.ts:126` |
| POST | `/api/cartera/facturas/:id/abonos` | `src/modules/cartera/cartera.routes.ts:150` |
| PATCH | `/api/cartera/facturas/:id/condiciones` | `src/modules/cartera/cartera.routes.ts:134` |
| GET | `/api/cartera/resumen` | `src/modules/cartera/cartera.routes.ts:109` |

## certificados-tributarios

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/certificados-tributarios/:nit` | `src/modules/certificados-tributarios/certificados.routes.ts:228` |
| DELETE | `/api/certificados-tributarios/archivo/:id` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:108` |
| GET | `/api/certificados-tributarios/archivos` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:13` |
| POST | `/api/certificados-tributarios/enviar-email` | `src/modules/certificados-tributarios/certificacion-envio.controller.ts:14` |
| POST | `/api/certificados-tributarios/enviar-masivo` | `src/modules/certificados-tributarios/certificacion-envio.controller.ts:31` |
| GET | `/api/certificados-tributarios/envios` | `src/modules/certificados-tributarios/certificacion-envio.controller.ts:105` |
| GET | `/api/certificados-tributarios/envios/tercero/:terceroId` | `src/modules/certificados-tributarios/certificacion-envio.controller.ts:119` |
| POST | `/api/certificados-tributarios/import-zip` | `src/modules/certificados-tributarios/certificados.routes.ts:116` |
| POST | `/api/certificados-tributarios/link` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:97` |
| GET | `/api/certificados-tributarios/list` | `src/modules/certificados-tributarios/certificados.routes.ts:195` |
| GET | `/api/certificados-tributarios/nits` | `src/modules/certificados-tributarios/certificados.routes.ts:175` |
| GET | `/api/certificados-tributarios/por-nit/:nit` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:28` |
| POST | `/api/certificados-tributarios/sync-s3` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:87` |
| GET | `/api/certificados-tributarios/tercero/:terceroId` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:39` |
| GET | `/api/certificados-tributarios/terceros-con-certificados` | `src/modules/certificados-tributarios/certificado-archivo.controller.ts:69` |
| POST | `/api/certificados-tributarios/upload` | `src/modules/certificados-tributarios/certificados.routes.ts:32` |
| POST | `/api/public/certificados-tercero/solicitar-acceso` | `src/modules/certificados-tributarios/certificados-tercero-public.routes.ts:46` |
| GET | `/api/public/certificados-tercero/verificar-token` | `src/modules/certificados-tributarios/certificados-tercero-public.routes.ts:12` |
| GET | `/api/tipos-certificado` | `src/modules/certificados-tributarios/tipo-certificado.controller.ts:12` |
| POST | `/api/tipos-certificado` | `src/modules/certificados-tributarios/tipo-certificado.controller.ts:22` |
| DELETE | `/api/tipos-certificado/:id` | `src/modules/certificados-tributarios/tipo-certificado.controller.ts:54` |
| PUT | `/api/tipos-certificado/:id` | `src/modules/certificados-tributarios/tipo-certificado.controller.ts:37` |

## clientes

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/clientes` | `src/modules/clientes/clientes.routes.ts:81` |
| POST | `/api/clientes` | `src/modules/clientes/clientes.routes.ts:152` |
| DELETE | `/api/clientes/:id` | `src/modules/clientes/clientes.routes.ts:224` |
| GET | `/api/clientes/:id` | `src/modules/clientes/clientes.routes.ts:180` |
| PUT | `/api/clientes/:id` | `src/modules/clientes/clientes.routes.ts:194` |
| PATCH | `/api/clientes/:id/ocultar` | `src/modules/clientes/clientes.routes.ts:283` |
| DELETE | `/api/clientes/:id/permanente` | `src/modules/clientes/clientes.routes.ts:239` |
| POST | `/api/clientes/:id/restore` | `src/modules/clientes/clientes.routes.ts:253` |
| GET | `/api/clientes/:id/stats` | `src/modules/clientes/clientes.routes.ts:268` |
| GET | `/api/clientes/buscar` | `src/modules/clientes/clientes.routes.ts:62` |
| POST | `/api/clientes/masivo` | `src/modules/clientes/clientes.routes.ts:329` |
| GET | `/api/clientes/ocultos` | `src/modules/clientes/clientes.routes.ts:106` |
| GET | `/api/clientes/papelera` | `src/modules/clientes/clientes.routes.ts:104` |
| GET | `/api/empresas` | `src/modules/clientes/clientes.routes.ts:45` |
| GET | `/api/empresas/basicos` | `src/modules/clientes/clientes.routes.ts:27` |

## combustible

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/combustible/catalogos` | `src/modules/combustible/combustible.routes.ts:50` |
| GET | `/api/combustible/rendimiento` | `src/modules/combustible/combustible.routes.ts:80` |
| GET | `/api/combustible/tanqueos` | `src/modules/combustible/combustible.routes.ts:58` |
| POST | `/api/combustible/tanqueos` | `src/modules/combustible/combustible.routes.ts:97` |
| DELETE | `/api/combustible/tanqueos/:id` | `src/modules/combustible/combustible.routes.ts:115` |
| PUT | `/api/combustible/tanqueos/:id` | `src/modules/combustible/combustible.routes.ts:106` |
| DELETE | `/api/combustible/tanqueos/:id/comprobante` | `src/modules/combustible/combustible.routes.ts:145` |
| POST | `/api/combustible/tanqueos/:id/comprobante` | `src/modules/combustible/combustible.routes.ts:127` |
| GET | `/api/combustible/tanqueos/:id/comprobante/url` | `src/modules/combustible/combustible.routes.ts:153` |
| GET | `/api/combustible/tanqueos/exportar` | `src/modules/combustible/combustible.routes.ts:66` |
| GET | `/api/combustible/vehiculos/:id/contexto` | `src/modules/combustible/combustible.routes.ts:88` |

## conductor-portal

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/conductor-portal/acceso-revision` | `src/modules/conductor-portal/conductor-portal.routes.ts:202` |
| GET | `/api/conductor-portal/asistencias/:token` | `src/modules/conductor-portal/conductor-portal.routes.ts:2377` |
| POST | `/api/conductor-portal/asistencias/:token` | `src/modules/conductor-portal/conductor-portal.routes.ts:2393` |
| GET | `/api/conductor-portal/capacitaciones` | `src/modules/conductor-portal/conductor-portal.routes.ts:2362` |
| GET | `/api/conductor-portal/desprendibles` | `src/modules/conductor-portal/conductor-portal.routes.ts:467` |
| GET | `/api/conductor-portal/desprendibles/:id` | `src/modules/conductor-portal/conductor-portal.routes.ts:861` |
| GET | `/api/conductor-portal/desprendibles/:id/datos` | `src/modules/conductor-portal/conductor-portal.routes.ts:618` |
| POST | `/api/conductor-portal/desprendibles/:id/firmar` | `src/modules/conductor-portal/conductor-portal.routes.ts:1021` |
| GET | `/api/conductor-portal/desprendibles/:id/pdf` | `src/modules/conductor-portal/conductor-portal.routes.ts:666` |
| GET | `/api/conductor-portal/dias-laborados/clientes` | `src/modules/conductor-portal/conductor-portal.routes.ts:1988` |
| GET | `/api/conductor-portal/dias-laborados/registros` | `src/modules/conductor-portal/conductor-portal.routes.ts:1648` |
| POST | `/api/conductor-portal/dias-laborados/registros` | `src/modules/conductor-portal/conductor-portal.routes.ts:1728` |
| DELETE | `/api/conductor-portal/dias-laborados/registros/:fecha` | `src/modules/conductor-portal/conductor-portal.routes.ts:1841` |
| DELETE | `/api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/:id` | `src/modules/conductor-portal/conductor-portal.routes.ts:1971` |
| POST | `/api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/:id/complete` | `src/modules/conductor-portal/conductor-portal.routes.ts:1950` |
| POST | `/api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/init` | `src/modules/conductor-portal/conductor-portal.routes.ts:1934` |
| GET | `/api/conductor-portal/dias-laborados/vehiculos` | `src/modules/conductor-portal/conductor-portal.routes.ts:2003` |
| DELETE | `/api/conductor-portal/dispositivos-push` | `src/modules/conductor-portal/conductor-portal.routes.ts:456` |
| POST | `/api/conductor-portal/dispositivos-push` | `src/modules/conductor-portal/conductor-portal.routes.ts:425` |
| GET | `/api/conductor-portal/evaluaciones/:id` | `src/modules/conductor-portal/conductor-portal.routes.ts:2414` |
| POST | `/api/conductor-portal/evaluaciones/:id` | `src/modules/conductor-portal/conductor-portal.routes.ts:2430` |
| GET | `/api/conductor-portal/extractos` | `src/modules/conductor-portal/extractos-portal.routes.ts:42` |
| GET | `/api/conductor-portal/extractos/:id` | `src/modules/conductor-portal/extractos-portal.routes.ts:50` |
| GET | `/api/conductor-portal/extractos/:id/pdf` | `src/modules/conductor-portal/extractos-portal.routes.ts:61` |
| GET | `/api/conductor-portal/notificaciones` | `src/modules/conductor-portal/conductor-portal.routes.ts:2026` |
| POST | `/api/conductor-portal/notificaciones/:id/leida` | `src/modules/conductor-portal/conductor-portal.routes.ts:2074` |
| GET | `/api/conductor-portal/prima/:id` | `src/modules/conductor-portal/conductor-portal.routes.ts:749` |
| GET | `/api/conductor-portal/primas` | `src/modules/conductor-portal/conductor-portal.routes.ts:1216` |
| GET | `/api/conductor-portal/primas/:id/enriquecida` | `src/modules/conductor-portal/conductor-portal.routes.ts:1412` |
| GET | `/api/conductor-portal/primas/:id/firma` | `src/modules/conductor-portal/conductor-portal.routes.ts:1549` |
| POST | `/api/conductor-portal/primas/:id/firmar` | `src/modules/conductor-portal/conductor-portal.routes.ts:1286` |
| GET | `/api/conductor-portal/servicios` | `src/modules/conductor-portal/conductor-portal.routes.ts:2097` |
| GET | `/api/conductor-portal/servicios/:id` | `src/modules/conductor-portal/conductor-portal.routes.ts:2206` |
| GET | `/api/conductor-portal/servicios/:id/ejecucion` | `src/modules/conductor-portal/conductor-portal.routes.ts:2469` |
| POST | `/api/conductor-portal/servicios/:id/iniciar` | `src/modules/conductor-portal/conductor-portal.routes.ts:2485` |
| POST | `/api/conductor-portal/servicios/:id/liberar` | `src/modules/conductor-portal/conductor-portal.routes.ts:2501` |
| POST | `/api/conductor-portal/servicios/:id/recomendaciones` | `src/modules/conductor-portal/conductor-portal.routes.ts:2517` |
| GET | `/api/conductor-portal/servicios/:id/via` | `src/modules/conductor-portal/conductor-portal.routes.ts:2317` |
| POST | `/api/conductor-portal/solicitar-acceso` | `src/modules/conductor-portal/conductor-portal.routes.ts:275` |
| GET | `/api/conductor-portal/vehiculos/:vehiculoId/documentos/:documentoId/url` | `src/modules/conductor-portal/extractos-portal.routes.ts:82` |
| GET | `/api/conductor-portal/vehiculos/documentos` | `src/modules/conductor-portal/extractos-portal.routes.ts:74` |
| GET | `/api/conductor-portal/verificar-token` | `src/modules/conductor-portal/conductor-portal.routes.ts:356` |

## conductores

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/conductores` | `src/modules/conductores/conductores.routes.ts:41` |
| POST | `/api/conductores` | `src/modules/conductores/conductores.routes.ts:47` |
| DELETE | `/api/conductores/:id` | `src/modules/conductores/conductores.routes.ts:68` |
| GET | `/api/conductores/:id` | `src/modules/conductores/conductores.routes.ts:44` |
| PUT | `/api/conductores/:id` | `src/modules/conductores/conductores.routes.ts:50` |
| PATCH | `/api/conductores/:id/estado` | `src/modules/conductores/conductores.routes.ts:53` |
| DELETE | `/api/conductores/:id/foto` | `src/modules/conductores/conductores.routes.ts:77` |
| POST | `/api/conductores/:id/foto` | `src/modules/conductores/conductores.routes.ts:71` |
| PATCH | `/api/conductores/:id/ocultar` | `src/modules/conductores/conductores.routes.ts:56` |
| DELETE | `/api/conductores/:id/permanente` | `src/modules/conductores/conductores.routes.ts:62` |
| GET | `/api/conductores/:id/relaciones` | `src/modules/conductores/conductores.routes.ts:65` |
| PATCH | `/api/conductores/:id/restaurar` | `src/modules/conductores/conductores.routes.ts:59` |
| POST | `/api/conductores/masivo` | `src/modules/conductores/conductores.routes.ts:32` |
| GET | `/api/conductores/ocultos` | `src/modules/conductores/conductores.routes.ts:26` |
| GET | `/api/conductores/papelera` | `src/modules/conductores/conductores.routes.ts:29` |
| GET | `/api/conductores/select-list` | `src/modules/conductores/conductores.routes.ts:38` |

## conductores-documentos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/conductores/:id/documentos` | `src/modules/conductores-documentos/conductores-documentos.routes.ts:74` |
| POST | `/api/conductores/:id/documentos` | `src/modules/conductores-documentos/conductores-documentos.routes.ts:85` |
| DELETE | `/api/conductores/:id/documentos/:docId` | `src/modules/conductores-documentos/conductores-documentos.routes.ts:124` |
| PATCH | `/api/conductores/:id/documentos/:docId` | `src/modules/conductores-documentos/conductores-documentos.routes.ts:114` |
| GET | `/api/conductores/:id/documentos/:docId/url` | `src/modules/conductores-documentos/conductores-documentos.routes.ts:133` |
| GET | `/api/conductores/documentos/catalogo` | `src/modules/conductores-documentos/conductores-documentos.routes.ts:70` |

## contabilidad

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/contabilidad/conciliacion-terceros` | `src/modules/contabilidad/contabilidad.routes.ts:13` |
| POST | `/api/contabilidad/conciliacion-terceros/excel` | `src/modules/contabilidad/contabilidad.routes.ts:22` |

## custom-places

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/custom-places` | `src/modules/custom-places/custom-places.routes.ts:26` |
| POST | `/api/custom-places` | `src/modules/custom-places/custom-places.routes.ts:28` |
| DELETE | `/api/custom-places/:id` | `src/modules/custom-places/custom-places.routes.ts:34` |
| GET | `/api/custom-places/:id` | `src/modules/custom-places/custom-places.routes.ts:30` |
| PATCH | `/api/custom-places/:id` | `src/modules/custom-places/custom-places.routes.ts:32` |

## dashboard

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/dashboard/secciones` | `src/modules/dashboard/dashboard.routes.ts:57` |
| GET | `/api/dashboard/secciones/:id` | `src/modules/dashboard/dashboard.routes.ts:69` |
| GET | `/api/dashboard/talento-humano/seguridad-social` | `src/modules/dashboard/dashboard.routes.ts:98` |
| PUT | `/api/dashboard/talento-humano/seguridad-social` | `src/modules/dashboard/dashboard.routes.ts:102` |
| POST | `/api/dashboard/talento-humano/seguridad-social/aplicar` | `src/modules/dashboard/dashboard.routes.ts:113` |

## dias-laborados

| Método | Ruta | Declarada en |
|---|---|---|
| DELETE | `/api/dias-laborados/admin/registro/:id` | `src/modules/dias-laborados/dias-laborados.routes.ts:443` |
| PUT | `/api/dias-laborados/admin/registro/:id` | `src/modules/dias-laborados/dias-laborados.routes.ts:395` |
| POST | `/api/dias-laborados/admin/registros-masivos` | `src/modules/dias-laborados/dias-laborados.routes.ts:112` |
| DELETE | `/api/dias-laborados/admin/segmento/:id` | `src/modules/dias-laborados/dias-laborados.routes.ts:375` |
| PUT | `/api/dias-laborados/admin/segmento/:id` | `src/modules/dias-laborados/dias-laborados.routes.ts:342` |
| GET | `/api/dias-laborados/bonos` | `src/modules/dias-laborados/dias-laborados.routes.ts:188` |
| POST | `/api/dias-laborados/bonos` | `src/modules/dias-laborados/dias-laborados.routes.ts:236` |
| GET | `/api/dias-laborados/bonos-config-visual` | `src/modules/dias-laborados/dias-laborados.routes.ts:280` |
| PUT | `/api/dias-laborados/bonos-config-visual` | `src/modules/dias-laborados/dias-laborados.routes.ts:296` |
| DELETE | `/api/dias-laborados/bonos/:id` | `src/modules/dias-laborados/dias-laborados.routes.ts:256` |
| POST | `/api/dias-laborados/bonos/sync` | `src/modules/dias-laborados/dias-laborados.routes.ts:207` |
| GET | `/api/dias-laborados/calendar-admin` | `src/modules/dias-laborados/dias-laborados.routes.ts:84` |
| GET | `/api/dias-laborados/clientes` | `src/modules/dias-laborados/dias-laborados.routes.ts:320` |
| GET | `/api/dias-laborados/registros` | `src/modules/dias-laborados/dias-laborados.routes.ts:490` |
| POST | `/api/dias-laborados/registros` | `src/modules/dias-laborados/dias-laborados.routes.ts:467` |
| DELETE | `/api/dias-laborados/registros/:fecha` | `src/modules/dias-laborados/dias-laborados.routes.ts:506` |
| POST | `/api/dias-laborados/solicitar-acceso` | `src/modules/dias-laborados/dias-laborados.routes.ts:51` |
| GET | `/api/dias-laborados/vehiculos` | `src/modules/dias-laborados/dias-laborados.routes.ts:328` |
| GET | `/api/dias-laborados/verificar-token` | `src/modules/dias-laborados/dias-laborados.routes.ts:67` |

## documentos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/desprendible/compartido/:token` | `src/modules/documentos/documentos-compartidos.routes.ts:15` |
| GET | `/api/desprendible/compartido/:token/datos` | `src/modules/documentos/documentos-compartidos.routes.ts:65` |
| POST | `/api/desprendible/compartido/:token/firmar` | `src/modules/documentos/documentos-compartidos.routes.ts:35` |
| GET | `/api/documentos/url-firma` | `src/modules/documentos/documentos.routes.ts:73` |
| GET | `/api/documentos/ver/*` | `src/modules/documentos/documentos.routes.ts:28` |

## encuestas

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/encuestas` | `src/modules/encuestas/encuestas.routes.ts:57` |
| POST | `/api/encuestas` | `src/modules/encuestas/encuestas.routes.ts:61` |
| DELETE | `/api/encuestas/:id` | `src/modules/encuestas/encuestas.routes.ts:112` |
| GET | `/api/encuestas/:id` | `src/modules/encuestas/encuestas.routes.ts:88` |
| PUT | `/api/encuestas/:id` | `src/modules/encuestas/encuestas.routes.ts:92` |
| POST | `/api/encuestas/:id/cerrar` | `src/modules/encuestas/encuestas.routes.ts:102` |
| POST | `/api/encuestas/:id/duplicar` | `src/modules/encuestas/encuestas.routes.ts:106` |
| GET | `/api/encuestas/:id/exportar.pdf` | `src/modules/encuestas/encuestas.routes.ts:130` |
| GET | `/api/encuestas/:id/exportar.xlsx` | `src/modules/encuestas/encuestas.routes.ts:122` |
| POST | `/api/encuestas/:id/publicar` | `src/modules/encuestas/encuestas.routes.ts:98` |
| GET | `/api/encuestas/:id/resultados` | `src/modules/encuestas/encuestas.routes.ts:116` |
| POST | `/api/encuestas/generar` | `src/modules/encuestas/encuestas.routes.ts:68` |
| GET | `/api/public/encuestas/:token` | `src/modules/encuestas/encuestas.routes.ts:33` |
| POST | `/api/public/encuestas/:token/respuestas` | `src/modules/encuestas/encuestas.routes.ts:39` |

## evaluaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/evaluaciones` | `src/modules/evaluaciones/evaluacion.routes.ts:34` |
| POST | `/api/evaluaciones` | `src/modules/evaluaciones/evaluacion.routes.ts:36` |
| DELETE | `/api/evaluaciones/:id` | `src/modules/evaluaciones/evaluacion.routes.ts:38` |
| GET | `/api/evaluaciones/:id` | `src/modules/evaluaciones/evaluacion.routes.ts:35` |
| PUT | `/api/evaluaciones/:id` | `src/modules/evaluaciones/evaluacion.routes.ts:37` |
| GET | `/api/evaluaciones/:id/exportar-pdf` | `src/modules/evaluaciones/evaluacion.routes.ts:53` |
| GET | `/api/evaluaciones/:id/exportar-zip` | `src/modules/evaluaciones/evaluacion.routes.ts:59` |
| POST | `/api/evaluaciones/:id/responder` | `src/modules/evaluaciones/evaluacion.routes.ts:70` |
| GET | `/api/evaluaciones/:id/resultados` | `src/modules/evaluaciones/evaluacion.routes.ts:41` |
| GET | `/api/evaluaciones/:id/resultados/:resultadoId` | `src/modules/evaluaciones/evaluacion.routes.ts:43` |
| PUT | `/api/evaluaciones/:id/resultados/:resultadoId` | `src/modules/evaluaciones/evaluacion.routes.ts:46` |
| GET | `/api/evaluaciones/:id/resultados/:resultadoId/exportar-pdf` | `src/modules/evaluaciones/evaluacion.routes.ts:56` |
| GET | `/api/evaluaciones/:id/verificar` | `src/modules/evaluaciones/evaluacion.routes.ts:82` |
| GET | `/api/public/evaluaciones/:id` | `src/modules/evaluaciones/evaluacion.routes.ts:66` |

## extractos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/extractos` | `src/modules/extractos/extractos.routes.ts:108` |
| POST | `/api/extractos` | `src/modules/extractos/extractos.routes.ts:211` |
| GET | `/api/extractos/:id` | `src/modules/extractos/extractos.routes.ts:186` |
| POST | `/api/extractos/:id/anular` | `src/modules/extractos/extractos.routes.ts:219` |
| GET | `/api/extractos/:id/pdf` | `src/modules/extractos/extractos.routes.ts:194` |
| GET | `/api/extractos/anios` | `src/modules/extractos/extractos.routes.ts:116` |
| GET | `/api/extractos/catalogo` | `src/modules/extractos/extractos.routes.ts:167` |
| DELETE | `/api/extractos/catalogo/:id` | `src/modules/extractos/extractos.routes.ts:177` |
| GET | `/api/extractos/contratantes` | `src/modules/extractos/extractos.routes.ts:133` |
| POST | `/api/extractos/contratantes` | `src/modules/extractos/extractos.routes.ts:142` |
| DELETE | `/api/extractos/contratantes/:id` | `src/modules/extractos/extractos.routes.ts:158` |
| PUT | `/api/extractos/contratantes/:id` | `src/modules/extractos/extractos.routes.ts:150` |
| GET | `/api/extractos/opciones` | `src/modules/extractos/extractos.routes.ts:125` |
| GET | `/api/public/extractos/:codigo` | `src/modules/extractos/extractos-public.routes.ts:14` |

## facturacion-liquidaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/facturacion-liquidaciones` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:14` |
| POST | `/api/facturacion-liquidaciones` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:15` |
| DELETE | `/api/facturacion-liquidaciones/:id` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:32` |
| GET | `/api/facturacion-liquidaciones/:id` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:20` |
| PATCH | `/api/facturacion-liquidaciones/:id/anular` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:31` |
| PATCH | `/api/facturacion-liquidaciones/:id/condiciones` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:29` |
| POST | `/api/facturacion-liquidaciones/:id/items` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:24` |
| DELETE | `/api/facturacion-liquidaciones/:id/items/:liquidacionId` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:25` |
| PATCH | `/api/facturacion-liquidaciones/:id/restaurar` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:33` |
| POST | `/api/facturacion-liquidaciones/batch-info` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:36` |
| GET | `/api/facturacion-liquidaciones/eliminadas` | `src/modules/facturacion-liquidaciones/facturacion-liquidaciones.routes.ts:18` |

## formularios-dinamicos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/conductor-portal/formularios` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:266` |
| GET | `/api/conductor-portal/formularios/:assignmentId` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:277` |
| DELETE | `/api/conductor-portal/formularios/attachments/:id` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:474` |
| POST | `/api/conductor-portal/formularios/attachments/:id/complete` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:483` |
| POST | `/api/conductor-portal/formularios/attachments/init` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:458` |
| DELETE | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:447` |
| GET | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:420` |
| PUT | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:436` |
| POST | `/api/conductor-portal/formularios/drafts/:clientSubmissionId/restaurar` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:408` |
| GET | `/api/conductor-portal/formularios/drafts/papelera` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:398` |
| GET | `/api/conductor-portal/formularios/ping` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:262` |
| GET | `/api/conductor-portal/formularios/submissions` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:304` |
| POST | `/api/conductor-portal/formularios/submissions` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:522` |
| GET | `/api/conductor-portal/formularios/submissions/:id` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:314` |
| GET | `/api/conductor-portal/formularios/submissions/:id/pdf` | `src/modules/formularios-dinamicos/formularios-portal.routes.ts:336` |
| GET | `/api/form-field-templates` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:149` |
| POST | `/api/form-field-templates` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:150` |
| DELETE | `/api/form-field-templates/:id` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:160` |
| PATCH | `/api/form-field-templates/:id` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:155` |
| GET | `/api/formularios` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:214` |
| POST | `/api/formularios` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:215` |
| DELETE | `/api/formularios/:formId` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:218` |
| GET | `/api/formularios/:formId` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:216` |
| PATCH | `/api/formularios/:formId` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:217` |
| POST | `/api/formularios/:formId/duplicate` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:220` |
| POST | `/api/formularios/:formId/restore` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:219` |
| GET | `/api/formularios/:formId/versions/:versionId` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:223` |
| PUT | `/api/formularios/:formId/versions/:versionId` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:226` |
| POST | `/api/formularios/:formId/versions/:versionId/archive` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:234` |
| POST | `/api/formularios/:formId/versions/:versionId/clone` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:232` |
| POST | `/api/formularios/:formId/versions/:versionId/publish` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:233` |
| POST | `/api/formularios/:formId/versions/:versionId/validate` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:231` |
| GET | `/api/formularios/asignaciones` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:193` |
| POST | `/api/formularios/asignaciones` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:194` |
| GET | `/api/formularios/asignaciones/:id` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:195` |
| PATCH | `/api/formularios/asignaciones/:id` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:196` |
| POST | `/api/formularios/asignaciones/:id/close` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:207` |
| POST | `/api/formularios/asignaciones/:id/pause` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:197` |
| POST | `/api/formularios/asignaciones/:id/resume` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:202` |
| GET | `/api/formularios/audiencia/usuarios` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:136` |
| GET | `/api/formularios/campana-portal/audiencia` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:75` |
| POST | `/api/formularios/campana-portal/enviar` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:108` |
| POST | `/api/formularios/campana-portal/test` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:88` |
| POST | `/api/formularios/documento/pdf` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:186` |
| GET | `/api/formularios/metricas` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:68` |
| GET | `/api/formularios/submissions` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:165` |
| DELETE | `/api/formularios/submissions/:id` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:170` |
| GET | `/api/formularios/submissions/:id` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:164` |
| POST | `/api/formularios/submissions/:id/restore` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:171` |
| POST | `/api/formularios/submissions/:id/void` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:166` |
| GET | `/api/formularios/submissions/export.csv` | `src/modules/formularios-dinamicos/formularios-dinamicos.routes.ts:163` |
| GET | `/api/mis-formularios` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:126` |
| GET | `/api/mis-formularios/:assignmentId` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:250` |
| DELETE | `/api/mis-formularios/attachments/:id` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:237` |
| POST | `/api/mis-formularios/attachments/:id/complete` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:215` |
| POST | `/api/mis-formularios/attachments/init` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:206` |
| DELETE | `/api/mis-formularios/drafts/:clientSubmissionId` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:191` |
| GET | `/api/mis-formularios/drafts/:clientSubmissionId` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:170` |
| PUT | `/api/mis-formularios/drafts/:clientSubmissionId` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:181` |
| GET | `/api/mis-formularios/submissions` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:142` |
| POST | `/api/mis-formularios/submissions` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:275` |
| GET | `/api/mis-formularios/submissions/:id` | `src/modules/formularios-dinamicos/formularios-mis.routes.ts:152` |

## formularios-sarlaft

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/formularios-sarlaft` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:205` |
| GET | `/api/formularios-sarlaft/:id` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:249` |
| GET | `/api/formularios-sarlaft/:id/documentos-generados/:docId/pdf` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:342` |
| GET | `/api/formularios-sarlaft/:id/documentos/:docId/url` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:267` |
| PATCH | `/api/formularios-sarlaft/:id/evaluacion` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:288` |
| GET | `/api/formularios-sarlaft/:id/evidencia` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:364` |
| GET | `/api/formularios-sarlaft/:id/pdf` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:324` |
| GET | `/api/public/formularios-sarlaft` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:21` |
| POST | `/api/public/formularios-sarlaft` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:170` |
| GET | `/api/public/formularios-sarlaft/:codigo` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:58` |
| GET | `/api/public/formularios-sarlaft/:codigo/documentos` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:96` |
| GET | `/api/public/formularios-sarlaft/contacto` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:120` |
| GET | `/api/public/formularios-sarlaft/documentos/descargar` | `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts:150` |

## incidentes

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/incidentes` | `src/modules/incidentes/incidentes.routes.ts:64` |
| POST | `/api/incidentes` | `src/modules/incidentes/incidentes.routes.ts:111` |
| DELETE | `/api/incidentes/:id` | `src/modules/incidentes/incidentes.routes.ts:148` |
| GET | `/api/incidentes/:id` | `src/modules/incidentes/incidentes.routes.ts:103` |
| PUT | `/api/incidentes/:id` | `src/modules/incidentes/incidentes.routes.ts:120` |
| POST | `/api/incidentes/:id/acciones` | `src/modules/incidentes/incidentes.routes.ts:210` |
| DELETE | `/api/incidentes/:id/acciones/:accionId` | `src/modules/incidentes/incidentes.routes.ts:228` |
| GET | `/api/incidentes/:id/acciones/buscar` | `src/modules/incidentes/incidentes.routes.ts:201` |
| POST | `/api/incidentes/:id/acciones/vincular` | `src/modules/incidentes/incidentes.routes.ts:219` |
| POST | `/api/incidentes/:id/estado` | `src/modules/incidentes/incidentes.routes.ts:138` |
| POST | `/api/incidentes/:id/evidencias` | `src/modules/incidentes/incidentes.routes.ts:160` |
| DELETE | `/api/incidentes/:id/evidencias/:evId` | `src/modules/incidentes/incidentes.routes.ts:190` |
| GET | `/api/incidentes/:id/evidencias/:evId/url` | `src/modules/incidentes/incidentes.routes.ts:182` |
| PUT | `/api/incidentes/:id/investigacion` | `src/modules/incidentes/incidentes.routes.ts:129` |
| GET | `/api/incidentes/indicadores` | `src/modules/incidentes/incidentes.routes.ts:72` |
| GET | `/api/incidentes/opciones` | `src/modules/incidentes/incidentes.routes.ts:81` |
| GET | `/api/incidentes/servicios-candidatos` | `src/modules/incidentes/incidentes.routes.ts:89` |

## inducciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/inducciones` | `src/modules/inducciones/inducciones.routes.ts:54` |
| POST | `/api/inducciones` | `src/modules/inducciones/inducciones.routes.ts:17` |
| DELETE | `/api/inducciones/:id` | `src/modules/inducciones/inducciones.routes.ts:194` |
| GET | `/api/inducciones/:id` | `src/modules/inducciones/inducciones.routes.ts:131` |
| PATCH | `/api/inducciones/:id` | `src/modules/inducciones/inducciones.routes.ts:155` |
| GET | `/api/inducciones/:id/exportar/excel` | `src/modules/inducciones/inducciones.routes.ts:218` |
| GET | `/api/inducciones/:id/exportar/pdf` | `src/modules/inducciones/inducciones.routes.ts:233` |
| GET | `/api/inducciones/estadisticas` | `src/modules/inducciones/inducciones.routes.ts:96` |

## invitaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/invitaciones` | `src/modules/invitaciones/invitaciones.routes.ts:9` |
| POST | `/api/invitaciones` | `src/modules/invitaciones/invitaciones.routes.ts:8` |
| DELETE | `/api/invitaciones/:id` | `src/modules/invitaciones/invitaciones.routes.ts:10` |
| POST | `/api/invitaciones/aceptar` | `src/modules/invitaciones/invitaciones.routes.ts:14` |
| GET | `/api/invitaciones/validar/:token` | `src/modules/invitaciones/invitaciones.routes.ts:13` |

## liquidaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/configuraciones-liquidacion` | `src/modules/liquidaciones/liquidaciones.routes.ts:97` |
| POST | `/api/configuraciones-liquidacion` | `src/modules/liquidaciones/liquidaciones.routes.ts:131` |
| DELETE | `/api/configuraciones-liquidacion/:id` | `src/modules/liquidaciones/liquidaciones.routes.ts:149` |
| PUT | `/api/configuraciones-liquidacion/:id` | `src/modules/liquidaciones/liquidaciones.routes.ts:143` |
| GET | `/api/configuraciones-liquidacion/activas` | `src/modules/liquidaciones/liquidaciones.routes.ts:106` |
| GET | `/api/configuraciones-liquidacion/anios` | `src/modules/liquidaciones/liquidaciones.routes.ts:125` |
| POST | `/api/configuraciones-liquidacion/duplicar` | `src/modules/liquidaciones/liquidaciones.routes.ts:137` |
| GET | `/api/desprendible-firma/:token` | `src/modules/liquidaciones/desprendible-firma.routes.ts:25` |
| GET | `/api/desprendible-firma/:token/datos` | `src/modules/liquidaciones/desprendible-firma.routes.ts:188` |
| POST | `/api/desprendible-firma/:token/firmar` | `src/modules/liquidaciones/desprendible-firma.routes.ts:124` |
| GET | `/api/desprendible-firma/:token/pdf` | `src/modules/liquidaciones/desprendible-firma.routes.ts:92` |
| POST | `/api/desprendible-firma/generar` | `src/modules/liquidaciones/desprendible-firma.routes.ts:345` |
| GET | `/api/firmas/liquidacion/:id` | `src/modules/liquidaciones/liquidaciones.routes.ts:42` |
| GET | `/api/liquidaciones` | `src/modules/liquidaciones/liquidaciones.routes.ts:26` |
| POST | `/api/liquidaciones` | `src/modules/liquidaciones/liquidaciones.routes.ts:79` |
| DELETE | `/api/liquidaciones/:id` | `src/modules/liquidaciones/liquidaciones.routes.ts:85` |
| GET | `/api/liquidaciones/:id` | `src/modules/liquidaciones/liquidaciones.routes.ts:36` |
| PUT | `/api/liquidaciones/:id` | `src/modules/liquidaciones/liquidaciones.routes.ts:82` |
| GET | `/api/liquidaciones/:id/pdf-desprendible` | `src/modules/liquidaciones/liquidaciones.routes.ts:70` |
| POST | `/api/liquidaciones/:id/recargos/:recargoId/revertir-override` | `src/modules/liquidaciones/liquidaciones.routes.ts:91` |
| GET | `/api/liquidaciones/analisis` | `src/modules/liquidaciones/liquidaciones.routes.ts:76` |
| PATCH | `/api/liquidaciones/desprendible-tablas-visible` | `src/modules/liquidaciones/liquidaciones.routes.ts:475` |
| PATCH | `/api/liquidaciones/desprendible-visible` | `src/modules/liquidaciones/liquidaciones.routes.ts:415` |
| POST | `/api/liquidaciones/enviar-desprendibles` | `src/modules/liquidaciones/liquidaciones.routes.ts:158` |
| POST | `/api/liquidaciones/generate-payslips-zip` | `src/modules/liquidaciones/liquidaciones.routes.ts:468` |
| POST | `/api/liquidaciones/preview-desprendibles` | `src/modules/liquidaciones/liquidaciones.routes.ts:332` |
| GET | `/api/liquidaciones/preview-recargos` | `src/modules/liquidaciones/liquidaciones.routes.ts:29` |

## liquidaciones-chat

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros/:id/chat/mensajes` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:14` |
| POST | `/api/liquidaciones-terceros/:id/chat/mensajes` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:15` |
| DELETE | `/api/liquidaciones-terceros/:id/chat/mensajes/:msgId` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:16` |
| GET | `/api/liquidaciones-terceros/:id/recordatorios` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:19` |
| POST | `/api/liquidaciones-terceros/:id/recordatorios` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:20` |
| PATCH | `/api/liquidaciones-terceros/recordatorios/:recordatorioId/estado` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:21` |
| GET | `/api/recordatorios/pendientes` | `src/modules/liquidaciones-chat/liquidaciones-chat.routes.ts:24` |

## liquidaciones-servicios

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-servicios` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:56` |
| POST | `/api/liquidaciones-servicios` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:57` |
| DELETE | `/api/liquidaciones-servicios/:id` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:64` |
| GET | `/api/liquidaciones-servicios/:id` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:62` |
| PUT | `/api/liquidaciones-servicios/:id` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:63` |
| GET | `/api/liquidaciones-servicios/:id/csv` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:67` |
| DELETE | `/api/liquidaciones-servicios/:id/draft` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:28` |
| GET | `/api/liquidaciones-servicios/:id/draft` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:27` |
| PATCH | `/api/liquidaciones-servicios/:id/estado` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:65` |
| GET | `/api/liquidaciones-servicios/:id/historial` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:66` |
| PATCH | `/api/liquidaciones-servicios/:id/restaurar` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:68` |
| POST | `/api/liquidaciones-servicios/autoguardado` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:34` |
| GET | `/api/liquidaciones-servicios/check-consecutivo/:consecutivo` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:37` |
| GET | `/api/liquidaciones-servicios/config-liquidador` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:49` |
| PUT | `/api/liquidaciones-servicios/config-liquidador` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:50` |
| DELETE | `/api/liquidaciones-servicios/draft` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:26` |
| GET | `/api/liquidaciones-servicios/draft` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:25` |
| POST | `/api/liquidaciones-servicios/draft` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:24` |
| GET | `/api/liquidaciones-servicios/eliminadas` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:60` |
| GET | `/api/liquidaciones-servicios/estadisticas` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:53` |
| GET | `/api/liquidaciones-servicios/preview` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:40` |
| GET | `/api/liquidaciones-servicios/servicios-disponibles` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:43` |
| GET | `/api/liquidaciones-servicios/tarifas` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:14` |
| POST | `/api/liquidaciones-servicios/tarifas` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:15` |
| DELETE | `/api/liquidaciones-servicios/tarifas/:id` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:17` |
| PUT | `/api/liquidaciones-servicios/tarifas/:id` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:16` |
| GET | `/api/liquidaciones-servicios/tipos-recargo` | `src/modules/liquidaciones-servicios/liquidaciones-servicios.routes.ts:46` |

## liquidaciones-terceros

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros` | `src/modules/liquidaciones-terceros/liquidaciones-terceros.routes.ts:14` |
| GET | `/api/liquidaciones-terceros/:liquidacion_id` | `src/modules/liquidaciones-terceros/liquidaciones-terceros.routes.ts:20` |
| PUT | `/api/liquidaciones-terceros/:liquidacion_id` | `src/modules/liquidaciones-terceros/liquidaciones-terceros.routes.ts:23` |
| POST | `/api/liquidaciones-terceros/migrar` | `src/modules/liquidaciones-terceros/liquidaciones-terceros.routes.ts:17` |

## liquidaciones-terceros-adicionales

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros-adicionales` | `src/modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.routes.ts:29` |
| POST | `/api/liquidaciones-terceros-adicionales` | `src/modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.routes.ts:36` |
| PUT | `/api/liquidaciones-terceros-adicionales` | `src/modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.routes.ts:59` |
| DELETE | `/api/liquidaciones-terceros-adicionales/:id` | `src/modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.routes.ts:51` |
| PATCH | `/api/liquidaciones-terceros-adicionales/:id` | `src/modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.routes.ts:44` |
| GET | `/api/liquidaciones-terceros-adicionales/anual` | `src/modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.routes.ts:22` |

## liquidaciones-terceros-adicionales-snapshots

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros-adicionales/snapshots` | `src/modules/liquidaciones-terceros-adicionales-snapshots/liquidaciones-terceros-adicionales-snapshots.routes.ts:32` |
| POST | `/api/liquidaciones-terceros-adicionales/snapshots` | `src/modules/liquidaciones-terceros-adicionales-snapshots/liquidaciones-terceros-adicionales-snapshots.routes.ts:47` |
| GET | `/api/liquidaciones-terceros-adicionales/snapshots/:id` | `src/modules/liquidaciones-terceros-adicionales-snapshots/liquidaciones-terceros-adicionales-snapshots.routes.ts:69` |
| GET | `/api/liquidaciones-terceros-adicionales/snapshots/:id/diff` | `src/modules/liquidaciones-terceros-adicionales-snapshots/liquidaciones-terceros-adicionales-snapshots.routes.ts:82` |
| POST | `/api/liquidaciones-terceros-adicionales/snapshots/:id/revertir` | `src/modules/liquidaciones-terceros-adicionales-snapshots/liquidaciones-terceros-adicionales-snapshots.routes.ts:97` |

## liquidaciones-terceros-descuentos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/configuracion-descuentos-tercero` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:26` |
| PUT | `/api/configuracion-descuentos-tercero` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:27` |
| GET | `/api/liquidaciones-terceros-descuentos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:137` |
| GET | `/api/liquidaciones-terceros-descuentos/:id` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:138` |
| DELETE | `/api/liquidaciones-terceros/:id` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:124` |
| GET | `/api/liquidaciones-terceros/:id/calcular-impuestos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:80` |
| PATCH | `/api/liquidaciones-terceros/:id/color-hoja` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:121` |
| GET | `/api/liquidaciones-terceros/:id/conceptos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:56` |
| PUT | `/api/liquidaciones-terceros/:id/conceptos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:57` |
| POST | `/api/liquidaciones-terceros/:id/conceptos-fila` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:65` |
| PUT | `/api/liquidaciones-terceros/:id/conductores` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:61` |
| PATCH | `/api/liquidaciones-terceros/:id/estado` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:116` |
| GET | `/api/liquidaciones-terceros/:id/historial-estados` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:117` |
| PUT | `/api/liquidaciones-terceros/:id/items` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:86` |
| POST | `/api/liquidaciones-terceros/:id/items-agregar` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:97` |
| GET | `/api/liquidaciones-terceros/:id/items-disponibles` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:96` |
| GET | `/api/liquidaciones-terceros/:id/propietarios` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:69` |
| PUT | `/api/liquidaciones-terceros/:id/propietarios` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:70` |
| POST | `/api/liquidaciones-terceros/:id/recalcular-totales` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:83` |
| POST | `/api/liquidaciones-terceros/:id/refresh-items` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:91` |
| GET | `/api/liquidaciones-terceros/anticipos-vehiculo` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:49` |
| GET | `/api/liquidaciones-terceros/autocompletar-nomina` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:43` |
| GET | `/api/liquidaciones-terceros/bonificaciones` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:46` |
| DELETE | `/api/liquidaciones-terceros/borrador-job/:jobId` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:36` |
| GET | `/api/liquidaciones-terceros/borrador-status/:jobId` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:35` |
| DELETE | `/api/liquidaciones-terceros/conceptos-fila/:conceptoId` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:66` |
| GET | `/api/liquidaciones-terceros/config-gastos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:74` |
| PUT | `/api/liquidaciones-terceros/config-gastos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:75` |
| GET | `/api/liquidaciones-terceros/config-valores` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:76` |
| PUT | `/api/liquidaciones-terceros/config-valores` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:77` |
| POST | `/api/liquidaciones-terceros/estado-lote` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:115` |
| POST | `/api/liquidaciones-terceros/generar-borrador` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:31` |
| POST | `/api/liquidaciones-terceros/generar-borrador-async` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:34` |
| POST | `/api/liquidaciones-terceros/guardar-borrador` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:40` |
| POST | `/api/liquidaciones-terceros/guardar-borrador-bulk-async` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:127` |
| PATCH | `/api/liquidaciones-terceros/items/:pivoteId/aplica-impuestos` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:100` |
| PATCH | `/api/liquidaciones-terceros/items/:pivoteId/excluir` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:105` |
| POST | `/api/liquidaciones-terceros/items/:pivoteId/revertir-traslado` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:112` |
| POST | `/api/liquidaciones-terceros/items/:pivoteId/trasladar` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:111` |
| GET | `/api/liquidaciones-terceros/periodo` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:134` |
| DELETE | `/api/liquidaciones-terceros/save-bulk-job/:batchId` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:129` |
| GET | `/api/liquidaciones-terceros/save-bulk/:batchId` | `src/modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes.ts:128` |

## liquidaciones-terceros-envios

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros/envios/cierre/:cierreId` | `src/modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.routes.ts:39` |
| GET | `/api/liquidaciones-terceros/envios/historial` | `src/modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.routes.ts:32` |
| DELETE | `/api/liquidaciones-terceros/envios/job/:jobId` | `src/modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.routes.ts:51` |
| POST | `/api/liquidaciones-terceros/envios/lote` | `src/modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.routes.ts:18` |
| GET | `/api/liquidaciones-terceros/envios/periodo` | `src/modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.routes.ts:25` |
| GET | `/api/liquidaciones-terceros/envios/status/:jobId` | `src/modules/liquidaciones-terceros-envios/liquidaciones-terceros-envios.routes.ts:45` |

## liquidaciones-terceros-ingresos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros-ingresos` | `src/modules/liquidaciones-terceros-ingresos/liquidaciones-terceros-ingresos.routes.ts:58` |
| GET | `/api/liquidaciones-terceros-ingresos/anual` | `src/modules/liquidaciones-terceros-ingresos/liquidaciones-terceros-ingresos.routes.ts:36` |
| GET | `/api/liquidaciones-terceros-ingresos/estado` | `src/modules/liquidaciones-terceros-ingresos/liquidaciones-terceros-ingresos.routes.ts:43` |
| POST | `/api/liquidaciones-terceros-ingresos/guardar` | `src/modules/liquidaciones-terceros-ingresos/liquidaciones-terceros-ingresos.routes.ts:51` |

## liquidaciones-terceros-ocasional

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros-ocasional` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:67` |
| DELETE | `/api/liquidaciones-terceros-ocasional/:id` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:111` |
| GET | `/api/liquidaciones-terceros-ocasional/:id` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:73` |
| POST | `/api/liquidaciones-terceros-ocasional/:id/cerrar-distribuir` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:99` |
| DELETE | `/api/liquidaciones-terceros-ocasional/:id/draft` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:87` |
| GET | `/api/liquidaciones-terceros-ocasional/:id/draft` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:83` |
| PATCH | `/api/liquidaciones-terceros-ocasional/:id/estado` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:105` |
| GET | `/api/liquidaciones-terceros-ocasional/:id/preview-data` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:117` |
| POST | `/api/liquidaciones-terceros-ocasional/:id/recalcular-totales` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:93` |
| GET | `/api/liquidaciones-terceros-ocasional/anual` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:55` |
| POST | `/api/liquidaciones-terceros-ocasional/draft` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:79` |
| POST | `/api/liquidaciones-terceros-ocasional/generar-borrador` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:24` |
| POST | `/api/liquidaciones-terceros-ocasional/guardar-borrador` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:48` |
| POST | `/api/liquidaciones-terceros-ocasional/items-agregar` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:42` |
| GET | `/api/liquidaciones-terceros-ocasional/items-disponibles` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:38` |
| GET | `/api/liquidaciones-terceros-ocasional/por-periodo` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:61` |
| POST | `/api/liquidaciones-terceros-ocasional/previsualizar` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:14` |
| POST | `/api/liquidaciones-terceros-ocasional/refrescar` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:30` |
| GET | `/api/liquidaciones-terceros-ocasional/terceros-candidatos` | `src/modules/liquidaciones-terceros-ocasional/liquidaciones-terceros-ocasional.routes.ts:18` |

## liquidaciones-terceros-ocasional-snapshots

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/liquidaciones-terceros-ocasional-snapshots/cron-hora` | `src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.routes.ts:41` |
| GET | `/api/liquidaciones-terceros-ocasional/:id/snapshots` | `src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.routes.ts:19` |
| POST | `/api/liquidaciones-terceros-ocasional/:id/snapshots` | `src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.routes.ts:23` |
| GET | `/api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId` | `src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.routes.ts:27` |
| GET | `/api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/diff` | `src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.routes.ts:31` |
| POST | `/api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/revertir` | `src/modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.routes.ts:35` |

## liquidaciones-terceros-pagos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros-pagos/:cierreId` | `src/modules/liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.routes.ts:94` |
| PUT | `/api/liquidaciones-terceros-pagos/:cierreId` | `src/modules/liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.routes.ts:103` |
| POST | `/api/liquidaciones-terceros-pagos/comprobante` | `src/modules/liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.routes.ts:54` |
| GET | `/api/liquidaciones-terceros-pagos/comprobante/:pagoId` | `src/modules/liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.routes.ts:119` |
| GET | `/api/liquidaciones-terceros-pagos/periodo` | `src/modules/liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.routes.ts:77` |

## liquidaciones-terceros-pdf

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/liquidaciones-terceros/:id/pdf` | `src/modules/liquidaciones-terceros-pdf/liquidaciones-terceros-pdf.routes.ts:29` |
| POST | `/api/liquidaciones-terceros/canvas/pdf` | `src/modules/liquidaciones-terceros-pdf/liquidaciones-terceros-pdf.routes.ts:41` |
| POST | `/api/liquidaciones-terceros/canvas/pdf-zip` | `src/modules/liquidaciones-terceros-pdf/liquidaciones-terceros-pdf.routes.ts:49` |

## liquidaciones-terceros-snapshots

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/liquidaciones-terceros-snapshots/cron-hora` | `src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes.ts:25` |
| GET | `/api/liquidaciones-terceros/:id/snapshots` | `src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes.ts:19` |
| GET | `/api/liquidaciones-terceros/:id/snapshots/:snapshotId` | `src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes.ts:20` |
| GET | `/api/liquidaciones-terceros/:id/snapshots/:snapshotId/diff` | `src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes.ts:21` |
| POST | `/api/liquidaciones-terceros/:id/snapshots/:snapshotId/revertir` | `src/modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes.ts:22` |

## mantenimiento

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/mantenimiento/costos` | `src/modules/mantenimiento/mantenimiento.routes.ts:234` |
| GET | `/api/mantenimiento/opciones` | `src/modules/mantenimiento/mantenimiento.routes.ts:63` |
| GET | `/api/mantenimiento/ordenes` | `src/modules/mantenimiento/mantenimiento.routes.ts:123` |
| POST | `/api/mantenimiento/ordenes` | `src/modules/mantenimiento/mantenimiento.routes.ts:139` |
| GET | `/api/mantenimiento/ordenes/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:131` |
| PATCH | `/api/mantenimiento/ordenes/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:148` |
| POST | `/api/mantenimiento/ordenes/:id/adjuntos` | `src/modules/mantenimiento/mantenimiento.routes.ts:166` |
| DELETE | `/api/mantenimiento/ordenes/:id/adjuntos/:adjuntoId` | `src/modules/mantenimiento/mantenimiento.routes.ts:200` |
| GET | `/api/mantenimiento/ordenes/:id/adjuntos/:adjuntoId/url` | `src/modules/mantenimiento/mantenimiento.routes.ts:188` |
| POST | `/api/mantenimiento/ordenes/:id/estado` | `src/modules/mantenimiento/mantenimiento.routes.ts:156` |
| GET | `/api/mantenimiento/planes` | `src/modules/mantenimiento/mantenimiento.routes.ts:80` |
| POST | `/api/mantenimiento/planes` | `src/modules/mantenimiento/mantenimiento.routes.ts:96` |
| DELETE | `/api/mantenimiento/planes/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:113` |
| GET | `/api/mantenimiento/planes/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:88` |
| PATCH | `/api/mantenimiento/planes/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:105` |
| GET | `/api/mantenimiento/preoperacionales/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:215` |
| GET | `/api/mantenimiento/resumen` | `src/modules/mantenimiento/mantenimiento.routes.ts:71` |
| GET | `/api/mantenimiento/vehiculos/:id` | `src/modules/mantenimiento/mantenimiento.routes.ts:226` |

## maps

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/maps/autocomplete` | `src/modules/maps/maps.routes.ts:39` |
| GET | `/api/maps/lookup` | `src/modules/maps/maps.routes.ts:85` |

## mcp

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/api-tokens` | `src/modules/mcp/api-tokens.routes.ts:21` |
| POST | `/api/api-tokens` | `src/modules/mcp/api-tokens.routes.ts:23` |
| DELETE | `/api/api-tokens/:id` | `src/modules/mcp/api-tokens.routes.ts:33` |
| DELETE | `/api/mcp` | `src/modules/mcp/mcp.routes.ts:81` |
| GET | `/api/mcp` | `src/modules/mcp/mcp.routes.ts:81` |
| PATCH | `/api/mcp` | `src/modules/mcp/mcp.routes.ts:81` |
| POST | `/api/mcp` | `src/modules/mcp/mcp.routes.ts:69` |
| PUT | `/api/mcp` | `src/modules/mcp/mcp.routes.ts:81` |
| DELETE | `/api/mcp/:token` | `src/modules/mcp/mcp.routes.ts:81` |
| GET | `/api/mcp/:token` | `src/modules/mcp/mcp.routes.ts:81` |
| PATCH | `/api/mcp/:token` | `src/modules/mcp/mcp.routes.ts:81` |
| POST | `/api/mcp/:token` | `src/modules/mcp/mcp.routes.ts:75` |
| PUT | `/api/mcp/:token` | `src/modules/mcp/mcp.routes.ts:81` |

## mis-capacitaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/mis-capacitaciones` | `src/modules/mis-capacitaciones/mis-capacitaciones.routes.ts:140` |
| GET | `/api/mis-capacitaciones/asistencias/:token` | `src/modules/mis-capacitaciones/mis-capacitaciones.routes.ts:148` |
| POST | `/api/mis-capacitaciones/asistencias/:token` | `src/modules/mis-capacitaciones/mis-capacitaciones.routes.ts:157` |
| GET | `/api/mis-capacitaciones/evaluaciones/:id` | `src/modules/mis-capacitaciones/mis-capacitaciones.routes.ts:166` |
| POST | `/api/mis-capacitaciones/evaluaciones/:id` | `src/modules/mis-capacitaciones/mis-capacitaciones.routes.ts:175` |

## municipios

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/municipios` | `src/modules/municipios/municipios.routes.ts:6` |
| GET | `/api/municipios/:id` | `src/modules/municipios/municipios.routes.ts:65` |
| GET | `/api/municipios/buscar` | `src/modules/municipios/municipios.routes.ts:32` |
| GET | `/api/municipios/departamento/:codigoDepartamento` | `src/modules/municipios/municipios.routes.ts:51` |

## nomina-canvas

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/nomina/analisis` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:32` |
| POST | `/api/nomina/borradores/:id/refrescar-dias` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:55` |
| POST | `/api/nomina/borradores/:id/rehacer-bonos` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:63` |
| POST | `/api/nomina/borradores/:id/reparar-recargos` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:78` |
| POST | `/api/nomina/borradores/generar` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:51` |
| DELETE | `/api/nomina/borradores/job/:jobId` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:104` |
| GET | `/api/nomina/borradores/previo` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:50` |
| GET | `/api/nomina/borradores/status/:jobId` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:52` |
| GET | `/api/nomina/canvas` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:28` |
| GET | `/api/nomina/canvas/resumen` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:29` |
| DELETE | `/api/nomina/envios/job/:jobId` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:116` |
| GET | `/api/nomina/envios/liquidacion/:id` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:118` |
| POST | `/api/nomina/envios/lote` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:114` |
| GET | `/api/nomina/envios/periodo` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:117` |
| GET | `/api/nomina/envios/status/:jobId` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:115` |
| POST | `/api/nomina/estado-lote` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:38` |
| GET | `/api/nomina/estados` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:36` |
| DELETE | `/api/nomina/liquidaciones/:id` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:99` |
| GET | `/api/nomina/liquidaciones/:id/desprendible-data` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:70` |
| PATCH | `/api/nomina/liquidaciones/:id/estado` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:37` |
| GET | `/api/nomina/liquidaciones/:id/historial-estados` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:39` |
| PUT | `/api/nomina/liquidaciones/:id/marcas-dias` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:85` |
| PUT | `/api/nomina/liquidaciones/:id/periodo` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:92` |
| POST | `/api/nomina/notificaciones` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:120` |
| GET | `/api/nomina/snapshots` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:106` |
| POST | `/api/nomina/snapshots` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:107` |
| GET | `/api/nomina/snapshots/:id` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:108` |
| GET | `/api/nomina/snapshots/:id/diff` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:109` |
| POST | `/api/nomina/snapshots/:id/revertir` | `src/modules/nomina-canvas/nomina-canvas.routes.ts:110` |

## notificaciones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/notificaciones` | `src/modules/notificaciones/notificaciones.routes.ts:10` |
| PATCH | `/api/notificaciones/:id/leida` | `src/modules/notificaciones/notificaciones.routes.ts:19` |
| PATCH | `/api/notificaciones/marcar-todas` | `src/modules/notificaciones/notificaciones.routes.ts:16` |
| GET | `/api/notificaciones/no-leidas` | `src/modules/notificaciones/notificaciones.routes.ts:13` |
| GET | `/api/notificaciones/web-push/clave` | `src/modules/notificaciones/notificaciones.routes.ts:23` |
| POST | `/api/notificaciones/web-push/desuscribir` | `src/modules/notificaciones/notificaciones.routes.ts:29` |
| POST | `/api/notificaciones/web-push/prueba` | `src/modules/notificaciones/notificaciones.routes.ts:32` |
| POST | `/api/notificaciones/web-push/suscripcion` | `src/modules/notificaciones/notificaciones.routes.ts:26` |

## operadoras

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/operadoras` | `src/modules/operadoras/operadoras.routes.ts:12` |
| POST | `/api/operadoras` | `src/modules/operadoras/operadoras.routes.ts:13` |
| DELETE | `/api/operadoras/:id` | `src/modules/operadoras/operadoras.routes.ts:17` |
| PUT | `/api/operadoras/:id` | `src/modules/operadoras/operadoras.routes.ts:14` |

## pdf

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/pdf/from-html` | `src/modules/pdf/pdf.routes.ts:8` |

## primas

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/primas` | `src/modules/primas/primas.routes.ts:34` |
| POST | `/api/primas` | `src/modules/primas/primas.routes.ts:50` |
| DELETE | `/api/primas/:id` | `src/modules/primas/primas.routes.ts:56` |
| GET | `/api/primas/:id` | `src/modules/primas/primas.routes.ts:47` |
| PUT | `/api/primas/:id` | `src/modules/primas/primas.routes.ts:53` |
| GET | `/api/primas/:id/firma-enriquecida` | `src/modules/primas/primas.routes.ts:41` |
| GET | `/api/primas/buscar` | `src/modules/primas/primas.routes.ts:37` |
| POST | `/api/primas/enviar` | `src/modules/primas/primas.routes.ts:59` |

## recargos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/recargos` | `src/modules/recargos/recargos.routes.ts:36` |
| POST | `/api/recargos` | `src/modules/recargos/recargos.routes.ts:55` |
| DELETE | `/api/recargos/:id` | `src/modules/recargos/recargos.routes.ts:61` |
| GET | `/api/recargos/:id` | `src/modules/recargos/recargos.routes.ts:46` |
| PUT | `/api/recargos/:id` | `src/modules/recargos/recargos.routes.ts:58` |
| POST | `/api/recargos/:id/duplicar` | `src/modules/recargos/recargos.routes.ts:79` |
| POST | `/api/recargos/:id/liquidar` | `src/modules/recargos/recargos.routes.ts:76` |
| POST | `/api/recargos/:id/planilla` | `src/modules/recargos/recargos.routes.ts:49` |
| POST | `/api/recargos/:id/recalcular` | `src/modules/recargos/recargos.routes.ts:84` |
| PATCH | `/api/recargos/cambiar-estado-multiple` | `src/modules/recargos/recargos.routes.ts:73` |
| GET | `/api/recargos/configuraciones-salarios` | `src/modules/recargos/recargos.routes.ts:150` |
| POST | `/api/recargos/configuraciones-salarios` | `src/modules/recargos/recargos.routes.ts:196` |
| DELETE | `/api/recargos/configuraciones-salarios/:id` | `src/modules/recargos/recargos.routes.ts:294` |
| GET | `/api/recargos/configuraciones-salarios/:id` | `src/modules/recargos/recargos.routes.ts:175` |
| PUT | `/api/recargos/configuraciones-salarios/:id` | `src/modules/recargos/recargos.routes.ts:245` |
| GET | `/api/recargos/configuraciones-salarios/vigentes` | `src/modules/recargos/recargos.routes.ts:389` |
| POST | `/api/recargos/eliminar-multiple` | `src/modules/recargos/recargos.routes.ts:64` |
| GET | `/api/recargos/empresas-disponibles` | `src/modules/recargos/recargos.routes.ts:319` |
| GET | `/api/recargos/estadisticas/resumen` | `src/modules/recargos/recargos.routes.ts:33` |
| POST | `/api/recargos/importar-desde-transmeralda` | `src/modules/recargos/recargos.routes.ts:139` |
| POST | `/api/recargos/importar-desde-transmeralda/crear-entidades-faltantes` | `src/modules/recargos/recargos.routes.ts:132` |
| GET | `/api/recargos/importar-desde-transmeralda/preview` | `src/modules/recargos/recargos.routes.ts:124` |
| POST | `/api/recargos/importar-desde-transmeralda/preview` | `src/modules/recargos/recargos.routes.ts:115` |
| POST | `/api/recargos/importar-desde-transmeralda/sincronizar-conductores-cotransmeq` | `src/modules/recargos/recargos.routes.ts:107` |
| GET | `/api/recargos/next-numero-planilla` | `src/modules/recargos/recargos.routes.ts:42` |
| POST | `/api/recargos/next-numero-planilla` | `src/modules/recargos/recargos.routes.ts:39` |
| POST | `/api/recargos/recalcular-bulk` | `src/modules/recargos/recargos.routes.ts:90` |
| GET | `/api/recargos/recalcular-bulk/:batchId` | `src/modules/recargos/recargos.routes.ts:94` |
| GET | `/api/recargos/reporte` | `src/modules/recargos/recargos.routes.ts:52` |
| DELETE | `/api/recargos/reservas-planilla/:reservaId` | `src/modules/recargos/recargos.routes.ts:43` |
| POST | `/api/recargos/restaurar-multiple` | `src/modules/recargos/recargos.routes.ts:70` |
| PATCH | `/api/recargos/restaurar/:id` | `src/modules/recargos/recargos.routes.ts:67` |
| GET | `/api/recargos/tipos-recargo/activos` | `src/modules/recargos/recargos.routes.ts:30` |
| GET | `/api/recargos/tipos-recargo/vigentes` | `src/modules/recargos/recargos.routes.ts:341` |

## recorridos-canvas

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/recorridos-snapshots/cron-hora` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:67` |
| GET | `/api/recorridos/canvas` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:39` |
| GET | `/api/recorridos/canvas/bonos` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:37` |
| POST | `/api/recorridos/canvas/filas` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:42` |
| DELETE | `/api/recorridos/canvas/filas/:tipo/:id` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:43` |
| GET | `/api/recorridos/canvas/placas` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:38` |
| GET | `/api/recorridos/snapshots` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:51` |
| POST | `/api/recorridos/snapshots` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:52` |
| GET | `/api/recorridos/snapshots/:id` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:53` |
| GET | `/api/recorridos/snapshots/:id/diff` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:54` |
| POST | `/api/recorridos/snapshots/:id/revertir` | `src/modules/recorridos-canvas/recorridos-canvas.routes.ts:55` |

## salidas-nc

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/salidas-nc` | `src/modules/salidas-nc/salidas-nc.routes.ts:78` |
| POST | `/api/salidas-nc` | `src/modules/salidas-nc/salidas-nc.routes.ts:24` |
| DELETE | `/api/salidas-nc/:id` | `src/modules/salidas-nc/salidas-nc.routes.ts:196` |
| GET | `/api/salidas-nc/:id` | `src/modules/salidas-nc/salidas-nc.routes.ts:157` |
| PUT | `/api/salidas-nc/:id` | `src/modules/salidas-nc/salidas-nc.routes.ts:176` |
| GET | `/api/salidas-nc/:id/pdf` | `src/modules/salidas-nc/salidas-nc.routes.ts:138` |
| GET | `/api/salidas-nc/estadisticas` | `src/modules/salidas-nc/salidas-nc.routes.ts:114` |
| GET | `/api/salidas-nc/siguiente-numero` | `src/modules/salidas-nc/salidas-nc.routes.ts:126` |

## servicios

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/servicios` | `src/modules/servicios/servicios.routes.ts:192` |
| POST | `/api/servicios` | `src/modules/servicios/servicios.routes.ts:330` |
| DELETE | `/api/servicios/:id` | `src/modules/servicios/servicios.routes.ts:404` |
| GET | `/api/servicios/:id` | `src/modules/servicios/servicios.routes.ts:297` |
| PUT | `/api/servicios/:id` | `src/modules/servicios/servicios.routes.ts:376` |
| PATCH | `/api/servicios/:id/cancelar` | `src/modules/servicios/servicios.routes.ts:418` |
| POST | `/api/servicios/:id/compartir` | `src/modules/servicios/servicios.routes.ts:484` |
| GET | `/api/servicios/:id/ejecucion` | `src/modules/servicios/servicios.routes.ts:283` |
| PATCH | `/api/servicios/:id/estado` | `src/modules/servicios/servicios.routes.ts:439` |
| PATCH | `/api/servicios/:id/planilla` | `src/modules/servicios/servicios.routes.ts:462` |
| GET | `/api/servicios/:id/rutograma` | `src/modules/servicios/servicios.routes.ts:247` |
| GET | `/api/servicios/buscar` | `src/modules/servicios/servicios.routes.ts:83` |
| GET | `/api/servicios/calendar` | `src/modules/servicios/servicios.routes.ts:105` |
| GET | `/api/servicios/filtros/clientes` | `src/modules/servicios/servicios.routes.ts:169` |
| GET | `/api/servicios/filtros/conductores` | `src/modules/servicios/servicios.routes.ts:125` |
| GET | `/api/servicios/filtros/vehiculos` | `src/modules/servicios/servicios.routes.ts:147` |
| GET | `/api/servicios/public/:token` | `src/modules/servicios/servicios.routes.ts:42` |
| GET | `/api/servicios/stats` | `src/modules/servicios/servicios.routes.ts:56` |
| DELETE | `/api/servicios/token/:token` | `src/modules/servicios/servicios.routes.ts:498` |

## sesiones

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/sesiones` | `src/modules/sesiones/sesiones.routes.ts:12` |
| DELETE | `/api/sesiones/:id` | `src/modules/sesiones/sesiones.routes.ts:22` |
| GET | `/api/sesiones/activas` | `src/modules/sesiones/sesiones.routes.ts:13` |
| GET | `/api/sesiones/app-movil` | `src/modules/sesiones/sesiones.routes.ts:14` |
| GET | `/api/sesiones/mis-sesiones` | `src/modules/sesiones/sesiones.routes.ts:26` |
| DELETE | `/api/sesiones/usuario/:usuarioId` | `src/modules/sesiones/sesiones.routes.ts:23` |

## solicitudes-web

| Método | Ruta | Declarada en |
|---|---|---|
| POST | `/api/public/solicitudes` | `src/modules/solicitudes-web/solicitudes-web.routes.ts:42` |
| GET | `/api/solicitudes` | `src/modules/solicitudes-web/solicitudes-web.routes.ts:68` |
| GET | `/api/solicitudes/:id` | `src/modules/solicitudes-web/solicitudes-web.routes.ts:84` |
| PATCH | `/api/solicitudes/:id` | `src/modules/solicitudes-web/solicitudes-web.routes.ts:92` |
| GET | `/api/solicitudes/resumen` | `src/modules/solicitudes-web/solicitudes-web.routes.ts:76` |

## terceros

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/terceros` | `src/modules/terceros/terceros.routes.ts:52` |
| POST | `/api/terceros` | `src/modules/terceros/terceros.routes.ts:69` |
| DELETE | `/api/terceros/:id` | `src/modules/terceros/terceros.routes.ts:105` |
| GET | `/api/terceros/:id` | `src/modules/terceros/terceros.routes.ts:78` |
| PUT | `/api/terceros/:id` | `src/modules/terceros/terceros.routes.ts:91` |
| GET | `/api/terceros/buscar` | `src/modules/terceros/terceros.routes.ts:36` |
| POST | `/api/terceros/importar-vehiculos` | `src/modules/terceros/terceros.routes.ts:27` |

## usuarios

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/conductores/basicos` | `src/modules/usuarios/usuarios.routes.ts:32` |
| GET | `/api/usuarios` | `src/modules/usuarios/usuarios.routes.ts:20` |
| POST | `/api/usuarios` | `src/modules/usuarios/usuarios.routes.ts:17` |
| GET | `/api/usuarios/:id` | `src/modules/usuarios/usuarios.routes.ts:24` |
| PUT | `/api/usuarios/:id` | `src/modules/usuarios/usuarios.routes.ts:25` |
| PATCH | `/api/usuarios/:id/activo` | `src/modules/usuarios/usuarios.routes.ts:26` |
| DELETE | `/api/usuarios/:id/firma` | `src/modules/usuarios/usuarios.routes.ts:31` |
| POST | `/api/usuarios/:id/firma` | `src/modules/usuarios/usuarios.routes.ts:30` |
| PATCH | `/api/usuarios/:id/permisos` | `src/modules/usuarios/usuarios.routes.ts:27` |
| GET | `/api/usuarios/firmantes` | `src/modules/usuarios/usuarios.routes.ts:21` |
| GET | `/api/usuarios/online-ids` | `src/modules/usuarios/usuarios.routes.ts:23` |
| POST | `/api/usuarios/permisos/bonos-planilla` | `src/modules/usuarios/usuarios.routes.ts:29` |
| GET | `/api/usuarios/presencia` | `src/modules/usuarios/usuarios.routes.ts:22` |

## vehiculos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/flota/basicos` | `src/modules/vehiculos/vehiculos.routes.ts:25` |
| GET | `/api/vehiculos` | `src/modules/vehiculos/vehiculos.routes.ts:43` |
| POST | `/api/vehiculos` | `src/modules/vehiculos/vehiculos.routes.ts:103` |
| DELETE | `/api/vehiculos/:id` | `src/modules/vehiculos/vehiculos.routes.ts:165` |
| GET | `/api/vehiculos/:id` | `src/modules/vehiculos/vehiculos.routes.ts:62` |
| PUT | `/api/vehiculos/:id` | `src/modules/vehiculos/vehiculos.routes.ts:150` |
| PATCH | `/api/vehiculos/:id/ocultar` | `src/modules/vehiculos/vehiculos.routes.ts:232` |
| POST | `/api/vehiculos/:id/restore` | `src/modules/vehiculos/vehiculos.routes.ts:207` |
| GET | `/api/vehiculos/deleted/list` | `src/modules/vehiculos/vehiculos.routes.ts:189` |
| POST | `/api/vehiculos/masivo` | `src/modules/vehiculos/vehiculos.routes.ts:278` |
| GET | `/api/vehiculos/ocultos` | `src/modules/vehiculos/vehiculos.routes.ts:77` |

## vehiculos-documentos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/vehiculos/:id/documentos` | `src/modules/vehiculos-documentos/vehiculos-documentos.routes.ts:37` |
| POST | `/api/vehiculos/:id/documentos` | `src/modules/vehiculos-documentos/vehiculos-documentos.routes.ts:47` |
| DELETE | `/api/vehiculos/:id/documentos/:docId` | `src/modules/vehiculos-documentos/vehiculos-documentos.routes.ts:97` |
| PATCH | `/api/vehiculos/:id/documentos/:docId` | `src/modules/vehiculos-documentos/vehiculos-documentos.routes.ts:78` |
| GET | `/api/vehiculos/:id/documentos/:docId/url` | `src/modules/vehiculos-documentos/vehiculos-documentos.routes.ts:106` |
| GET | `/api/vehiculos/documentos/catalogo` | `src/modules/vehiculos-documentos/vehiculos-documentos.routes.ts:33` |

## viaticos

| Método | Ruta | Declarada en |
|---|---|---|
| GET | `/api/conductor-portal/viaticos` | `src/modules/viaticos/viaticos-portal.routes.ts:35` |
| GET | `/api/conductor-portal/viaticos/:id` | `src/modules/viaticos/viaticos-portal.routes.ts:43` |
| POST | `/api/conductor-portal/viaticos/:id/gastos` | `src/modules/viaticos/viaticos-portal.routes.ts:51` |
| POST | `/api/conductor-portal/viaticos/:id/solicitudes` | `src/modules/viaticos/viaticos-portal.routes.ts:81` |
| POST | `/api/conductor-portal/viaticos/gastos/:gastoId/adjuntos/:id/complete` | `src/modules/viaticos/viaticos-portal.routes.ts:67` |
| POST | `/api/conductor-portal/viaticos/gastos/:gastoId/adjuntos/init` | `src/modules/viaticos/viaticos-portal.routes.ts:59` |
| GET | `/api/viaticos/anticipos` | `src/modules/viaticos/viaticos.routes.ts:52` |
| POST | `/api/viaticos/anticipos` | `src/modules/viaticos/viaticos.routes.ts:68` |
| DELETE | `/api/viaticos/anticipos/:id` | `src/modules/viaticos/viaticos.routes.ts:84` |
| GET | `/api/viaticos/anticipos/:id` | `src/modules/viaticos/viaticos.routes.ts:60` |
| PUT | `/api/viaticos/anticipos/:id` | `src/modules/viaticos/viaticos.routes.ts:76` |
| POST | `/api/viaticos/comprobantes/leer` | `src/modules/viaticos/viaticos.routes.ts:100` |
| POST | `/api/viaticos/comprobantes/presign` | `src/modules/viaticos/viaticos.routes.ts:92` |
| GET | `/api/viaticos/fondo` | `src/modules/viaticos/viaticos.routes.ts:146` |
| POST | `/api/viaticos/fondo/ajustes` | `src/modules/viaticos/viaticos.routes.ts:171` |
| POST | `/api/viaticos/fondo/cierres` | `src/modules/viaticos/viaticos.routes.ts:179` |
| GET | `/api/viaticos/fondo/consolidado` | `src/modules/viaticos/viaticos.routes.ts:154` |
| PATCH | `/api/viaticos/fondo/movimientos/:id` | `src/modules/viaticos/viaticos.routes.ts:187` |
| POST | `/api/viaticos/fondo/recargas` | `src/modules/viaticos/viaticos.routes.ts:163` |
| GET | `/api/viaticos/gastos-empresa` | `src/modules/viaticos/viaticos.routes.ts:223` |
| POST | `/api/viaticos/gastos-empresa` | `src/modules/viaticos/viaticos.routes.ts:231` |
| DELETE | `/api/viaticos/gastos-empresa/:id` | `src/modules/viaticos/viaticos.routes.ts:247` |
| PUT | `/api/viaticos/gastos-empresa/:id` | `src/modules/viaticos/viaticos.routes.ts:239` |
| POST | `/api/viaticos/gastos/:id/anular` | `src/modules/viaticos/viaticos.routes.ts:112` |
| GET | `/api/viaticos/resumen` | `src/modules/viaticos/viaticos.routes.ts:215` |
| GET | `/api/viaticos/solicitudes` | `src/modules/viaticos/viaticos.routes.ts:120` |
| GET | `/api/viaticos/solicitudes/:id` | `src/modules/viaticos/viaticos.routes.ts:128` |
| POST | `/api/viaticos/solicitudes/:id/rechazar` | `src/modules/viaticos/viaticos.routes.ts:136` |
| GET | `/api/viaticos/vehiculos/:id/tercero` | `src/modules/viaticos/viaticos.routes.ts:197` |
| POST | `/api/viaticos/vehiculos/:id/tercero` | `src/modules/viaticos/viaticos.routes.ts:205` |
