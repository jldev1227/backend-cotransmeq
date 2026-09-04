# Contratos de transporte especial y FUEC

## Situación actual

Extractos interpreta `extractos.txt`, intenta relacionar nombres y placas, y agrega nuevas filas
al archivo. Esa estructura no conserva todos los datos del formulario generado, no relaciona
cada extracto con un servicio y no ofrece integridad referencial ni auditoría suficiente.

## Modelo objetivo

`transport_contract` conserva número, contratante, objeto, tipo, origen/destino, inicio, fin,
estado, archivo contractual, cantidad y clase de vehículos. Sus relaciones identifican clientes,
terceros, vehículos y responsables.

`fuec_extract` conserva consecutivo, número completo, contrato, empresa, vehículo, tarjeta de
operación, hasta tres o más conductores normalizados, responsable, vigencia, estado, PDF y
snapshot JSON de todos los datos impresos. El PDF emitido es inmutable; una corrección anula el
anterior y genera otro.

Estados: `BORRADOR`, `VIGENTE`, `VENCIDO` y `ANULADO`.

## Importación histórica

1. Leer el TXT sin modificarlo.
2. Crear una huella estable por fila para que el proceso sea idempotente.
3. Resolver cliente, vehículo y conductores sin crear entidades a partir de valores inválidos.
4. Importar coincidencias seguras; dejar las ambiguas en una bandeja de conciliación.
5. Marcar `source = LEGACY_TXT` y conservar texto original y número de línea.
6. Comparar totales antes/después y generar informe de no conciliados.
7. Cambiar el módulo a lectura/escritura relacional; conservar el TXT como respaldo histórico.

## Control por servicio

Un servicio está `CUBIERTO` solamente cuando:

- Tiene contrato vigente para la fecha y contratante.
- Tiene FUEC vigente ligado a ese contrato.
- Vehículo y conductor del servicio aparecen en el FUEC.
- Tarjeta de operación y documentos habilitantes están vigentes.
- El FUEC no está anulado.

Los demás estados son `SIN_CONTRATO`, `SIN_FUEC`, `VENCIDO`, `VEHICULO_NO_COINCIDE`,
`CONDUCTOR_NO_COINCIDE` o `DOCUMENTOS_NO_VIGENTES`. PESV muestra la alerta y enlaza el
registro exacto en `/dashboard/extractos`.

## Evolución RUNT

Se reservan `external_id`, `external_status`, `last_sync_at`, `request_snapshot` y
`response_snapshot`. La integración electrónica no se activa hasta que exista norma vigente,
servicio publicado, credenciales y homologación. La implementación inicial continúa soportando
la expedición y porte definidos para el FUEC vigente.

Antes de activar esa evolución se debe comprobar la versión finalmente expedida de cualquier
cambio normativo. Como antecedente de planeación, el Ministerio publicó en 2026 un
[proyecto de modificación del FUEC](https://mintransporte.gov.co/publicaciones/12443/mintransporte-publica-para-comentarios-proyecto-de-resolucion-que-modifica-el-formato-unico-de-extracto-del-contrato-fuec/);
un proyecto publicado para comentarios no se implementa como obligación vigente.
