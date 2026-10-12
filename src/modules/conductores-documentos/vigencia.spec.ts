/**
 * Vigencias y umbrales de aviso de los documentos del conductor.
 *
 * Sin base de datos: la pestaña Documentos y el cron de avisos deciden con
 * estas funciones, así que basta con fijarlas aquí para que no discrepen.
 */
import { describe, expect, it } from 'vitest'
import { CATEGORIAS_DOCUMENTO_CONDUCTOR, CATEGORIA_CONDUCTOR_POR_CLAVE } from './catalogo'
import { estadoDe, hoyColombia, referenciaAviso, umbralDe, type FilaVigencia } from './vigencia'

const HOY = '2026-10-10'
const fila = (vence: string | null, estado = 'vigente'): FilaVigencia => ({
  estado,
  fecha_vencimiento: vence ? new Date(`${vence}T00:00:00Z`) : null,
  fecha_vigencia: null,
  metadata: {},
})

describe('umbralDe', () => {
  it('avisa en 30, 15, 7 y 0 días, tomando el menor umbral no alcanzado', () => {
    expect(umbralDe(45)).toBeNull()
    expect(umbralDe(31)).toBeNull()
    expect(umbralDe(30)).toBe('30')
    expect(umbralDe(16)).toBe('30')
    expect(umbralDe(15)).toBe('15')
    expect(umbralDe(12)).toBe('15')
    expect(umbralDe(7)).toBe('7')
    expect(umbralDe(1)).toBe('7')
    expect(umbralDe(0)).toBe('0')
  })

  it('«vencido» solo los primeros tres días', () => {
    expect(umbralDe(-1)).toBe('vencido')
    expect(umbralDe(-3)).toBe('vencido')
    expect(umbralDe(-4)).toBeNull()
    expect(umbralDe(-200)).toBeNull()
  })

  it('una ventana corta (PILA mensual) no usa los umbrales que no le caben', () => {
    expect(umbralDe(20, 7)).toBeNull()
    expect(umbralDe(8, 7)).toBeNull()
    expect(umbralDe(7, 7)).toBe('7')
    expect(umbralDe(0, 7)).toBe('0')
    expect(umbralDe(-2, 7)).toBe('vencido')
  })
})

describe('estadoDe', () => {
  it('semáforo de una categoría que vence', () => {
    expect(estadoDe('EXAMEN_MEDICO', fila('2027-03-01'), HOY)).toMatchObject({ estado: 'vigente', vence: '2027-03-01' })
    expect(estadoDe('EXAMEN_MEDICO', fila('2026-11-09'), HOY)).toMatchObject({ estado: 'por_vencer', dias: 30 })
    expect(estadoDe('EXAMEN_MEDICO', fila('2026-10-10'), HOY)).toMatchObject({ estado: 'por_vencer', dias: 0 })
    expect(estadoDe('EXAMEN_MEDICO', fila('2026-10-09'), HOY)).toMatchObject({ estado: 'vencido', dias: -1 })
    expect(estadoDe('EXAMEN_MEDICO', fila(null), HOY).estado).toBe('sin_fecha')
    expect(estadoDe('EXAMEN_MEDICO', null, HOY).estado).toBe('faltante')
  })

  it('la ventana de «por vencer» respeta la de la categoría', () => {
    /// A 20 días, un examen médico ya está por vencer; la PILA (7 días) no.
    expect(estadoDe('EXAMEN_MEDICO', fila('2026-10-30'), HOY).estado).toBe('por_vencer')
    expect(estadoDe('SEGURIDAD_SOCIAL', fila('2026-10-30'), HOY).estado).toBe('vigente')
    expect(estadoDe('SEGURIDAD_SOCIAL', fila('2026-10-15'), HOY).estado).toBe('por_vencer')
  })

  it('sin vencimiento: cargado o faltante; «no aplica» gana a todo', () => {
    expect(estadoDe('CEDULA', fila(null), HOY).estado).toBe('cargado')
    expect(estadoDe('CEDULA', null, HOY).estado).toBe('faltante')
    expect(estadoDe('LIBRETA_MILITAR', fila(null, 'no_aplica'), HOY).estado).toBe('no_aplica')
  })

  it('la licencia toma la fecha de la ficha aunque no haya archivo, y la ficha manda', () => {
    expect(estadoDe('LICENCIA', null, HOY, '2028-12-09')).toMatchObject({ estado: 'vigente', vence: '2028-12-09' })
    expect(estadoDe('LICENCIA', null, HOY, '2026-10-20')).toMatchObject({ estado: 'por_vencer', dias: 10 })
    expect(estadoDe('LICENCIA', fila('2025-01-01'), HOY, '2029-01-01').vence).toBe('2029-01-01')
    /// Sin fecha en la ficha, vale la del documento.
    expect(estadoDe('LICENCIA', fila('2026-09-01'), HOY, null)).toMatchObject({ estado: 'vencido', vence: '2026-09-01' })
    expect(estadoDe('LICENCIA', null, HOY, null).estado).toBe('faltante')
  })

  it('lee la fecha corregida de la carga de 2025 (`fechaVigenciaOriginal`)', () => {
    const vieja: FilaVigencia = {
      estado: 'vigente',
      fecha_vencimiento: null,
      fecha_vigencia: new Date('2027-01-02T00:00:00Z'),
      metadata: { fechaVigenciaOriginal: '2027-01-01' },
    }
    expect(estadoDe('EXAMEN_MEDICO', vieja, HOY).vence).toBe('2027-01-01')
  })
})

describe('catálogo y huella del aviso', () => {
  it('la huella cabe en notificacion.referencia_tipo (VARCHAR 50) con la categoría más larga', () => {
    for (const c of CATEGORIAS_DOCUMENTO_CONDUCTOR.filter((x) => x.vence)) {
      const ref = referenciaAviso(c.clave, '2026-10-10', 'vencido')
      expect(ref.length, ref).toBeLessThanOrEqual(50)
    }
  })

  it('las claves son únicas y conservan las de la carga de 2025', () => {
    const claves = CATEGORIAS_DOCUMENTO_CONDUCTOR.map((c) => c.clave)
    expect(new Set(claves).size).toBe(claves.length)
    for (const k of ['LICENCIA', 'CEDULA', 'CONTRATO']) expect(CATEGORIA_CONDUCTOR_POR_CLAVE.has(k)).toBe(true)
    /// La foto de perfil vive en la misma tabla y NO es parte de esto.
    expect(CATEGORIA_CONDUCTOR_POR_CLAVE.has('FOTO_PERFIL')).toBe(false)
  })

  it('hoy es el día de Colombia, no el de UTC', () => {
    /// 10 p. m. del 9 en Bogotá ya es el 10 en UTC.
    expect(hoyColombia(new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-09')
  })
})
