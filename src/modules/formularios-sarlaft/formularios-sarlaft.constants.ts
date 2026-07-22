// Definiciones estructurales de los 3 formularios SARLAFT + PTEE
// Estos datos describen la forma del formulario (secciones, preguntas, tipos)
// y son consumidos por el frontend para renderizar el formulario dinámicamente
// y por el backend para validar/enviar.

export type TipoRespuesta =
  | 'texto_corto'
  | 'texto_largo'
  | 'numerico'
  | 'fecha'
  | 'seleccion_unica'
  | 'firma'
  | 'declaracion_informativa'

export interface PreguntaDefinicion {
  id: string
  pregunta: string
  tipo_respuesta: TipoRespuesta
  modo_respuesta: string
  opciones: string[] | null
  obligatorio: boolean
  nota?: string
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

export interface FormularioDefinicion {
  codigo: 'GC-FR-04' | 'GC-FR-05' | 'GC-FR-06'
  nombre_formato: string
  titulo: string
  version: string
  fecha_documento: string
  archivo_origen: string
  tipo: 'cliente_proveedor' | 'accionistas' | 'personal'
  secciones: SeccionDefinicion[]
}

// ──────────────────────────────────────────────────────────
// GC-FR-06 — FORMATO CONOCIMIENTO PERSONAL
// ──────────────────────────────────────────────────────────
const FORMULARIO_PERSONAL: FormularioDefinicion = {
  codigo: 'GC-FR-06',
  nombre_formato: 'FORMATO_CONOCIMIENTO_PERSONAL',
  titulo: 'Formulario Vinculación Personal SARLAFT + PTEE',
  version: '001',
  fecha_documento: '12/12/2026',
  archivo_origen: '4_FORMATO_CONOCIMIENTO_PERSONAL.xlsx',
  tipo: 'personal',
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
        { id: 'PER-IG-02', pregunta: 'N° de cédula', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
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
        { id: 'PER-IP-02', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
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
            '3. Me comprometo a informar a TRANSMERALDA S.A.S. cualquier cambio relevante en la naturaleza, volumen o frecuencia de estas operaciones.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Condicional: solo si PER-DEC-04 = Sí'
        },
        {
          id: 'PER-DEC-04-4',
          pregunta: '4. Autorizo a TRANSMERALDA S.A.S. a verificar la información aquí suministrada.',
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
// GC-FR-05 — FORMATO CONOCIMIENTO ACCIONISTAS
// ──────────────────────────────────────────────────────────
const FORMULARIO_ACCIONISTAS: FormularioDefinicion = {
  codigo: 'GC-FR-05',
  nombre_formato: 'FORMATO_CONOCIMIENTO_ACCIONISTAS',
  titulo: 'Formulario Conocimiento Accionistas SARLAFT + PTEE',
  version: '001',
  fecha_documento: '12/12/2026',
  archivo_origen: '3_FORMATO_CONOCIMIENTO_ACCIONISTAS.xlsx',
  tipo: 'accionistas',
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
        { id: 'ACC-EMP-02', pregunta: 'NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-EMP-03', pregunta: 'Dirección', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-EMP-04', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
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
        { id: 'ACC-CA-02', pregunta: 'N° de cédula / NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CA-03', pregunta: 'Nacionalidad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CA-04', pregunta: 'Tipo societario', tipo_respuesta: 'seleccion_unica', modo_respuesta: 'Selección única', opciones: ['Natural', 'Jurídico'], obligatorio: true },
        { id: 'ACC-CA-05', pregunta: 'Correo electrónico', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'ACC-CA-06', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
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
          pregunta: '3. Me comprometo a informar a TRANSMERALDA S.A.S. cualquier cambio relevante en la naturaleza, volumen o frecuencia de estas operaciones.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Condicional: solo si ACC-DEC-04 = Sí'
        },
        {
          id: 'ACC-DEC-04-4',
          pregunta: '4. Autorizo a TRANSMERALDA S.A.S. a verificar la información aquí suministrada.',
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
// GC-FR-04 — FORMATO CONOCIMIENTO CLIENTE / PROVEEDOR
// ──────────────────────────────────────────────────────────
const FORMULARIO_CLIENTE_PROVEEDOR: FormularioDefinicion = {
  codigo: 'GC-FR-04',
  nombre_formato: 'FORMATO_CONOCIMIENTO_CLIENTE_PROVEEDOR',
  titulo: 'Formulario Vinculación Cliente/Proveedor SARLAFT + PTEE',
  version: '001',
  fecha_documento: '12/06/2026',
  archivo_origen: '2__FOMARTO_CONOCIMIENTO_CLIENTE_PROVEEDOR.xlsx',
  tipo: 'cliente_proveedor',
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
        { id: 'CLI-PN-02', pregunta: 'N° de cédula', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-03', pregunta: 'Nacionalidad', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-04', pregunta: 'Fecha de nacimiento', tipo_respuesta: 'fecha', modo_respuesta: 'DD/MM/AAAA', opciones: null, obligatorio: true },
        { id: 'CLI-PN-05', pregunta: 'Actividad económica', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-06', pregunta: 'Ocupación / Cargo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-07', pregunta: 'Dirección', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-08', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PN-09', pregunta: 'Correo', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true }
      ]
    },
    {
      seccion: 'Persona jurídica',
      tipo_bloque: 'seccion_normal',
      condicional: 'Se diligencia si CLI-IG-01 = Persona Jurídica',
      preguntas: [
        { id: 'CLI-PJ-01', pregunta: 'Razón social', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
        { id: 'CLI-PJ-02', pregunta: 'N° NIT', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
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
        { id: 'CLI-DP-05', pregunta: 'Teléfono', tipo_respuesta: 'texto_corto', modo_respuesta: 'Texto libre', opciones: null, obligatorio: true },
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
          pregunta: '3. Me comprometo a informar a TRANSMERALDA S.A.S. cualquier cambio relevante en la naturaleza, volumen o frecuencia de estas operaciones.',
          tipo_respuesta: 'declaracion_informativa',
          modo_respuesta: 'Texto declarativo (condicional si DEC-04 = Sí)',
          opciones: null,
          obligatorio: false,
          nota: 'Condicional: solo si CLI-DEC-04 = Sí'
        },
        {
          id: 'CLI-DEC-04-4',
          pregunta: '4. Autorizo a TRANSMERALDA S.A.S. a verificar la información aquí suministrada.',
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
// Registry público
// ──────────────────────────────────────────────────────────
export const FORMULARIOS: Record<string, FormularioDefinicion> = {
  'GC-FR-04': FORMULARIO_CLIENTE_PROVEEDOR,
  'GC-FR-05': FORMULARIO_ACCIONISTAS,
  'GC-FR-06': FORMULARIO_PERSONAL
}

export function getFormularioPorCodigo(codigo: string): FormularioDefinicion | null {
  return FORMULARIOS[codigo] ?? null
}

export function listarFormularios(): FormularioDefinicion[] {
  return Object.values(FORMULARIOS)
}

export const TIPOS_FORMULARIO: Array<{
  codigo: FormularioDefinicion['codigo']
  tipo: FormularioDefinicion['tipo']
  titulo: string
  descripcion: string
}> = [
  {
    codigo: 'GC-FR-04',
    tipo: 'cliente_proveedor',
    titulo: 'Cliente / Proveedor',
    descripcion: 'Para personas naturales o jurídicas que contratan servicios de transporte con TRANSMERALDA S.A.S.'
  },
  {
    codigo: 'GC-FR-05',
    tipo: 'accionistas',
    titulo: 'Accionistas',
    descripcion: 'Para socios o accionistas de TRANSMERALDA S.A.S. Incluye composición accionaria y beneficiario final.'
  },
  {
    codigo: 'GC-FR-06',
    tipo: 'personal',
    titulo: 'Vinculación de Personal',
    descripcion: 'Para candidatos a vincularse como empleados de TRANSMERALDA S.A.S.'
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

export type TipoDocumentoId = (typeof TIPO_DOCUMENTO)[keyof typeof TIPO_DOCUMENTO]

export interface DocumentoRequerido {
  id: TipoDocumentoId
  nombre: string
  descripcion: string
  /** Aplica a: 'pn' (persona natural), 'pj' (persona jurídica), o 'ambos' */
  aplicaA: 'pn' | 'pj' | 'ambos'
}

export const DOCUMENTOS_REQUERIDOS: Record<TipoDocumentoId, DocumentoRequerido> = {
  cedula_representante: {
    id: 'cedula_representante',
    nombre: 'Cédula de ciudadanía',
    descripcion: 'Cédula por ambas caras (en una sola imagen o PDF).',
    aplicaA: 'ambos'
  },
  rut: {
    id: 'rut',
    nombre: 'RUT actualizado',
    descripcion: 'Registro Único Tributario expedido por la DIAN.',
    aplicaA: 'ambos'
  },
  certificado_existencia: {
    id: 'certificado_existencia',
    nombre: 'Certificado de existencia y representación legal',
    descripcion: 'Expedido por la Cámara de Comercio, con fecha no mayor a un mes.',
    aplicaA: 'ambos'
  },
  composicion_accionaria: {
    id: 'composicion_accionaria',
    nombre: 'Composición accionaria y socios mayoritarios',
    descripcion: 'Documento que detalle los socios y su participación.',
    aplicaA: 'pj'
  }
}

/** Devuelve la lista de documentos requeridos según el tipo de formulario y el tipo de persona */
export function getDocumentosRequeridos(
  tipoFormulario: FormularioDefinicion['tipo'],
  tipoCliente?: 'Persona Natural' | 'Persona Jurídica' | null
): DocumentoRequerido[] {
  return Object.values(DOCUMENTOS_REQUERIDOS).filter((d) => {
    if (tipoFormulario === 'personal') {
      // PN: requiere cédula, RUT y certificado. NO composición accionaria.
      return d.aplicaA === 'ambos'
    }
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
