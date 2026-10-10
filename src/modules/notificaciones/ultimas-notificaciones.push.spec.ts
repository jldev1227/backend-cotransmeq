import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../config/prisma'
import { enviarWebPush, webPushHabilitado } from './web-push.service'

/**
 * Dispara como avisos del sistema las últimas notificaciones de UN usuario.
 *
 *   WEB_PUSH_CORREO=tu@correo.com npm run test:web-push
 *   WEB_PUSH_CORREO=tu@correo.com WEB_PUSH_CANTIDAD=3 npm run test:web-push
 *
 * Solo las suyas (`notificacion.usuario_id`) y solo a sus navegadores
 * (`usuario_web_push` activos): nadie más recibe nada. Antes de correrlo:
 *  1. Abre el dashboard con ese usuario, campana → «Activar» en este dispositivo.
 *  2. Cambia a otra ventana o minimiza Chrome: con el dashboard a la vista el
 *     service worker no muestra el aviso (ya lo hace la campana por socket).
 *
 * No marca nada como leído ni crea notificaciones.
 */

const correo = process.env.WEB_PUSH_CORREO?.trim()
const cantidad = Math.min(Math.max(Number(process.env.WEB_PUSH_CANTIDAD) || 10, 1), 50)
/// Pausa entre avisos: si llegan en el mismo instante, el sistema operativo
/// los agrupa y no se ve que salieron todos.
const PAUSA_MS = 700

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!correo)(`Web Push: últimas ${cantidad} notificaciones de ${correo}`, () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('las entrega a los navegadores suscritos del usuario', async () => {
    expect(webPushHabilitado(), 'Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el .env').toBe(true)

    const usuario = await prisma.usuarios.findFirst({
      where: { correo: { equals: correo!, mode: 'insensitive' } },
      select: { id: true, nombre: true },
    })
    expect(usuario, `No existe un usuario con correo ${correo}`).toBeTruthy()

    const navegadores = await prisma.usuario_web_push.count({ where: { usuario_id: usuario!.id, activo: true } })
    expect(
      navegadores,
      'Ese usuario no tiene navegadores suscritos: abre la campana del dashboard y pulsa «Activar».',
    ).toBeGreaterThan(0)

    const notificaciones = await prisma.notificacion.findMany({
      where: { usuario_id: usuario!.id },
      orderBy: { created_at: 'desc' },
      take: cantidad,
    })
    expect(notificaciones.length, 'El usuario no tiene notificaciones').toBeGreaterThan(0)

    /// De la más vieja a la más nueva: así la última queda arriba del centro
    /// de notificaciones, igual que en la campana.
    const resultados: Array<{ titulo: string; enviados: number; fallidos: number }> = []
    for (const n of [...notificaciones].reverse()) {
      const r = await enviarWebPush(n)
      resultados.push({ titulo: n.titulo, ...r })
      await esperar(PAUSA_MS)
    }

    /// Directo a stdout: vitest no siempre muestra el `console` de un test que pasa.
    const filas = resultados.map((r, i) => `  ${String(i + 1).padStart(2)}. ${r.enviados ? '✔' : '✘'} ${r.titulo}`)
    process.stdout.write(
      `\n${usuario!.nombre}: ${notificaciones.length} notificaciones × ${navegadores} navegador(es)\n${filas.join('\n')}\n\n`,
    )

    for (const r of resultados) expect(r.enviados, `«${r.titulo}» no llegó a ningún navegador`).toBeGreaterThan(0)
  })
})
