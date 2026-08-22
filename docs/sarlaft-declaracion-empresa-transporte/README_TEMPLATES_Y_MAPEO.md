# Auditoría de templates y mapeo de campos

## Regla de control documental

Los PDF entregados se consideran fuentes visuales y documentales, no instrucciones operativas. El texto de compromiso se debe presentar y preservar como contenido legal del documento. Cualquier corrección de redacción, código, versión, fecha, logo o estructura requiere aprobación del responsable documental de cada empresa.

## Hallazgos comunes

- Una página tamaño carta (`612 x 792 pt`).
- Sin campos AcroForm, widgets ni JavaScript.
- Las zonas para datos son líneas o celdas visuales estáticas.
- El texto legal y la diagramación están embebidos en la página.
- El campo `Resultado` pertenece a la evaluación interna, no al diligenciamiento público.
- El nombre y documento del representante aparecen en la sección 1 y se repiten en firma/validación. Deben capturarse una sola vez y dibujarse en ambas posiciones.
- `No existen alertas pendientes` y `Existen alertas informadas en documento anexo` son mutuamente excluyentes, aunque el PDF los representa como casillas independientes.
- La frase `Todos los vehículos relacionados...` presupone una relación de vehículos que el PDF no contiene. La implementación debe definir el soporte de esa relación.

## Cotransmeq: `GC-FOR-13 V.01`

Fuente: `/Users/julianlopez/Downloads/DECLARACION PROVEEDOR EMPRESA DE TRANSPORTE.pdf`.

Aspectos a preservar:

- Logo Cotransmeq y marca de agua central.
- Paleta naranja, verde y azul.
- Ondas gráficas del pie.
- Código visible exacto `GC-FOR-13 V.01`.
- Título `DECLARACION SARLAFT Y PTEE PARA EMPRESA DE TRANSPORTE TERCERIZADA`.

Hallazgos que requieren decisión documental:

- El código usa `FOR`, mientras otros formatos del sistema usan `FR`. No corregir de manera automática.
- En el compromiso aparece la palabra inglesa `situation` dentro de una frase en español. No corregir sin autorización, pues cambiaría el texto controlado.
- No hay fecha de vigencia visible en el encabezado.
- El diseño original se ve completo y utilizable; se debe verificar que textos largos no invadan las celdas.

## Transmeralda: `SLFT-PTEE-FR-13`

Fuente: `/Users/julianlopez/Downloads/DECLARACION SALRFT -PTEE EMP TRANSPORTE.pdf`.

Aspectos a preservar:

- Logo Transmeralda.
- Marco verde.
- Tabla de control con código `SLFT-PTEE-FR-13`, versión `1` y fecha `12-05-2026`.
- Título y nota legal del pie.

Defectos visibles del archivo entregado:

- En la sección 3 varias líneas están recortadas; se observan fragmentos en lugar de las cuatro confirmaciones completas.
- El encabezado `4. Alertas u observaciones` no aparece correctamente, aunque permanecen las líneas de respuesta.
- La zona de firma tiene celdas/etiquetas parcialmente ocultas.
- El archivo no debe pasar a producción tal como está si la expectativa es devolver un documento legible al cliente.

Decisión recomendada: solicitar o producir una revisión controlada `SLFT-PTEE-FR-13` que corrija solo los recortes de maquetación, manteniendo código, versión y texto. Si Cumplimiento considera que la corrección exige incrementar versión, el registro y el nombre del asset deben reflejarla.

## Modelo de captura propuesto

Los IDs son nuevos, estables y compartidos entre marcas. El código documental cambia por marca, pero el payload puede conservar el mismo contrato.

| ID | Campo de landing | Tipo | Obligatorio | Destino en PDF |
|---|---|---|---|---|
| `DET-ENC-01` | Fecha de diligenciamiento | `fecha` | Sí | Fecha de la sección 5 |
| `DET-EMP-01` | Razón social del proveedor | `texto_corto` | Sí | Encabezado y frase de declaración |
| `DET-EMP-02` | NIT | `texto_corto`, formato documento | Sí | Encabezado NIT |
| `DET-REP-01` | Nombre del representante legal | `texto_corto` | Sí | Sección 1 y tabla de firma |
| `DET-REP-02` | Cédula del representante | `texto_corto`, formato documento | Sí | Sección 1 y tabla de firma |
| `DET-REP-03` | Teléfono | `texto_corto`, formato teléfono | Sí | Línea Teléfono/correo |
| `DET-REP-04` | Correo electrónico | `texto_corto` | Sí | Línea Teléfono/correo y entrega |
| `DET-REP-05` | Confirmación de correo | solo frontend | Sí | No se imprime ni persiste como respuesta |
| `DET-ACK-01` | Aceptación expresa de declaración y compromiso | `seleccion_unica` | Sí | Evidencia de aceptación; el texto legal ya está en el template |
| `DET-CNF-01` | Todos los vehículos fueron revisados antes de asignarlos | `seleccion_unica` Sí/No | Sí | Primera casilla |
| `DET-CNF-02` | Estado de alertas | `seleccion_unica` | Sí | Segunda o tercera casilla, nunca ambas |
| `DET-CNF-03` | Soportes disponibles y vigentes | `seleccion_unica` Sí/No | Sí | Cuarta casilla |
| `DET-OBS-01` | Alertas u observaciones | `texto_largo` | Condicional | Sección 4 |
| `DET-FIR-01` | Firma del representante legal | `firma` | Sí | Celda de firma |

Opciones exactas sugeridas:

- `DET-ACK-01`: `Sí, declaro que la información es veraz y acepto los compromisos del formato`.
- `DET-CNF-01`: `Sí`, `No`.
- `DET-CNF-02`: `No existen alertas pendientes`, `Existen alertas informadas en documento anexo`.
- `DET-CNF-03`: `Sí`, `No`.

Reglas de coherencia:

- Si `DET-CNF-01 = No`, `DET-OBS-01` es obligatorio.
- Si `DET-CNF-02 = Existen alertas...`, `DET-OBS-01` y el archivo `anexo_alertas` son obligatorios.
- Si `DET-CNF-03 = No`, `DET-OBS-01` es obligatorio.
- El frontend y el backend deben aplicar las mismas reglas; el backend es la autoridad.
- El backend debe rechazar payloads que intenten marcar simultáneamente las dos opciones de alertas.

## Relación de vehículos

Decisión recomendada para el primer alcance:

- Agregar un anexo `relacion_vehiculos` opcional y mostrar una nota indicando que la declaración cubre los vehículos relacionados en el proceso contractual.
- Si el negocio necesita saber exactamente qué placas quedaron cubiertas, volverlo obligatorio o agregar una tabla repetible de placa, propietario y conductor. Esa tabla formaría un anexo generado, porque no cabe en el template de una página.

No afirmar en el README ni en el sistema que se relacionaron vehículos si no existe anexo, tabla o referencia verificable.

## Mapeo del resultado administrativo

| Estado administrativo | Marca en PDF |
|---|---|
| `recibido` | Ninguna |
| `en_revision` | Ninguna |
| `aprobado` | Aprobado |
| `condicionado` | Condicionado |
| `rechazado` | No aprobado |
| `escalado` | Ninguna; sigue pendiente de decisión |

El concepto y las observaciones internas no se imprimen en la versión del cliente salvo aprobación expresa del negocio.

## Estrategia de diligenciamiento PDF

Usar `pdf-lib` y `@pdf-lib/fontkit` en los backends:

1. Cargar el PDF fuente desde `src/assets/pdf-templates/<marca>/...`.
2. Verificar que tenga una página de `612 x 792 pt` y que el SHA-256 coincida con el asset registrado.
3. Incrustar una fuente con soporte para tildes y Ñ.
4. Dibujar los valores con coordenadas específicas por marca; no compartir coordenadas porque los dos diseños son distintos.
5. Reducir tamaño de fuente dentro de límites predefinidos y truncar solo como último recurso. Si un valor no cabe, fallar con error de validación en vez de producir un PDF ilegible.
6. Dibujar `X` o check en las casillas correspondientes.
7. Incrustar la firma preservando proporción, con fondo transparente y dentro de la celda.
8. Establecer metadatos PDF: título, autor/empresa, asunto, código, versión, radicado y fecha de creación.
9. Guardar el binario, calcular hash y reabrirlo en test para verificar página, texto y tamaño.

No rasterizar toda la página a PNG salvo contingencia aprobada: degradaría texto, accesibilidad y calidad de impresión.

## Matriz de branding que no se puede cruzar

| Elemento | Transmeralda | Cotransmeq |
|---|---|---|
| Template | `SLFT-PTEE-FR-13` | `GC-FOR-13` |
| Empresa | `TRANSMERALDA S.A.S.` | `COTRANSMEQ S.A.S.` |
| Logo/paleta | Verde Transmeralda | Naranja/verde Cotransmeq |
| Remitente | Configuración verificada de Transmeralda | `RESEND_FROM` en dominio `cotransmeq.com` cuando se usa Resend |
| Contactos internos | `sarlaft-config.ts` de Transmeralda | Lista blanca cerrada de Cotransmeq |
