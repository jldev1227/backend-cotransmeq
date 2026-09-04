/**
 * Modo sandbox de correo y no regresión de los cuatro formatos existentes.
 *
 * El bloque de sandbox comprueba la garantía que hace seguro correr QA: que
 * `sandbox` no pueda activarse en producción y que redirija sin usar BCC.
 *
 * El bloque de regresión comprueba que agregar el quinto formato no cambió
 * nada de SLFT-PTEE-FR-04, SLFT-PTEE-FR-05, SLFT-PTEE-FR-06 ni SLFT-PTEE-FR-12.
 */
import { describe, expect, it } from 'vitest'
import {
  copiaDeclaranteHabilitada,
  enmascararDireccion,
  resolverDestino,
  resolverModo,
  ttlDescargaPublica,
  avisoSandboxHtml
} from '../../src/modules/formularios-sarlaft/sarlaft-email-mode'
import {
  FORMULARIOS,
  getDocumentosRequeridos,
  getFormularioPorCodigo,
  listarFormularios
} from '../../src/modules/formularios-sarlaft/formularios-sarlaft.constants'
import { CONFIG_POR_TIPO } from '../../src/modules/formularios-sarlaft/sarlaft-config'
import { submitFormularioSarlaftSchema } from '../../src/modules/formularios-sarlaft/formularios-sarlaft.schema'
import { TEMPLATE_DECLARACION_TRANSPORTE } from '../../src/modules/formularios-sarlaft/declaracion-transporte-template.manifest'
import { CORREO_QA } from './fixtures'

const CODIGO = TEMPLATE_DECLARACION_TRANSPORTE.codigo
const PRODUCTIVOS = ['area.interna@empresa-productiva.com', 'cumplimiento@empresa-productiva.com']

/** Entorno sandbox bien configurado. */
const ENV_SANDBOX = {
  SARLAFT_EMAIL_MODE: 'sandbox',
  SARLAFT_TEST_RECIPIENT: CORREO_QA
} as NodeJS.ProcessEnv

describe('Modo sandbox de correo', () => {
  it('por defecto el modo es producción y no redirige nada', () => {
    const destino = resolverDestino(PRODUCTIVOS, {} as NodeJS.ProcessEnv, 'development')
    expect(destino.modo).toBe('produccion')
    expect(destino.to).toEqual(PRODUCTIVOS)
    expect(destino.prefijoAsunto).toBe('')
  })

  it('redirige TODOS los destinatarios al buzón de prueba', () => {
    const destino = resolverDestino(PRODUCTIVOS, ENV_SANDBOX, 'development')
    expect(destino.modo).toBe('sandbox')
    expect(destino.to).toEqual([CORREO_QA])
    // Ningún destinatario productivo sobrevive al envío.
    for (const productivo of PRODUCTIVOS) {
      expect(destino.to).not.toContain(productivo)
    }
  })

  it('prefija el asunto y menciona los originales solo enmascarados', () => {
    const destino = resolverDestino(PRODUCTIVOS, ENV_SANDBOX, 'development')
    expect(destino.prefijoAsunto).toBe('[SANDBOX] ')
    expect(destino.destinatariosOriginalesEnmascarados).toEqual([
      'ar**********@empresa-productiva.com',
      'cu**********@empresa-productiva.com'
    ])

    const aviso = avisoSandboxHtml(destino)
    expect(aviso).toContain('modo sandbox')
    // La dirección completa nunca aparece en el cuerpo.
    for (const productivo of PRODUCTIVOS) {
      expect(aviso).not.toContain(productivo)
    }
  })

  it('el aviso de sandbox no se pinta en producción', () => {
    const destino = resolverDestino(PRODUCTIVOS, {} as NodeJS.ProcessEnv, 'development')
    expect(avisoSandboxHtml(destino)).toBe('')
  })

  it('está PROHIBIDO en producción: lanza en vez de redirigir en silencio', () => {
    // Ni redirigir calladamente (perdería correo productivo) ni ignorar la
    // variable (traicionaría la intención de quien la puso): se falla fuerte.
    expect(() => resolverModo(ENV_SANDBOX, 'production')).toThrow(/prohibido con NODE_ENV=production/i)
    expect(() => resolverDestino(PRODUCTIVOS, ENV_SANDBOX, 'production')).toThrow()
  })

  it('exige destinatario de prueba para poder activarse', () => {
    expect(() =>
      resolverModo({ SARLAFT_EMAIL_MODE: 'sandbox' } as NodeJS.ProcessEnv, 'development')
    ).toThrow(/requiere SARLAFT_TEST_RECIPIENT/i)
  })

  it('el correo de prueba NO está en los destinatarios autorizados de la marca', () => {
    // El buzón de QA es un destino de redirección, no un canal autorizado:
    // agregarlo a la configuración productiva lo dejaría recibiendo formularios
    // reales incluso con el sandbox apagado.
    for (const cfg of Object.values(CONFIG_POR_TIPO)) {
      expect(cfg.emails.map((e) => e.toLowerCase())).not.toContain(CORREO_QA.toLowerCase())
      expect(cfg.correo_publico?.toLowerCase()).not.toBe(CORREO_QA.toLowerCase())
    }
  })

  it('enmascararDireccion no revela el usuario completo', () => {
    expect(enmascararDireccion('1227jldev@gmail.com')).toBe('12*******@gmail.com')
    expect(enmascararDireccion('ab@x.com')).toBe('ab*@x.com')
    expect(enmascararDireccion('sin-arroba')).toBe('***')
  })

  it('la copia al declarante está APAGADA por defecto', () => {
    // Decisión de negocio: el trámite se revisa internamente y el declarante
    // no recibe correo automático. Activarla exige ponerlo explícitamente,
    // de modo que un `.env` incompleto nunca empiece a enviar documentos a
    // direcciones que nadie verificó.
    expect(copiaDeclaranteHabilitada({} as NodeJS.ProcessEnv)).toBe(false)
    expect(
      copiaDeclaranteHabilitada({ SARLAFT_CLIENT_COPY_ENABLED: 'false' } as NodeJS.ProcessEnv)
    ).toBe(false)
    expect(
      copiaDeclaranteHabilitada({ SARLAFT_CLIENT_COPY_ENABLED: '' } as NodeJS.ProcessEnv)
    ).toBe(false)
    expect(
      copiaDeclaranteHabilitada({ SARLAFT_CLIENT_COPY_ENABLED: 'true' } as NodeJS.ProcessEnv)
    ).toBe(true)
  })

  it('el TTL de descarga tiene defecto y tope de 24 h', () => {
    expect(ttlDescargaPublica({} as NodeJS.ProcessEnv)).toBe(3600)
    expect(
      ttlDescargaPublica({ SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS: '900' } as NodeJS.ProcessEnv)
    ).toBe(900)
    // Un enlace a un documento con datos personales no puede volverse
    // permanente por un valor mal puesto en el .env.
    expect(
      ttlDescargaPublica({ SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS: '999999' } as NodeJS.ProcessEnv)
    ).toBe(86_400)
    expect(
      ttlDescargaPublica({ SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS: 'abc' } as NodeJS.ProcessEnv)
    ).toBe(3600)
  })
})

describe('No regresión de los cuatro formatos existentes', () => {
  const EXISTENTES = ['SLFT-PTEE-FR-04', 'SLFT-PTEE-FR-05', 'SLFT-PTEE-FR-06', 'SLFT-PTEE-FR-12'] as const

  it('siguen registrados, con su tipo y categoría intactos', () => {
    const esperado: Record<string, { tipo: string; categoria: string }> = {
      'SLFT-PTEE-FR-04': { tipo: 'cliente_proveedor', categoria: 'sarlaft' },
      'SLFT-PTEE-FR-05': { tipo: 'accionistas', categoria: 'sarlaft' },
      'SLFT-PTEE-FR-06': { tipo: 'personal', categoria: 'sarlaft' },
      'SLFT-PTEE-FR-12': { tipo: 'autorizacion_propietario', categoria: 'individual' }
    }
    for (const codigo of EXISTENTES) {
      const f = getFormularioPorCodigo(codigo)!
      expect(f).toBeTruthy()
      expect(f.tipo).toBe(esperado[codigo].tipo)
      expect(f.categoria).toBe(esperado[codigo].categoria)
    }
  })

  it('el catálogo público sigue devolviendo exactamente tres formularios', () => {
    const publicos = listarFormularios('sarlaft').map((f) => f.codigo).sort()
    expect(publicos).toEqual(['SLFT-PTEE-FR-04', 'SLFT-PTEE-FR-05', 'SLFT-PTEE-FR-06'])
  })

  it('los formatos individuales solo se alcanzan por código', () => {
    const individuales = listarFormularios('individual').map((f) => f.codigo).sort()
    expect(individuales).toEqual(['SLFT-PTEE-FR-12', CODIGO].sort())
  })

  it('conservan su número de secciones y preguntas', () => {
    const conteos = Object.fromEntries(
      EXISTENTES.map((c) => {
        const f = getFormularioPorCodigo(c)!
        return [c, [f.secciones.length, f.secciones.reduce((a, s) => a + s.preguntas.length, 0)]]
      })
    )
    // Cifras congeladas: si un cambio futuro las mueve, es una regresión que
    // hay que justificar, no un detalle.
    expect(conteos).toEqual({
      'SLFT-PTEE-FR-04': [16, 76],
      'SLFT-PTEE-FR-05': [10, 39],
      'SLFT-PTEE-FR-06': [6, 25],
      'SLFT-PTEE-FR-12': [12, 72]
    })
  })

  it('su lista de anexos no cambió al volverse condicional para el nuevo formato', () => {
    expect(getDocumentosRequeridos('cliente_proveedor', 'Persona Natural').map((d) => d.id)).toEqual([
      'cedula_representante',
      'rut',
      'certificado_existencia'
    ])
    expect(getDocumentosRequeridos('accionistas').map((d) => d.id)).toEqual([
      'cedula_representante',
      'rut',
      'certificado_existencia',
      'composicion_accionaria'
    ])
    const personal = getDocumentosRequeridos('personal')
    expect(personal.filter((d) => d.obligatorio).map((d) => d.id)).toEqual([
      'cedula_representante',
      'rut'
    ])
    expect(getDocumentosRequeridos('autorizacion_propietario')).toHaveLength(11)
  })

  it('el payload de los cuatro formatos sigue siendo válido sin correo_confirmacion', () => {
    // `correo_confirmacion` es opcional a propósito: solo lo manda el formato
    // nuevo, y exigirlo rompería los envíos existentes.
    for (const codigo of EXISTENTES) {
      const r = submitFormularioSarlaftSchema.safeParse({
        codigo_formulario: codigo,
        respuestas: { 'X-01': 'valor' }
      })
      expect(r.success).toBe(true)
    }
  })

  it('el nuevo formato entra en el schema sin desplazar a los demás', () => {
    const r = submitFormularioSarlaftSchema.safeParse({
      codigo_formulario: CODIGO,
      respuestas: {},
      correo_confirmacion: CORREO_QA
    })
    expect(r.success).toBe(true)
    const invalido = submitFormularioSarlaftSchema.safeParse({
      codigo_formulario: 'SLFT-PTEE-FR-99',
      respuestas: {}
    })
    expect(invalido.success).toBe(false)
  })

  it('cada tipo conserva su configuración de contacto', () => {
    for (const tipo of [
      'cliente_proveedor',
      'accionistas',
      'personal',
      'autorizacion_propietario',
      'declaracion_empresa_transporte'
    ] as const) {
      const cfg = CONFIG_POR_TIPO[tipo]
      expect(cfg).toBeTruthy()
      expect(cfg.emails.length).toBeGreaterThan(0)
      expect(cfg.area_responsable).toBeTruthy()
    }
  })

  it('el registro tiene exactamente cinco formatos', () => {
    expect(Object.keys(FORMULARIOS)).toHaveLength(5)
  })
})

describe('Branding cruzado en la configuración', () => {
  const MARCA_AJENA = TEMPLATE_DECLARACION_TRANSPORTE.marca === 'transmeralda'
    ? 'cotransmeq'
    : 'transmeralda'

  it('ningún destinatario ni correo público pertenece a la otra empresa', () => {
    for (const cfg of Object.values(CONFIG_POR_TIPO)) {
      for (const correo of [...cfg.emails, cfg.correo_publico ?? '']) {
        expect(correo.toLowerCase()).not.toContain(MARCA_AJENA)
      }
    }
  })

  it('el manifiesto del template apunta a la marca de este despliegue', () => {
    expect(TEMPLATE_DECLARACION_TRANSPORTE.empresa.toLowerCase()).not.toContain(MARCA_AJENA)
    expect(TEMPLATE_DECLARACION_TRANSPORTE.marca).not.toBe(MARCA_AJENA)
  })
})
