# Plan de pruebas, PDFs y correo

## Objetivo de QA

Demostrar, de forma repetible y sin enviar datos a destinatarios productivos, que cada marca puede recibir la declaración, generar el PDF correcto, persistir su evidencia, mostrarla en el dashboard y entregar una copia a `1227jldev@gmail.com`.

No ejecutar este plan contra producción ni con datos personales reales.

## Configuración sandbox propuesta

Agregar en ambos backends variables equivalentes a:

```dotenv
SARLAFT_EMAIL_MODE=sandbox
SARLAFT_TEST_RECIPIENT=1227jldev@gmail.com
SARLAFT_CLIENT_COPY_ENABLED=true
SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS=3600
```

Comportamiento obligatorio de `sandbox`:

- Solo se permite si `NODE_ENV !== production`.
- Fuerza todos los correos de SARLAFT de esa ejecución al destinatario de prueba.
- Conserva en el asunto un prefijo `[SANDBOX]` y menciona los destinatarios originales solo como texto enmascarado o metadata de test.
- No agrega `1227jldev@gmail.com` a `CANALES_AUTORIZADOS` de Cotransmeq.
- No usa BCC.
- El log no imprime firmas, tokens ni adjuntos.
- Si `NODE_ENV=production` y `SARLAFT_EMAIL_MODE=sandbox`, el proceso debe rechazar esa configuración o ignorarla con error explícito; nunca redirigir silenciosamente correo productivo.

## Datos sintéticos base

Usar datos inequívocamente ficticios:

```text
Razón social: TRANSPORTES QA DOCUMENTAL S.A.S.
NIT: 900999888-1
Representante: JULIÁN QA DOCUMENTAL
C.C.: 1000000123
Teléfono: +57 300 000 0123
Correo y confirmación: 1227jldev@gmail.com
Fecha: fecha fija del test
Firma: PNG sintético generado por fixture
```

Los anexos deben contener la leyenda visible `DOCUMENTO SINTÉTICO DE PRUEBA - SIN VALIDEZ`.

## Pruebas unitarias del dominio

Para los dos backends:

1. El registro devuelve el código correcto por marca.
2. El formato es `individual` y no aparece en el catálogo general.
3. Se rechazan campos obligatorios vacíos.
4. Se rechaza correo distinto de la confirmación en frontend y backend/API si la confirmación viaja separada.
5. Se rechaza `DET-CNF-02` fuera de sus dos valores.
6. Si hay alertas, se exigen observaciones y `anexo_alertas`.
7. Si vehículos revisados o soportes vigentes es `No`, se exigen observaciones.
8. La firma debe ser una data URL de imagen permitida y respetar un tamaño máximo.
9. `extraerDatosClave` obtiene razón social, NIT, correo y teléfono correctos.
10. El estado inicial no marca resultado.
11. `aprobado`, `condicionado` y `rechazado` marcan exactamente una casilla.
12. Un intento con `escalado` no marca resultado.

## Pruebas unitarias del generador PDF

Crear fixtures y specs equivalentes a los tests actuales de `tests/sarlaft-pdf`, uno por marca.

Casos mínimos:

- Datos normales sin alertas.
- Datos con alertas y observación de dos líneas.
- Valores de longitud máxima permitida.
- Firma apaisada, firma alta y firma transparente.
- Tildes, Ñ, caracteres de NIT y correo.
- Resultado aprobado, condicionado y no aprobado.
- Template ausente o con hash distinto: debe fallar, no generar sobre un asset desconocido.

Asserts automáticos:

- Buffer inicia con `%PDF`.
- Una página y tamaño carta.
- Tamaño de archivo razonable.
- Texto extraído contiene razón social, NIT, representante y fecha.
- No contiene `data:image`, IP, user agent ni nombres de la otra marca.
- Hash calculado y no vacío.
- Al reabrirlo no está cifrado ni corrupto.

## Revisión visual obligatoria

Renderizar cada PDF a PNG a 160-200 DPI y revisar:

- logos, marco, marca de agua y pie completos;
- texto dentro de líneas/celdas, sin solapamiento;
- firma legible y contenida;
- una sola opción de alertas marcada;
- resultado correcto o totalmente en blanco;
- sección 3 y sección 4 completas en Transmeralda;
- ninguna palabra o paleta de la otra marca;
- impresión carta sin contenido fuera del área segura.

Guardar las salidas de revisión en una carpeta de test ignorada por Git, excepto los golden files que el equipo decida versionar.

## Pruebas de integración del servicio

Mockear Prisma, almacenamiento y correo para probar:

1. Orden: validar, radicar, persistir snapshot, generar, almacenar PDF, registrar hash, notificar.
2. Si falla el generador, el POST no debe reportar éxito documental.
3. Si falla S3 antes de guardar el PDF, limpiar solo objetos creados por ese intento.
4. Si falla el correo, conservar radicado/documento y crear entrega fallida o pendiente.
5. Un reintento no genera múltiples entregas idénticas.
6. La copia del declarante contiene solo el PDF; el correo interno conserva los anexos autorizados.
7. La descarga pública rechaza token inválido, vencido o ya revocado.
8. La descarga administrativa exige autenticación.
9. Cambiar a `condicionado` crea una nueva versión y no altera el hash de la primera.

## E2E por marca

Extender o crear scripts a partir de `tests/e2e-sarlaft.mjs`.

Secuencia:

1. Arrancar backend local con base de datos de QA aislada, almacenamiento de QA y correo sandbox.
2. Consultar el código individual de la marca.
3. Construir respuestas desde la definición, pero sobrescribir los datos sintéticos base para que sean reconocibles.
4. Enviar multipart sin alertas.
5. Verificar HTTP 201, patrón de radicado, documento, hash, download URL y entrega.
6. Descargar usando el token y comparar SHA-256 con la respuesta.
7. Autenticar un usuario QA del dashboard.
8. Verificar listado, filtro, detalle, documento generado y hash.
9. Evaluar como `condicionado` y comprobar la segunda versión.
10. Repetir con alertas y anexo.
11. Confirmar que todos los correos de la corrida llegaron solamente a `1227jldev@gmail.com`.

Ejecutar Transmeralda y Cotransmeq en corridas separadas. No compartir base URL, credenciales, bucket/prefijo ni variables de marca.

## Verificación del correo real de QA

Por cada marca deben recibirse como mínimo:

- una notificación interna redirigida por sandbox;
- una copia dirigida al declarante;
- opcionalmente una copia evaluada si se aprueba ese comportamiento.

Checklist manual:

- `From` corresponde a un dominio verificado de la marca.
- `To` es solo `1227jldev@gmail.com`.
- Asunto incluye `[SANDBOX]`, marca, código y radicado.
- PDF adjunto abre correctamente y su hash coincide.
- Correo al declarante no contiene anexos internos.
- Enlaces apuntan al ambiente QA correcto y expiran.
- No aparece branding, dominio ni correo de la otra empresa.
- El provider message ID queda registrado.

## Matriz de aceptación

| Caso | Transmeralda | Cotransmeq |
|---|---:|---:|
| Definición individual disponible | Pendiente | Pendiente |
| Envío sin alertas | Pendiente | Pendiente |
| Envío con alertas + anexo | Pendiente | Pendiente |
| PDF inicial visualmente aprobado | Pendiente | Pendiente |
| Descarga temporal y hash | Pendiente | Pendiente |
| Correo interno sandbox recibido | Pendiente | Pendiente |
| Copia del declarante recibida | Pendiente | Pendiente |
| Dashboard lista y abre detalle | Pendiente | Pendiente |
| Resultado condicionado genera v2 | Pendiente | Pendiente |
| No regresión de 4 formatos existentes | Pendiente | Pendiente |

## Evidencia que debe entregar Claude

- Salida resumida de tests con fecha y commit.
- Rutas de los dos PDF generados de muestra.
- Capturas/render PNG de las dos páginas.
- SHA-256 de cada PDF generado.
- Radicados de QA.
- Provider message IDs de los correos de prueba.
- Confirmación de destinatario efectivo, sin copiar contenido sensible.
- Lista de migraciones SQL manuales pendientes de ejecución humana.

