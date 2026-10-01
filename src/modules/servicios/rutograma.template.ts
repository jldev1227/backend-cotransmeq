import fs from 'node:fs';
import path from 'node:path';

/**
 * Documento del rutograma de un servicio, en HTML, para renderizar con
 * Puppeteer (`pdfFromHtml`).
 *
 * POR QUÉ EXISTE. El rutograma se dibujaba con pdfkit llevando a mano una
 * `y`, sumando alturas de celda y decidiendo saltos de página por
 * estimación: salía en apaisado, con rejilla gris, cuerpos de 5 a 7 puntos
 * y sin la mitad de los datos del servicio (propósito, fechas, cédula del
 * conductor, NIT del cliente). Cualquier texto largo se cortaba con puntos
 * suspensivos dentro de la celda.
 *
 * Aquí la paginación la resuelve Chromium y el documento comparte lenguaje
 * con el desprendible de nómina (`nomina-canvas/desprendible.template.ts`):
 * misma cabecera corporativa (logo, razón social, NIT), misma tipografía
 * embebida (Inter Tight / JetBrains Mono), tarjetas con esquinas
 * redondeadas, cabeceras de tabla en el color de marca y pie de página.
 *
 * ── Cabecera y pie en TODAS las páginas ──
 * El cuerpo va dentro de una tabla de una sola celda: Chromium repite el
 * `<thead>` en cada página impresa, así que el membrete aparece arriba de
 * cada hoja sin duplicarlo en el marcado. El pie es un elemento
 * `position: fixed` —que Chromium también repite por página— y el `<tfoot>`
 * vacío reserva su altura para que el contenido no se le monte encima.
 *
 * ── Sin imports de otros módulos ──
 * Las fuentes embebidas llegan por `prelude`, igual que en el desprendible,
 * para que este archivo sea el mismo en los dos repos (Transmeralda y
 * Cotransmeq) salvo por los colores y la razón social.
 */

export interface PuntoRuta {
  /** Marcador que lo identifica en el mapa y en la tabla: A, B, P, R, S, H, D. */
  marca: string;
  tipo: 'Origen' | 'Destino' | 'Peaje' | 'Restaurante' | 'Estación de servicio' | 'Hospedaje' | 'Distracom';
  nombre: string;
  detalle: string;
  lat: number;
  lng: number;
}

export interface TramoVia {
  via: string;
  distanciaKm: number;
}

export interface FirmaRutograma {
  nombre: string;
  cargo: string;
  /** Imagen de la firma como data-URL, o `null` si el usuario no tiene. */
  imagenDataUrl: string | null;
}

export interface DatosRutograma {
  empresa: { nombre: string; nit: string };
  formato: { codigo: string; version: string };
  /** `30/09/2026 14:05`, en hora de Colombia. */
  emitidoEl: string;
  servicio: {
    id: string;
    numeroRuta: string;
    estado: string;
    proposito: string;
    fechaSolicitud: string;
    fechaRealizacion: string;
    fechaFinalizacion: string;
    numeroPlanilla: string;
    observaciones: string;
  };
  cliente: { nombre: string; nit: string };
  conductor: { nombre: string; cedula: string; telefono: string } | null;
  vehiculo: { placa: string; descripcion: string; clase: string } | null;
  origen: { municipio: string; departamento: string; direccion: string; lat: number | null; lng: number | null };
  destino: { municipio: string; departamento: string; direccion: string; lat: number | null; lng: number | null };
  ruta: {
    distanciaKm: number;
    duracionHoras: number;
    velocidadSegura: number;
    /** Imagen del mapa estático como data-URL, o `null` si no se pudo obtener. */
    mapaDataUrl: string | null;
    tramos: TramoVia[];
  };
  puntos: PuntoRuta[];
  vias: { label: string; marcado: boolean }[];
  riesgos: { label: string; marcado: boolean }[];
  firmas: FirmaRutograma[];
}

export interface OpcionesRenderRutograma {
  /** `@font-face` de las fuentes embebidas. Sin él se usan las del sistema. */
  prelude?: string;
}

const assetDataUrl = (fileName: string, mimeType: string): string => {
  try {
    const assetPath = path.join(__dirname, '..', '..', 'assets', fileName);
    return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString('base64')}`;
  } catch {
    return '';
  }
};

const LOGO_DATA_URL = assetDataUrl('desprendible/logo.png', 'image/png');

/** Color de cada marcador: el mismo que lleva el pin en el mapa de Mapbox. */
const COLOR_MARCA: Record<string, string> = {
  A: '#ea580c',
  B: '#d32f2f',
  P: '#f59e0b',
  R: '#2196f3',
  S: '#9c27b0',
  H: '#009688',
  D: '#1b5e20',
};

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const km = (v: number): string =>
  `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)} km`;

function horasLegibles(h: number): string {
  const total = Math.round(h * 60);
  const horas = Math.floor(total / 60);
  const minutos = total % 60;
  if (horas === 0) return `${minutos} min`;
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`;
}

const coord = (v: number | null): string => (v == null ? '—' : v.toFixed(5));

const CHECK_SVG = `<svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true"><path d="M2 6.5l2.6 2.5L10 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function listaChecks(items: { label: string; marcado: boolean }[]): string {
  return items
    .map(
      (i) => `<li class="check${i.marcado ? ' check--on' : ''}">
        <span class="check-box">${i.marcado ? CHECK_SVG : ''}</span>
        <span>${esc(i.label)}</span>
      </li>`,
    )
    .join('');
}

function marcador(marca: string): string {
  return `<span class="marca" style="background:${COLOR_MARCA[marca] ?? '#475569'}">${esc(marca)}</span>`;
}

function dato(label: string, valor: string, extra = ''): string {
  return `<div class="dato${extra ? ` ${extra}` : ''}">
    <span class="dato-label">${esc(label)}</span>
    <span class="dato-valor">${valor || '—'}</span>
  </div>`;
}

const CONTROLES: [string, string][] = [
  ['Paradas seguras', 'Estaciones de servicio, bahías de parqueo, peajes y zonas autorizadas.'],
  ['Puntos de control', 'Salida, llegada y puntos intermedios verificados por el Área de Operaciones.'],
  ['Pernocta autorizada', 'Según autorización del Área de Operaciones.'],
  ['Control de jornada', 'Máximo 10 horas de conducción; descanso mínimo de 30 minutos cada 4 horas (Res. 1565/2014).'],
  ['Notificaciones', 'Reportar novedades al Centro de Operaciones y a HSEQ.'],
  ['Equipo de emergencia', 'Botiquín, extintor, triángulos, chaleco reflectivo, linterna y kit de carretera.'],
];

export function renderRutogramaHtml(
  d: DatosRutograma,
  opciones: OpcionesRenderRutograma = {},
): string {
  const logo = LOGO_DATA_URL
    ? `<img class="brand-logo" src="${LOGO_DATA_URL}" alt="Cotransmeq">`
    : `<strong class="brand-fallback">COTRANSMEQ</strong>`;

  const peajes = d.puntos.filter((p) => p.marca === 'P').length;
  const paradas = d.puntos.filter((p) => ['R', 'S', 'H'].includes(p.marca)).length;
  const distracom = d.puntos.filter((p) => p.marca === 'D').length;

  const leyenda: { marca: string; label: string }[] = [
    { marca: 'A', label: 'Origen' },
    { marca: 'B', label: 'Destino' },
  ];
  if (peajes) leyenda.push({ marca: 'P', label: 'Peaje' });
  if (d.puntos.some((p) => p.marca === 'R')) leyenda.push({ marca: 'R', label: 'Restaurante' });
  if (d.puntos.some((p) => p.marca === 'S')) leyenda.push({ marca: 'S', label: 'Estación de servicio' });
  if (d.puntos.some((p) => p.marca === 'H')) leyenda.push({ marca: 'H', label: 'Hospedaje' });
  if (distracom) leyenda.push({ marca: 'D', label: 'Estación Distracom' });

  const filasPuntos = d.puntos
    .map(
      (p, i) => `<tr>
        <td class="c mono">${i + 1}</td>
        <td class="c">${marcador(p.marca)}</td>
        <td><strong>${esc(p.nombre)}</strong><span class="sub">${esc(p.tipo)}</span></td>
        <td>${esc(p.detalle) || '<span class="tenue">—</span>'}</td>
        <td class="d mono">${coord(p.lat)}</td>
        <td class="d mono">${coord(p.lng)}</td>
      </tr>`,
    )
    .join('');

  const filasTramos = d.ruta.tramos
    .map(
      (t, i) => `<tr>
        <td class="c mono">${i + 1}</td>
        <td>${esc(t.via)}</td>
        <td class="d mono">${km(t.distanciaKm)}</td>
      </tr>`,
    )
    .join('');

  const firma = (cargo: string): string => {
    const f = d.firmas.find((x) => x.cargo === cargo);
    return `<div class="firma">
      <div class="firma-media">${f?.imagenDataUrl ? `<img class="firma-image" src="${f.imagenDataUrl}" alt="Firma">` : ''}</div>
      <div class="linea">${esc(f?.nombre || '')}&nbsp;</div>
      <small>${esc(cargo)}</small>
    </div>`;
  };

  const mapa = d.ruta.mapaDataUrl
    ? `<img class="mapa" src="${d.ruta.mapaDataUrl}" alt="Mapa de la ruta">`
    : `<div class="mapa mapa--vacio">No fue posible generar el mapa de la ruta. Verifique las coordenadas de origen y destino.</div>`;

  const trayecto = `${esc(d.origen.municipio)} → ${esc(d.destino.municipio)}`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>${opciones.prelude ?? ''}</style>
<style>
  @page { size: letter portrait; margin: 8mm 10mm 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter Tight', system-ui, sans-serif;
    font-size: 7.6pt;
    line-height: 1.3;
    color: #17201d;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, p, ul { margin: 0; }
  ul { padding: 0; list-style: none; }
  table { width: 100%; border-collapse: collapse; }
  .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  .c { text-align: center; }
  .d { text-align: right; }
  .tenue { color: #94a3b8; }

  /* ── Esqueleto: cabecera repetida y pie fijo ─────────────────────── */
  table.doc > thead { display: table-header-group; }
  table.doc > tfoot { display: table-footer-group; }
  table.doc > thead > tr > td, table.doc > tbody > tr > td, table.doc > tfoot > tr > td { padding: 0; }
  .cab-espacio { height: 6pt; }
  .pie-espacio { height: 20pt; }
  .pie {
    position: fixed; left: 0; right: 0; bottom: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 5pt 2pt 0; border-top: .6pt solid #dee7e3;
    color: #66756f; font-size: 5.7pt; letter-spacing: .025em; background: #fff;
  }

  /* ── Cabecera corporativa ─────────────────────────────────────────── */
  .cabecera {
    position: relative; overflow: hidden;
    display: grid; grid-template-columns: 1fr auto; gap: 14pt; align-items: end;
    border-radius: 14pt; padding: 11pt 16pt 12pt;
    background: #14532d; color: #fff;
  }
  .cabecera::before, .cabecera::after {
    content: ''; position: absolute; border-radius: 999pt;
    background: rgba(255,255,255,.055);
  }
  .cabecera::before { width: 150pt; height: 150pt; right: 120pt; top: -96pt; }
  .cabecera::after { width: 54pt; height: 54pt; left: -18pt; bottom: -26pt; }
  .cabecera > * { position: relative; z-index: 2; }
  .brand { display: flex; align-items: center; gap: 8pt; }
  .brand-logo { width: 90pt; max-height: 28pt; object-fit: contain; object-position: left center; filter: brightness(0) invert(1); }
  .brand-fallback { color: #fff; font-size: 10pt; letter-spacing: .08em; }
  .brand-meta { color: #f0fdf4; font-size: 6.6pt; line-height: 1.3; font-weight: 750; letter-spacing: .015em; }
  .doc { margin-top: 8pt; }
  .doc .kicker { color: #fdba74; font-size: 6pt; font-weight: 800; letter-spacing: .15em; }
  .doc h1 { margin-top: 2pt; color: #fff; font-size: 17pt; line-height: 1.05; letter-spacing: -.025em; }
  .doc .trayecto { margin-top: 3pt; color: #ffedd5; font-size: 8pt; font-weight: 600; }
  .formato { display: grid; grid-template-columns: auto auto; gap: 2pt 8pt; align-self: start; padding: 6pt 9pt; border-radius: 9pt; background: rgba(255,255,255,.1); font-size: 6.2pt; }
  .formato dt { color: #fdba74; font-weight: 800; letter-spacing: .08em; }
  .formato dd { margin: 0; color: #fff; font-weight: 700; text-align: right; }
  .estado {
    display: inline-block; margin-top: 5pt; padding: 2.5pt 7pt; border-radius: 999pt;
    background: rgba(255,255,255,.14); color: #fff;
    font-size: 5.8pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  }

  /* ── Tarjetas ─────────────────────────────────────────────────────── */
  main { display: flex; flex-direction: column; gap: 7pt; }
  .card { overflow: hidden; background: #fff; border: .6pt solid #dee7e3; border-radius: 12pt; break-inside: avoid; }
  /* La tabla de puntos puede ser larga: se deja partir entre páginas, fila a fila. */
  .card--fluida { break-inside: auto; }
  .card--fluida tr { break-inside: avoid; }
  .card-title { padding: 6pt 9pt 4pt; color: #17201d; font-size: 8.6pt; font-weight: 850; }
  .card-subtitle { display: block; margin-top: 1pt; color: #66756f; font-size: 5.8pt; font-weight: 550; }
  .identity-strip { display: grid; grid-template-columns: 1.6fr 1fr 1fr .8fr; gap: 8pt; padding: 8pt 9pt; background: #f7faf8; border-bottom: .6pt solid #dee7e3; }
  .dato { min-width: 0; }
  .dato-label { display: block; font-size: 5.4pt; color: #66756f; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  .dato-valor { display: block; margin-top: 1.5pt; font-size: 7.2pt; line-height: 1.25; font-weight: 750; overflow-wrap: anywhere; }
  .dato-valor .sub { display: block; font-size: 6.2pt; font-weight: 500; color: #475569; }
  .grid { display: grid; gap: 8pt; padding: 7pt 9pt; }
  .grid--2 { grid-template-columns: 1fr 1fr; }
  .grid--3 { grid-template-columns: 1fr 1fr 1fr; }
  .grid + .grid { border-top: .6pt solid #edf3f0; }
  .punto { display: grid; grid-template-columns: auto 1fr; gap: 7pt; align-items: start; }
  .punto .marca { margin-top: 1pt; }
  .marca { display: inline-flex; align-items: center; justify-content: center; width: 12pt; height: 12pt; border-radius: 999pt; color: #fff; font-size: 6pt; font-weight: 850; }
  .observaciones { padding: 6pt 9pt 7pt; border-top: .6pt solid #edf3f0; }
  .observaciones .dato-valor { font-weight: 500; font-size: 6.9pt; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

  /* ── Resumen de la ruta ───────────────────────────────────────────── */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7pt; }
  .stat { padding: 7pt 9pt; border: .6pt solid #dee7e3; border-radius: 10pt; background: #fff; }
  .stat-label { display: block; font-size: 5.4pt; color: #66756f; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  .stat-valor { display: block; margin-top: 2pt; font-size: 12.5pt; font-weight: 850; letter-spacing: -.02em; color: #14532d; }
  .stat-sub { display: block; font-size: 5.8pt; color: #66756f; }

  /* ── Condiciones y riesgos ────────────────────────────────────────── */
  .checks { padding: 2pt 9pt 7pt; }
  .checks h3 { margin: 4pt 0 3pt; font-size: 6pt; color: #14532d; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  .checks ul { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5pt 10pt; }
  .check { display: flex; align-items: center; gap: 5pt; font-size: 7pt; color: #475569; }
  .check--on { color: #17201d; font-weight: 700; }
  .check-box { display: inline-flex; align-items: center; justify-content: center; width: 9pt; height: 9pt; border-radius: 2.5pt; border: .8pt solid #9eb0a8; background: #fff; }
  .check--on .check-box { border-color: #ea580c; background: #ea580c; }

  /* ── Tablas ───────────────────────────────────────────────────────── */
  thead th { background: #ffedd5; color: #14532d; text-align: left; padding: 4.5pt 6pt; font-size: 5.8pt; letter-spacing: .08em; text-transform: uppercase; }
  thead th.c { text-align: center; }
  thead th.d { text-align: right; }
  tbody td { padding: 3.6pt 6pt; border-bottom: .5pt solid #edf3f0; vertical-align: top; font-size: 7pt; }
  tbody tr:last-child td { border-bottom: 0; }
  td .sub { display: block; font-size: 5.8pt; color: #66756f; font-weight: 500; }
  td.vacio { color: #94a3b8; font-style: italic; text-align: center; padding: 7pt; }
  .controles td:first-child { width: 26%; font-weight: 800; color: #14532d; }

  /* ── Mapa ─────────────────────────────────────────────────────────── */
  .salto { break-before: page; }
  .mapa { display: block; width: 100%; height: auto; border-top: .6pt solid #dee7e3; border-bottom: .6pt solid #dee7e3; }
  .mapa--vacio { display: flex; align-items: center; justify-content: center; height: 150pt; color: #94a3b8; font-style: italic; background: #f7faf8; }
  .leyenda { display: flex; flex-wrap: wrap; gap: 4pt 14pt; padding: 6pt 9pt; font-size: 6.4pt; color: #475569; }
  .leyenda li { display: inline-flex; align-items: center; gap: 4pt; }
  .leyenda .marca { width: 10pt; height: 10pt; font-size: 5.2pt; }
  .nota { padding: 0 9pt 6pt; font-size: 5.8pt; color: #66756f; }
  .columnas { display: grid; grid-template-columns: 1.55fr 1fr; gap: 7pt; align-items: start; }

  /* ── Firmas ───────────────────────────────────────────────────────── */
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 22pt; padding: 8pt 14pt 8pt; background: #fff; border: .6pt solid #dee7e3; border-radius: 12pt; break-inside: avoid; }
  .firma { min-width: 0; text-align: center; display: flex; flex-direction: column; }
  .firma-media { height: 36pt; display: flex; align-items: flex-end; justify-content: center; }
  .firma-image { display: block; max-height: 36pt; max-width: 160pt; object-fit: contain; }
  .firma .linea { width: 100%; border-top: .75pt solid #9eb0a8; margin-top: 1pt; padding-top: 3pt; color: #14532d; font-weight: 800; }
  .firma small { color: #66756f; font-size: 5.8pt; }
</style></head>
<body>
<table class="doc">
<thead><tr><td>
  <header class="cabecera">
    <div>
      <div class="brand">
        ${logo}
        <p class="brand-meta">${esc(d.empresa.nombre)}<br>NIT ${esc(d.empresa.nit)}</p>
      </div>
      <div class="doc">
        <p class="kicker">HOJA DE RUTA · CONTROL OPERACIONAL</p>
        <h1>Rutograma del servicio</h1>
        <p class="trayecto">${trayecto}</p>
        <span class="estado">${esc(d.servicio.estado)}</span>
      </div>
    </div>
    <dl class="formato">
      <dt>Código</dt><dd>${esc(d.formato.codigo)}</dd>
      <dt>Versión</dt><dd>${esc(d.formato.version)}</dd>
      <dt>Ruta</dt><dd>${esc(d.servicio.numeroRuta)}</dd>
      <dt>Emitido</dt><dd>${esc(d.emitidoEl)}</dd>
    </dl>
  </header>
  <div class="cab-espacio"></div>
</td></tr></thead>
<tfoot><tr><td><div class="pie-espacio"></div></td></tr></tfoot>
<tbody><tr><td>
<main>
  <section class="card">
    <div class="identity-strip">
      ${dato('Cliente', `${esc(d.cliente.nombre)}${d.cliente.nit ? `<span class="sub">NIT ${esc(d.cliente.nit)}</span>` : ''}`)}
      ${dato('Fecha de realización', esc(d.servicio.fechaRealizacion))}
      ${dato('Propósito del servicio', esc(d.servicio.proposito))}
      ${dato('Planilla', `<span class="mono">${esc(d.servicio.numeroPlanilla)}</span>`)}
    </div>
    <div class="grid grid--2">
      <div class="punto">${marcador('A')}${dato('Origen', `${esc(d.origen.municipio)} <span class="tenue">(${esc(d.origen.departamento)})</span><span class="sub">${esc(d.origen.direccion) || 'Sin dirección específica'}</span><span class="sub mono">${coord(d.origen.lat)}, ${coord(d.origen.lng)}</span>`)}</div>
      <div class="punto">${marcador('B')}${dato('Destino', `${esc(d.destino.municipio)} <span class="tenue">(${esc(d.destino.departamento)})</span><span class="sub">${esc(d.destino.direccion) || 'Sin dirección específica'}</span><span class="sub mono">${coord(d.destino.lat)}, ${coord(d.destino.lng)}</span>`)}</div>
    </div>
    <div class="grid grid--3">
      ${dato('Conductor', d.conductor ? `${esc(d.conductor.nombre)}<span class="sub">C.C. ${esc(d.conductor.cedula)}${d.conductor.telefono ? ` · Tel. ${esc(d.conductor.telefono)}` : ''}</span>` : '<span class="tenue">Sin asignar</span>')}
      ${dato('Vehículo', d.vehiculo ? `<span class="mono">${esc(d.vehiculo.placa)}</span><span class="sub">${esc(d.vehiculo.descripcion)}${d.vehiculo.clase ? ` · ${esc(d.vehiculo.clase)}` : ''}</span>` : '<span class="tenue">Sin asignar</span>')}
      ${dato('Fechas', `<span class="sub">Solicitud: <strong>${esc(d.servicio.fechaSolicitud)}</strong></span><span class="sub">Realización: <strong>${esc(d.servicio.fechaRealizacion)}</strong></span><span class="sub">Finalización: <strong>${esc(d.servicio.fechaFinalizacion)}</strong></span>`)}
    </div>
    <div class="observaciones">
      ${dato('Observaciones del servicio', esc(d.servicio.observaciones) || '<span class="tenue">Sin observaciones</span>')}
    </div>
  </section>

  <div class="stats">
    <div class="stat"><span class="stat-label">Distancia</span><span class="stat-valor">${d.ruta.distanciaKm > 0 ? km(d.ruta.distanciaKm) : '—'}</span><span class="stat-sub">Por carretera, según Mapbox</span></div>
    <div class="stat"><span class="stat-label">Duración estimada</span><span class="stat-valor">${d.ruta.duracionHoras > 0 ? horasLegibles(d.ruta.duracionHoras) : '—'}</span><span class="stat-sub">Sin paradas ni contratiempos</span></div>
    <div class="stat"><span class="stat-label">Velocidad segura</span><span class="stat-valor">${d.ruta.velocidadSegura} km/h</span><span class="stat-sub">Máxima recomendada en vía</span></div>
    <div class="stat"><span class="stat-label">Puntos en ruta</span><span class="stat-valor">${peajes + paradas + distracom}</span><span class="stat-sub">${peajes} peaje(s) · ${paradas} parada(s) · ${distracom} Distracom</span></div>
  </div>

  <div class="columnas">
    <section class="card">
      <h2 class="card-title">Condiciones de la vía y riesgos<span class="card-subtitle">Registradas en la planilla del servicio</span></h2>
      <div class="checks">
        <h3>Estado de la vía</h3>
        <ul>${listaChecks(d.vias)}</ul>
        <h3>Riesgos identificados</h3>
        <ul>${listaChecks(d.riesgos)}</ul>
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">Vías principales<span class="card-subtitle">Tramos del recorrido por nombre de vía</span></h2>
      <table>
        <thead><tr><th class="c">#</th><th>Vía</th><th class="d">Distancia</th></tr></thead>
        <tbody>${filasTramos || '<tr><td colspan="3" class="vacio">Sin detalle de vías para esta ruta.</td></tr>'}</tbody>
      </table>
    </section>
  </div>

  <section class="card">
    <h2 class="card-title">Controles operacionales<span class="card-subtitle">Medidas obligatorias durante el desplazamiento</span></h2>
    <table class="controles">
      <thead><tr><th>Control</th><th>Disposición</th></tr></thead>
      <tbody>${CONTROLES.map(([c, t]) => `<tr><td>${esc(c)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody>
    </table>
  </section>

  <div class="firmas">
    ${firma('Jefe de Operaciones')}
    ${firma('Coordinadora HSEQ')}
  </div>

  <section class="card salto">
    <h2 class="card-title">Mapa de la ruta<span class="card-subtitle">Trazado por carretera entre el origen y el destino, con los puntos identificados</span></h2>
    ${mapa}
    <ul class="leyenda">${leyenda.map((l) => `<li>${marcador(l.marca)}${esc(l.label)}</li>`).join('')}</ul>
    <p class="nota">Mapa generado con Mapbox. El trazado y los tiempos son aproximados; los peajes y paradas provienen de OpenStreetMap y de la red Distracom.</p>
  </section>

  <section class="card card--fluida">
    <h2 class="card-title">Puntos de la ruta<span class="card-subtitle">Origen, destino, peajes, paradas seguras y estaciones aliadas</span></h2>
    <table>
      <thead><tr><th class="c">#</th><th class="c">Marca</th><th>Punto</th><th>Ubicación / servicios</th><th class="d">Latitud</th><th class="d">Longitud</th></tr></thead>
      <tbody>${filasPuntos}</tbody>
    </table>
  </section>
</main>
</td></tr></tbody>
</table>
<footer class="pie">
  <span>Rutograma · ${esc(d.formato.codigo)} v${esc(d.formato.version)} · Documento generado electrónicamente por Cotransmeq</span>
  <span>Servicio ${esc(d.servicio.id)} · Emitido el ${esc(d.emitidoEl)}</span>
</footer>
</body></html>`;
}
