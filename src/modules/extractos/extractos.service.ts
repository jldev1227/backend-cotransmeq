import { prisma } from '../../config/prisma'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'

interface ExtractoHistorico {
  consecutivo: string
  contratante: string
  origen_destino: string
  fecha_inicial: string
  fecha_final: string
  placa: string
  num_interno: string
  num_tarjeta_operacion: string
  conductor_1: string
  vigencia_pase_1: string
  conductor_2: string
  vigencia_pase_2: string
  conductor_3: string
  vigencia_pase_3: string
  // Matching
  cliente_id?: string | null
  cliente_match?: boolean
  vehiculo_id?: string | null
  vehiculo_match?: boolean
  conductores_match?: boolean[]
}

// Cache
let cachedExtractos: ExtractoHistorico[] | null = null
let cachedMatchedExtractos: ExtractoHistorico[] | null = null
let lastParseTime = 0

// Aliases de contratantes que son la misma empresa
const CONTRATANTE_ALIASES: Record<string, string[]> = {
  'HV SERVICES Y SUPPLY SAS': ['FEPCO SERVICIOS S.A.S', 'FEPCO SERVICIOS SAS', 'FEPCO SERVICIOS'],
  'FEPCO SERVICIOS S.A.S': ['HV SERVICES Y SUPPLY SAS'],
}

function normalizeString(str: string): string {
  return str
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function parseExtractosFile(): ExtractoHistorico[] {
  if (cachedExtractos && Date.now() - lastParseTime < 60000) {
    return cachedExtractos
  }

  const filePath = path.join(__dirname, '../../../extractos.txt')
  
  if (!fs.existsSync(filePath)) {
    console.error('❌ extractos.txt no encontrado en:', filePath)
    return []
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim() !== '')
  
  const extractos: ExtractoHistorico[] = []
  
  for (let i = 0; i < lines.length; i++) {
    // Clean quotes from line before splitting (Excel exports sometimes wrap fields with tabs in quotes)
    const cleanLine = lines[i].replace(/"/g, '')
    let cols = cleanLine.split('\t')
    
    // If line has 15+ columns (extra tab from quoted field), merge col1+col2 as contratante
    if (cols.length > 14) {
      const consecutivo = cols[0]?.trim() || ''
      const contratante = cols.slice(1, cols.length - 12).map(c => c.trim()).filter(Boolean).join(' ')
      const rest = cols.slice(cols.length - 12)
      cols = [consecutivo, contratante, ...rest]
    }
    
    const consecutivo = cols[0]?.trim() || ''
    
    // Skip invalid rows (like #¡REF! rows)
    if (!consecutivo || consecutivo.includes('#') || consecutivo.includes('REF') || isNaN(Number(consecutivo))) {
      continue
    }

    const contratante = cols[1]?.trim() || ''
    const conductor1 = cols[8]?.trim() || ''
    const conductor2 = cols[10]?.trim() || ''
    const conductor3 = cols[12]?.trim() || ''
    
    extractos.push({
      consecutivo: consecutivo.padStart(4, '0'),
      contratante,
      origen_destino: cols[2]?.trim() || '',
      fecha_inicial: cols[3]?.trim() || '',
      fecha_final: cols[4]?.trim() || '',
      placa: cols[5]?.trim() || '',
      num_interno: cols[6]?.trim() || '',
      num_tarjeta_operacion: cols[7]?.trim() || '',
      conductor_1: conductor1 === '##########' ? '' : conductor1,
      vigencia_pase_1: cols[9]?.trim() || '',
      conductor_2: conductor2 === '##########' ? '' : conductor2,
      vigencia_pase_2: cols[11]?.trim() || '',
      conductor_3: conductor3 === '##########' ? '' : conductor3,
      vigencia_pase_3: cols[13]?.trim() || '',
    })
  }

  cachedExtractos = extractos
  lastParseTime = Date.now()
  
  console.log(`✅ Parseados ${extractos.length} extractos históricos`)
  return extractos
}

export const ExtractosService = {
  async getAll(query: {
    page?: number
    limit?: number
    search?: string
    contratante?: string
    placa?: string
    conductor?: string
    desde?: string
    hasta?: string
  }) {
    const extractos = parseExtractosFile()
    
    let filtered = [...extractos]

    // Filtros
    if (query.search) {
      const s = normalizeString(query.search)
      filtered = filtered.filter(e => 
        normalizeString(e.consecutivo).includes(s) ||
        normalizeString(e.contratante).includes(s) ||
        normalizeString(e.placa).includes(s) ||
        normalizeString(e.origen_destino).includes(s) ||
        normalizeString(e.conductor_1).includes(s) ||
        normalizeString(e.conductor_2).includes(s) ||
        normalizeString(e.conductor_3).includes(s)
      )
    }

    if (query.contratante) {
      const c = normalizeString(query.contratante)
      filtered = filtered.filter(e => {
        const norm = normalizeString(e.contratante)
        if (norm.includes(c)) return true
        // Check aliases
        for (const [key, aliases] of Object.entries(CONTRATANTE_ALIASES)) {
          if (normalizeString(key).includes(c) || aliases.some(a => normalizeString(a).includes(c))) {
            if (norm.includes(normalizeString(key)) || aliases.some(a => norm.includes(normalizeString(a)))) {
              return true
            }
          }
        }
        return false
      })
    }

    if (query.placa) {
      const p = query.placa.toUpperCase().trim()
      filtered = filtered.filter(e => e.placa.toUpperCase().includes(p))
    }

    if (query.conductor) {
      const c = normalizeString(query.conductor)
      filtered = filtered.filter(e =>
        normalizeString(e.conductor_1).includes(c) ||
        normalizeString(e.conductor_2).includes(c) ||
        normalizeString(e.conductor_3).includes(c)
      )
    }

    // Pagination
    const page = query.page || 1
    const limit = query.limit || 50
    const total = filtered.length
    const pages = Math.ceil(total / limit)
    const start = (page - 1) * limit
    const paginated = filtered.slice(start, start + limit)

    return {
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1
      }
    }
  },

  async getMatches() {
    // Get all unique values from extractos
    const extractos = parseExtractosFile()
    
    const uniquePlacas = [...new Set(extractos.map(e => e.placa.toUpperCase()).filter(Boolean))]
    const uniqueContratantes = [...new Set(extractos.map(e => normalizeString(e.contratante)).filter(Boolean))]
    
    // Collect all conductor names
    const allConductorNames = new Set<string>()
    extractos.forEach(e => {
      if (e.conductor_1 && e.conductor_1 !== '##########') allConductorNames.add(normalizeString(e.conductor_1))
      if (e.conductor_2 && e.conductor_2 !== '##########') allConductorNames.add(normalizeString(e.conductor_2))
      if (e.conductor_3 && e.conductor_3 !== '##########') allConductorNames.add(normalizeString(e.conductor_3))
    })

    // Query DB for matches
    const [vehiculosDB, clientesDB, conductoresDB] = await Promise.all([
      prisma.vehiculos.findMany({
        select: { id: true, placa: true, marca: true, modelo: true, clase_vehiculo: true },
        where: { deleted_at: null }
      }),
      prisma.clientes.findMany({
        select: { id: true, nombre: true, nit: true },
        where: { deletedAt: null }
      }),
      prisma.conductores.findMany({
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
        where: { oculto: false }
      })
    ])

    // Build lookup maps
    const placaMap = new Map<string, string>()
    vehiculosDB.forEach(v => placaMap.set(v.placa.toUpperCase(), v.id))

    const clienteMap = new Map<string, string>()
    clientesDB.forEach(c => {
      if (c.nombre) clienteMap.set(normalizeString(c.nombre), c.id)
    })

    // Add known aliases to cliente map
    // HV SERVICES Y SUPPLY SAS -> look for FEPCO SERVICIOS in DB
    for (const [alias, targets] of Object.entries(CONTRATANTE_ALIASES)) {
      const aliasNorm = normalizeString(alias)
      for (const target of targets) {
        const targetNorm = normalizeString(target)
        // If target exists in DB, map alias to its ID
        if (clienteMap.has(targetNorm) && !clienteMap.has(aliasNorm)) {
          clienteMap.set(aliasNorm, clienteMap.get(targetNorm)!)
        }
        // Vice versa
        if (clienteMap.has(aliasNorm) && !clienteMap.has(targetNorm)) {
          clienteMap.set(targetNorm, clienteMap.get(aliasNorm)!)
        }
      }
    }

    const conductorMap = new Map<string, string>()
    conductoresDB.forEach(c => {
      const fullName = normalizeString(`${c.nombre} ${c.apellido}`)
      conductorMap.set(fullName, c.id)
    })

    return {
      placaMap: Object.fromEntries(placaMap),
      clienteMap: Object.fromEntries(clienteMap),
      conductorMap: Object.fromEntries(conductorMap),
      stats: {
        totalExtractos: extractos.length,
        uniquePlacas: uniquePlacas.length,
        uniqueContratantes: uniqueContratantes.length,
        uniqueConductores: allConductorNames.size,
        matchedPlacas: uniquePlacas.filter(p => placaMap.has(p)).length,
        matchedContratantes: uniqueContratantes.filter(c => clienteMap.has(c)).length,
        matchedConductores: [...allConductorNames].filter(c => conductorMap.has(c)).length,
      }
    }
  },

  async getContratantes() {
    const extractos = parseExtractosFile()
    const contratanteCount = new Map<string, number>()
    
    extractos.forEach(e => {
      const name = e.contratante.trim()
      if (name) {
        contratanteCount.set(name, (contratanteCount.get(name) || 0) + 1)
      }
    })

    return [...contratanteCount.entries()]
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count)
  },

  /**
   * Sincroniza entidades del extractos.txt con la base de datos.
   * Crea contratantes, vehículos y conductores que no existan, evitando duplicados.
   * Retorna los mapas completos (nombre/placa → UUID) para todas las entidades.
   */
  async syncToDatabase() {
    const extractos = parseExtractosFile()
    const now = new Date()

    // ─── 1. Recopilar valores únicos del archivo ───
    const uniqueContratantesRaw = new Map<string, string>() // normalized → original name
    const uniquePlacasRaw = new Map<string, { placa: string; num_interno: string }>()
    const uniqueConductoresRaw = new Map<string, string>() // normalized → original name

    for (const e of extractos) {
      // Contratantes
      if (e.contratante.trim()) {
        const norm = normalizeString(e.contratante)
        if (!uniqueContratantesRaw.has(norm)) {
          uniqueContratantesRaw.set(norm, e.contratante.trim())
        }
      }

      // Placas
      if (e.placa.trim()) {
        const key = e.placa.toUpperCase().trim()
        if (!uniquePlacasRaw.has(key)) {
          uniquePlacasRaw.set(key, {
            placa: e.placa.toUpperCase().trim(),
            num_interno: e.num_interno?.trim() || ''
          })
        }
      }

      // Conductores
      for (const condName of [e.conductor_1, e.conductor_2, e.conductor_3]) {
        if (condName && condName !== '##########' && condName.trim()) {
          const norm = normalizeString(condName)
          if (!uniqueConductoresRaw.has(norm)) {
            uniqueConductoresRaw.set(norm, condName.trim())
          }
        }
      }
    }

    // ─── 2. Consultar lo que YA existe en la BD ───
    const [existingClientes, existingVehiculos, existingConductores] = await Promise.all([
      prisma.clientes.findMany({
        select: { id: true, nombre: true, nit: true },
        where: { deletedAt: null }
      }),
      prisma.vehiculos.findMany({
        select: { id: true, placa: true },
        where: { deleted_at: null }
      }),
      prisma.conductores.findMany({
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
        where: { oculto: false }
      })
    ])

    // ─── 3. Mapas de existentes ───
    const clienteMap = new Map<string, string>()
    existingClientes.forEach(c => {
      if (c.nombre) clienteMap.set(normalizeString(c.nombre), c.id)
    })

    // Aliases bidireccionales
    for (const [alias, targets] of Object.entries(CONTRATANTE_ALIASES)) {
      const aliasNorm = normalizeString(alias)
      for (const target of targets) {
        const targetNorm = normalizeString(target)
        if (clienteMap.has(targetNorm) && !clienteMap.has(aliasNorm)) {
          clienteMap.set(aliasNorm, clienteMap.get(targetNorm)!)
        }
        if (clienteMap.has(aliasNorm) && !clienteMap.has(targetNorm)) {
          clienteMap.set(targetNorm, clienteMap.get(aliasNorm)!)
        }
      }
    }

    const placaMap = new Map<string, string>()
    existingVehiculos.forEach(v => placaMap.set(v.placa.toUpperCase(), v.id))

    const conductorMap = new Map<string, string>()
    existingConductores.forEach(c => {
      const fullName = normalizeString(`${c.nombre} ${c.apellido}`)
      conductorMap.set(fullName, c.id)
    })

    // ─── 4. Crear contratantes faltantes ───
    const clientesToCreate: { id: string; nombre: string }[] = []
    for (const [norm, originalName] of uniqueContratantesRaw) {
      // Skip if alias already resolved
      if (clienteMap.has(norm)) continue

      // Check aliases - si tiene alias y el alias existe, mapear
      let aliasFound = false
      for (const [aliasKey, aliasTargets] of Object.entries(CONTRATANTE_ALIASES)) {
        const aliasNorm = normalizeString(aliasKey)
        if (norm === aliasNorm || aliasTargets.some(t => normalizeString(t) === norm)) {
          // Check if any alias/target already in map
          if (clienteMap.has(aliasNorm)) {
            clienteMap.set(norm, clienteMap.get(aliasNorm)!)
            aliasFound = true
            break
          }
          for (const t of aliasTargets) {
            const tNorm = normalizeString(t)
            if (clienteMap.has(tNorm)) {
              clienteMap.set(norm, clienteMap.get(tNorm)!)
              aliasFound = true
              break
            }
          }
          if (aliasFound) break
        }
      }
      if (aliasFound) continue

      const newId = randomUUID()
      clientesToCreate.push({ id: newId, nombre: originalName })
      clienteMap.set(norm, newId)
    }

    if (clientesToCreate.length > 0) {
      await prisma.clientes.createMany({
        data: clientesToCreate.map(c => ({
          id: c.id,
          nombre: c.nombre,
          createdAt: now,
          updatedAt: now,
          oculto: false
        })),
        skipDuplicates: true
      })
      console.log(`✅ Creados ${clientesToCreate.length} contratantes nuevos`)
    }

    // ─── 5. Crear vehículos faltantes ───
    const vehiculosToCreate: { id: string; placa: string }[] = []
    for (const [placaKey, info] of uniquePlacasRaw) {
      if (placaMap.has(placaKey)) continue

      const newId = randomUUID()
      vehiculosToCreate.push({ id: newId, placa: info.placa })
      placaMap.set(placaKey, newId)
    }

    if (vehiculosToCreate.length > 0) {
      // Insertar uno por uno para manejar duplicados por unique constraint
      for (const v of vehiculosToCreate) {
        try {
          await prisma.vehiculos.create({
            data: {
              id: v.id,
              placa: v.placa,
              clase_vehiculo: 'POR DEFINIR',
              created_at: now,
              updated_at: now,
              oculto: false
            }
          })
        } catch (err: any) {
          // Si ya existe (unique constraint), buscar el existente
          if (err.code === 'P2002') {
            const existing = await prisma.vehiculos.findFirst({
              where: { placa: v.placa },
              select: { id: true }
            })
            if (existing) placaMap.set(v.placa.toUpperCase(), existing.id)
          }
        }
      }
      console.log(`✅ Creados ${vehiculosToCreate.length} vehículos nuevos`)
    }

    // ─── 6. Crear conductores faltantes ───
    const conductoresToCreate: { id: string; nombre: string; apellido: string; numero_identificacion: string }[] = []
    let conductorCounter = 0
    for (const [norm, originalName] of uniqueConductoresRaw) {
      if (conductorMap.has(norm)) continue

      // Separar nombre y apellido del nombre completo
      const parts = originalName.split(' ')
      let nombre: string
      let apellido: string
      if (parts.length >= 4) {
        // Ej: "JUAN CARLOS PEREZ LOPEZ" -> nombre="JUAN CARLOS", apellido="PEREZ LOPEZ"
        const mid = Math.ceil(parts.length / 2)
        nombre = parts.slice(0, mid).join(' ')
        apellido = parts.slice(mid).join(' ')
      } else if (parts.length >= 2) {
        nombre = parts[0]
        apellido = parts.slice(1).join(' ')
      } else {
        nombre = originalName
        apellido = ''
      }

      conductorCounter++
      const newId = randomUUID()
      // Generar identificación temporal única
      const tempId = `EXT-${Date.now()}-${conductorCounter}`
      conductoresToCreate.push({ id: newId, nombre, apellido, numero_identificacion: tempId })
      conductorMap.set(norm, newId)
    }

    if (conductoresToCreate.length > 0) {
      for (const c of conductoresToCreate) {
        try {
          await prisma.conductores.create({
            data: {
              id: c.id,
              nombre: c.nombre,
              apellido: c.apellido,
              tipo_identificacion: 'CC',
              numero_identificacion: c.numero_identificacion,
              fecha_ingreso: now,
              cargo: 'CONDUCTOR',
              created_at: now,
              updated_at: now,
              oculto: false
            }
          })
        } catch (err: any) {
          // Si falla por unique, ignorar
          if (err.code === 'P2002') {
            console.warn(`⚠️ Conductor duplicado, saltando: ${c.nombre} ${c.apellido}`)
          }
        }
      }
      console.log(`✅ Creados ${conductoresToCreate.length} conductores nuevos`)
    }

    return {
      placaMap: Object.fromEntries(placaMap),
      clienteMap: Object.fromEntries(clienteMap),
      conductorMap: Object.fromEntries(conductorMap),
      created: {
        clientes: clientesToCreate.length,
        vehiculos: vehiculosToCreate.length,
        conductores: conductoresToCreate.length
      },
      stats: {
        totalExtractos: extractos.length,
        uniquePlacas: uniquePlacasRaw.size,
        uniqueContratantes: uniqueContratantesRaw.size,
        uniqueConductores: uniqueConductoresRaw.size,
        matchedPlacas: placaMap.size,
        matchedContratantes: clienteMap.size,
        matchedConductores: conductorMap.size,
      }
    }
  },

  // Invalidate cache
  invalidateCache() {
    cachedExtractos = null
    cachedMatchedExtractos = null
    lastParseTime = 0
  },

  // Get the next consecutivo number
  getNextConsecutivo(): number {
    const extractos = parseExtractosFile()
    if (extractos.length === 0) return 1

    let maxConsecutivo = 0
    for (const e of extractos) {
      const num = parseInt(e.consecutivo, 10)
      if (!isNaN(num) && num > maxConsecutivo) {
        maxConsecutivo = num
      }
    }
    return maxConsecutivo + 1
  },

  // Create a new extracto (append to file)
  async createExtracto(data: {
    contratante: string
    origen_destino: string
    fecha_inicial: string
    fecha_final: string
    placa: string
    num_interno: string
    num_tarjeta_operacion: string
    conductor_1: string
    vigencia_pase_1: string
    conductor_2: string
    vigencia_pase_2: string
    conductor_3: string
    vigencia_pase_3: string
  }) {
    const filePath = path.join(__dirname, '../../../extractos.txt')
    const nextConsecutivo = this.getNextConsecutivo()

    // Build TSV line matching file format:
    // consecutivo \t contratante \t origen_destino \t fecha_inicial \t fecha_final \t placa \t num_interno \t num_tarjeta_operacion \t conductor_1 \t vigencia_pase_1 \t conductor_2 \t vigencia_pase_2 \t conductor_3 \t vigencia_pase_3
    const line = [
      nextConsecutivo.toString(),
      data.contratante || '',
      data.origen_destino || '',
      data.fecha_inicial || '',
      data.fecha_final || '',
      data.placa || '',
      data.num_interno || '',
      data.num_tarjeta_operacion || '',
      data.conductor_1 || '',
      data.vigencia_pase_1 || '',
      data.conductor_2 || '',
      data.vigencia_pase_2 || '',
      data.conductor_3 || '',
      data.vigencia_pase_3 || '',
    ].join('\t')

    // Read file, prepend new line at top (file is sorted desc by consecutivo)
    const content = fs.readFileSync(filePath, 'utf-8')
    fs.writeFileSync(filePath, line + '\n' + content, 'utf-8')

    // Invalidate cache
    this.invalidateCache()

    console.log(`✅ Extracto ${nextConsecutivo} creado exitosamente`)

    return {
      consecutivo: nextConsecutivo,
      message: `Extracto ${nextConsecutivo} creado exitosamente`
    }
  },

  // Delete all extractos from the file
  async deleteAllExtractos() {
    const filePath = path.join(__dirname, '../../../extractos.txt')
    fs.writeFileSync(filePath, '', 'utf-8')
    this.invalidateCache()
    console.log('✅ Todos los extractos eliminados')
    return { message: 'Todos los extractos eliminados' }
  },

  // Delete a specific extracto by consecutivo
  async deleteExtracto(consecutivo: string) {
    const filePath = path.join(__dirname, '../../../extractos.txt')
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    
    const filteredLines = lines.filter(line => {
      const cols = line.split('\t')
      const lineConsecutivo = cols[0]?.trim()
      return lineConsecutivo !== consecutivo
    })

    fs.writeFileSync(filePath, filteredLines.join('\n'), 'utf-8')
    this.invalidateCache()
    console.log(`✅ Extracto ${consecutivo} eliminado`)
    return { consecutivo, message: `Extracto ${consecutivo} eliminado` }
  }
}
