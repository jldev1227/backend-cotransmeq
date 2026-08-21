/**
 * Reenvía la notificación de un formulario SARLAFT + PTEE ya radicado.
 *
 * Existe porque las notificaciones estuvieron fallando en silencio: el módulo
 * fijaba su `from` desde `SMTP_FROM` (una cuenta @gmail.com) mientras el
 * proveedor activo era Resend, que rechaza remitentes de dominios no
 * verificados con HTTP 403. Los formularios quedaron correctamente guardados,
 * pero el correo al área responsable nunca salió; este script lo emite de
 * nuevo para esos radicados.
 *
 * Reutiliza `notificarOficialCumplimiento`, la MISMA función del flujo de
 * envío, para que el correo salga con el template, los destinatarios y los
 * adjuntos idénticos a los del envío original — PDF de respuestas, archivos
 * subidos por el titular y firmas manuscritas como PNG.
 *
 * Uso:
 *   npx tsx scripts/reenviar-notificacion-sarlaft.ts <id|radicado> [...]
 *   npx tsx scripts/reenviar-notificacion-sarlaft.ts --dry-run <id>
 *   npx tsx scripts/reenviar-notificacion-sarlaft.ts --to=qa@ejemplo.com <id>
 *
 * Con `--dry-run` resuelve el registro, regenera el PDF y lista destinatarios
 * y adjuntos, pero NO envía. Conviene correrlo antes del envío real.
 *
 * Con `--to=` el correo se desvía a los destinatarios indicados (coma) en vez
 * de a los buzones de cumplimiento. Sirve para revisar el resultado real —
 * template y adjuntos — sin ensuciar las bandejas del área ni dejar copias
 * duplicadas de un radicado, que no se pueden borrar una vez entregadas.
 */
import { prisma } from '../src/config/prisma'
import { getFormularioPorCodigo } from '../src/modules/formularios-sarlaft/formularios-sarlaft.constants'
import { FormulariosSarlaftService } from '../src/modules/formularios-sarlaft/formularios-sarlaft.service'
import { getConfigPorTipo } from '../src/modules/formularios-sarlaft/sarlaft-config'
import { EmailService } from '../src/services/email.service'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const claves = args.filter((a) => !a.startsWith('--'))

const destinoPrueba = (args.find((a) => a.startsWith('--to=')) ?? '')
  .slice('--to='.length)
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

// El desvío se hace envolviendo `EmailService.sendEmail` en vez de tocar la
// configuración: así el resto del flujo —incluida la lista blanca de canales
// autorizados de `sarlaft-config`— corre exactamente igual que en producción,
// y lo único que cambia es la última milla del envío.
if (destinoPrueba.length > 0) {
  const original = EmailService.sendEmail.bind(EmailService)
  ;(EmailService as any).sendEmail = (p: any) => {
    console.log(`   ⚠ PRUEBA: desviado de [${(p.to ?? []).join(', ')}] a [${destinoPrueba.join(', ')}]`)
    return original({ ...p, to: destinoPrueba, subject: `[PRUEBA] ${p.subject}` })
  }
}

if (claves.length === 0) {
  console.error('Uso: npx tsx scripts/reenviar-notificacion-sarlaft.ts [--dry-run] [--to=correo] <id|radicado> [...]')
  process.exit(1)
}

/** Acepta tanto el UUID del registro como el radicado impreso en el PDF. */
async function buscarRegistro(clave: string) {
  const porId = await prisma.formulario_sarlaft_ptee.findUnique({
    where: { id: clave },
    include: { documentos: { orderBy: { tipo_documento: 'asc' } } }
  })
  if (porId) return porId
  return prisma.formulario_sarlaft_ptee.findFirst({
    where: { radicado: clave },
    include: { documentos: { orderBy: { tipo_documento: 'asc' } } }
  })
}

async function reenviar(clave: string) {
  const f = await buscarRegistro(clave)
  if (!f) {
    console.error(`✗ ${clave}: no existe ningún formulario con ese id ni radicado.`)
    return false
  }

  const formulario = getFormularioPorCodigo(f.codigo_formulario as any)
  if (!formulario) {
    console.error(`✗ ${f.radicado}: no hay definición para el código ${f.codigo_formulario}.`)
    return false
  }

  const cfg = getConfigPorTipo(f.tipo_formulario as any)
  console.log(`\n── ${f.radicado} ─ ${f.codigo_formulario} (${f.tipo_formulario})`)
  console.log(`   Titular      : ${f.nombre_completo ?? '—'} ${f.tipo_documento ?? ''} ${f.numero_documento ?? ''}`)
  console.log(`   Radicado el  : ${f.fecha_envio.toISOString()}`)
  console.log(`   Destinatarios: ${cfg.emails.join(', ')}`)

  // El PDF se pide a `generarPDFRespuesta`, que es EXACTAMENTE el método que
  // usan la descarga del dashboard y el ZIP de evidencia. No se invoca aquí
  // ningún generador directamente: existen dos clases llamadas
  // `PDFGeneratorSarlaftService` (una en `pdf-generator-sarlaft.service.ts`,
  // otra en `pdf-generator-sarlaft-html.service.ts`) y elegir la equivocada
  // produce un PDF con otro diseño sin fallar la compilación. Delegar en el
  // servicio deja una sola fuente de verdad.
  let pdfBuffer: Buffer | null = null
  try {
    const pdf = await FormulariosSarlaftService.generarPDFRespuesta(f.id)
    pdfBuffer = pdf?.buffer ?? null
    console.log(`   PDF          : ${((pdfBuffer?.length ?? 0) / 1024).toFixed(1)} KB (mismo que el ZIP del dashboard)`)
  } catch (err: any) {
    // Se continúa sin PDF a propósito: es preferible que el área reciba el
    // aviso y los adjuntos originales a que no le llegue nada.
    console.error(`   PDF          : FALLÓ (${err.message}) — se envía sin él`)
  }

  const documentos = f.documentos.map((d) => ({
    nombre_archivo: d.nombre_archivo,
    tipo_documento: d.tipo_documento,
    mime_type: d.mime_type,
    s3_key: d.s3_key,
    tamano_bytes: String(d.tamano_bytes)
  }))
  console.log(`   Adjuntos S3  : ${documentos.length}`)
  for (const d of documentos) console.log(`      · ${d.tipo_documento}: ${d.nombre_archivo}`)

  if (dryRun) {
    console.log('   → DRY RUN: no se envió nada.')
    return true
  }

  // `registro` replica la forma que produce `registradoToDTO` en el flujo de
  // envío. Se incluye `respuestas` para que la función extraiga las firmas
  // manuscritas sin tener que releerlas de la base.
  await FormulariosSarlaftService.notificarOficialCumplimiento(
    {
      id: f.id,
      radicado: f.radicado,
      tipo_formulario: f.tipo_formulario,
      codigo_formulario: f.codigo_formulario,
      fecha_envio: f.fecha_envio,
      nombre_completo: f.nombre_completo,
      tipo_documento: f.tipo_documento,
      numero_documento: f.numero_documento,
      correo: f.correo,
      telefono: f.telefono,
      ip_origen: f.ip_origen,
      respuestas: f.respuestas
    } as any,
    formulario,
    documentos,
    pdfBuffer
  )
  console.log('   ✓ Notificación reenviada.')
  return true
}

;(async () => {
  let ok = 0
  for (const clave of claves) {
    if (await reenviar(clave)) ok++
  }
  console.log(`\n${ok}/${claves.length} procesados${dryRun ? ' (dry run)' : ''}.`)
  if (ok < claves.length) process.exitCode = 1
})()
  .catch((err) => {
    console.error('Error:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
