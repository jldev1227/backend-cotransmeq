/**
 * Apagado ordenado (`src/lib/apagado.ts`).
 *
 * Antes el proceso solo atendía SIGINT: el SIGTERM de cada despliegue lo
 * mataba con los crons a mitad de camino. Lo que se fija aquí es lo que no se
 * ve con un `kill` a mano contra el servidor: que la espera cubre la ejecución
 * EN CURSO de un cron (la librería, sin `waitForCompletion`, la da por
 * terminada en cuanto el callback devuelve su promesa) y que el plazo corta.
 *
 * Cada caso importa el módulo de cero porque su estado (registro y bandera de
 * «apagando») es global del proceso, a propósito.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CronJob } from 'cron'

/// Sockets de mentira: el módulo real arrastra colas y gateways que no pintan
/// nada aquí, y sin `initSockets` `getIo()` lanzaría igual.
vi.mock('../src/sockets', () => ({
  getIo: () => {
    throw new Error('Socket.io not initialized')
  },
}))

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Un cron que nunca dispara solo: los ticks se lanzan a mano con `fireOnTick`. */
function cronLento(ms: number, alTerminar: () => void) {
  return new CronJob('0 0 1 1 *', async () => {
    await esperar(ms)
    alTerminar()
  })
}

beforeEach(() => {
  vi.resetModules()
})

describe('registrarCron / detenerCrons', () => {
  it('espera a que termine la ejecución en curso antes de dar el cron por detenido', async () => {
    const { registrarCron, detenerCrons } = await import('../src/lib/apagado')
    let terminado = false
    const job = registrarCron('lento', cronLento(400, () => (terminado = true)))
    expect(job.waitForCompletion).toBe(true)

    void job.fireOnTick()
    await esperar(20)
    expect(job.isCallbackRunning).toBe(true)

    const pendientes = await detenerCrons(5_000)
    expect(terminado).toBe(true)
    expect(pendientes).toEqual([])
    expect(job.isActive).toBe(false)
  })

  it('al agotarse el plazo devuelve los que siguen corriendo, sin esperarlos', async () => {
    const { registrarCron, detenerCrons } = await import('../src/lib/apagado')
    let terminado = false
    const job = registrarCron('eterno', cronLento(3_000, () => (terminado = true)))
    void job.fireOnTick()
    await esperar(20)

    const inicio = Date.now()
    const pendientes = await detenerCrons(200)
    expect(Date.now() - inicio).toBeLessThan(1_000)
    expect(pendientes).toEqual(['eterno'])
    expect(terminado).toBe(false)
  })

  it('un tick que llega con el anterior corriendo se salta en vez de solaparse', async () => {
    const { registrarCron } = await import('../src/lib/apagado')
    let ejecuciones = 0
    const job = registrarCron('unico', cronLento(200, () => ejecuciones++))
    const a = job.fireOnTick()
    const b = job.fireOnTick()
    await Promise.all([a, b])
    expect(ejecuciones).toBe(1)
  })
})

describe('apagar', () => {
  it('cierra el HTTP, espera al cron en curso y sale con 0', async () => {
    const { registrarCron, registrarServidor, apagar } = await import('../src/lib/apagado')
    const orden: string[] = []
    const job = registrarCron('captura', cronLento(300, () => orden.push('cron terminó')))
    registrarServidor({
      close: vi.fn(async () => {
        orden.push('http cerrado')
      }),
    } as any)

    void job.fireOnTick()
    await esperar(20)

    const salir = vi.fn()
    await apagar('SIGTERM', salir)

    expect(orden).toEqual(['http cerrado', 'cron terminó'])
    expect(salir).toHaveBeenCalledWith(0)
  })

  it('una segunda llamada no repite el apagado', async () => {
    const { registrarServidor, apagar } = await import('../src/lib/apagado')
    const close = vi.fn(async () => {})
    registrarServidor({ close } as any)
    const salir = vi.fn()
    await Promise.all([apagar('SIGTERM', salir), apagar('SIGINT', salir)])
    expect(close).toHaveBeenCalledTimes(1)
    expect(salir).toHaveBeenCalledTimes(1)
  })
})
