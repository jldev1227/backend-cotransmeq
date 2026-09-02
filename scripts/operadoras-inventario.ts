#!/usr/bin/env tsx
/**
 * Inventario de las operadoras que ya hay escritas en la base.
 *
 * SOLO LEE. No hay un solo UPDATE ni INSERT en este archivo, y así debe
 * seguir: su salida es lo que una persona revisa antes de decidir qué se
 * siembra en el catálogo (`prisma/seeds/operadoras/`).
 *
 * `liquidacion_servicio.operadora` es texto libre —sin enum, sin default y sin
 * una sola validación en ninguna capa—, así que lo que hay ahí dentro no lo
 * sabe nadie hasta que se mira. De eso va esto.
 *
 * Agrupa por `upper(btrim(...))`, que es exactamente la normalización que usan
 * el backfill del SQL y el CRUD. Si aquí salen dos filas que solo difieren en
 * mayúsculas o espacios, en el catálogo serán una sola: eso es correcto, y por
 * eso se muestra también el valor crudo, para que se vea qué se está juntando.
 *
 * Uso:
 *   npx tsx scripts/operadoras-inventario.ts
 */

import { prisma } from '../src/config/prisma'

interface FilaInventario {
  codigo: string
  variantes: string[]
  filas: number
}

async function inventarioDe(tabla: 'liquidacion_servicio' | 'tarifas_servicios') {
  const crudas = await prisma.$queryRawUnsafe<
    Array<{ valor: string; filas: bigint }>
  >(
    `SELECT operadora AS valor, count(*) AS filas
       FROM ${tabla}
      WHERE operadora IS NOT NULL AND btrim(operadora) <> ''
      GROUP BY operadora
      ORDER BY count(*) DESC`
  )

  const porCodigo = new Map<string, FilaInventario>()
  for (const { valor, filas } of crudas) {
    const codigo = valor.trim().toUpperCase()
    const previo = porCodigo.get(codigo)
    if (previo) {
      previo.filas += Number(filas)
      if (!previo.variantes.includes(valor)) previo.variantes.push(valor)
    } else {
      porCodigo.set(codigo, { codigo, variantes: [valor], filas: Number(filas) })
    }
  }
  return [...porCodigo.values()].sort((a, b) => b.filas - a.filas)
}

async function contarNulas(tabla: 'liquidacion_servicio' | 'tarifas_servicios') {
  const [{ nulas }] = await prisma.$queryRawUnsafe<Array<{ nulas: bigint }>>(
    `SELECT count(*) AS nulas FROM ${tabla}
      WHERE operadora IS NULL OR btrim(operadora) = ''`
  )
  return Number(nulas)
}

function imprimir(titulo: string, filas: FilaInventario[], nulas: number) {
  console.log(`\n── ${titulo} ${'─'.repeat(Math.max(0, 60 - titulo.length))}`)
  if (filas.length === 0) {
    console.log('  (sin valores escritos)')
  }
  for (const f of filas) {
    /// Se avisa de las variantes porque al normalizar se funden en una, y
    /// conviene verlo antes y no después.
    const ojo =
      f.variantes.length > 1 ? `   ⚠ se funden: ${f.variantes.map((v) => JSON.stringify(v)).join(', ')}` : ''
    console.log(`  ${String(f.filas).padStart(7)}  ${f.codigo}${ojo}`)
  }
  console.log(`  ${String(nulas).padStart(7)}  (sin operadora — se quedan sin FK, a propósito)`)
}

async function main() {
  const liq = await inventarioDe('liquidacion_servicio')
  imprimir('liquidacion_servicio.operadora', liq, await contarNulas('liquidacion_servicio'))

  /// `tarifas_servicios` se lista SOLO para comparar. Esa columna NO entra en
  /// el catálogo: ahí «operadora» significa otra cosa —selecciona la tabla de
  /// precios— y su dominio no admite 'OTRA'. Mezclarlas haría que 'OTRA'
  /// apareciera como opción de tarifa.
  const tar = await inventarioDe('tarifas_servicios')
  imprimir('tarifas_servicios.operadora  (solo para comparar, NO se toca)', tar, await contarNulas('tarifas_servicios'))

  const soloEnTarifas = tar.filter((t) => !liq.some((l) => l.codigo === t.codigo))
  if (soloEnTarifas.length) {
    console.log(
      `\n  Nota: ${soloEnTarifas.map((t) => t.codigo).join(', ')} aparece(n) en tarifas y no en liquidaciones.`
    )
  }

  console.log('\n── Para el seed ' + '─'.repeat(48))
  console.log('  Pega esto en prisma/seeds/operadoras/index.ts y ajusta nombre y orden:\n')
  console.log(
    JSON.stringify(
      liq.map((f, i) => ({ codigo: f.codigo, nombre: f.codigo, orden: (i + 1) * 10 })),
      null,
      2
    )
  )
  console.log(
    '\n  Ojo: si en el catálogo falta algún código que aparece arriba, el backfill\n' +
      '  del SQL abortará con «BACKFILL INCOMPLETO». Es la red de seguridad.\n'
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
