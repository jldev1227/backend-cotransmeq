# Integración de la declaración SARLAFT/PTEE para empresas de transporte

## Objetivo

Incorporar en los ecosistemas de TRANSMERALDA S.A.S. y COTRANSMEQ S.A.S. una declaración pública para proveedores que sean empresas de transporte, reutilizando el flujo SARLAFT/PTEE existente y generando el documento final sobre el formato PDF controlado de cada marca.

La solución debe:

1. Capturar en la landing los datos y declaraciones del representante legal.
2. Validar y radicar el envío en el backend existente.
3. Diligenciar el PDF propio de la marca sin reemplazarlo por el PDF genérico actual.
4. Conservar una copia inmutable, versionada y verificable del PDF generado.
5. Notificar a las áreas internas como ocurre hoy.
6. Entregar al declarante una copia del documento por correo y permitir su descarga segura desde la confirmación.
7. Mostrar y evaluar el nuevo tipo de formulario en el dashboard SARLAFT/PTEE.

## Repositorios involucrados

| Marca | Capa | Ruta local analizada |
|---|---|---|
| Transmeralda | Landing | `/Users/julianlopez/Desktop/transmeralda/landing-transmeralda-1` |
| Transmeralda | Backend | `/Users/julianlopez/Desktop/transmeralda/backend-nest` |
| Transmeralda | Dashboard | `/Users/julianlopez/Desktop/transmeralda/ingreso-svelte` |
| Cotransmeq | Landing | `/Users/julianlopez/Desktop/Cotransmeq/landing` |
| Cotransmeq | Backend | `/Users/julianlopez/Desktop/Cotransmeq/backend-nest-main 2` |
| Cotransmeq | Dashboard | `/Users/julianlopez/Desktop/Cotransmeq/ingreso-svelte-main 2` |

Los proyectos son independientes. No se debe asumir que desplegar o modificar el proyecto de Transmeralda actualiza Cotransmeq, ni viceversa.

## Línea base encontrada

El flujo actual ya ofrece:

- definiciones dinámicas para `SLFT-PTEE-FR-04`, `SLFT-PTEE-FR-05`, `SLFT-PTEE-FR-06` y `SLFT-PTEE-FR-12`;
- rutas públicas `GET` de definición/contacto/documentos y un `POST multipart` común;
- validación de obligatorios, firma canvas, adjuntos, radicado y snapshot JSON;
- almacenamiento de anexos con SHA-256;
- PDF genérico HTML, notificación interna, descarga administrativa y ZIP de evidencia;
- renderizado genérico en el dashboard para formatos individuales.

Brechas frente a este requerimiento:

- no existe el tipo ni la ruta de declaración de empresa de transporte;
- el generador actual recrea un documento HTML y no escribe sobre un template PDF;
- el PDF generado no se persiste como binario inmutable ni tiene historial de versiones;
- el `POST` devuelve JSON con radicado, pero no entrega el PDF al declarante;
- el correo actual es solo interno;
- no existe registro de intentos/message ID de entrega;
- no existe el estado administrativo `condicionado`;
- la validación de anexos actual depende del tipo de formulario/cliente, no de respuestas condicionales como `Existen alertas`.

## Insumos PDF controlados

| Marca | Archivo fuente | Código visible | SHA-256 del archivo entregado |
|---|---|---|---|
| Cotransmeq | `DECLARACION PROVEEDOR EMPRESA DE TRANSPORTE.pdf` | `GC-FOR-13 V.01` | `01797d062fb3ba793207eb9ed45e0dfc00a1a59a9970c5f9c1f62a94e39598ec` |
| Transmeralda | `DECLARACION SALRFT -PTEE EMP TRANSPORTE.pdf` | `SLFT-PTEE-FR-13`, versión `1`, fecha `12-05-2026` | `dd8ba552efd01b2216e7587a48318ea864d15879d02764a3a90229fa1f84906e` |

Ambos archivos son PDF 1.7, tamaño carta, una página, sin cifrado y sin AcroForm. Por lo tanto, no se pueden diligenciar llamando a una API de campos de formulario: hay que cargar la página original y dibujar texto, marcas y firma en coordenadas controladas.

## Decisión de arquitectura

Se agregará un formato individual llamado lógicamente `declaracion_empresa_transporte`. No aparecerá en el selector general de los tres formularios de conocimiento; tendrá una ruta pública compartible, de la misma forma que hoy funciona `autorizacion_propietario`.

Identidad propuesta por marca:

| Marca | Código de formato | Versión | Tipo lógico | Serie de radicado propuesta |
|---|---|---|---|---|
| Cotransmeq | `GC-FOR-13` | `01` | `declaracion_empresa_transporte` | `DECL-TRA-AAAA-#####` |
| Transmeralda | `SLFT-PTEE-FR-13` | `1` | `declaracion_empresa_transporte` | `DECL-TRA-AAAA-#####` |

No se debe homogeneizar el código documental entre marcas: el código `GC-FOR-13` de Cotransmeq debe conservarse tal como aparece en el formato, aunque otros documentos usen la sigla `FR`.

## Flujo funcional objetivo

1. El usuario abre `/declaracion-empresa-transporte` en la landing de la marca correcta.
2. La landing obtiene la definición desde `GET /api/public/formularios-sarlaft/:codigo`.
3. El usuario diligencia datos, confirma los compromisos, registra observaciones, adjunta el anexo de alertas cuando aplique y firma.
4. Antes del envío se presenta un resumen con razón social, NIT, representante y correo de entrega.
5. El backend valida formato, coherencia de confirmaciones, firma, correo y anexos condicionales.
6. El backend crea el radicado y el snapshot JSON, genera el PDF sobre el template de la marca, calcula su SHA-256 y lo guarda en almacenamiento.
7. La transacción funcional solo se considera recibida cuando existen el registro y el documento generado. La falla de correo no debe borrar el radicado; debe quedar como entrega pendiente/reintentable.
8. Se envía la notificación interna existente, adjuntando el nuevo PDF y los anexos.
9. Se envía al correo confirmado por el declarante una copia del PDF, sin adjuntar documentos de identidad u otros anexos internos.
10. La respuesta del POST incluye radicado, hash del PDF y un enlace temporal de descarga de un solo documento.
11. El dashboard permite revisar el radicado y cambiar su resultado a Aprobado, Condicionado o No aprobado.
12. Al emitir un resultado se genera una nueva versión inmutable del PDF; nunca se sobrescribe la versión recibida.

## Ciclo de vida del campo Resultado

El resultado es de uso interno y no lo elige el proveedor.

| Momento | PDF | Marcas de resultado |
|---|---|---|
| Envío inicial | Versión `recibida` | Ninguna marcada |
| Revisión en curso | No requiere nueva versión | Ninguna marcada |
| Decisión final | Nueva versión `evaluada` | Exactamente una: Aprobado, Condicionado o No aprobado |

El dashboard actual no tiene el estado `condicionado`; debe agregarse al backend y a ambos dashboards. No se debe usar `escalado` como sinónimo porque representan decisiones distintas.

## Trazabilidad documental mínima

Cada documento generado debe conservar:

- ID y radicado del formulario origen.
- Marca/tenant.
- Código y versión del formato.
- SHA-256 del template fuente.
- SHA-256 del PDF producido.
- Ruta/clave del objeto en almacenamiento.
- Tamaño, MIME y fecha de generación en UTC.
- Estado documental: `recibida` o `evaluada`.
- Número secuencial de versión documental.
- Usuario evaluador para la versión evaluada.
- Destinatario, estado, proveedor y message ID de cada intento de correo, sin almacenar el cuerpo completo del correo.

No es suficiente regenerar el PDF bajo demanda desde el JSON: para trazabilidad debe persistirse exactamente el binario que fue entregado.

## Seguridad y privacidad

- El enlace público de descarga debe usar un token aleatorio de un solo propósito, almacenar solo su hash y expirar. No debe aceptar solo el radicado como credencial.
- El PDF entregado al declarante no incluye IP, user agent, notas internas ni anexos cargados.
- El correo al declarante se envía solo a la dirección confirmada en el formulario. Se debe pedir doble digitación del correo o una pantalla final de confirmación.
- Los destinatarios internos siguen la configuración autorizada de cada marca. El correo de QA no debe agregarse a la lista blanca productiva de Cotransmeq.
- Nunca usar BCC para copiar formularios SARLAFT/PTEE.
- No registrar firmas data URL, tokens ni documentos completos en logs.
- Sanitizar nombres de archivo y texto antes de dibujarlo en el PDF o incluirlo en HTML de correo.

## Alcance de los README de esta carpeta

- `README_TEMPLATES_Y_MAPEO.md`: auditoría visual, defectos y mapa campo a campo.
- `README_IMPLEMENTACION_CLAUDE.md`: cambios concretos por repositorio y orden recomendado.
- `README_QA_EMAIL.md`: pruebas automáticas, revisión visual y envíos controlados a `1227jldev@gmail.com`.

## Criterio global de terminado

La funcionalidad no está terminada hasta que, para ambas marcas, un envío real de QA produzca un radicado, un PDF visualmente correcto basado en el template correspondiente, un registro/hash verificable, una notificación interna en modo sandbox y una copia recibida en `1227jldev@gmail.com`, sin fugas de branding ni destinatarios de la otra empresa.
