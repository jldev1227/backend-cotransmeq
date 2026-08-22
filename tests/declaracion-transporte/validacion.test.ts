/**
 * Reglas de dominio del formato `declaracion_empresa_transporte`.
 *
 * Cubre los doce casos del plan de pruebas: registro, categoría, obligatorios,
 * doble digitación del correo, valores admitidos, anexos condicionales, firma,
 * datos clave y el ciclo de vida del campo Resultado.
 */
import { describe, it, expect } from 'vitest'
import {
  getFormularioPorCodigo,
  listarFormularios,
  getDocumentosRequeridos,
  FORMULARIOS
} from '../../src/modules/formularios-sarlaft/formularios-sarlaft.constants'
import {
  CAMPOS,
  OPCION_CON_ALERTAS,
  OPCION_SIN_ALERTAS,
  ANEXO_ALERTAS,
  ANEXO_RELACION_VEHICULOS,
  esDecisionFinal,
  esFirmaValida,
  extraerDatosClaveDeclaracion,
  limpiarRespuestas,
  marcaResultadoDeEstado,
  requiereObservaciones,
  tieneAlertas,
  validarDeclaracionTransporte,
  enmascararCorreo,
  LONGITUD_MAXIMA
} from '../../src/modules/formularios-sarlaft/declaracion-transporte.validacion'
import { TEMPLATE_DECLARACION_TRANSPORTE } from '../../src/modules/formularios-sarlaft/declaracion-transporte-template.manifest'
import { CORREO_QA, firmaSinteticaDataUrl, respuestasBase } from './fixtures'

const CODIGO = TEMPLATE_DECLARACION_TRANSPORTE.codigo

/** Contexto mínimo para que solo falle lo que el caso quiere probar. */
function ctx(overrides: Record<string, unknown> = {}) {
  return { correoConfirmacion: CORREO_QA, anexosRecibidos: [], ...overrides }
}

describe('Registro del formato', () => {
  it('1. está registrado con el código documental de la marca', () => {
    const f = getFormularioPorCodigo(CODIGO)
    expect(f).not.toBeNull()
    expect(f!.codigo).toBe(CODIGO)
    expect(f!.tipo).toBe('declaracion_empresa_transporte')
  })

  it('2. es individual y NO aparece en el catálogo público general', () => {
    const f = getFormularioPorCodigo(CODIGO)!
    expect(f.categoria).toBe('individual')

    const publicos = listarFormularios('sarlaft')
    expect(publicos).toHaveLength(3)
    expect(publicos.map((x) => x.codigo)).not.toContain(CODIGO)
  })

  it('no altera los cuatro formatos existentes del registro', () => {
    expect(Object.keys(FORMULARIOS).sort()).toEqual(
      ['GC-FR-04', 'GC-FR-05', 'GC-FR-06', 'SLFT-PTEE-FR-12', CODIGO].sort()
    )
  })

  it('declara las preguntas mapeadas al PDF con sus IDs estables', () => {
    const f = getFormularioPorCodigo(CODIGO)!
    const ids = f.secciones.flatMap((s) => s.preguntas.map((p) => p.id))
    expect(ids).toEqual([
      'DET-ENC-01',
      'DET-EMP-01',
      'DET-EMP-02',
      'DET-REP-01',
      'DET-REP-02',
      'DET-REP-03',
      'DET-REP-04',
      'DET-ACK-01',
      'DET-CNF-01',
      'DET-CNF-02',
      'DET-CNF-03',
      'DET-OBS-01',
      'DET-FIR-01'
    ])
  })

  it('no expone DET-REP-05: la confirmación de correo no es una respuesta', () => {
    const f = getFormularioPorCodigo(CODIGO)!
    const ids = f.secciones.flatMap((s) => s.preguntas.map((p) => p.id))
    expect(ids).not.toContain('DET-REP-05')
  })
})

describe('Validación de campos', () => {
  it('3. acepta el caso base sin alertas', () => {
    expect(validarDeclaracionTransporte(respuestasBase(), ctx())).toEqual([])
  })

  it('3b. rechaza obligatorios vacíos', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.CNF_VEHICULOS]: '', [CAMPOS.ACEPTACION]: '' }),
      ctx()
    )
    expect(errores.some((e) => e.includes('DET-CNF-01'))).toBe(true)
    expect(errores.some((e) => e.includes('aceptar expresamente'))).toBe(true)
  })

  it('4. rechaza un correo distinto de su confirmación', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase(),
      ctx({ correoConfirmacion: 'otro@ejemplo.com' })
    )
    expect(errores).toContain('El correo electrónico y su confirmación no coinciden.')
  })

  it('4b. rechaza cuando la confirmación no viaja en el payload', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase(),
      ctx({ correoConfirmacion: null })
    )
    expect(errores).toContain('Falta la confirmación del correo electrónico de entrega.')
  })

  it('4c. compara la confirmación sin distinguir mayúsculas ni espacios', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase(),
      ctx({ correoConfirmacion: `  ${CORREO_QA.toUpperCase()}  ` })
    )
    expect(errores).toEqual([])
  })

  it('4d. rechaza un correo con formato inválido', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.CORREO]: 'no-es-un-correo' }),
      ctx({ correoConfirmacion: 'no-es-un-correo' })
    )
    expect(errores.some((e) => e.includes('formato válido'))).toBe(true)
  })

  it('5. rechaza DET-CNF-02 fuera de sus dos valores', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.CNF_ALERTAS]: 'Tal vez' }),
      ctx()
    )
    expect(errores.some((e) => e.includes('DET-CNF-02'))).toBe(true)
  })

  it('5b. rechaza marcar simultáneamente las dos opciones de alertas', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.CNF_ALERTAS]: [OPCION_SIN_ALERTAS, OPCION_CON_ALERTAS] }),
      ctx()
    )
    expect(errores.some((e) => e.includes('una sola opción'))).toBe(true)
  })

  it('6. con alertas exige observaciones y el anexo', () => {
    const respuestas = respuestasBase({ [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS })
    const errores = validarDeclaracionTransporte(respuestas, ctx())
    expect(errores.some((e) => e.includes('alertas u observaciones son obligatorias'))).toBe(true)
    expect(errores.some((e) => e.includes('debes adjuntar ese documento'))).toBe(true)
  })

  it('6b. con alertas, observaciones y anexo, pasa', () => {
    const respuestas = respuestasBase({
      [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS,
      [CAMPOS.OBSERVACIONES]: 'Alerta sobre el conductor del vehículo WGY482.'
    })
    const errores = validarDeclaracionTransporte(
      respuestas,
      ctx({ anexosRecibidos: [ANEXO_ALERTAS] })
    )
    expect(errores).toEqual([])
  })

  it('7. si los vehículos no fueron revisados, exige observaciones', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.CNF_VEHICULOS]: 'No' }),
      ctx()
    )
    expect(errores.some((e) => e.includes('alertas u observaciones son obligatorias'))).toBe(true)
  })

  it('7b. si los soportes no están vigentes, exige observaciones', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.CNF_SOPORTES]: 'No' }),
      ctx()
    )
    expect(errores.some((e) => e.includes('alertas u observaciones son obligatorias'))).toBe(true)
  })

  it('rechaza valores que exceden el largo que cabe en el formato', () => {
    const errores = validarDeclaracionTransporte(
      respuestasBase({ [CAMPOS.RAZON_SOCIAL]: 'X'.repeat(LONGITUD_MAXIMA[CAMPOS.RAZON_SOCIAL] + 1) }),
      ctx()
    )
    expect(errores.some((e) => e.includes('DET-EMP-01'))).toBe(true)
  })
})

describe('8. Firma', () => {
  it('acepta una data URL PNG dentro del límite', () => {
    expect(esFirmaValida(firmaSinteticaDataUrl())).toBe(true)
  })

  it('rechaza texto plano, otro esquema y formatos no incrustables', () => {
    expect(esFirmaValida('JULIÁN QA DOCUMENTAL')).toBe(false)
    expect(esFirmaValida('https://ejemplo.com/firma.png')).toBe(false)
    // pdf-lib no incrusta WebP: aceptarlo crearía un radicado cuyo PDF no se
    // puede producir.
    expect(esFirmaValida('data:image/webp;base64,UklGRg==')).toBe(false)
    expect(esFirmaValida('data:application/pdf;base64,JVBERi0=')).toBe(false)
  })

  it('rechaza una firma que supera el tamaño máximo', () => {
    const enorme = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024)
    expect(esFirmaValida(enorme)).toBe(false)
  })

  it('la firma vacía invalida el envío', () => {
    const errores = validarDeclaracionTransporte(respuestasBase({ [CAMPOS.FIRMA]: '' }), ctx())
    expect(errores.some((e) => e.includes('firma del representante legal'))).toBe(true)
  })
})

describe('9. extraerDatosClave', () => {
  it('toma la empresa como titular y los datos del representante como contacto', () => {
    const datos = extraerDatosClaveDeclaracion(respuestasBase())
    expect(datos).toEqual({
      nombre_completo: 'TRANSPORTES QA DOCUMENTAL S.A.S.',
      tipo_documento: 'NIT',
      numero_documento: '900999888-1',
      correo: CORREO_QA,
      telefono: '+57 300 000 0123'
    })
  })
})

describe('Anexos condicionales', () => {
  it('el anexo de alertas es obligatorio solo cuando hay alertas', () => {
    const sin = getDocumentosRequeridos('declaracion_empresa_transporte', null, respuestasBase())
    expect(sin.find((d) => d.id === ANEXO_ALERTAS)!.obligatorio).toBe(false)

    const con = getDocumentosRequeridos(
      'declaracion_empresa_transporte',
      null,
      respuestasBase({ [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS })
    )
    expect(con.find((d) => d.id === ANEXO_ALERTAS)!.obligatorio).toBe(true)
  })

  it('la relación de vehículos es siempre opcional en este alcance', () => {
    const docs = getDocumentosRequeridos(
      'declaracion_empresa_transporte',
      null,
      respuestasBase({ [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS })
    )
    expect(docs.find((d) => d.id === ANEXO_RELACION_VEHICULOS)!.obligatorio).toBe(false)
  })

  it('no altera los anexos de los otros formatos', () => {
    const cli = getDocumentosRequeridos('cliente_proveedor', 'Persona Jurídica')
    expect(cli.map((d) => d.id)).toEqual([
      'cedula_representante',
      'rut',
      'certificado_existencia',
      'composicion_accionaria'
    ])
    const aut = getDocumentosRequeridos('autorizacion_propietario')
    expect(aut.filter((d) => d.obligatorio)).toHaveLength(6)
  })
})

describe('Ciclo de vida del Resultado', () => {
  it('10. el estado inicial no marca ninguna casilla', () => {
    expect(marcaResultadoDeEstado('recibido')).toBeNull()
    expect(marcaResultadoDeEstado('en_revision')).toBeNull()
    expect(esDecisionFinal('recibido')).toBe(false)
  })

  it('11. aprobado, condicionado y rechazado marcan exactamente una casilla', () => {
    expect(marcaResultadoDeEstado('aprobado')).toBe('aprobado')
    expect(marcaResultadoDeEstado('condicionado')).toBe('condicionado')
    expect(marcaResultadoDeEstado('rechazado')).toBe('no_aprobado')
    for (const e of ['aprobado', 'condicionado', 'rechazado']) {
      expect(esDecisionFinal(e)).toBe(true)
    }
  })

  it('12. escalado NO marca resultado ni cierra la evaluación', () => {
    // `escalado` y `condicionado` son decisiones distintas; tratarlas como
    // sinónimas emitiría una versión evaluada de un caso todavía pendiente.
    expect(marcaResultadoDeEstado('escalado')).toBeNull()
    expect(esDecisionFinal('escalado')).toBe(false)
  })
})

describe('Higiene del snapshot', () => {
  it('la confirmación de correo no se persiste', () => {
    const limpio = limpiarRespuestas({
      ...respuestasBase(),
      'DET-REP-05': CORREO_QA,
      correo_confirmacion: CORREO_QA
    })
    expect(limpio['DET-REP-05']).toBeUndefined()
    expect(limpio.correo_confirmacion).toBeUndefined()
    expect(limpio[CAMPOS.CORREO]).toBe(CORREO_QA)
  })

  it('enmascararCorreo no revela el usuario completo', () => {
    expect(enmascararCorreo('1227jldev@gmail.com')).toBe('12*******@gmail.com')
    expect(enmascararCorreo(null)).toBe('')
  })
})

describe('Helpers de coherencia', () => {
  it('tieneAlertas y requiereObservaciones concuerdan con las respuestas', () => {
    expect(tieneAlertas(respuestasBase())).toBe(false)
    expect(requiereObservaciones(respuestasBase())).toBe(false)
    expect(tieneAlertas(respuestasBase({ [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS }))).toBe(true)
    expect(requiereObservaciones(respuestasBase({ [CAMPOS.CNF_SOPORTES]: 'No' }))).toBe(true)
  })
})
