import { buildFontsCss } from '../liquidaciones-terceros-pdf/fonts';
import { sncCssVars } from './snc-pdf-tokens';
import { resolverLogoCotransmeq } from '../../lib/branding';
import fs from 'fs';

/**
 * Plantilla HTML + CSS del registro de Salida No Conforme.
 *
 * ── Por qué HTML y no PDFKit ──
 * El generador anterior dibujaba el documento con PDFKit: 456 líneas
 * llevando a mano una `yPos`, sumando alturas de celda y decidiendo saltos
 * de página con `checkPage(100)` —una estimación—. Cualquier cambio de
 * contenido obligaba a recalcular coordenadas, y una descripción larga
 * podía partirse a mitad de celda sin que nada avisara.
 *
 * Aquí la paginación la resuelve el motor de maquetación: `break-inside:
 * avoid` sobre cada sección, y Chromium decide. Es el mismo camino que ya
 * usa el PDF de liquidaciones de terceros (`pdfFromHtml`, Puppeteer +
 * Chromium), así que ahora los documentos del producto se generan todos
 * igual y comparten la escala tipográfica.
 *
 * ── Lo que NO cambia ──
 * Es un registro CONTROLADO por ISO 9001:2015, cláusula 8.7. Las secciones,
 * su numeración, sus referencias normativas (`ISO 8.7.2 a`, `ISO 8.7.1
 * d`...) y las etiquetas de los campos son las mismas, literalmente, que en
 * el generador anterior. Lo que cambia es cómo se pinta, no qué dice.
 *
 * @see services/pdf.service.ts       — el render (Puppeteer)
 * @see snc-pdf-tokens.ts             — los tokens visuales
 * @see snc-pdf-estructura.spec.ts    — el test que fija secciones y refs ISO
 */

// ── Datos de entrada ────────────────────────────────────────────────

export interface SalidaNCPdf {
  numero_snc: number;
  fecha_deteccion: Date | string;
  fecha_evento: Date | string;
  detectado_por: string;
  area_proceso: string;
  tipo_deteccion: string;
  tipo_deteccion_otro?: string | null;
  vehiculo_placa?: string | null;
  ruta_trayecto?: string | null;
  turno_horario?: string | null;
  conductor_nombre?: string | null;
  conductor_cedula?: string | null;
  cliente_contrato?: string | null;
  servicio_afectado?: string | null;
  descripcion_nc: string;
  clasificacion_nc: string;
  tipo_salida_nc: string;
  tipo_salida_nc_otro?: string | null;
  estado: string;
  observaciones?: string | null;
  tratamiento_seleccionado?: string | null;
  descripcion_accion_tomada?: string | null;
  responsable_accion?: string | null;
  fecha_implementacion?: Date | string | null;
  autoridad_disposicion?: string | null;
  concesion_solicitada?: boolean | null;
  condiciones_concesion?: string | null;
  concesion_cliente_nombre?: string | null;
  concesion_cliente_fecha?: Date | string | null;
  concesion_medio?: string | null;
  metodo_verificacion?: string | null;
  metodo_verificacion_otro?: string | null;
  resultado_verificacion?: string | null;
  cumple_requisitos?: boolean | null;
  responsable_verificacion?: string | null;
  fecha_verificacion?: Date | string | null;
  firma_verificacion?: string | null;
}

// ── Etiquetas ───────────────────────────────────────────────────────
// Copiadas literalmente del generador PDFKit anterior. Un cambio de
// redacción aquí cambia un registro de calidad ya emitido: no se tocan sin
// pasar por el responsable del SGC.

const CLASIFICACION_LABELS: Record<string, string> = {
  CRITICA: 'CRÍTICA — Afecta seguridad de personas',
  MAYOR: 'MAYOR — Afecta conformidad del servicio',
  MENOR: 'MENOR — Desviación controlable'
};

const TIPO_DETECCION_LABELS: Record<string, string> = {
  DURANTE_SERVICIO: 'Durante el servicio',
  POST_SERVICIO: 'Post servicio',
  AUDITORIA_INTERVENTORIA: 'Auditoría / Interventoría',
  REPORTE_CLIENTE: 'Reporte del cliente',
  OTRO: 'Otro'
};

const TIPO_SALIDA_NC_LABELS: Record<string, string> = {
  GPS_SISTEMA_TECNOLOGICO: 'GPS / Sistema tecnológico',
  INCUMPLIMIENTO_RUTA_HORARIO_DESTINO: 'Incumplimiento ruta/horario/destino',
  VEHICULO_DIFERENTE_SIN_APROBACION: 'Vehículo diferente sin aprobación',
  FALLA_MECANICA_ELECTRICA: 'Falla mecánica/eléctrica',
  DOCUMENTACION_VENCIDA_INCOMPLETA: 'Documentación vencida/incompleta',
  CONDUCTOR_NO_APTO_INFRACCION_VIAL: 'Conductor no apto / infracción vial',
  QUEJA_CLIENTE: 'Queja del cliente',
  HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE: 'Hallazgo auditoría/interventoría/cliente',
  PERSONAL_NO_AUTORIZADO_TRANSPORTADO: 'Personal no autorizado transportado',
  OTRO: 'Otro'
};

const ESTADO_LABELS: Record<string, string> = {
  ABIERTA: 'ABIERTA',
  EN_TRATAMIENTO: 'EN TRATAMIENTO',
  CERRADA: 'CERRADA'
};

const TRATAMIENTO_LABELS: Record<string, string> = {
  CORRECCION: 'Corrección — Acción inmediata para eliminar la NC',
  CONTENCION: 'Contención — Control de efectos mientras se define disposición',
  SUSPENSION: 'Suspensión — Detener la prestación del servicio',
  CONCESION: 'Concesión — Autorización formal del cliente'
};

const MEDIO_AUTORIZACION_LABELS: Record<string, string> = {
  ESCRITO: 'Escrito',
  CORREO: 'Correo electrónico',
  ACTA: 'Acta'
};

const METODO_VERIFICACION_LABELS: Record<string, string> = {
  REVISION_DOCUMENTAL: 'Revisión documental',
  VERIFICACION_OPERATIVA_CAMPO: 'Verificación operativa en campo',
  CONFIRMACION_GPS_PLATAFORMA: 'Confirmación GPS / plataforma',
  CONFIRMACION_CLIENTE_INTERVENTOR: 'Confirmación del cliente / interventor',
  OTRO: 'Otro'
};

// ── Utilidades ──────────────────────────────────────────────────────

/// La ruta la resuelve `lib/branding`: este repo arrastra del original tres
/// archivos de logotipo con nombre parecido y dos son de TRANSMERALDA. Un
/// registro de Cotransmeq con la marca de la otra empresa es peor que uno sin
/// marca, así que el helper nunca cae a esos.
let logoDataUrl: string | null = null;
function getLogoDataUrl(): string {
  if (logoDataUrl !== null) return logoDataUrl;
  const ruta = resolverLogoCotransmeq();
  if (!ruta) {
    logoDataUrl = '';
    return logoDataUrl;
  }
  try {
    const buf = fs.readFileSync(ruta);
    logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    // Sin logo el documento sigue siendo válido; el encabezado cae al
    // nombre de la empresa en texto.
    logoDataUrl = '';
  }
  return logoDataUrl;
}

/**
 * Escapa el contenido antes de meterlo en el HTML.
 *
 * No es cosmética: `descripcion_nc`, `observaciones` y `resultado_verificacion`
 * los escribe un usuario. Sin escapar, un `<` en una descripción rompe la
 * maquetación del registro, y cualquier etiqueta que alguien pegue desde un
 * correo se ejecutaría dentro del Chromium que genera el PDF.
 */
function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fecha del documento, en UTC.
 *
 * `timeZone: 'UTC'` NO es un detalle: las cinco fechas que imprime este
 * registro —detección, evento, implementación, autorización y verificación—
 * son columnas `@db.Date` de Postgres. Prisma las devuelve como un `Date`
 * situado a MEDIANOCHE UTC, y el servidor corre en America/Bogota (UTC-5).
 * Sin fijar la zona, `toLocaleDateString` restaba cinco horas y el
 * documento imprimía SIEMPRE EL DÍA ANTERIOR: una SNC detectada el 4 de
 * marzo salía fechada el 3.
 *
 * El generador anterior tenía el mismo fallo, así que los registros ya
 * emitidos llevan la fecha corrida un día. Se arregla aquí porque en un
 * registro ISO la fecha de detección es un dato con consecuencias.
 */
function formatearFecha(fecha: Date | string | null | undefined): string {
  if (!fecha) return 'N/A';
  return new Date(fecha).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/** Mismo criterio que el generador anterior: vacío y nulo se leen «N/A». */
function val(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'N/A';
  if (typeof v === 'boolean') return v ? 'SÍ' : 'NO';
  return String(v);
}

/** Una celda: etiqueta arriba, valor debajo. `span` en columnas de 12. */
function celda(label: string, valor: string, span = 4): string {
  return `<div class="celda" style="grid-column:span ${span}">
      <div class="celda-label">${esc(label)}</div>
      <div class="celda-valor">${esc(valor)}</div>
    </div>`;
}

function seccion(numero: string, titulo: string, iso: string | null, cuerpo: string): string {
  return `<section class="seccion">
      <header class="seccion-head">
        <span class="seccion-num">${esc(numero)}</span>
        <h2>${esc(titulo)}</h2>
        ${iso ? `<span class="seccion-iso">${esc(iso)}</span>` : ''}
      </header>
      <div class="rejilla">${cuerpo}</div>
    </section>`;
}

// ── Plantilla ───────────────────────────────────────────────────────

export function renderSalidaNCPdf(s: SalidaNCPdf): string {
  const sncNum = `SNC-${String(s.numero_snc).padStart(4, '0')}`;
  const estadoLabel = ESTADO_LABELS[s.estado] || s.estado;
  const estadoClase =
    s.estado === 'CERRADA' ? 'ok' : s.estado === 'EN_TRATAMIENTO' ? 'aviso' : 'alerta';

  const clasificLabel = CLASIFICACION_LABELS[s.clasificacion_nc] || s.clasificacion_nc;
  const clasifClase =
    s.clasificacion_nc === 'CRITICA' ? 'alerta' : s.clasificacion_nc === 'MAYOR' ? 'mayor' : 'aviso';

  const tipoDetLabel =
    s.tipo_deteccion === 'OTRO' && s.tipo_deteccion_otro
      ? `Otro: ${s.tipo_deteccion_otro}`
      : TIPO_DETECCION_LABELS[s.tipo_deteccion] || s.tipo_deteccion;

  const tipoSalidaLabel =
    s.tipo_salida_nc === 'OTRO' && s.tipo_salida_nc_otro
      ? `Otro: ${s.tipo_salida_nc_otro}`
      : TIPO_SALIDA_NC_LABELS[s.tipo_salida_nc] || s.tipo_salida_nc;

  const tratamientoLabel = s.tratamiento_seleccionado
    ? TRATAMIENTO_LABELS[s.tratamiento_seleccionado] || s.tratamiento_seleccionado
    : 'N/A';

  const metodoLabel =
    s.metodo_verificacion === 'OTRO' && s.metodo_verificacion_otro
      ? `Otro: ${s.metodo_verificacion_otro}`
      : s.metodo_verificacion
        ? METODO_VERIFICACION_LABELS[s.metodo_verificacion] || s.metodo_verificacion
        : 'N/A';

  let cumpleLabel = 'N/A';
  if (s.cumple_requisitos === true) cumpleLabel = '✓ SÍ — Cierre de la SNC';
  else if (s.cumple_requisitos === false) cumpleLabel = '✗ NO — Escalar AC';

  /// La concesión es una sección CONDICIONAL, y de ella depende que la
  /// verificación sea la 4 o la 5. Se calcula una sola vez: tener el número
  /// escrito en dos sitios fue exactamente lo que hacía frágil al generador
  /// anterior.
  const hayConcesion = s.tratamiento_seleccionado === 'CONCESION' || !!s.concesion_solicitada;
  const numVerificacion = hayConcesion ? '5' : '4';

  const logo = getLogoDataUrl();

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(sncNum)}</title>
<style>
${buildFontsCss()}

:root{${sncCssVars()}}

/* Los márgenes NO van aquí: se pasan desde el servicio. Los dos repos
   tratan preferCSSPageSize de forma distinta —uno borra el margen
   explícito y el otro no— y el mismo documento salía con márgenes
   diferentes en cada uno. Fijándolos en el render es idéntico. */
@page{ size: Letter portrait; }

*{ box-sizing: border-box; margin: 0; padding: 0; }

body{
  font-family: var(--snc-fuente-sans);
  font-size: var(--snc-fs-body);
  color: var(--snc-tinta);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── Encabezado ───────────────────────────────────────────────── */
.doc-head{
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 6px;
  border-bottom: var(--snc-borde-marco) solid var(--snc-rojo);
}
.doc-logo{ width: 130px; height: auto; }
.doc-marca{ font-weight: 700; font-size: var(--snc-fs-seccion); }
.doc-titulo{
  flex: 1;
  text-align: center;
  font-family: var(--snc-fuente-display);
  font-size: var(--snc-fs-titulo);
  font-weight: 600;
  line-height: 1.15;
  color: var(--snc-rojo);
  text-transform: uppercase;
}
.doc-meta{ text-align: right; min-width: 130px; }
.doc-num{
  font-family: var(--snc-fuente-mono);
  font-size: var(--snc-fs-seccion);
  font-weight: 700;
}
.pastilla{
  display: inline-block;
  margin-top: 3px;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: var(--snc-fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
}
.pastilla.ok{ background: var(--snc-ok-bg); color: var(--snc-ok-texto); }
.pastilla.aviso{ background: var(--snc-aviso-bg); color: var(--snc-aviso-texto); }
.pastilla.alerta{ background: var(--snc-rojo-suave); color: var(--snc-rojo-texto); }
.pastilla.mayor{ background: var(--snc-mayor-bg); color: var(--snc-mayor-texto); }

/* ── Secciones ────────────────────────────────────────────────── */
.seccion{
  margin-top: 8px;
  /* La paginación la decide el motor. El generador anterior la estimaba
     con checkPage(100) y una sección que creciera se partía por la mitad
     sin que nada avisara. */
  break-inside: avoid;
}
.seccion-head{
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px var(--snc-pad-x);
  background: var(--snc-rojo-suave);
  border: var(--snc-borde-rejilla) solid var(--snc-rojo-borde);
}
.seccion-num{
  font-family: var(--snc-fuente-mono);
  font-size: var(--snc-fs-head);
  font-weight: 700;
  color: #fff;
  background: var(--snc-rojo);
  padding: 1px 5px;
  border-radius: 2px;
}
.seccion-head h2{
  flex: 1;
  font-size: var(--snc-fs-seccion);
  font-weight: 700;
  color: var(--snc-rojo-texto);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* La referencia normativa es parte del registro, no un adorno: identifica
   qué requisito de la cláusula 8.7 cubre cada sección. */
.seccion-iso{
  font-family: var(--snc-fuente-mono);
  font-size: var(--snc-fs-micro);
  color: var(--snc-rojo-texto);
  white-space: nowrap;
}

/* ── Rejilla de celdas ────────────────────────────────────────── */
.rejilla{
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  border: var(--snc-borde-rejilla) solid var(--snc-rejilla);
  border-top: 0;
}
.celda{
  border-right: var(--snc-borde-rejilla) solid var(--snc-rejilla);
  border-bottom: var(--snc-borde-rejilla) solid var(--snc-rejilla);
  /* Sin esto, un valor largo sin espacios (una URL, una placa concatenada)
     ensancha su columna y descuadra la rejilla entera. */
  min-width: 0;
}
.celda-label{
  padding: 2px var(--snc-pad-x);
  background: var(--snc-label-bg);
  border-bottom: var(--snc-borde-rejilla) solid var(--snc-rejilla);
  font-size: var(--snc-fs-micro);
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--snc-tinta-suave);
}
.celda-valor{
  padding: var(--snc-pad-y) var(--snc-pad-x);
  font-size: var(--snc-fs-body);
  line-height: 1.35;
  /* El texto largo fluye y la celda crece. En PDFKit había que acotarlo a
     60px de alto y lo que sobraba se perdía sin dejar rastro. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ── Pie ──────────────────────────────────────────────────────── */
.doc-pie{
  margin-top: 10px;
  padding-top: 4px;
  border-top: var(--snc-borde-rejilla) solid var(--snc-rejilla);
  text-align: center;
  font-size: var(--snc-fs-micro);
  color: var(--snc-tinta-tenue);
}
</style>
</head>
<body>

<header class="doc-head">
  ${logo ? `<img class="doc-logo" src="${logo}" alt="">` : '<div class="doc-marca">COTRANSMEQ S.A.S</div>'}
  <div class="doc-titulo">Registro de salida<br>no conforme</div>
  <div class="doc-meta">
    <div class="doc-num">${esc(sncNum)}</div>
    <span class="pastilla ${estadoClase}">${esc(estadoLabel)}</span>
  </div>
</header>

${seccion(
  '1',
  'Identificación de la salida no conforme',
  null,
  [
    celda('FECHA DETECCIÓN', formatearFecha(s.fecha_deteccion)),
    celda('FECHA DEL EVENTO', formatearFecha(s.fecha_evento)),
    celda('DETECTADO POR', val(s.detectado_por)),
    celda('ÁREA / PROCESO', val(s.area_proceso)),
    celda('TIPO DE DETECCIÓN', tipoDetLabel),
    celda('CLASIFICACIÓN NC', clasificLabel),
    celda('CONDUCTOR', val(s.conductor_nombre)),
    celda('CÉDULA CONDUCTOR', val(s.conductor_cedula)),
    celda('PLACA VEHÍCULO', val(s.vehiculo_placa)),
    celda('RUTA / TRAYECTO', val(s.ruta_trayecto)),
    celda('TURNO / HORARIO', val(s.turno_horario)),
    celda('CLIENTE / CONTRATO', val(s.cliente_contrato)),
    celda('SERVICIO AFECTADO', val(s.servicio_afectado), 12)
  ].join('')
)}

${seccion(
  '2',
  'Descripción de la salida no conforme',
  'ISO 8.7.2 a',
  [
    celda('TIPO DE SALIDA NO CONFORME', tipoSalidaLabel, 6),
    celda('CLASIFICACIÓN', clasificLabel, 6),
    celda('DESCRIPCIÓN DETALLADA DE LA NO CONFORMIDAD', val(s.descripcion_nc), 12),
    s.observaciones ? celda('OBSERVACIONES', val(s.observaciones), 12) : ''
  ].join('')
)}

${seccion(
  '3',
  'Tratamiento aplicado',
  'ISO 8.7.1 a-d / 8.7.2 b-c',
  [
    celda('TRATAMIENTO SELECCIONADO', tratamientoLabel, 6),
    celda('AUTORIDAD QUE DECIDIÓ', val(s.autoridad_disposicion), 6),
    celda('DESCRIPCIÓN DE LA ACCIÓN TOMADA', val(s.descripcion_accion_tomada), 12),
    celda('RESPONSABLE DE LA ACCIÓN', val(s.responsable_accion), 6),
    celda('FECHA DE IMPLEMENTACIÓN', formatearFecha(s.fecha_implementacion), 6)
  ].join('')
)}

${
  hayConcesion
    ? seccion(
        '4',
        'Concesión formal del cliente',
        'ISO 8.7.1 d / 8.7.2 c',
        [
          celda('¿SE SOLICITÓ CONCESIÓN?', s.concesion_solicitada ? 'SÍ' : 'NO'),
          celda('REPRESENTANTE CLIENTE', val(s.concesion_cliente_nombre)),
          celda('FECHA AUTORIZACIÓN', formatearFecha(s.concesion_cliente_fecha)),
          celda(
            'MEDIO DE AUTORIZACIÓN',
            s.concesion_medio
              ? MEDIO_AUTORIZACION_LABELS[s.concesion_medio] || s.concesion_medio
              : 'N/A',
            6
          ),
          celda('CONDICIONES DE LA CONCESIÓN', val(s.condiciones_concesion), 6)
        ].join('')
      )
    : ''
}

${seccion(
  numVerificacion,
  'Verificación de conformidad post-corrección',
  'ISO 8.7.1 párrafo final',
  [
    celda('MÉTODO DE VERIFICACIÓN', metodoLabel, 6),
    celda('¿CUMPLE REQUISITOS?', cumpleLabel, 6),
    celda('RESULTADO DE LA VERIFICACIÓN', val(s.resultado_verificacion), 12),
    celda('RESPONSABLE VERIFICACIÓN', val(s.responsable_verificacion)),
    celda('FECHA VERIFICACIÓN', formatearFecha(s.fecha_verificacion)),
    celda('FIRMA VERIFICADOR', val(s.firma_verificacion))
  ].join('')
)}

<footer class="doc-pie">
  Registro de Salida No Conforme según ISO 9001:2015 — Cláusula 8.7 Control de las Salidas No Conformes
</footer>

</body>
</html>`;
}
