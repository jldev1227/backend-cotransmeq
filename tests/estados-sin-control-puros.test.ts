/**
 * Las tres «puertas» de estado que se cerraron en oct-2026, probadas sin base:
 *
 * - Lista blanca de campos de una acción correctiva (`acciones-correctivas.campos.ts`).
 * - Tabla de transiciones de la liquidación de servicios (`estado-transiciones.ts`).
 * - Máquina de estados de la liquidación ocasional de terceros (`estado-ocasional.ts`).
 *
 * Son funciones puras: ninguna importa Prisma. Los casos contra la base están
 * en `liquidaciones-servicios-flujo.test.ts` y `revertir-snapshots-cierres.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  CAMPOS_EDITABLES_ACCION,
  camposEditablesAccion,
} from '../src/modules/acciones-correctivas/acciones-correctivas.campos'
import {
  ESTADOS_LIQUIDACION_SERVICIO,
  TRANSICIONES_LIQUIDACION_SERVICIO,
  validarTransicionLiquidacion,
} from '../src/modules/liquidaciones-servicios/estado-transiciones'
import {
  ESTADOS_OCASIONAL_NO_EDITABLES,
  destinosOcasional,
  esAdministracion,
  validarCambioEstadoOcasional,
} from '../src/modules/liquidaciones-terceros-ocasional/estado-ocasional'

// ════════════════════════════════════════════════════════════════════════════
describe('Acciones correctivas · lista blanca de campos', () => {
  it('descarta los campos de control que tienen su propia ruta', () => {
    const r = camposEditablesAccion({
      accion_numero: 'AC-2026-001',
      descripcion_hallazgo: 'Sin extintor',
      estado_aprobacion: 'APROBADO',
      estado_global: 'CUMPLIDA',
      registrado_por_id: '00000000-0000-0000-0000-000000000001',
      creado_por_id: '00000000-0000-0000-0000-000000000002',
      hallazgo_tipo: 'MEJORA',
      deleted_at: new Date().toISOString(),
      fecha_actualizacion_estado: '2026-10-01',
      observaciones: 'cerrada a mano',
      origen_pesv: true,
      pesv_cycle_id: '00000000-0000-0000-0000-000000000003',
      id: '00000000-0000-0000-0000-000000000004',
    })
    expect(r).toEqual({ accion_numero: 'AC-2026-001', descripcion_hallazgo: 'Sin extintor' })
  })

  it('descarta lo que no es columna (el formulario manda `replanteo_correccion`)', () => {
    /// Antes llegaba a Prisma y el guardado entero fallaba con «Unknown argument».
    expect(camposEditablesAccion({ replanteo_correccion: { motivo: 'x' }, lugar_sede: 'Yopal' })).toEqual({
      lugar_sede: 'Yopal',
    })
  })

  it('deja fuera los `undefined` (en el PUT significan «no tocar») pero conserva null y false', () => {
    expect(
      camposEditablesAccion({
        lugar_sede: undefined,
        aplica_reapertura: false,
        razon_reapertura: null,
      }),
    ).toEqual({ aplica_reapertura: false, razon_reapertura: null })
  })

  it('no incluye ninguna de las columnas de control en la lista', () => {
    for (const prohibido of [
      'estado_aprobacion',
      'estado_global',
      'registrado_por_id',
      'creado_por_id',
      'hallazgo_tipo',
      'deleted_at',
      'id',
      'updated_at',
    ]) {
      expect(CAMPOS_EDITABLES_ACCION as readonly string[]).not.toContain(prohibido)
    }
  })

  it('acepta todo lo que manda el formulario de crear/editar', () => {
    /// Copia de las claves de `FormularioAccion.svelte` (handleSubmit) y de la
    /// reapertura, menos las listas anidadas y `replanteo_correccion`. Si el
    /// formulario gana un campo y la lista no, este caso lo dice.
    const delFormulario = [
      'accion_numero', 'lugar_sede', 'proceso_origen_hallazgo', 'componente_elemento_referencia',
      'fuente_genero_hallazgo', 'marco_legal_normativo', 'variable_categoria_analisis',
      'fecha_identificacion_hallazgo', 'created_at', 'tipo_hallazgo_otros', 'fuente_genero_hallazgo_otros',
      'descripcion_hallazgo', 'tipo_hallazgo_detectado', 'aplica_correccion_inmediata',
      'justificacion_no_correccion', 'responsable_correccion', 'correccion_solucion_inmediata',
      'fecha_implementacion', 'valoracion_riesgo', 'requiere_actualizar_matriz', 'matriz_a_actualizar',
      'tipo_accion_ejecutar', 'fecha_limite_evaluacion_eficacia', 'criterio_evaluacion_eficacia',
      'evaluaciones_eficacia', 'evaluacion_cierre_eficaz', 'fecha_cierre_definitivo', 'observaciones_cierre',
      'responsable_cierre', 'cargo_responsable_cierre', 'aplica_reapertura', 'fecha_reapertura',
      'razon_reapertura', 'accion_origen_reapertura',
      // ModalFormularioAccion
      'fecha_evaluacion_eficacia', 'analisis_evidencias_cierre', 'soporte_cierre_eficaz',
    ]
    for (const campo of delFormulario) {
      expect(CAMPOS_EDITABLES_ACCION as readonly string[], campo).toContain(campo)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Liquidaciones de servicios · tabla de transiciones', () => {
  const error = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return e as { statusCode: number; codigo: string; message: string }
    }
    throw new Error('no lanzó')
  }

  it('acepta las transiciones legítimas del flujo y de la lista', () => {
    const legitimas: Array<[string, string, string?]> = [
      ['BORRADOR', 'LIQUIDADA'],
      ['LIQUIDADA', 'APROBADA'],
      ['LIQUIDADA', 'BORRADOR'],
      ['APROBADA', 'LIQUIDADA'],
      ['APROBADA', 'BORRADOR'],
      ['FACTURADA', 'APROBADA'],
      ['ANULADA', 'BORRADOR'],
      ['BORRADOR', 'ANULADA', 'Duplicada'],
      ['LIQUIDADA', 'ANULADA', 'Duplicada'],
      ['APROBADA', 'ANULADA', 'Duplicada'],
    ]
    for (const [desde, hacia, motivo] of legitimas) {
      expect(validarTransicionLiquidacion(desde, hacia, motivo), `${desde}→${hacia}`).toBe(hacia)
    }
  })

  it('FACTURADA no es destino desde ningún estado', () => {
    for (const desde of ESTADOS_LIQUIDACION_SERVICIO) {
      expect(TRANSICIONES_LIQUIDACION_SERVICIO[desde]).not.toContain('FACTURADA')
      const e = error(() => validarTransicionLiquidacion(desde, 'FACTURADA'))
      expect(e.statusCode).toBe(409)
      expect(e.codigo).toBe('TRANSICION_INVALIDA')
    }
  })

  it('un valor fuera del enum es 400 ESTADO_INVALIDO', () => {
    for (const valor of ['PAGADA', 'aprobada', '', null, undefined, 3]) {
      const e = error(() => validarTransicionLiquidacion('BORRADOR', valor))
      expect(e.statusCode, String(valor)).toBe(400)
      expect(e.codigo).toBe('ESTADO_INVALIDO')
    }
  })

  it('rechaza saltos y reaperturas fuera de la tabla con 409 y mensaje legible', () => {
    const invalidas: Array<[string, string]> = [
      ['BORRADOR', 'APROBADA'],
      ['ANULADA', 'APROBADA'],
      ['ANULADA', 'LIQUIDADA'],
      ['FACTURADA', 'LIQUIDADA'],
      ['FACTURADA', 'BORRADOR'],
      ['FACTURADA', 'ANULADA'],
      ['LIQUIDADA', 'LIQUIDADA'],
    ]
    for (const [desde, hacia] of invalidas) {
      const e = error(() => validarTransicionLiquidacion(desde, hacia, 'motivo'))
      expect(e.statusCode, `${desde}→${hacia}`).toBe(409)
      expect(e.codigo).toBe('TRANSICION_INVALIDA')
      expect(e.message).not.toMatch(/prisma|undefined/i)
    }
    expect(error(() => validarTransicionLiquidacion('ANULADA', 'APROBADA')).message).toBe(
      'Una liquidación anulada no puede pasar a aprobada. Desde ahí solo puede pasar a: borrador.',
    )
  })

  it('anular exige motivo no vacío', () => {
    for (const motivo of [undefined, '', '   ']) {
      const e = error(() => validarTransicionLiquidacion('BORRADOR', 'ANULADA', motivo))
      expect(e.statusCode).toBe(400)
      expect(e.codigo).toBe('FALTA_MOTIVO')
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('Liquidación ocasional · máquina de estados', () => {
  const admin = { admin: true }
  const operaciones = { admin: false }
  const error = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return e as { statusCode: number; codigo: string }
    }
    throw new Error('no lanzó')
  }

  it('reconoce Administración por el área, sin importar mayúsculas', () => {
    expect(esAdministracion(['administracion'])).toBe(true)
    expect(esAdministracion('ADMINISTRACION')).toBe(true)
    expect(esAdministracion(['operaciones', 'facturacion'])).toBe(false)
    expect(esAdministracion(null)).toBe(false)
  })

  it('valor inválido (texto libre, REEMPLAZADA, PAGADA) es 400', () => {
    for (const valor of ['CUALQUIERA', 'REEMPLAZADA', 'PAGADA', '', undefined]) {
      expect(error(() => validarCambioEstadoOcasional('BORRADOR', valor, admin)).statusCode, String(valor)).toBe(400)
    }
  })

  it('a LIQUIDADA desde BORRADOR no se llega por aquí: es cerrar-y-distribuir', () => {
    const e = error(() => validarCambioEstadoOcasional('BORRADOR', 'LIQUIDADA', admin))
    expect(e.statusCode).toBe(409)
    expect(e.codigo).toBe('TRANSICION_INVALIDA')
  })

  it('ANULADA y REEMPLAZADA son terminales', () => {
    for (const desde of ['ANULADA', 'REEMPLAZADA']) {
      expect(destinosOcasional(desde, true)).toEqual([])
      expect(error(() => validarCambioEstadoOcasional(desde, 'BORRADOR', admin)).statusCode).toBe(409)
    }
  })

  it('entrar o salir de APROBADA/FACTURADA es de Administración', () => {
    expect(error(() => validarCambioEstadoOcasional('LIQUIDADA', 'APROBADA', operaciones)).statusCode).toBe(403)
    expect(error(() => validarCambioEstadoOcasional('APROBADA', 'LIQUIDADA', operaciones)).statusCode).toBe(403)
    expect(
      error(() => validarCambioEstadoOcasional('FACTURADA', 'ANULADA', { admin: false, motivo: 'x' })).statusCode,
    ).toBe(403)
    expect(validarCambioEstadoOcasional('LIQUIDADA', 'APROBADA', admin)).toBe('APROBADA')
    expect(validarCambioEstadoOcasional('APROBADA', 'FACTURADA', admin)).toBe('FACTURADA')
  })

  it('FACTURADA → APROBADA es la puerta de atrás de Administración', () => {
    expect(destinosOcasional('FACTURADA', false)).toEqual(['ANULADA'])
    expect(destinosOcasional('FACTURADA', true)).toEqual(['ANULADA', 'APROBADA'])
    expect(validarCambioEstadoOcasional('FACTURADA', 'APROBADA', admin)).toBe('APROBADA')
  })

  it('cualquiera con el módulo devuelve una LIQUIDADA a borrador o anula un borrador con motivo', () => {
    expect(validarCambioEstadoOcasional('LIQUIDADA', 'BORRADOR', operaciones)).toBe('BORRADOR')
    expect(validarCambioEstadoOcasional('BORRADOR', 'ANULADA', { admin: false, motivo: 'Duplicada' })).toBe('ANULADA')
    expect(error(() => validarCambioEstadoOcasional('BORRADOR', 'ANULADA', operaciones)).codigo).toBe('FALTA_MOTIVO')
  })

  it('no se revierte un snapshot sobre una cabecera bloqueada', () => {
    expect([...ESTADOS_OCASIONAL_NO_EDITABLES].sort()).toEqual(['ANULADA', 'APROBADA', 'FACTURADA', 'REEMPLAZADA'])
  })
})
