/**
 * Genera el inventario legible de las semillas para la revisión de HSEQ.
 *
 *   npm run seeds:formularios:inventario
 *
 * NO toca la base de datos, no lee `DATABASE_URL` y no importa Prisma. Es un
 * generador de informe: entra el código de las semillas y sale texto.
 *
 * Sale con código 1 si alguna semilla tiene errores, para que un pipeline lo note.
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { SEMILLAS_HSEQ } from './index'
import { informeLegible, revisarConjunto } from './validate'

const reporte = revisarConjunto(SEMILLAS_HSEQ)
const informe = informeLegible(reporte)

console.log(informe)

/// Se escribe también a archivo: el informe de trece semillas no cabe cómodo en
/// una terminal y HSEQ lo va a revisar en pantalla, no en la consola.
const destino = resolve(__dirname, 'INVENTARIO.txt')
writeFileSync(destino, `${informe}\n`, 'utf8')
console.log(`\nInforme escrito en ${destino}`)

if (reporte.invalidas > 0 || reporte.problemas.length > 0) {
	console.error(
		`\n${reporte.invalidas} semilla(s) con errores y ${reporte.problemas.length} problema(s) del conjunto.`
	)
	process.exit(1)
}
