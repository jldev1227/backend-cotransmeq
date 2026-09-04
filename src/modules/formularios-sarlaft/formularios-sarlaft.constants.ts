// Definiciones estructurales de los formularios públicos.
// Estos datos describen la forma del formulario (secciones, preguntas, tipos)
// y son consumidos por el frontend para renderizar el formulario dinámicamente
// y por el backend para validar/enviar.
//
// Hay dos categorías (ver `FormularioDefinicion.categoria`):
//  - 'sarlaft'    → los 3 formularios de conocimiento SARLAFT + PTEE, que se
//                   listan juntos en el selector público.
//  - 'individual' → formatos que viven en su propia ruta y NO aparecen en ese
//                   selector (ej. SLFT-PTEE-FR-12, Autorización del Propietario).

import {
  ANEXO_ALERTAS,
  ANEXO_RELACION_VEHICULOS,
  documentosDeclaracionTransporte
} from './declaracion-transporte.validacion'

export type TipoRespuesta =
  | 'texto_corto'
  | 'texto_largo'
  | 'numerico'
  | 'fecha'
  | 'seleccion_unica'
  | 'seleccion_multiple'
  | 'firma'
  | 'declaracion_informativa'

/** Regla declarativa de visibilidad de una pregunta en función de otra.
 *  - `igual_a`: la pregunta origen debe valer exactamente ese texto.
 *  - `incluye`: la pregunta origen es `seleccion_multiple` y su arreglo
 *    de respuestas debe contener ese valor. */
export interface CondicionalPregunta {
  id: string
  igual_a?: string
  incluye?: string
}

/**
 * Restringe qué se puede teclear en un `texto_corto`. Estos campos son
 * identificadores, no cantidades: no se usan como `numerico` (input type
 * number) porque eso pierde los ceros a la izquierda de una cuenta bancaria,
 * muestra flechas de incremento y admite notación científica.
 *
 *  - `digitos`   → solo 0-9 (número de cuenta bancaria, licencia de tránsito)
 *  - `documento` → 0-9 más punto y guion (cédula o NIT con dígito de verificación)
 *  - `telefono`  → 0-9 más + espacio, guion y paréntesis (indicativos)
 */
export type FormatoCampo = 'digitos' | 'documento' | 'telefono'

export interface PreguntaDefinicion {
  id: string
  pregunta: string
  tipo_respuesta: TipoRespuesta
  modo_respuesta: string
  opciones: string[] | null
  obligatorio: boolean
  nota?: string
  condicional_pregunta?: CondicionalPregunta
  formato?: FormatoCampo
}

export interface SeccionDefinicion {
  seccion: string
  tipo_bloque?: 'tabla_repetible' | 'seccion_normal' | 'tabla_repetible_multiple'
  condicional?: string
  /** Key estable para agrupar filas de tabla repetible en el payload.
   *  Si no se define, se deriva del id de la primera pregunta. */
  key_tabla?: string
  nota?: string
  preguntas: PreguntaDefinicion[]
}

export type CodigoFormulario =
  | 'SLFT-PTEE-FR-04'
  | 'SLFT-PTEE-FR-05'
  | 'SLFT-PTEE-FR-06'
  | 'SLFT-PTEE-FR-12'
  | 'GC-FOR-13'

export type TipoFormulario =
  | 'cliente_proveedor'
  | 'accionistas'
  | 'personal'
  | 'autorizacion_propietario'
  | 'declaracion_empresa_transporte'

export interface FormularioDefinicion {
  codigo: CodigoFormulario
  nombre_formato: string
  titulo: string
  version: string
  fecha_documento: string
  archivo_origen: string
  tipo: TipoFormulario
  /** Agrupación del formulario de cara al público. Solo los 'sarlaft'
   *  aparecen en `GET /public/formularios-sarlaft`. */
  categoria: 'sarlaft' | 'individual'
  secciones: SeccionDefinicion[]
}

// ──────────────────────────────────────────────────────────
// SLFT-PTEE-FR-06 — FORMATO CONOCIMIENTO PERSONAL
// ──────────────────────────────────────────────────────────
const FORMULARIO_PERSONAL: FormularioDefinicion = {
  codigo: 'SLFT-PTEE-FR-06',
  nombre_formato: 'FORMATO_CONOCIMIENTO_PERSONAL',
  titulo: 'Formulario Vinculación Personal SARLAFT + PTEE',
  version: '001',
  fecha_documento: '12/12/2026',
  archivo_origen: '4_FORMATO_CONOCIMIENTO_PERSONAL.xlsx',
  tipo: 'personal',
  categoria: 'sarlaft',
  secciones: [
    {
      seccion: 'Datos del documento',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'PER-ENC-01',
          pregunta: 'Fecha de diligenciamiento',
          tipo_respuesta: 'fecha',
          modo_respuesta: 'DD/MM/AAAA',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Aviso de privacidad y autorización tratamiento de datos',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'PER-ENC-02',
          pregunta:
            'Autorización libre, previa, expresa e informada para el tratamiento de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013)',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta:
            'Texto declarativo, sin casilla de respuesta explícita (aceptación implícita al firmar)',
          opciones: null,
          obligatorio: false,
          nota: 'Texto de consentimiento informativo; se acepta mediante nombre y firma del titular.'
        },
        {
          id: 'PER-ENC-03',
          pregunta: 'Nombre (de quien autoriza)',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true
        },
        {
          id: 'PER-ENC-04',
          pregunta: 'Firma (de quien autoriza)',
          tipo_respuesta: 'firma',
          modo_respuesta: 'Espacio para firma manuscrita o firma digital',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Información general',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'PER-IG-01', pregunta: 'Nombre Completo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'PER-IG-02', pregunta: 'N° de cédula', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'PER-IG-03', pregunta: 'Cargo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'PER-IG-04', pregunta: 'Área', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        {
          id: 'PER-IG-05',
          pregunta: '¿Persona políticamente expuesta?',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'PER-IG-06',
          pregunta: 'Fecha de ingreso',
          tipo_respuesta: 'fecha',
          modo_respuesta: 'DD/MM/AAAA',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Información personal',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'PER-IP-01', pregunta: 'Dirección', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'PER-IP-02', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'PER-IP-03', pregunta: 'Correo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, nota: 'Correo electrónico' },
        { id: 'PER-IP-04', pregunta: 'Estado civil', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Información financiera',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'PER-IF-01', pregunta: 'Ingresos (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'PER-IF-02', pregunta: 'Egresos (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'PER-IF-03', pregunta: 'Patrimonio (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Declaraciones SARLAFT y PTEE (Anticorrupción)',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'PER-DEC-01',
          pregunta: 'Declaro que la información suministrada es veraz, completa y verificable.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo, sin casilla de respuesta (aceptación implícita al firmar)',
          opciones: null,
          obligatorio: false
        },
        {
          id: 'PER-DEC-02',
          pregunta:
            'Declaro que los recursos que manejo provienen de actividades lícitas y no están relacionados con lavado de activos, financiación del terrorismo o proliferación.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'PER-DEC-03',
          pregunta:
            'Declaro que no he ofrecido, prometido ni recibido sobornos o beneficios indebidos y me comprometo a cumplir las normas anticorrupción.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'PER-DEC-04',
          pregunta:
            '¿Realiza o ha realizado operaciones en moneda extranjera o con activos virtuales (criptomonedas u otros activos digitales)?',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true,
          nota: 'Si la respuesta es SÍ, se deben responder las 4 preguntas condicionales siguientes.'
        },
        {
          id: 'PER-DEC-04-1',
          pregunta:
            '1. Las operaciones que realizo en moneda extranjera y/o activos virtuales, en caso de existir, tienen origen lícito y cumplen con la normativa vigente.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si PER-DEC-04 = Sí'
        },
        {
          id: 'PER-DEC-04-2',
          pregunta:
            '2. Dichas operaciones no están relacionadas con actividades de lavado de activos, financiación del terrorismo, financiación de la proliferación, corrupción o cualquier otra actividad ilícita.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si PER-DEC-04 = Sí'
        },
        {
          id: 'PER-DEC-04-3',
          pregunta:
            '3. Me comprometo a informar a COTRANSMEQ S.A.S. cualquier cambio relevante en la naturaleza, volumen o frecuencia de estas operaciones.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Condicional: solo si PER-DEC-04 = Sí'
        },
        {
          id: 'PER-DEC-04-4',
          pregunta: '4. Autorizo a COTRANSMEQ S.A.S. a verificar la información aquí suministrada.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si PER-DEC-04 = Sí'
        }
      ]
    }
  ]
}

// ──────────────────────────────────────────────────────────
// SLFT-PTEE-FR-05 — FORMATO CONOCIMIENTO ACCIONISTAS
// ──────────────────────────────────────────────────────────
const FORMULARIO_ACCIONISTAS: FormularioDefinicion = {
  codigo: 'SLFT-PTEE-FR-05',
  nombre_formato: 'FORMATO_CONOCIMIENTO_ACCIONISTAS',
  titulo: 'Formulario Conocimiento Accionistas SARLAFT + PTEE',
  version: '001',
  fecha_documento: '12/12/2026',
  archivo_origen: '3_FORMATO_CONOCIMIENTO_ACCIONISTAS.xlsx',
  tipo: 'accionistas',
  categoria: 'sarlaft',
  secciones: [
    {
      seccion: 'Datos del documento',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'ACC-ENC-01',
          pregunta: 'Fecha de diligenciamiento',
          tipo_respuesta: 'fecha',
          modo_respuesta: 'DD/MM/AAAA',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Aviso de privacidad y autorización tratamiento de datos',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'ACC-ENC-02',
          pregunta:
            'Autorización libre, previa, expresa e informada para el tratamiento de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013)',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (aceptación implícita al firmar)',
          opciones: null,
          obligatorio: false,
          nota: 'Texto de consentimiento informativo; se acepta mediante nombre y firma del titular.'
        },
        {
          id: 'ACC-ENC-03',
          pregunta: 'Nombre (de quien autoriza)',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true
        },
        {
          id: 'ACC-ENC-04',
          pregunta: 'Firma (de quien autoriza)',
          tipo_respuesta: 'firma',
          modo_respuesta: 'Espacio para firma manuscrita o firma digital',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Información general de la empresa',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'ACC-EMP-01', pregunta: 'Razón social', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-EMP-02', pregunta: 'NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'ACC-EMP-03', pregunta: 'Dirección', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-EMP-04', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'ACC-EMP-05', pregunta: 'Correo electrónico', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Composición accionaria',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'ACC-CA__rows',
      nota: 'Una fila por accionista',
      preguntas: [
        { id: 'ACC-CA-01', pregunta: 'Nombre completo / Razón social accionista', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CA-02', pregunta: 'N° de cédula / NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'ACC-CA-03', pregunta: 'Nacionalidad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CA-04', pregunta: 'Tipo societario', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Natural', 'Jurídico'], obligatorio: true },
        { id: 'ACC-CA-05', pregunta: 'Correo electrónico', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CA-06', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'ACC-CA-07', pregunta: '% de participación', tipo_respuesta: 'numerico', modo_respuesta: 'Porcentaje', opciones: null, obligatorio: true },
        { id: 'ACC-CA-08', pregunta: '¿Persona políticamente expuesta?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true }
      ]
    },
    {
      seccion: 'Declaraciones SARLAFT y PTEE (Anticorrupción)',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'ACC-DEC-01',
          pregunta: 'Declaro que la información suministrada es veraz, completa y verificable.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo',
          opciones: null,
          obligatorio: false
        },
        {
          id: 'ACC-DEC-02',
          pregunta: 'Declaro que los recursos que manejo provienen de actividades lícitas y no están relacionados con lavado de activos, financiación del terrorismo o proliferación.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'ACC-DEC-03',
          pregunta: 'Declaro que no he ofrecido, prometido ni recibido sobornos o beneficios indebidos y me comprometo a cumplir las normas anticorrupción.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'ACC-DEC-04',
          pregunta: '¿Realiza o ha realizado operaciones en moneda extranjera o con activos virtuales (criptomonedas u otros activos digitales)?',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true,
          nota: 'Si la respuesta es SÍ, se deben responder las 4 preguntas condicionales siguientes.'
        },
        {
          id: 'ACC-DEC-04-1',
          pregunta: '1. Las operaciones que realizo en moneda extranjera y/o activos virtuales, en caso de existir, tienen origen lícito y cumplen con la normativa vigente.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si ACC-DEC-04 = Sí'
        },
        {
          id: 'ACC-DEC-04-2',
          pregunta: '2. Dichas operaciones no están relacionadas con actividades de lavado de activos, financiación del terrorismo, financiación de la proliferación, corrupción o cualquier otra actividad ilícita.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si ACC-DEC-04 = Sí'
        },
        {
          id: 'ACC-DEC-04-3',
          pregunta: '3. Me comprometo a informar a COTRANSMEQ S.A.S. cualquier cambio relevante en la naturaleza, volumen o frecuencia de estas operaciones.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Condicional: solo si ACC-DEC-04 = Sí'
        },
        {
          id: 'ACC-DEC-04-4',
          pregunta: '4. Autorizo a COTRANSMEQ S.A.S. a verificar la información aquí suministrada.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si ACC-DEC-04 = Sí'
        }
      ]
    },
    {
      seccion: 'Beneficiario final',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'ACC-BF__rows',
      nota: 'Una fila por beneficiario final',
      preguntas: [
        { id: 'ACC-BF-01', pregunta: 'Nombre completo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-BF-02', pregunta: 'Documento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-BF-03', pregunta: 'Participación %', tipo_respuesta: 'numerico', modo_respuesta: 'Porcentaje', opciones: null, obligatorio: true },
        { id: 'ACC-BF-04', pregunta: '¿Persona políticamente expuesta?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true }
      ]
    },
    {
      seccion: 'Información financiera',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'ACC-IF-01', pregunta: 'Ingresos (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'ACC-IF-02', pregunta: 'Egresos (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'ACC-IF-03', pregunta: 'Patrimonio (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Información sobre cuentas que posee en entidades financieras',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'ACC-CTA__rows',
      nota: 'Hasta 3 cuentas',
      preguntas: [
        { id: 'ACC-CTA-01', pregunta: 'Entidad bancaria', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CTA-02', pregunta: 'Tipo de producto', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Ahorro', 'Corriente'], obligatorio: true },
        { id: 'ACC-CTA-03', pregunta: 'N° de producto', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Origen de fondos',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'ACC-OF-01',
          pregunta: 'Origen de fondos (detalle de qué actividad provienen sus fondos)',
          tipo_respuesta: 'texto_largo',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Relación conflicto de intereses',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'ACC-CI-01', pregunta: '¿Tiene relación con empleados?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'ACC-CI-02', pregunta: '¿Tiene relación con directivos?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'ACC-CI-03', pregunta: '¿Tiene relación con entidades públicas?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true }
      ]
    }
  ]
}

// ──────────────────────────────────────────────────────────
// SLFT-PTEE-FR-04 — FORMATO CONOCIMIENTO CLIENTE / PROVEEDOR
// ──────────────────────────────────────────────────────────
const FORMULARIO_CLIENTE_PROVEEDOR: FormularioDefinicion = {
  codigo: 'SLFT-PTEE-FR-04',
  nombre_formato: 'FORMATO_CONOCIMIENTO_CLIENTE_PROVEEDOR',
  titulo: 'Formulario Vinculación Cliente/Proveedor SARLAFT + PTEE',
  version: '001',
  fecha_documento: '12/06/2026',
  archivo_origen: '2__FOMARTO_CONOCIMIENTO_CLIENTE_PROVEEDOR.xlsx',
  tipo: 'cliente_proveedor',
  categoria: 'sarlaft',
  secciones: [
    {
      seccion: 'Datos del documento',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'CLI-ENC-01',
          pregunta: 'Fecha de diligenciamiento',
          tipo_respuesta: 'fecha',
          modo_respuesta: 'DD/MM/AAAA',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Aviso de privacidad y autorización tratamiento de datos',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'CLI-ENC-02',
          pregunta: 'Autorización libre, previa, expresa e informada para el tratamiento de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013)',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (aceptación implícita al firmar)',
          opciones: null,
          obligatorio: false,
          nota: 'Texto de consentimiento informativo; se acepta mediante nombre y firma del titular.'
        },
        {
          id: 'CLI-ENC-03',
          pregunta: 'Nombre (de quien autoriza)',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true
        },
        {
          id: 'CLI-ENC-04',
          pregunta: 'Firma (de quien autoriza)',
          tipo_respuesta: 'firma',
          modo_respuesta: 'Espacio para firma manuscrita o firma digital',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Información general',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'CLI-IG-01',
          pregunta: 'Tipo de cliente',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Persona Natural', 'Persona Jurídica'],
          obligatorio: true
        },
        {
          id: 'CLI-IG-02',
          pregunta: 'Fecha de diligenciamiento',
          tipo_respuesta: 'fecha',
          modo_respuesta: 'DD/MM/AAAA',
          opciones: null,
          obligatorio: true
        },
        {
          id: 'CLI-IG-03',
          pregunta: 'Tipo de vinculación',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Nuevo', 'Actualización', 'Ocasional'],
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Persona natural',
      tipo_bloque: 'seccion_normal',
      condicional: 'Se diligencia si CLI-IG-01 = Persona Natural',
      preguntas: [
        { id: 'CLI-PN-01', pregunta: 'Nombre completo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-02', pregunta: 'N° de cédula', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'CLI-PN-03', pregunta: 'Nacionalidad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-04', pregunta: 'Fecha de nacimiento', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'CLI-PN-05', pregunta: 'Actividad económica', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-06', pregunta: 'Ocupación / Cargo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-07', pregunta: 'Dirección', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-08', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'CLI-PN-09', pregunta: 'Correo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Persona jurídica',
      tipo_bloque: 'seccion_normal',
      condicional: 'Se diligencia si CLI-IG-01 = Persona Jurídica',
      preguntas: [
        { id: 'CLI-PJ-01', pregunta: 'Razón social', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PJ-02', pregunta: 'N° NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'CLI-PJ-03', pregunta: 'Fecha de constitución', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'CLI-PJ-04', pregunta: 'Actividad económica principal', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PJ-05', pregunta: 'Actividad económica secundaria', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Jurisdicción',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'CLI-JU-01', pregunta: 'Nacional - Municipio', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-JU-02', pregunta: 'Nacional - Departamento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-JU-03', pregunta: 'Internacional - País', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-JU-04', pregunta: 'Internacional - Ciudad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false }
      ]
    },
    {
      seccion: 'Domicilio principal',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'CLI-DP-01', pregunta: 'Nacional - Municipio', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-DP-02', pregunta: 'Nacional - Departamento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-DP-03', pregunta: 'Internacional - País', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-DP-04', pregunta: 'Internacional - Ciudad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-DP-05', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'CLI-DP-06', pregunta: 'Correo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-DP-07', pregunta: 'Representante Legal', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-DP-08', pregunta: 'Documento RL', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-DP-09', pregunta: 'Representante Legal / Suplente', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-DP-10', pregunta: 'Documento RL / Suplente', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false }
      ]
    },
    {
      seccion: 'Declaraciones SARLAFT y PTEE (Anticorrupción)',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'CLI-DEC-01',
          pregunta: 'Declaro que la información suministrada es veraz, completa y verificable.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo',
          opciones: null,
          obligatorio: false
        },
        {
          id: 'CLI-DEC-02',
          pregunta: 'Declaro que los recursos que manejo provienen de actividades lícitas y no están relacionados con lavado de activos, financiación del terrorismo o proliferación.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'CLI-DEC-03',
          pregunta: 'Declaro que no he ofrecido, prometido ni recibido sobornos o beneficios indebidos y me comprometo a cumplir las normas anticorrupción.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true
        },
        {
          id: 'CLI-DEC-04',
          pregunta: '¿Realiza o ha realizado operaciones en moneda extranjera o con activos virtuales (criptomonedas u otros activos digitales)?',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true,
          nota: 'Si la respuesta es SÍ, se deben responder las 4 preguntas condicionales siguientes.'
        },
        {
          id: 'CLI-DEC-04-1',
          pregunta: '1. Las operaciones que realizo en moneda extranjera y/o activos virtuales, en caso de existir, tienen origen lícito y cumplen con la normativa vigente.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si CLI-DEC-04 = Sí'
        },
        {
          id: 'CLI-DEC-04-2',
          pregunta: '2. Dichas operaciones no están relacionadas con actividades de lavado de activos, financiación del terrorismo, financiación de la proliferación, corrupción o cualquier otra actividad ilícita.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si CLI-DEC-04 = Sí'
        },
        {
          id: 'CLI-DEC-04-3',
          pregunta: '3. Me comprometo a informar a COTRANSMEQ S.A.S. cualquier cambio relevante en la naturaleza, volumen o frecuencia de estas operaciones.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Condicional: solo si CLI-DEC-04 = Sí'
        },
        {
          id: 'CLI-DEC-04-4',
          pregunta: '4. Autorizo a COTRANSMEQ S.A.S. a verificar la información aquí suministrada.',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única (condicional si DEC-04 = Sí)',
          opciones: ['Sí', 'No'],
          obligatorio: false,
          nota: 'Condicional: solo si CLI-DEC-04 = Sí'
        },
        {
          id: 'CLI-DEC-05',
          pregunta: '¿Describa cuáles? (moneda extranjera / activos virtuales)',
          tipo_respuesta: 'texto_largo',
          modo_respuesta: 'Texto libre (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Se diligencia si CLI-DEC-04 = Sí'
        }
      ]
    },
    {
      seccion: 'Composición accionaria',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'CLI-CA__rows',
      nota: 'Una fila por accionista',
      preguntas: [
        { id: 'CLI-CA-01', pregunta: 'Nombre completo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-CA-02', pregunta: 'Documento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-CA-03', pregunta: 'Participación %', tipo_respuesta: 'numerico', modo_respuesta: 'Porcentaje', opciones: null, obligatorio: true },
        { id: 'CLI-CA-04', pregunta: '¿Persona políticamente expuesta?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-CA-05', pregunta: 'País de residencia', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Beneficiario final',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'CLI-BF__rows',
      nota: 'Una fila por beneficiario final',
      preguntas: [
        { id: 'CLI-BF-01', pregunta: 'Nombre completo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-BF-02', pregunta: 'Documento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-BF-03', pregunta: 'Participación %', tipo_respuesta: 'numerico', modo_respuesta: 'Porcentaje', opciones: null, obligatorio: true },
        { id: 'CLI-BF-04', pregunta: '¿Persona políticamente expuesta?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-BF-05', pregunta: 'País de residencia', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Revisor fiscal (principal/suplente)',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'CLI-RF__rows',
      nota: 'Diligenciar solo si la persona jurídica tiene revisor fiscal.',
      preguntas: [
        { id: 'CLI-RF-01', pregunta: 'Nombre completo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-RF-02', pregunta: 'Documento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false },
        { id: 'CLI-RF-03', pregunta: '¿Persona políticamente expuesta?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: false },
        { id: 'CLI-RF-04', pregunta: 'País de residencia', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false }
      ]
    },
    {
      seccion: 'Información financiera (último periodo)',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'CLI-IF-01', pregunta: 'Ingresos (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'CLI-IF-02', pregunta: 'Egresos (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'CLI-IF-03', pregunta: 'Patrimonio (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Información sobre cuentas que posee en entidades financieras',
      tipo_bloque: 'tabla_repetible_multiple',
      key_tabla: 'CLI-CTA__rows',
      nota: 'Hasta 3-4 cuentas. Artículo 5.6.11.1. Procedimiento de Conocimiento del Cliente. Resolución 2328 de 2025.',
      preguntas: [
        { id: 'CLI-CTA-01', pregunta: 'Entidad bancaria', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-CTA-02', pregunta: 'Tipo de producto', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Ahorro', 'Corriente'], obligatorio: true },
        { id: 'CLI-CTA-03', pregunta: 'N° de producto', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Origen de fondos',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'CLI-OF-01',
          pregunta: 'Origen de fondos (detalle)',
          tipo_respuesta: 'texto_largo',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Perfil transaccional',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'CLI-PT-01', pregunta: 'Tipo de servicio', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PT-02', pregunta: 'Frecuencia', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PT-03', pregunta: 'Valor estimado (COP)', tipo_respuesta: 'numerico', modo_respuesta: 'Moneda COP', opciones: null, obligatorio: true },
        { id: 'CLI-PT-04', pregunta: 'Municipio de origen de los servicios', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PT-05a', pregunta: 'Forma de pago - Transferencia bancaria', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección múltiple', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-PT-05b', pregunta: 'Forma de pago - Cheque', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección múltiple', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-PT-05c', pregunta: 'Forma de pago - Efectivo', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección múltiple', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-PT-06', pregunta: 'Nombre de la entidad bancaria donde realiza el pago', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Relación conflicto de intereses',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'CLI-CI-01', pregunta: '¿Tiene relación con empleados?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-CI-02', pregunta: '¿Tiene relación con directivos?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true },
        { id: 'CLI-CI-03', pregunta: '¿Tiene relación con entidades públicas?', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Sí', 'No'], obligatorio: true }
      ]
    }
  ]
}

// ──────────────────────────────────────────────────────────
// SLFT-PTEE-FR-12 — AUTORIZACIÓN DEL PROPIETARIO
// Facturación y/o pago a tercero diferente del propietario del vehículo.
//
// Formato individual: NO pertenece al grupo de formularios de conocimiento
// SARLAFT y por eso no aparece en el selector público (`categoria: 'individual'`).
// Se diligencia desde su propia ruta en el landing.
//
// Las secciones 10 (lista de anexos) y 11 (uso exclusivo de la empresa) del
// documento original no viven aquí: la 10 se resuelve con la fase de carga de
// documentos (ver `DOCUMENTOS_AUTORIZACION_PROPIETARIO`) y la 11 corresponde a
// los campos de evaluación interna del dashboard de Cumplimiento.
// ──────────────────────────────────────────────────────────
const FORMULARIO_AUTORIZACION_PROPIETARIO: FormularioDefinicion = {
  codigo: 'SLFT-PTEE-FR-12',
  nombre_formato: 'AUTORIZACION_DEL_PROPIETARIO',
  titulo: 'Autorización del Propietario — Facturación y/o pago a tercero',
  version: '01',
  fecha_documento: '13/08/2026',
  archivo_origen: 'GC-FR-12 AUTORIZACION DEL PROPIETARIO.pdf',
  tipo: 'autorizacion_propietario',
  categoria: 'individual',
  secciones: [
    {
      seccion: 'Datos del documento',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'AUT-ENC-01', pregunta: 'Ciudad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-ENC-02', pregunta: 'Fecha de diligenciamiento', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'AUT-ENC-03', pregunta: 'Dirigida a (Señores)', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, nota: 'Nombre o razón social de la empresa destinataria de la autorización.' },
        { id: 'AUT-ENC-04', pregunta: 'NIT del destinatario', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'AUT-ENC-05', pregunta: 'Ciudad del destinatario', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Identificación del propietario que autoriza',
      tipo_bloque: 'seccion_normal',
      nota: 'Manifiesto que soy el propietario registrado del vehículo identificado en esta carta.',
      preguntas: [
        { id: 'AUT-DCL-01', pregunta: 'Nombre completo del propietario', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-DCL-02', pregunta: 'Tipo de documento', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Cédula de ciudadanía', 'NIT'], obligatorio: true },
        { id: 'AUT-DCL-03', pregunta: 'Número de documento', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'AUT-DCL-04', pregunta: 'Expedida en', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-DCL-05', pregunta: 'Actúa en calidad de', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Nombre propio', 'Representante legal'], obligatorio: true },
        {
          id: 'AUT-DCL-06',
          pregunta: 'Nombre o razón social que representa',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          nota: 'Solo si actúa en calidad de representante legal.',
          condicional_pregunta: { id: 'AUT-DCL-05', igual_a: 'Representante legal' }
        }
      ]
    },
    {
      seccion: '1. Identificación del vehículo',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'AUT-VEH-01', pregunta: 'Placa', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-VEH-02', pregunta: 'Clase / servicio', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-VEH-03', pregunta: 'Marca, línea y modelo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-VEH-04', pregunta: 'Número de motor', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-VEH-05', pregunta: 'Número de chasis / VIN', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-VEH-06', pregunta: 'Licencia de tránsito', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'digitos' }
      ]
    },
    {
      seccion: '2. Identificación del tercero autorizado',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'AUT-TER-01', pregunta: 'Nombre o razón social', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-TER-02', pregunta: 'Cédula o NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'AUT-TER-03', pregunta: 'Representante legal', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false, nota: 'Solo si el tercero autorizado es una persona jurídica.' },
        { id: 'AUT-TER-04', pregunta: 'Dirección', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-TER-05', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'AUT-TER-06', pregunta: 'Correo electrónico', tipo_respuesta: 'texto_corto', modo_respuesta: 'Correo electrónico', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Alcance de la autorización',
      tipo_bloque: 'seccion_normal',
      nota: 'Marque todo lo que corresponda.',
      preguntas: [
        {
          id: 'AUT-ALC-01',
          pregunta: 'Autorizo al tercero identificado para',
          tipo_respuesta: 'seleccion_multiple',
          modo_respuesta: 'Selección múltiple',
          opciones: [
            'Administrar o explotar económicamente el vehículo.',
            'Presentar factura electrónica o cuenta de cobro por servicios efectivamente prestados.',
            'Recibir los pagos de facturas o cuentas de cobro verificadas y aprobadas.',
            'Realizar trámites administrativos relacionados con la operación del vehículo.',
            'Otro'
          ],
          obligatorio: true
        },
        {
          id: 'AUT-ALC-02',
          pregunta: '¿Cuál otro alcance?',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          condicional_pregunta: { id: 'AUT-ALC-01', incluye: 'Otro' }
        }
      ]
    },
    {
      seccion: '3. Relación jurídica con el tercero autorizado',
      tipo_bloque: 'seccion_normal',
      nota: 'La autorización se origina en el siguiente negocio o relación jurídica.',
      preguntas: [
        {
          id: 'AUT-REL-01',
          pregunta: 'Tipo de negocio o relación jurídica',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: [
            'Contrato de arrendamiento.',
            'Contrato de administración del vehículo.',
            'Contrato de mandato.',
            'Cesión de derechos económicos.',
            'Contrato de usufructo o explotación económica.',
            'Contrato de leasing.',
            'Otro'
          ],
          obligatorio: true
        },
        {
          id: 'AUT-REL-02',
          pregunta: '¿Cuál otra relación jurídica?',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          condicional_pregunta: { id: 'AUT-REL-01', igual_a: 'Otro' }
        },
        { id: 'AUT-REL-03', pregunta: 'Fecha de suscripción', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'AUT-REL-04', pregunta: 'Vigencia del contrato — desde', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'AUT-REL-05', pregunta: 'Vigencia del contrato — hasta', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'AUT-REL-06', pregunta: 'Objeto contractual', tipo_respuesta: 'texto_largo', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: '4. Información para el pago',
      tipo_bloque: 'seccion_normal',
      nota: 'Autorizo que los pagos debidamente causados, soportados y aprobados sean efectuados únicamente en la siguiente cuenta bancaria.',
      preguntas: [
        { id: 'AUT-PAG-01', pregunta: 'Titular de la cuenta', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-PAG-02', pregunta: 'Cédula o NIT del titular', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'AUT-PAG-03', pregunta: 'Entidad bancaria', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-PAG-04', pregunta: 'Tipo de cuenta', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Ahorros', 'Corriente'], obligatorio: true },
        { id: 'AUT-PAG-05', pregunta: 'Número de cuenta', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'digitos' },
        {
          id: 'AUT-PAG-06',
          pregunta: 'Declaración sobre la cuenta bancaria',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (aceptación implícita al firmar)',
          opciones: null,
          obligatorio: false,
          nota: 'Declaro que la cuenta bancaria pertenece al tercero autorizado y adjunto certificación bancaria vigente. Esta autorización no comprende pagos en efectivo ni pagos a otras personas o cuentas distintas de las aquí indicadas.'
        }
      ]
    },
    {
      seccion: '5. Declaraciones del propietario',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'AUT-DPR-01', pregunta: 'Declaración 1', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '1. Soy el propietario legítimo del vehículo y la información suministrada es completa, cierta, actualizada y verificable.' },
        { id: 'AUT-DPR-02', pregunta: 'Declaración 2', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '2. El vehículo no fue adquirido con recursos provenientes de actividades ilícitas ni está destinado a actividades contrarias a la ley.' },
        { id: 'AUT-DPR-03', pregunta: 'Declaración 3', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '3. La relación con el tercero autorizado es real, lícita y está soportada en el contrato adjunto.' },
        { id: 'AUT-DPR-04', pregunta: 'Declaración 4', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '4. Los recursos que reciba el tercero corresponderán exclusivamente a servicios reales, efectivamente prestados y soportados.' },
        { id: 'AUT-DPR-05', pregunta: 'Declaración 5', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '5. La facturación se realizará conforme a la legislación tributaria colombiana y por la persona jurídicamente facultada u obligada para expedirla.' },
        { id: 'AUT-DPR-06', pregunta: 'Declaración 6', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '6. La autorización no busca ocultar al beneficiario final, evadir obligaciones tributarias, eludir medidas cautelares, simular operaciones, desviar recursos o facilitar LA/FT/FP, corrupción o soborno.' },
        { id: 'AUT-DPR-07', pregunta: 'Declaración 7', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '7. Informaré inmediatamente cualquier cambio en la propiedad, administración, explotación, facturación, cuenta bancaria o beneficiario económico del vehículo.' },
        { id: 'AUT-DPR-08', pregunta: 'Declaración 8', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '8. Autorizo a la empresa a verificar la autenticidad de la información, contactar a las partes y solicitar soportes adicionales.' },
        {
          id: 'AUT-DPR-09',
          pregunta: 'Relación del propietario con el tercero autorizado',
          tipo_respuesta: 'seleccion_multiple',
          modo_respuesta: 'Selección múltiple',
          opciones: [
            'Cónyuge o compañero(a) permanente.',
            'Familiar',
            'Socio o accionista.',
            'Arrendatario.',
            'Administrador del vehículo.',
            'Mandatario.',
            'Cesionario de derechos económicos.',
            'No existe relación familiar, societaria o laboral.',
            'Otro'
          ],
          obligatorio: true
        },
        {
          id: 'AUT-DPR-10',
          pregunta: 'Parentesco',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          condicional_pregunta: { id: 'AUT-DPR-09', incluye: 'Familiar' }
        },
        {
          id: 'AUT-DPR-11',
          pregunta: '¿Cuál otra relación?',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          condicional_pregunta: { id: 'AUT-DPR-09', incluye: 'Otro' }
        },
        { id: 'AUT-DPR-12', pregunta: 'Relaciones o conflictos de interés que deban declararse', tipo_respuesta: 'texto_largo', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false, nota: 'Deje el campo vacío si no hay nada que declarar.' }
      ]
    },
    {
      seccion: '6. Autorización para consultas y tratamiento de información',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'AUT-TRA-01',
          pregunta: 'Autorización previa, expresa e informada',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo',
          opciones: null,
          obligatorio: false,
          nota: 'Autorizo de manera previa, expresa e informada a la empresa destinataria de esta carta para lo que marque a continuación.'
        },
        {
          id: 'AUT-TRA-02',
          pregunta: 'Autorizo a la empresa para',
          tipo_respuesta: 'seleccion_multiple',
          modo_respuesta: 'Selección múltiple',
          opciones: [
            'Consultar y verificar mis datos y los del tercero autorizado.',
            'Realizar consultas en listas vinculantes, restrictivas, sancionatorias, judiciales, fiscales, disciplinarias, administrativas, PEP y fuentes públicas o reputacionales.',
            'Verificar la titularidad del vehículo, la cuenta bancaria y la relación contractual.',
            'Validar beneficiarios finales, origen de fondos y posibles conflictos de interés.',
            'Tratar los datos personales conforme a la política de protección de datos de la empresa.',
            'Aplicar medidas de debida diligencia SARLAFT y PTEE, incluida la debida diligencia intensificada cuando corresponda.'
          ],
          obligatorio: true
        }
      ]
    },
    {
      seccion: '7. Condiciones de la autorización',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'AUT-CND-01', pregunta: 'Condición 1', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '1. Esta carta no obliga a la empresa a aceptar la facturación ni a efectuar pagos al tercero autorizado.' },
        { id: 'AUT-CND-02', pregunta: 'Condición 2', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '2. La autorización queda sujeta a revisión operativa, contractual, tributaria, contable, jurídica y de cumplimiento.' },
        { id: 'AUT-CND-03', pregunta: 'Condición 3', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '3. La empresa podrá solicitar aclaraciones, soportes adicionales o una debida diligencia intensificada.' },
        { id: 'AUT-CND-04', pregunta: 'Condición 4', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '4. La empresa podrá suspender o rechazar la vinculación, facturación o pago ante inconsistencias, documentación insuficiente, señales de alerta o riesgos no justificados.' },
        { id: 'AUT-CND-05', pregunta: 'Condición 5', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '5. La carta no reemplaza el contrato que acredita la relación jurídica ni subsana irregularidades tributarias, contractuales o de cumplimiento.' },
        { id: 'AUT-CND-06', pregunta: 'Condición 6', tipo_respuesta: 'declaracion_informativa', modo_respuesta: 'Texto declarativo', opciones: null, obligatorio: false, nota: '6. La empresa no será responsable de controversias particulares entre el propietario y el tercero autorizado, sin perjuicio de sus obligaciones legales.' }
      ]
    },
    {
      seccion: '8. Vigencia y revocatoria',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        { id: 'AUT-VIG-01', pregunta: 'Vigencia de la autorización — desde', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'AUT-VIG-02', pregunta: 'Vigencia de la autorización — hasta', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        {
          id: 'AUT-VIG-03',
          pregunta: 'Revocatoria',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo',
          opciones: null,
          obligatorio: false,
          nota: 'La autorización podrá revocarse mediante comunicación escrita radicada ante la empresa. La revocatoria producirá efectos después de su recepción, validación y registro, sin afectar obligaciones válidamente causadas o pagos previamente realizados.'
        }
      ]
    },
    {
      seccion: '9. Firmas',
      tipo_bloque: 'seccion_normal',
      nota: 'Firman el propietario del vehículo y el tercero autorizado en señal de aceptación.',
      preguntas: [
        { id: 'AUT-FIR-01', pregunta: 'Se firma en (ciudad)', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-FIR-02', pregunta: 'Fecha de firma', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },

        { id: 'AUT-FIR-03', pregunta: 'Propietario del vehículo — Nombre', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-FIR-04', pregunta: 'Propietario del vehículo — Cédula/NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'AUT-FIR-05', pregunta: 'Propietario del vehículo — Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'AUT-FIR-06', pregunta: 'Propietario del vehículo — Correo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Correo electrónico', opciones: null, obligatorio: true },
        { id: 'AUT-FIR-07', pregunta: 'Propietario del vehículo — Firma', tipo_respuesta: 'firma', modo_respuesta: 'Firma manuscrita o digital', opciones: null, obligatorio: true },

        { id: 'AUT-FIR-08', pregunta: 'Tercero autorizado — Nombre o razón social', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'AUT-FIR-09', pregunta: 'Tercero autorizado — Cédula/NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'documento' },
        { id: 'AUT-FIR-10', pregunta: 'Tercero autorizado — Representante legal', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: false, nota: 'Solo si el tercero autorizado es una persona jurídica.' },
        { id: 'AUT-FIR-11', pregunta: 'Tercero autorizado — Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true, formato: 'telefono' },
        { id: 'AUT-FIR-12', pregunta: 'Tercero autorizado — Firma de aceptación', tipo_respuesta: 'firma', modo_respuesta: 'Firma manuscrita o digital', opciones: null, obligatorio: true }
      ]
    }
  ]
}

// ──────────────────────────────────────────────────────────
// GC-FOR-13 — DECLARACIÓN SARLAFT/PTEE PARA EMPRESA DE TRANSPORTE
//
// Formato individual: NO pertenece al grupo de formularios de conocimiento
// SARLAFT y por eso no aparece en el selector público (`categoria: 'individual'`).
// Se diligencia desde `/declaracion-empresa-transporte` en el landing.
//
// El documento final NO lo arma el generador HTML genérico: se dibuja sobre el
// PDF controlado de la marca (ver `declaracion-transporte-pdf.service.ts`). Por
// eso los IDs de pregunta son estables y están mapeados uno a uno a una
// coordenada del formato; renombrarlos rompe el diligenciamiento del PDF.
//
// La sección "Resultado" del formato no se pregunta aquí: es la decisión
// interna del Oficial de Cumplimiento y se marca al emitir la versión evaluada.
// ──────────────────────────────────────────────────────────
const FORMULARIO_DECLARACION_TRANSPORTE: FormularioDefinicion = {
  codigo: 'GC-FOR-13',
  nombre_formato: 'DECLARACION_SARLAFT_PTEE_EMPRESA_TRANSPORTE',
  titulo: 'Declaración SARLAFT y PTEE para empresa de transporte',
  version: '01',
  // El formato GC-FOR-13 no trae fecha de vigencia visible en el encabezado.
  // Se deja vacío a propósito: inventar una fecha en un documento controlado
  // sería declarar una vigencia que el formato no tiene.
  fecha_documento: '',
  archivo_origen: 'DECLARACION PROVEEDOR EMPRESA DE TRANSPORTE.pdf',
  tipo: 'declaracion_empresa_transporte',
  categoria: 'individual',
  secciones: [
    {
      seccion: 'Datos del documento',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'DET-ENC-01',
          pregunta: 'Fecha de diligenciamiento',
          tipo_respuesta: 'fecha',
          modo_respuesta: 'DD/MM/AAAA',
          opciones: null,
          obligatorio: true
        }
      ]
    },
    {
      seccion: 'Identificación del proveedor',
      tipo_bloque: 'seccion_normal',
      nota: 'Empresa de transporte que presta el servicio tercerizado.',
      preguntas: [
        {
          id: 'DET-EMP-01',
          pregunta: 'Razón social del proveedor',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          nota: 'Tal como aparece en el certificado de existencia y representación legal. Máximo 55 caracteres para que quepa en el formato.'
        },
        {
          id: 'DET-EMP-02',
          pregunta: 'NIT',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          formato: 'documento'
        }
      ]
    },
    {
      seccion: '1. Datos de quien declara',
      tipo_bloque: 'seccion_normal',
      nota: 'Debe diligenciarlo el representante legal de la empresa de transporte.',
      preguntas: [
        {
          id: 'DET-REP-01',
          pregunta: 'Nombre del representante legal',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true
        },
        {
          id: 'DET-REP-02',
          pregunta: 'Cédula del representante legal',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          formato: 'documento'
        },
        {
          id: 'DET-REP-03',
          pregunta: 'Teléfono',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Texto libre',
          opciones: null,
          obligatorio: true,
          formato: 'telefono'
        },
        {
          id: 'DET-REP-04',
          pregunta: 'Correo electrónico',
          tipo_respuesta: 'texto_corto',
          modo_respuesta: 'Correo electrónico',
          opciones: null,
          obligatorio: true,
          nota: 'Queda impreso en la declaración y es el canal por el que la empresa contacta al declarante. Se pide dos veces para evitar errores de digitación.'
        }
      ]
    },
    {
      seccion: '2. Declaración y compromiso',
      tipo_bloque: 'seccion_normal',
      nota:
        'El texto completo de la declaración y de los ocho compromisos está impreso en el formato GC-FOR-13 ' +
        'que se genera al enviar. Aceptarlo aquí equivale a suscribirlo.',
      preguntas: [
        {
          id: 'DET-ACK-01',
          pregunta:
            'En mi calidad de representante legal, declaro que la información es veraz y acepto los compromisos del formato',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí, declaro que la información es veraz y acepto los compromisos del formato'],
          obligatorio: true
        }
      ]
    },
    {
      seccion: '3. Confirmación rápida',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'DET-CNF-01',
          pregunta: 'Todos los vehículos relacionados fueron revisados antes de su asignación',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true,
          nota: 'Si respondes No, debes explicarlo en las alertas u observaciones.'
        },
        {
          id: 'DET-CNF-02',
          pregunta: 'Estado de alertas',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: [
            'No existen alertas pendientes',
            'Existen alertas informadas en documento anexo'
          ],
          obligatorio: true,
          nota: 'Las dos opciones son excluyentes. Si existen alertas, debes describirlas y adjuntar el documento anexo.'
        },
        {
          id: 'DET-CNF-03',
          pregunta: 'Los soportes están disponibles y vigentes',
          tipo_respuesta: 'seleccion_unica',
          modo_respuesta: 'Selección única',
          opciones: ['Sí', 'No'],
          obligatorio: true,
          nota: 'Si respondes No, debes explicarlo en las alertas u observaciones.'
        }
      ]
    },
    {
      seccion: '4. Alertas u observaciones',
      tipo_bloque: 'seccion_normal',
      preguntas: [
        {
          id: 'DET-OBS-01',
          pregunta: 'Alertas u observaciones',
          tipo_respuesta: 'texto_largo',
          modo_respuesta: 'Texto libre (máximo 260 caracteres)',
          opciones: null,
          obligatorio: false,
          nota:
            'Obligatorio si existen alertas, si los vehículos no fueron revisados o si los soportes no están vigentes. ' +
            'El formato tiene dos renglones: para el detalle extenso usa el documento anexo.'
        }
      ]
    },
    {
      seccion: '5. Firma y validación',
      tipo_bloque: 'seccion_normal',
      nota: 'Firma el representante legal identificado en la sección 1.',
      preguntas: [
        {
          id: 'DET-FIR-01',
          pregunta: 'Firma del representante legal',
          tipo_respuesta: 'firma',
          modo_respuesta: 'Firma manuscrita o digital',
          opciones: null,
          obligatorio: true
        }
      ]
    }
  ]
}

// ──────────────────────────────────────────────────────────
// Registry público
// ──────────────────────────────────────────────────────────
export const FORMULARIOS: Record<string, FormularioDefinicion> = {
  'SLFT-PTEE-FR-04': FORMULARIO_CLIENTE_PROVEEDOR,
  'SLFT-PTEE-FR-05': FORMULARIO_ACCIONISTAS,
  'SLFT-PTEE-FR-06': FORMULARIO_PERSONAL,
  'SLFT-PTEE-FR-12': FORMULARIO_AUTORIZACION_PROPIETARIO,
  'GC-FOR-13': FORMULARIO_DECLARACION_TRANSPORTE
}

export function getFormularioPorCodigo(codigo: string): FormularioDefinicion | null {
  return FORMULARIOS[codigo] ?? null
}

/**
 * Lista los formularios registrados. Si se pasa `categoria`, devuelve solo los
 * de esa categoría — el listado público del selector SARLAFT usa
 * `listarFormularios('sarlaft')` para no exponer los formatos individuales,
 * que se alcanzan únicamente por su código desde su propia ruta.
 */
export function listarFormularios(
  categoria?: FormularioDefinicion['categoria']
): FormularioDefinicion[] {
  const todos = Object.values(FORMULARIOS)
  return categoria ? todos.filter((f) => f.categoria === categoria) : todos
}

export const TIPOS_FORMULARIO: Array<{
  codigo: FormularioDefinicion['codigo']
  tipo: FormularioDefinicion['tipo']
  titulo: string
  descripcion: string
}> = [
  {
    codigo: 'SLFT-PTEE-FR-04',
    tipo: 'cliente_proveedor',
    titulo: 'Cliente / Proveedor',
    descripcion: 'Para personas naturales o jurídicas que contratan servicios de transporte con COTRANSMEQ S.A.S.'
  },
  {
    codigo: 'SLFT-PTEE-FR-05',
    tipo: 'accionistas',
    titulo: 'Accionistas',
    descripcion: 'Para socios o accionistas de COTRANSMEQ S.A.S. Incluye composición accionaria y beneficiario final.'
  },
  {
    codigo: 'SLFT-PTEE-FR-06',
    tipo: 'personal',
    titulo: 'Vinculación de Personal',
    descripcion: 'Para candidatos a vincularse como empleados de COTRANSMEQ S.A.S.'
  },
  {
    codigo: 'SLFT-PTEE-FR-12',
    tipo: 'autorizacion_propietario',
    titulo: 'Autorización del Propietario',
    descripcion: 'Para propietarios que autorizan la facturación y/o el pago a un tercero diferente del propietario del vehículo.'
  },
  {
    codigo: 'GC-FOR-13',
    tipo: 'declaracion_empresa_transporte',
    titulo: 'Declaración de empresa de transporte',
    descripcion: 'Para empresas de transporte tercerizadas que declaran el control de los vehículos, propietarios y conductores que incorporan al servicio de COTRANSMEQ S.A.S.'
  }
]

// ──────────────────────────────────────────────────────────
// Tipos de documentos que se deben anexar al formulario
// ──────────────────────────────────────────────────────────
export const TIPO_DOCUMENTO = {
  CEDULA_REPRESENTANTE: 'cedula_representante',
  RUT: 'rut',
  CERTIFICADO_EXISTENCIA: 'certificado_existencia',
  COMPOSICION_ACCIONARIA: 'composicion_accionaria'
} as const

/** Anexos propios del formato SLFT-PTEE-FR-12 (sección 10 del documento).
 *  Se mantienen en un catálogo aparte a propósito: `getDocumentosRequeridos`
 *  para los formularios SARLAFT recorre `DOCUMENTOS_REQUERIDOS` completo, así
 *  que mezclarlos ahí los filtraría a Cliente/Proveedor y Accionistas. */
/** Anexos propios de la declaración de empresa de transporte. El catálogo real
 *  lo produce `documentosDeclaracionTransporte`, porque la obligatoriedad
 *  depende de las respuestas y no del tipo de cliente. */
export const TIPO_DOCUMENTO_DECLARACION_TRANSPORTE = {
  ANEXO_ALERTAS: ANEXO_ALERTAS,
  RELACION_VEHICULOS: ANEXO_RELACION_VEHICULOS
} as const

export const TIPO_DOCUMENTO_AUTORIZACION = {
  IDENTIDAD_PROPIETARIO: 'identidad_propietario',
  IDENTIDAD_TERCERO: 'identidad_tercero',
  RUT_PROPIETARIO: 'rut_propietario',
  RUT_TERCERO: 'rut_tercero',
  TARJETA_PROPIEDAD: 'tarjeta_propiedad',
  CERTIFICACION_BANCARIA: 'certificacion_bancaria',
  CERT_EXISTENCIA_PROPIETARIO: 'cert_existencia_propietario',
  CERT_TRADICION_VEHICULO: 'cert_tradicion_vehiculo',
  CONTRATO_RELACION_JURIDICA: 'contrato_relacion_juridica',
  FORMULARIO_CONOCIMIENTO_TERCERO: 'formulario_conocimiento_tercero',
  OTROS_ANEXOS: 'otros_anexos'
} as const

export type TipoDocumentoSarlaftId = (typeof TIPO_DOCUMENTO)[keyof typeof TIPO_DOCUMENTO]

export type TipoDocumentoAutorizacionId =
  (typeof TIPO_DOCUMENTO_AUTORIZACION)[keyof typeof TIPO_DOCUMENTO_AUTORIZACION]

export type TipoDocumentoDeclaracionTransporteId =
  (typeof TIPO_DOCUMENTO_DECLARACION_TRANSPORTE)[keyof typeof TIPO_DOCUMENTO_DECLARACION_TRANSPORTE]

export type TipoDocumentoId =
  | TipoDocumentoSarlaftId
  | TipoDocumentoAutorizacionId
  | TipoDocumentoDeclaracionTransporteId

export interface DocumentoRequerido {
  id: TipoDocumentoId
  nombre: string
  descripcion: string
  /** Aplica a: 'pn' (persona natural), 'pj' (persona jurídica), o 'ambos' */
  aplicaA: 'pn' | 'pj' | 'ambos'
  /** Indica si el documento es obligatorio al enviar el formulario.
   *  Por defecto true. En el formulario de Vinculación de Personal
   *  (SLFT-PTEE-FR-06) el RUT y la Cédula de Ciudadanía son obligatorios;
   *  los demás se muestran como opcionales. */
  obligatorio: boolean
}

export const DOCUMENTOS_REQUERIDOS: Record<TipoDocumentoSarlaftId, DocumentoRequerido> = {
  cedula_representante: {
    id: 'cedula_representante',
    nombre: 'Cédula de ciudadanía',
    descripcion: 'Cédula por ambas caras (en una sola imagen o PDF).',
    aplicaA: 'ambos',
    obligatorio: true
  },
  rut: {
    id: 'rut',
    nombre: 'RUT actualizado',
    descripcion: 'Registro Único Tributario expedido por la DIAN.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  certificado_existencia: {
    id: 'certificado_existencia',
    nombre: 'Certificado de existencia y representación legal',
    descripcion: 'Expedido por la Cámara de Comercio, con fecha no mayor a un mes.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  composicion_accionaria: {
    id: 'composicion_accionaria',
    nombre: 'Composición accionaria y socios mayoritarios',
    descripcion: 'Documento que detalle los socios y su participación.',
    aplicaA: 'pj',
    obligatorio: true
  }
}

/**
 * Anexos del formato SLFT-PTEE-FR-12 (sección 10 del documento original).
 * Los seis primeros son obligatorios para poder enviar; los restantes se
 * ofrecen como opcionales ("cuando aplique" en el documento).
 *
 * Las declaraciones que el documento marca con ✓ (origen de fondos,
 * beneficiario final, conflictos de interés y autorización de tratamiento de
 * datos) no se piden como archivo: quedan cubiertas por las secciones 5 y 6
 * del propio formulario.
 */
export const DOCUMENTOS_AUTORIZACION_PROPIETARIO: DocumentoRequerido[] = [
  {
    id: 'identidad_propietario',
    nombre: 'Documento de identidad del propietario',
    descripcion: 'Cédula o documento de identidad por ambas caras (una sola imagen o PDF).',
    aplicaA: 'ambos',
    obligatorio: true
  },
  {
    id: 'identidad_tercero',
    nombre: 'Documento de identidad del tercero autorizado',
    descripcion: 'Cédula del tercero o de su representante legal si es persona jurídica.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  {
    id: 'rut_propietario',
    nombre: 'RUT actualizado del propietario',
    descripcion: 'Registro Único Tributario expedido por la DIAN.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  {
    id: 'rut_tercero',
    nombre: 'RUT actualizado del tercero autorizado',
    descripcion: 'Registro Único Tributario expedido por la DIAN.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  {
    id: 'tarjeta_propiedad',
    nombre: 'Tarjeta de propiedad del vehículo',
    descripcion: 'Licencia de tránsito del vehículo, por ambas caras.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  {
    id: 'certificacion_bancaria',
    nombre: 'Certificación bancaria vigente del tercero autorizado',
    descripcion: 'Debe corresponder a la cuenta indicada en la sección 4 y estar a nombre del tercero.',
    aplicaA: 'ambos',
    obligatorio: true
  },
  {
    id: 'cert_existencia_propietario',
    nombre: 'Certificado de existencia y representación legal',
    descripcion: 'Solo si el propietario o el tercero es persona jurídica. Fecha no mayor a un mes.',
    aplicaA: 'pj',
    obligatorio: false
  },
  {
    id: 'cert_tradicion_vehiculo',
    nombre: 'Certificado de tradición del vehículo',
    descripcion: 'Cuando aplique, para acreditar la titularidad registrada.',
    aplicaA: 'ambos',
    obligatorio: false
  },
  {
    id: 'contrato_relacion_juridica',
    nombre: 'Contrato que acredita la relación jurídica',
    descripcion: 'Arrendamiento, administración, mandato, cesión, usufructo o leasing según la sección 3.',
    aplicaA: 'ambos',
    obligatorio: false
  },
  {
    id: 'formulario_conocimiento_tercero',
    nombre: 'Formulario de conocimiento del tercero',
    descripcion: 'Formato SARLAFT de Cliente/Proveedor diligenciado por el tercero autorizado, si ya lo tiene.',
    aplicaA: 'ambos',
    obligatorio: false
  },
  {
    id: 'otros_anexos',
    nombre: 'Otros anexos',
    descripcion: 'Cualquier otro soporte que quiera aportar para sustentar la autorización.',
    aplicaA: 'ambos',
    obligatorio: false
  }
]

/**
 * Devuelve la lista de documentos a anexar según el tipo de formulario y
 * el tipo de persona. Cada item incluye la bandera `obligatorio` que
 * indica si el documento es requerido para poder enviar el formulario.
 *
 * Comportamiento por tipo:
 *  - `cliente_proveedor` y `accionistas`: los documentos devueltos son
 *    todos obligatorios (el usuario debe adjuntarlos para enviar).
 *  - `personal` (Vinculación de Personal): se muestran los 4 documentos,
 *    pero SOLO la Cédula de ciudadanía y el RUT son obligatorios. Los
 *    demás (Certificado de existencia y Composición accionaria) son
 *    opcionales — el usuario puede adjuntarlos o no, y el Oficial de
 *    Cumplimiento puede solicitarlos después si los requiere.
 *  - `autorizacion_propietario`: catálogo propio (`DOCUMENTOS_AUTORIZACION_PROPIETARIO`),
 *    con 6 obligatorios y el resto opcionales.
 */
export function getDocumentosRequeridos(
  tipoFormulario: FormularioDefinicion['tipo'],
  tipoCliente?: 'Persona Natural' | 'Persona Jurídica' | null,
  respuestas?: Record<string, unknown> | null
): DocumentoRequerido[] {
  // La declaración de empresa de transporte es el primer formato cuya lista de
  // anexos NO depende del tipo de cliente sino de una respuesta condicional
  // (`DET-CNF-02`), así que necesita ver las respuestas. Los demás formatos
  // ignoran el tercer parámetro y siguen comportándose igual que antes.
  if (tipoFormulario === 'declaracion_empresa_transporte') {
    return documentosDeclaracionTransporte(respuestas ?? {}) as DocumentoRequerido[]
  }

  if (tipoFormulario === 'autorizacion_propietario') {
    return DOCUMENTOS_AUTORIZACION_PROPIETARIO.map((d) => ({ ...d }))
  }

  if (tipoFormulario === 'personal') {
    // Vinculación de personal: se muestran los 4 documentos disponibles
    // para que el candidato pueda anexar los que tenga, pero solo la
    // Cédula de ciudadanía y el RUT son obligatorios.
    return [
      { ...DOCUMENTOS_REQUERIDOS.cedula_representante, obligatorio: true },
      { ...DOCUMENTOS_REQUERIDOS.rut, obligatorio: true },
      {
        ...DOCUMENTOS_REQUERIDOS.certificado_existencia,
        obligatorio: false
      },
      {
        ...DOCUMENTOS_REQUERIDOS.composicion_accionaria,
        obligatorio: false
      }
    ]
  }
  return Object.values(DOCUMENTOS_REQUERIDOS).filter((d) => {
    if (tipoFormulario === 'accionistas') {
      // PJ: requiere los 4 documentos
      return true
    }
    if (tipoFormulario === 'cliente_proveedor') {
      // Depende del tipo de cliente
      if (d.id === 'composicion_accionaria') return tipoCliente === 'Persona Jurídica'
      return true
    }
    return false
  })
}

// Validaciones de upload
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
export const UPLOAD_MIME_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]
export const UPLOAD_EXT_PERMITIDAS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']
