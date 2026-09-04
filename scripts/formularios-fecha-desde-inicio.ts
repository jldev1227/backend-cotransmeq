/**
 * Rellena la fecha del formulario de los envíos que ya existen.
 *
 * La fecha del formulario (`context_json.filledOn`) sale de `started_at` —
 * cuándo se empezó a diligenciar— convertido a la zona horaria de la asignación.
 * Los envíos anteriores a que el campo existiera no la traen, y los de la
 * primera versión la traen tecleada por el conductor. Este script los deja a
 * todos con el mismo criterio.
 *
 * Es IDEMPOTENTE: recalcula desde `started_at` siempre, así que correrlo dos
 * veces da el mismo resultado. Y no toca ninguna otra clave del contexto: el
 * vehículo y el servicio se conservan tal cual.
 *
 * Por defecto solo INFORMA. Para escribir hay que pedirlo:
 *
 *     npx tsx scripts/formularios-fecha-desde-inicio.ts            # simulacro
 *     npx tsx scripts/formularios-fecha-desde-inicio.ts --aplicar  # escribe
 *
 * El simulacro es el modo por defecto a propósito: esto reescribe una columna
 * JSON de una tabla de registros firmados, y conviene ver el recuento antes.
 */

import { PrismaClient, Prisma } from '@prisma/client'
import {
  BUSINESS_TIMEZONE,
  CLAVE_FECHA_DILIGENCIAMIENTO,
  fechaDeFormulario,
} from '../src/modules/formularios-dinamicos/domain'

const prisma = new PrismaClient()
const aplicar = process.argv.includes('--aplicar')
/// Lotes: la tabla puede tener decenas de miles de filas y cargarlas todas en
/// memoria para actualizarlas una a una es la forma de que el script muera a
/// media faena y deje el trabajo por la mitad.
const LOTE = 500

async function main() {
  const total = await prisma.form_submission.count()
  console.log(`\nEnvíos en la base: ${total}`)
  console.log(aplicar ? 'Modo: APLICAR (escribe)\n' : 'Modo: simulacro (no escribe)\n')

  let procesados = 0
  let escritos = 0
  let yaCorrectos = 0
  let sinInicio = 0
  const ejemplos: string[] = []

  for (let salto = 0; ; salto += LOTE) {
    const filas = await prisma.form_submission.findMany({
      skip: salto,
      take: LOTE,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        started_at: true,
        context_json: true,
        assignment: { select: { timezone: true } },
      },
    })
    if (filas.length === 0) break

    for (const fila of filas) {
      procesados++
      if (!fila.started_at) {
        sinInicio++
        continue
      }

      const contexto = (fila.context_json ?? {}) as Record<string, unknown>
      const previo = contexto[CLAVE_FECHA_DILIGENCIAMIENTO]
      const nueva = fechaDeFormulario(fila.started_at, fila.assignment?.timezone || BUSINESS_TIMEZONE)

      if (previo === nueva) {
        yaCorrectos++
        continue
      }

      if (ejemplos.length < 10) {
        ejemplos.push(`  ${fila.id}  ${String(previo ?? '(vacío)').padEnd(12)} → ${nueva}`)
      }

      if (aplicar) {
        await prisma.form_submission.update({
          where: { id: fila.id },
          data: {
            context_json: {
              ...contexto,
              [CLAVE_FECHA_DILIGENCIAMIENTO]: nueva,
            } as Prisma.InputJsonValue,
          },
        })
      }
      escritos++
    }

    process.stdout.write(`\r  procesados ${procesados}/${total}`)
  }

  console.log('\n')
  if (ejemplos.length) {
    console.log(`Ejemplos (${aplicar ? 'aplicados' : 'se aplicarían'}):`)
    console.log(ejemplos.join('\n'))
    console.log('')
  }
  console.log(`  ${aplicar ? 'Actualizados' : 'Por actualizar'}: ${escritos}`)
  console.log(`  Ya correctos:   ${yaCorrectos}`)
  if (sinInicio) console.log(`  Sin started_at: ${sinInicio}  (no se tocan)`)
  if (!aplicar && escritos > 0) console.log('\nPara escribir: añade --aplicar\n')
}

main()
  .catch((err) => {
    console.error('\nFalló:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
