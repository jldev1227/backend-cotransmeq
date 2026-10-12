/**
 * Inventario de las rutas de la API, sacado de la app y no de los archivos.
 *
 * Arranca la app en memoria (`buildApp()` + `ready()`), sin abrir puerto, sin
 * crons y sin sockets, y apunta cada ruta que registra Fastify con el
 * archivo:línea donde se declara. Así el inventario no depende de cómo esté
 * escrito cada `*.routes.ts` (prefijos anidados, plugins dentro de plugins).
 *
 *   npm run docs:inventario   → reescribe docs/api/inventario.md
 *   npm run docs:verificar    → falla si alguna ruta no aparece en docs/api/<modulo>.md
 *   npx tsx scripts/docs/inventario-rutas.ts --json <salida.json>
 *
 * Necesita el `.env` (la configuración se valida al importar), pero no toca la
 * base: Prisma conecta en la primera consulta y aquí no se hace ninguna.
 */
import 'dotenv/config'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { buildApp } from '../../src/app'

interface Ruta {
  metodo: string
  url: string
  archivo: string | null
  linea: number | null
  descripcion: string | null
}

const RAIZ = path.resolve(__dirname, '../..')
const DOCS_API = path.join(RAIZ, 'docs/api')
/// Rutas que registran plugins de terceros y no un módulo: no se documentan
/// endpoint por endpoint (están explicadas en docs/api/README.md).
const DE_PLUGINS = new Set(['OPTIONS *', 'GET /assets/*'])

/** Primer marco de la pila dentro de `src/` (sin contar app.ts): ahí se declaró la ruta. */
function origen(): { archivo: string | null; linea: number | null } {
  const pila = (new Error().stack ?? '').split('\n').slice(2)
  for (const marco of pila) {
    const m = marco.match(/\(?((?:\/|file:\/\/)[^():]+\.ts):(\d+):\d+\)?$/)
    if (!m) continue
    const archivo = m[1].replace('file://', '')
    if (archivo.includes('node_modules') || !archivo.includes('/src/') || archivo.endsWith('/src/app.ts')) continue
    return { archivo: path.relative(RAIZ, archivo), linea: Number(m[2]) }
  }
  return { archivo: null, linea: null }
}

async function inventario(): Promise<Ruta[]> {
  const rutas: Ruta[] = []
  const app = buildApp()
  /// `onRoute` se añade en el acto (no se difiere como los demás hooks), así que
  /// alcanza a todos los plugins, que se cargan después, en `ready()`. La única
  /// que se pierde es `GET /`, declarada en `buildApp()` antes de este punto.
  app.addHook('onRoute', (opts) => {
    const metodos = (Array.isArray(opts.method) ? opts.method : [opts.method]).filter((m) => m !== 'HEAD')
    const schema = (opts.schema ?? {}) as Record<string, any>
    const { archivo, linea } = origen()
    for (const metodo of metodos) {
      rutas.push({
        metodo,
        url: opts.url.length > 1 ? opts.url.replace(/\/$/, '') : opts.url,
        archivo,
        linea,
        descripcion: schema.description ?? schema.summary ?? null,
      })
    }
  })
  await app.ready()
  await app.close().catch(() => undefined)

  const vistas = new Set<string>()
  return rutas
    .filter((r) => {
      const clave = `${r.metodo} ${r.url}`
      if (vistas.has(clave)) return false
      vistas.add(clave)
      return true
    })
    .sort((a, b) => a.url.localeCompare(b.url) || a.metodo.localeCompare(b.metodo))
}

/** Carpeta de `src/modules/` que declara la ruta, que es también el nombre de su doc. */
function moduloDe(r: Ruta): string | null {
  const m = r.archivo?.match(/^src\/modules\/([^/]+)\//)
  return m ? m[1] : null
}

interface RutasDeDoc {
  /** Filas de la tabla de endpoints: `| GET | `/api/x` |`. Es lo que el doc declara. */
  enTabla: Set<string>
  /** Además, las citadas en encabezados o en la prosa: `GET /api/x`. */
  citadas: Set<string>
}

/**
 * Rutas que nombra un doc. Para dar una ruta por documentada vale cualquiera de
 * las dos formas; para avisar de rutas que ya no existen solo cuentan las
 * tablas, porque la prosa cita a propósito rutas del repo gemelo o patrones
 * con comodín (`/api/viaticos/*`).
 */
function rutasDocumentadas(texto: string): RutasDeDoc {
  /// Solo rutas con `/api/`: en la prosa a veces se cita el patrón tal como está
  /// escrito en el archivo (`POST /inducciones`), sin el prefijo del plugin.
  const fila = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`(\/api\/[^`]+)`/gm
  const cita = /`(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`\s]+)`/g
  const normalizar = (m: RegExpMatchArray) => `${m[1]} ${m[2].replace(/\?.*$/, '').replace(/\/$/, '')}`
  const enTabla = new Set([...texto.matchAll(fila)].map(normalizar).filter((r) => !r.includes('*')))
  const citadas = new Set([...enTabla, ...[...texto.matchAll(cita)].map(normalizar)])
  return { enTabla, citadas }
}

function documentos(): Map<string, RutasDeDoc> {
  const docs = new Map<string, RutasDeDoc>()
  if (!existsSync(DOCS_API)) return docs
  for (const nombre of readdirSync(DOCS_API)) {
    if (!nombre.endsWith('.md') || nombre === 'inventario.md') continue
    docs.set(nombre.replace(/\.md$/, ''), rutasDocumentadas(readFileSync(path.join(DOCS_API, nombre), 'utf8')))
  }
  return docs
}

function escribirMarkdown(rutas: Ruta[], destino: string) {
  const docs = documentos()
  const porModulo = new Map<string, Ruta[]>()
  for (const r of rutas) {
    if (DE_PLUGINS.has(`${r.metodo} ${r.url}`)) continue
    const m = moduloDe(r) ?? '(sin módulo)'
    porModulo.set(m, [...(porModulo.get(m) ?? []), r])
  }
  const modulos = [...porModulo.keys()].sort()
  const total = [...porModulo.values()].reduce((n, l) => n + l.length, 0)

  const lineas = [
    '# Inventario de rutas',
    '',
    '> Archivo generado por `npm run docs:inventario` (`scripts/docs/inventario-rutas.ts`).',
    '> No lo edites a mano: regenéralo cuando cambien las rutas.',
    '',
    `${total} rutas en ${modulos.length} módulos, más \`GET /\` (salud) y las que`,
    'registran los plugins (`OPTIONS *` de CORS y `GET /assets/*`). Cada módulo',
    'enlaza su referencia; ahí están la guarda, los parámetros y las respuestas.',
    '',
    '| Módulo | Rutas |',
    '|---|--:|',
    ...modulos.map((m) => `| ${docs.has(m) ? `[\`${m}\`](./${m}.md)` : `\`${m}\``} | ${porModulo.get(m)!.length} |`),
  ]
  for (const m of modulos) {
    lineas.push('', `## ${m}`, '', '| Método | Ruta | Declarada en |', '|---|---|---|')
    for (const r of porModulo.get(m)!) {
      lineas.push(`| ${r.metodo} | \`${r.url}\` | \`${r.archivo ?? '?'}:${r.linea ?? '?'}\` |`)
    }
  }
  writeFileSync(destino, lineas.join('\n') + '\n')
  console.log(`Escrito ${path.relative(RAIZ, destino)}: ${total} rutas en ${modulos.length} módulos.`)
}

/** Cada ruta tiene que aparecer en el doc de su módulo (o, si no tiene, en alguno). */
function verificar(rutas: Ruta[]): boolean {
  const docs = documentos()
  const todas = new Set([...docs.values()].flatMap((d) => [...d.citadas]))
  const faltan: string[] = []
  for (const r of rutas) {
    const clave = `${r.metodo} ${r.url}`
    if (DE_PLUGINS.has(clave)) continue
    const m = moduloDe(r)
    const enSuDoc = m ? docs.get(m)?.citadas.has(clave) : todas.has(clave)
    if (!enSuDoc) faltan.push(`${clave}   (${m ? `docs/api/${m}.md` : 'ningún doc'} · ${r.archivo}:${r.linea})`)
  }
  const sobran: string[] = []
  const vivas = new Set(rutas.map((r) => `${r.metodo} ${r.url}`))
  for (const [doc, { enTabla }] of docs) {
    for (const clave of enTabla) {
      if (!vivas.has(clave)) sobran.push(`${clave}   (docs/api/${doc}.md)`)
    }
  }
  if (faltan.length) console.log(`Rutas sin documentar (${faltan.length}):\n  ${faltan.join('\n  ')}`)
  if (sobran.length) console.log(`Rutas documentadas que ya no existen (${sobran.length}):\n  ${sobran.join('\n  ')}`)
  const propias = rutas.filter((r) => !DE_PLUGINS.has(`${r.metodo} ${r.url}`)).length
  if (!faltan.length && !sobran.length) console.log(`Las ${propias} rutas de los módulos están documentadas.`)
  return faltan.length === 0 && sobran.length === 0
}

async function main() {
  const [modo, destino] = process.argv.slice(2)
  const rutas = await inventario()
  if (modo === '--json' && destino) {
    writeFileSync(destino, JSON.stringify(rutas, null, 1))
  } else if (modo === '--md') {
    escribirMarkdown(rutas, path.resolve(RAIZ, destino ?? 'docs/api/inventario.md'))
  } else if (modo === '--verificar') {
    process.exit(verificar(rutas) ? 0 : 1)
  } else {
    console.error('Uso: inventario-rutas.ts --md [destino.md] | --verificar | --json <salida.json>')
    process.exit(2)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
