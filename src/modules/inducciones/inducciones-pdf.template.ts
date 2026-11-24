import fs from 'fs'
import path from 'path'
import type { InduccionesService } from './inducciones.service'

type Datos = Awaited<ReturnType<typeof InduccionesService.exportarDatos>>

const escapar = (valor: unknown) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function firma(valor: string | null | undefined): string {
  /// La firma proviene del formulario público; solo se incrustan imágenes de datos.
  return valor && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(valor)
    ? `<img src="${valor}" alt="Firma" />`
    : '<span class="sin-firma">Sin firma registrada</span>'
}

export function renderInduccionPdf(datos: Datos, empresa: string, archivoLogo: string): string {
  let logo = ''
  try {
    const imagen = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', archivoLogo))
    logo = `data:image/webp;base64,${imagen.toString('base64')}`
  } catch {
    // El nombre de la empresa sigue identificando el documento si falta el logo.
  }
  const confirmados = datos.temas.filter((tema) => tema.confirmado).length
  const filas = datos.temas.map((tema, indice) => `<tr><td class="numero">${indice + 1}</td><td>${escapar(tema.label)}</td><td class="respuesta">${tema.confirmado ? 'SÍ' : 'NO'}</td></tr>`).join('')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Inducción de visitantes</title><style>
    @page { size: letter portrait; margin: 10mm 11mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #18312b; background: #fff; font: 9.5px/1.32 Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { display: grid; grid-template-columns: 95px 1fr 116px; min-height: 58px; border: 1px solid #172b24; }
    .logo { display: flex; align-items: center; justify-content: center; padding: 6px; border-right: 1px solid #172b24; }
    .logo img { max-width: 85px; max-height: 45px; object-fit: contain; }
    .titulo { display: flex; flex-direction: column; justify-content: center; padding: 8px 12px; }
    .titulo small { color: #155c3f; font-size: 9px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
    .titulo strong { color: #314760; font-size: 10px; line-height: 1.15; text-transform: uppercase; }
    .meta { border-left: 1px solid #172b24; display: grid; grid-template-rows: repeat(3,1fr); }
    .meta div { padding: 3px 6px; border-bottom: 1px solid #d4ded7; font-size: 8px; }
    .meta div:last-child { border-bottom: 0; }
    .meta b { display: block; color: #587166; font-size: 7px; text-transform: uppercase; }
    .franja { display: flex; justify-content: space-between; gap: 10px; margin: 3px 0 8px; padding: 5px 8px; background: #edf5ef; border: 1px solid #9ebbaa; color: #14573e; font-weight: 700; text-transform: uppercase; }
    .seccion { margin-top: 9px; break-inside: avoid; }
    .seccion h2 { margin: 0; padding: 5px 8px; background: #104e35; color: #fff; font-size: 9px; letter-spacing: .03em; text-transform: uppercase; }
    .datos { display: grid; grid-template-columns: 1fr 1fr; border-left: 1px solid #b9c8bd; border-top: 1px solid #b9c8bd; }
    .dato { min-height: 34px; padding: 5px 8px; border-right: 1px solid #b9c8bd; border-bottom: 1px solid #b9c8bd; }
    .dato label { display: block; margin-bottom: 2px; color: #62776b; font-size: 7px; font-weight: 700; text-transform: uppercase; }
    .dato strong { font-size: 9px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #b9c8bd; padding: 5px 7px; text-align: left; }
    th { background: #104e35; color: #fff; font-size: 8px; text-transform: uppercase; }
    tbody tr:nth-child(even) { background: #f5f8f6; }
    .numero { width: 25px; color: #60736a; text-align: center; }
    .respuesta { width: 45px; text-align: center; font-weight: 800; color: #155f40; }
    .resumen { display: flex; justify-content: space-between; padding: 7px 9px; border: 1px solid #94bfa1; border-top: 0; background: #e7f3eb; color: #14573e; font-weight: 700; }
    .texto { padding: 8px 9px; border: 1px solid #b9c8bd; white-space: pre-wrap; }
    .declaracion { padding: 8px 9px; border: 1px solid #b9c8bd; background: #f5f8f5; }
    .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    .firma { height: 88px; padding: 6px 8px; border: 1px solid #b9c8bd; display: flex; flex-direction: column; justify-content: space-between; }
    .firma img { display: block; height: 48px; max-width: 100%; object-fit: contain; object-position: left center; }
    .firma b { display: block; padding-top: 3px; border-top: 1px solid #8ca39a; font-size: 8px; }
    .sin-firma { color: #8a9890; font-style: italic; }
    .pie { display: flex; justify-content: space-between; gap: 12px; margin-top: 9px; padding-top: 5px; border-top: 1px solid #c9d6cd; color: #596c7a; font-size: 7px; }
  </style></head><body>
    <header class="header"><div class="logo">${logo ? `<img src="${logo}" alt="${escapar(empresa)}">` : ''}</div><div class="titulo"><small>${escapar(empresa)} · Gestión HSEQ</small><strong>Inducción / Reinducción de visitantes</strong></div><div class="meta"><div><b>Código</b>${escapar(datos.codigo)}</div><div><b>Versión</b>${escapar(datos.version)}</div><div><b>Fecha</b>${escapar(datos.fecha_documento)}</div></div></header>
    <div class="franja"><span>Sede: ${escapar(datos.sede)}</span><span>Conformidad: ${datos.porcentaje_conformidad}%</span></div>
    <section class="seccion"><h2>Datos del visitante</h2><div class="datos"><div class="dato"><label>Nombre y apellido</label><strong>${escapar(datos.visitante.nombre)}</strong></div><div class="dato"><label>Documento</label><strong>${escapar(datos.visitante.cedula)}</strong></div><div class="dato"><label>Cargo</label><strong>${escapar(datos.visitante.cargo)}</strong></div><div class="dato"><label>Entidad / empresa</label><strong>${escapar(datos.visitante.entidad)}</strong></div></div></section>
    <section class="seccion"><h2>Temas informados</h2><table><thead><tr><th>#</th><th>Verificación</th><th>Respuesta</th></tr></thead><tbody>${filas}</tbody></table><div class="resumen"><span>Temas confirmados</span><span>${confirmados} de ${datos.temas.length} · ${datos.porcentaje_conformidad}%</span></div></section>
    ${datos.observaciones ? `<section class="seccion"><h2>Observaciones</h2><div class="texto">${escapar(datos.observaciones)}</div></section>` : ''}
    <section class="seccion"><h2>Declaración</h2><div class="declaracion">Declaro que ${escapar(empresa)} me suministró la información indicada, que la he leído y comprendido, y que me comprometo a cumplir las normas durante mi permanencia en sus instalaciones.</div></section>
    <div class="firmas"><div class="firma">${firma(datos.visitante.firma)}<b>Visitante · ${escapar(datos.visitante.nombre)}</b></div><div class="firma">${firma(datos.responsable.firma)}<b>Responsable · ${escapar(datos.responsable.nombre || '')}</b></div></div>
    <footer class="pie"><span>Generado el ${escapar(new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }))}</span><span>Documento generado automáticamente por el sistema</span></footer>
  </body></html>`
}
