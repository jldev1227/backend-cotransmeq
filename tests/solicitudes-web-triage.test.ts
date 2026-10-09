/**
 * El clasificador de solicitudes web es el filtro que decide qué llega
 * marcado como «verificar antes de atender». Se prueba sin base de datos:
 * recibe los antecedentes ya consultados.
 */
import { describe, expect, it } from 'vitest'
import { clasificarSolicitud, diasEntre, telefonoColombianoValido, type ContextoTriage } from '../src/modules/solicitudes-web/triage'
import { crearSolicitudPublicaSchema, type CrearSolicitudPublica } from '../src/modules/solicitudes-web/solicitudes-web.schema'
import { excedeLimite, reiniciarLimitador } from '../src/modules/solicitudes-web/limitador'

const HOY = '2026-10-09'

function base(extra: Partial<CrearSolicitudPublica> = {}): CrearSolicitudPublica {
  return {
    tipo: 'cotizacion',
    nombre: 'María Pérez',
    empresa: 'Petrolera del Llano S.A.S.',
    documento: '900123456-7',
    cargo: null,
    correo: 'maria.perez@petrollano.com',
    telefono: '310 555 1234',
    origen: 'Yopal',
    destino: 'Tauramena',
    fecha_servicio: '2026-10-25',
    pasajeros: 12,
    tipo_vehiculo: 'Camioneta 4x4',
    modalidad: 'recurrente',
    mensaje: 'Necesitamos transporte diario de personal al campo durante noviembre.',
    acepta_politica: true,
    tiempo_llenado_ms: 90_000,
    origen_sitio: 'transmeralda.com',
    ...extra
  }
}

const limpio: ContextoTriage = { hoy: HOY, previas: [], mismaIp24h: 0, clienteConocido: null }

describe('clasificarSolicitud', () => {
  it('una cotización completa de una empresa con tiempo queda en riesgo bajo', () => {
    const r = clasificarSolicitud(base(), limpio)
    expect(r.riesgo_nivel).toBe('bajo')
    expect(r.urgente).toBe(false)
    expect(r.senales).toEqual([])
    expect(r.prioridad).toBe('media')
  })

  it('«para hoy» marca urgente y suma riesgo, aunque el resto esté completo', () => {
    const r = clasificarSolicitud(base({ tipo: 'servicio', fecha_servicio: HOY }), limpio)
    expect(r.urgente).toBe(true)
    expect(r.senales.map((s) => s.clave)).toContain('servicio_inmediato')
    expect(r.riesgo_nivel).toBe('medio')
    // Es urgente Y comercialmente prioritaria: la bandeja la sube, pero marcada.
    expect(r.prioridad).toBe('alta')
  })

  it('servicio inmediato, sin empresa ni documento, desde un correo gratuito y llenado en 3 s es riesgo alto', () => {
    const r = clasificarSolicitud(
      base({ tipo: 'servicio', fecha_servicio: HOY, empresa: null, documento: null, correo: 'juan123@gmail.com', tiempo_llenado_ms: 3_000 }),
      limpio
    )
    expect(r.riesgo_nivel).toBe('alto')
    const claves = r.senales.map((s) => s.clave)
    expect(claves).toEqual(expect.arrayContaining(['servicio_inmediato', 'sin_empresa_ni_documento', 'llenado_rapido']))
    // Sin empresa no hay señal de «correo gratuito»: esa solo aplica cuando dice ser de una.
    expect(claves).not.toContain('correo_gratuito')
  })

  it('un cliente registrado resta riesgo y sube la prioridad', () => {
    const r = clasificarSolicitud(base({ tipo: 'servicio', fecha_servicio: HOY }), { ...limpio, clienteConocido: { id: 'x', nombre: 'PETROLERA DEL LLANO' } })
    expect(r.senales.map((s) => s.clave)).toContain('cliente_conocido')
    expect(r.riesgo_nivel).toBe('bajo')
    expect(r.prioridad).toBe('alta')
  })

  it('antecedentes descartados del mismo contacto pesan más que una repetición atendida', () => {
    const d = new Date()
    const malo = clasificarSolicitud(base(), { ...limpio, previas: [{ estado: 'descartada', created_at: d }, { estado: 'spam', created_at: d }] })
    const bueno = clasificarSolicitud(base(), { ...limpio, previas: [{ estado: 'atendida', created_at: d }] })
    expect(malo.riesgo_puntaje).toBeGreaterThan(bueno.riesgo_puntaje)
    expect(bueno.riesgo_puntaje).toBe(0)
  })

  it('una pregunta de información no tiene prioridad comercial ni pide empresa', () => {
    const r = clasificarSolicitud(base({ tipo: 'informacion', empresa: null, documento: null, fecha_servicio: null }), limpio)
    expect(r.prioridad).toBe('baja')
    expect(r.senales).toEqual([])
  })

  it('correo temporal, enlaces y la misma IP repetida suman', () => {
    const r = clasificarSolicitud(
      base({ correo: 'bot@mailinator.com', mensaje: 'mira http://a.co y http://b.co y https://c.co para ganar' }),
      { ...limpio, mismaIp24h: 4 }
    )
    expect(r.senales.map((s) => s.clave)).toEqual(expect.arrayContaining(['correo_desechable', 'mensaje_con_enlaces', 'ip_repetida']))
    expect(r.riesgo_nivel).toBe('alto')
  })
})

describe('ayudas', () => {
  it('diasEntre cuenta días de calendario', () => {
    expect(diasEntre('2026-10-09', '2026-10-10')).toBe(1)
    expect(diasEntre('2026-10-09', '2026-10-09')).toBe(0)
    expect(diasEntre('2026-10-09', '2026-10-01')).toBe(-8)
  })

  it('reconoce celulares y fijos colombianos, con o sin indicativo', () => {
    expect(telefonoColombianoValido('310 555 1234')).toBe(true)
    expect(telefonoColombianoValido('+57 310 555 1234')).toBe(true)
    expect(telefonoColombianoValido('(608) 634 5678')).toBe(true)
    expect(telefonoColombianoValido('+1 212 555 0100')).toBe(false)
    expect(telefonoColombianoValido('12345678')).toBe(false)
  })
})

describe('crearSolicitudPublicaSchema', () => {
  it('exige la autorización de datos y rechaza mensajes vacíos', () => {
    expect(() => crearSolicitudPublicaSchema.parse({ ...base(), acepta_politica: false })).toThrow()
    expect(() => crearSolicitudPublicaSchema.parse({ ...base(), mensaje: 'hola' })).toThrow()
  })

  it('normaliza vacíos a null y el correo a minúsculas', () => {
    const r = crearSolicitudPublicaSchema.parse({ ...base(), empresa: '   ', correo: 'MARIA@Empresa.COM', fecha_servicio: '' })
    expect(r.empresa).toBeNull()
    expect(r.correo).toBe('maria@empresa.com')
    expect(r.fecha_servicio).toBeNull()
  })
})

describe('excedeLimite', () => {
  it('deja pasar hasta el máximo dentro de la ventana y luego corta', () => {
    reiniciarLimitador()
    const t0 = 1_000_000
    expect(excedeLimite('ip', 2, 1000, t0)).toBe(false)
    expect(excedeLimite('ip', 2, 1000, t0 + 10)).toBe(false)
    expect(excedeLimite('ip', 2, 1000, t0 + 20)).toBe(true)
    // Pasada la ventana vuelve a admitir.
    expect(excedeLimite('ip', 2, 1000, t0 + 2000)).toBe(false)
  })
})
