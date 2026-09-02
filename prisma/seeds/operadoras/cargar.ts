#!/usr/bin/env tsx
/**
 * Siembra el catálogo de operadoras.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO EJECUTA UNA PERSONA, NUNCA UN AGENTE, Y SOLO DESPUÉS DE:
 *
 *   1. haber revisado `npx tsx scripts/operadoras-inventario.ts` y completado
 *      la lista de `index.ts` con lo que aparezca;
 *   2. haber aplicado los PASOS 1 y 2 de
 *      `migrations/31-08-2026-operadoras-catalogo.sql` (crear la tabla).
 *
 *  Por defecto NO ESCRIBE NADA: es un simulacro. Para escribir de verdad hay
 *  que pasar `--apply` explícitamente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Idempotente: cada operadora se escribe con `upsert` por `codigo`, así que
 * correrlo dos veces actualiza nombre y orden, y no duplica nada. Nunca borra:
 * una operadora que ya no se usa se retira con `activo = false` desde la
 * interfaz, no quitándola de esta lista.
 *
 * Uso:
 *   npm run seeds:operadoras:cargar              # simulacro
 *   npm run seeds:operadoras:cargar -- --apply   # escribe
 */

import { prisma } from '../../../src/config/prisma'
import { SEMILLAS_OPERADORAS, normalizarCodigoOperadora } from './index'

const APLICAR = process.argv.includes('--apply')

async function main() {
  console.log(
    APLICAR
      ? '── Sembrando el catálogo de operadoras (--apply)\n'
      : '── SIMULACRO: no se escribe nada. Pasa --apply para escribir de verdad.\n'
  )

  /// Se valida antes de tocar nada: dos semillas que normalizan al mismo
  /// código chocarían contra el índice único a mitad del bucle, dejando el
  /// catálogo a medias.
  const vistos = new Set<string>()
  for (const s of SEMILLAS_OPERADORAS) {
    const codigo = normalizarCodigoOperadora(s.codigo)
    if (vistos.has(codigo)) {
      throw new Error(
        `La lista de semillas tiene dos entradas que normalizan a "${codigo}". Revisa prisma/seeds/operadoras/index.ts.`
      )
    }
    vistos.add(codigo)
  }

  for (const s of SEMILLAS_OPERADORAS) {
    const codigo = normalizarCodigoOperadora(s.codigo)
    const existente = await prisma.operadoras.findUnique({ where: { codigo } })

    if (!APLICAR) {
      console.log(`  ${existente ? 'actualizaría' : 'crearía    '}  ${codigo}  (${s.nombre}, orden ${s.orden})`)
      continue
    }

    await prisma.operadoras.upsert({
      where: { codigo },
      /// No se toca `activo` al actualizar: si alguien retiró una operadora
      /// desde la interfaz, volver a correr el seed no debe resucitarla.
      update: { nombre: s.nombre, orden: s.orden },
      create: { codigo, nombre: s.nombre, orden: s.orden }
    })
    console.log(`  ${existente ? 'actualizada' : 'creada     '}  ${codigo}`)
  }

  const total = await prisma.operadoras.count()
  console.log(
    APLICAR
      ? `\n  Catálogo con ${total} operadora(s). Ya puedes aplicar el PASO 3 en adelante del SQL.\n`
      : `\n  (el catálogo tiene hoy ${total} fila(s))\n`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
