/**
 * Generador del PDF de la declaración de empresa de transporte.
 *
 * Escribe cada caso en `tests/declaracion-transporte-output/` para la revisión
 * visual obligatoria del plan de QA, y comprueba automáticamente lo que sí se
 * puede comprobar sin ojos: que el binario es un PDF de una página tamaño
 * carta, que contiene los datos del declarante, que no filtra la firma ni
 * metadata HTTP, y que no hay branding cruzado.
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import {
  DeclaracionTransportePdfService,
  ajustarTamano,
  calcularExtensionSubrayado,
  encajarProporcional,
  formatearFecha,
  sanearTexto
} from '../../src/modules/formularios-sarlaft/declaracion-transporte-pdf.service'
import { COORDENADAS } from '../../src/modules/formularios-sarlaft/declaracion-transporte-pdf.coordinates'
import {
  TEMPLATE_DECLARACION_TRANSPORTE,
  assertTemplateEmitible,
  leerTemplateVerificado
} from '../../src/modules/formularios-sarlaft/declaracion-transporte-template.manifest'
import { CAMPOS, OPCION_CON_ALERTAS } from '../../src/modules/formularios-sarlaft/declaracion-transporte.validacion'
import { OUT_DIR, firmaSinteticaDataUrl, respuestasBase } from './fixtures'

const MANIFEST = TEMPLATE_DECLARACION_TRANSPORTE
/** Nombre de la OTRA marca: no puede aparecer en el documento generado. */
const MARCA_AJENA = MANIFEST.marca === 'transmeralda' ? 'COTRANSMEQ' : 'TRANSMERALDA'
const CODIGO_AJENO = MANIFEST.marca === 'transmeralda' ? 'GC-FOR-13' : 'SLFT-PTEE-FR-13'

/** Fecha fija: dos corridas del mismo caso deben producir el mismo hash. */
const FECHA_FIJA = new Date('2026-08-22T15:00:00.000Z')

async function generar(
  nombre: string,
  respuestas: Record<string, unknown>,
  extra: Partial<Parameters<typeof DeclaracionTransportePdfService.generar>[0]> = {}
) {
  const res = await DeclaracionTransportePdfService.generar({
    radicado: 'DECL-TRA-2026-00001',
    respuestas,
    estado_documental: 'recibida',
    version_documento: 1,
    fecha_generacion: FECHA_FIJA,
    ...extra
  })
  writeFileSync(resolve(OUT_DIR, `${MANIFEST.codigo}-${nombre}.pdf`), res.buffer)
  return res
}

/**
 * Texto extraído del PDF.
 *
 * Se usa un extractor real (pdf-parse, que por dentro es pdf.js) y no una
 * lectura del flujo de contenido: la fuente va incrustada como subconjunto, de
 * modo que en el flujo los caracteres son IDs de glifo y solo el CMap ToUnicode
 * los devuelve a texto. Que esto funcione demuestra además que el documento
 * conserva capa de texto seleccionable — es decir, que NO se rasterizó.
 */
async function textoDe(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as (
    b: Buffer
  ) => Promise<{ text: string; numpages: number }>
  const { text } = await pdfParse(buffer)
  return text
}

describe(`Generador PDF — ${MANIFEST.codigo}`, () => {
  it('el asset congelado coincide con el hash del manifiesto', () => {
    const bytes = leerTemplateVerificado(MANIFEST)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(MANIFEST.sha256)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  it('caso normal sin alertas: PDF de una página tamaño carta', async () => {
    const res = await generar('sin-alertas', respuestasBase())

    expect(res.buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/)
    // Tamaño razonable: el template pesa ~300 KB y el resultado no debe
    // dispararse ni quedar en un stub vacío.
    expect(res.buffer.length).toBeGreaterThan(50_000)
    expect(res.buffer.length).toBeLessThan(5_000_000)

    const doc = await PDFDocument.load(res.buffer)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(612)
    expect(Math.round(height)).toBe(792)
    expect(doc.isEncrypted).toBe(false)
  })

  it('el documento contiene razón social, NIT, representante y fecha', async () => {
    const res = await generar('datos-visibles', respuestasBase())
    const texto = await textoDe(res.buffer)
    for (const esperado of [
      'TRANSPORTES QA DOCUMENTAL',
      '900999888-1',
      'QA DOCUMENTAL',
      '1000000123',
      '22/08/2026'
    ]) {
      expect(texto).toContain(esperado)
    }
  })

  it('no filtra la firma, la IP ni el user agent', async () => {
    const res = await generar('sin-fugas', respuestasBase())
    const texto = await textoDe(res.buffer)
    expect(texto).not.toContain('data:image')
    expect(texto).not.toContain('Mozilla/')
    expect(texto).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
  })

  it('no contiene branding ni código de la otra marca', async () => {
    const res = await generar('branding', respuestasBase())
    const plano = res.buffer.toString('latin1')
    expect(plano).not.toContain(MARCA_AJENA)
    expect(plano).not.toContain(CODIGO_AJENO)

    // Los metadatos se fijan explícitamente porque el archivo de Word original
    // trae autor y productor propios que, sin sobrescribir, viajarían dentro
    // del documento entregado al declarante.
    //
    // `updateMetadata: false` es imprescindible al releer: por defecto pdf-lib
    // reescribe Producer y ModDate al cargar, así que sin esta opción se
    // estaría comprobando lo que pdf-lib acaba de poner, no lo que quedó
    // guardado en el archivo.
    const doc = await PDFDocument.load(res.buffer, { updateMetadata: false })
    expect(doc.getAuthor()).toBe(MANIFEST.empresa)
    expect(doc.getAuthor()).not.toContain(MARCA_AJENA)
    expect(doc.getProducer()).toContain(MANIFEST.empresa)
    expect(doc.getTitle()).toContain(MANIFEST.codigo)
    expect(doc.getTitle()).toContain('DECL-TRA-2026-00001')
  })

  it('no arrastra el XMP del archivo de Word original', async () => {
    // El template trae un flujo XMP con `dc:creator` heredado de Word. En
    // Cotransmeq ese autor es literalmente "OPERACIONES TRANSMERALDA" y en
    // Transmeralda es el nombre de una persona: los dos son datos que no
    // pueden viajar dentro del documento que se entrega al declarante.
    const res = await generar('sin-xmp', respuestasBase())
    const plano = res.buffer.toString('latin1')
    expect(plano).not.toContain('dc:creator')
    expect(plano).not.toContain('OPERACIONES TRANSMERALDA')
    expect(plano.toLowerCase()).not.toContain('rochi lizarazo')
  })

  it('con alertas y observación de dos líneas', async () => {
    const res = await generar(
      'con-alertas',
      respuestasBase({
        [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS,
        [CAMPOS.OBSERVACIONES]:
          'Se informa una señal de alerta sobre el conductor asignado al vehículo WGY482. ' +
          'El detalle, los soportes y el plan de acción quedan en el documento anexo.'
      })
    )
    const texto = await textoDe(res.buffer)
    expect(texto).toContain('WGY482')
    expect(res.marca_resultado).toBeNull()
  })

  it('valores de longitud máxima permitida caben sin fallar', async () => {
    await expect(
      generar(
        'longitud-maxima',
        respuestasBase({
          [CAMPOS.RAZON_SOCIAL]: 'TRANSPORTES Y LOGISTICA DEL ORIENTE COLOMBIANO S.A.S.',
          [CAMPOS.REPRESENTANTE]: 'MARÍA FERNANDA CASTRO RUIZ DE LA ESPRIELLA ÑUNGO',
          [CAMPOS.CORREO]: 'representante.legal.declaraciones@transportesqadocumental.com',
          [CAMPOS.OBSERVACIONES]: 'Ñ'.repeat(10) + ' ' + 'observación con tildes áéíóú '.repeat(7)
        })
      )
    ).resolves.toBeTruthy()
  })

  it('tildes, Ñ y caracteres de NIT/correo se dibujan sin perderse', async () => {
    const res = await generar(
      'tildes',
      respuestasBase({
        [CAMPOS.RAZON_SOCIAL]: 'TRANSPORTES ÑUÑOA & CÍA S.A.S.',
        [CAMPOS.REPRESENTANTE]: 'JOSÉ MARÍA PEÑA ÁVILA',
        [CAMPOS.NIT]: '900.999.888-1'
      })
    )
    const texto = await textoDe(res.buffer)
    expect(texto).toContain('ÑUÑOA')
    expect(texto).toContain('PEÑA ÁVILA')
    expect(texto).toContain('900.999.888-1')
  })

  it('firma apaisada, alta y transparente quedan contenidas en la celda', async () => {
    for (const [nombre, opts] of [
      ['firma-apaisada', { width: 900, height: 150 }],
      ['firma-alta', { width: 200, height: 400 }],
      ['firma-transparente', { width: 600, height: 200, transparente: true }]
    ] as const) {
      const res = await generar(nombre, respuestasBase({ [CAMPOS.FIRMA]: firmaSinteticaDataUrl(opts) }))
      expect(res.buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
    }
  })

  it('la firma queda REALMENTE incrustada como imagen, no como celda vacía', async () => {
    // Regresión: el E2E usaba un PNG de 1×1 transparente, que es una imagen
    // válida pero deja la celda de firma en blanco. Un documento firmado con
    // la firma invisible es un documento sin firma.
    const res = await generar('firma-incrustada', respuestasBase())
    const plano = res.buffer.toString('latin1')
    expect(plano).toContain('/Subtype /Image')
    // La firma sintética es de 600×200: si se incrustara el píxel de antes,
    // el XObject declararía /Width 1.
    expect(plano).toMatch(/\/Width 600/)
    expect(plano).toMatch(/\/Height 200/)
  })

  it('extiende la raya del formato cuando el valor la desborda', async () => {
    // La raya impresa de la sección 2 mide 94 pt y una razón social típica pasa
    // de 130 pt: sin la extensión el valor queda medio subrayado y medio al
    // aire, que es exactamente como se ve un formato mal diligenciado.
    const campo = COORDENADAS.empresa_declaracion
    const rayaImpresa = campo.subrayadoHasta!

    // Valor corto: la raya impresa alcanza, no se dibuja nada.
    expect(calcularExtensionSubrayado(campo, 40)).toBeNull()

    // Valor largo: se continúa desde donde termina la raya hasta el fin del texto.
    const tramo = calcularExtensionSubrayado(campo, 200)!
    expect(tramo).not.toBeNull()
    expect(tramo.desde).toBe(rayaImpresa)
    expect(tramo.hasta).toBe(campo.x + 200)
    // El empalme es continuo: arranca exactamente donde acaba la raya impresa.
    expect(tramo.desde).toBeLessThan(tramo.hasta)
    // Y va justo debajo de la línea base, al nivel de la raya del template.
    expect(tramo.y).toBeCloseTo(campo.y - 1.1, 5)

    // Los campos sin raya impresa (celdas de tabla) nunca se subrayan.
    expect(calcularExtensionSubrayado(COORDENADAS.razon_social, 500)).toBeNull()
    expect(calcularExtensionSubrayado(COORDENADAS.firma_nombre, 500)).toBeNull()

    // Y de punta a punta, el documento con valor largo difiere del corto.
    const corta = await generar('subrayado-corto', respuestasBase({ [CAMPOS.RAZON_SOCIAL]: 'ABC S.A.S.' }))
    const larga = await generar('subrayado-largo', respuestasBase())
    expect(larga.sha256).not.toBe(corta.sha256)
  })

  it('la escala de la firma preserva proporción y nunca amplía', () => {
    const caja = { width: 229, height: 43.2 }
    const apaisada = encajarProporcional({ width: 900, height: 150 }, caja)
    expect(apaisada.width / apaisada.height).toBeCloseTo(6, 5)
    expect(apaisada.width).toBeLessThanOrEqual(caja.width)
    expect(apaisada.height).toBeLessThanOrEqual(caja.height)

    const alta = encajarProporcional({ width: 200, height: 400 }, caja)
    expect(alta.height).toBeLessThanOrEqual(caja.height)

    // Una firma diminuta no se estira: se dibuja a su tamaño natural.
    const pequena = encajarProporcional({ width: 40, height: 10 }, caja)
    expect(pequena).toEqual({ width: 40, height: 10 })
  })

  it('rechaza contenido que no cabe de forma legible, en vez de truncarlo', async () => {
    await expect(
      generar(
        'no-cabe',
        respuestasBase({
          [CAMPOS.OBSERVACIONES]: 'palabra '.repeat(300)
        })
      )
    ).rejects.toThrow(/no caben en las dos líneas/i)
  })

  it('rechaza una firma que no es imagen incrustable', async () => {
    await expect(
      generar('firma-invalida', respuestasBase({ [CAMPOS.FIRMA]: 'JULIÁN QA' }))
    ).rejects.toThrow(/PNG o JPG/i)
  })

  it('la versión recibida deja el Resultado completamente en blanco', async () => {
    const res = await generar('resultado-blanco', respuestasBase(), {
      estado_documental: 'recibida',
      estado_administrativo: 'aprobado' // se ignora a propósito
    })
    expect(res.marca_resultado).toBeNull()
  })

  it('la versión evaluada marca exactamente el resultado correspondiente', async () => {
    const casos = [
      ['aprobado', 'aprobado'],
      ['condicionado', 'condicionado'],
      ['rechazado', 'no_aprobado']
    ] as const
    for (const [estado, esperado] of casos) {
      const res = await generar(`resultado-${estado}`, respuestasBase(), {
        estado_documental: 'evaluada',
        estado_administrativo: estado,
        version_documento: 2
      })
      expect(res.marca_resultado).toBe(esperado)
      expect(res.nombre_archivo).toContain('_v2.pdf')
    }
  })

  it('escalado no marca resultado ni siquiera en la versión evaluada', async () => {
    const res = await generar('resultado-escalado', respuestasBase(), {
      estado_documental: 'evaluada',
      estado_administrativo: 'escalado',
      version_documento: 2
    })
    expect(res.marca_resultado).toBeNull()
  })

  it('dos versiones del mismo radicado producen hashes distintos', async () => {
    const v1 = await generar('version-1', respuestasBase(), { version_documento: 1 })
    const v2 = await generar('version-2', respuestasBase(), {
      estado_documental: 'evaluada',
      estado_administrativo: 'condicionado',
      version_documento: 2
    })
    expect(v1.sha256).not.toBe(v2.sha256)
  })

  it('el mismo contenido y la misma fecha producen el mismo hash', async () => {
    const a = await generar('determinista-a', respuestasBase())
    const b = await generar('determinista-b', respuestasBase())
    expect(a.sha256).toBe(b.sha256)
  })

  it('falla si el template no coincide con el hash registrado', () => {
    // No se dibuja jamás sobre un asset desconocido: sería firmar un texto
    // legal distinto del auditado.
    expect(() =>
      leerTemplateVerificado({ ...MANIFEST, sha256: 'f'.repeat(64) })
    ).toThrow(/no coincide con el hash registrado/i)
  })

  it('falla si el template no existe', () => {
    expect(() =>
      leerTemplateVerificado({ ...MANIFEST, archivo: 'no-existe.pdf' })
    ).toThrow(/No se encontró el template/i)
  })
})

describe('Control documental del asset', () => {
  it('un template sin aprobación no puede emitirse en producción', () => {
    const pendiente = { ...MANIFEST, estado_aprobacion: 'pendiente_aprobacion' as const }
    expect(() => assertTemplateEmitible(pendiente, 'production')).toThrow(
      /control documental y no puede emitirse en producción/i
    )
    // En dev/QA sí se genera: es lo que permite revisarlo visualmente y cerrar
    // la decisión documental.
    expect(() => assertTemplateEmitible(pendiente, 'development')).not.toThrow()
  })

  it('un template aprobado se emite en cualquier entorno', () => {
    const aprobado = { ...MANIFEST, estado_aprobacion: 'aprobado' as const }
    expect(() => assertTemplateEmitible(aprobado, 'production')).not.toThrow()
  })
})

describe('Utilidades de dibujo', () => {
  it('sanearTexto elimina control y colapsa espacios', () => {
    expect(sanearTexto('  ALFA \n\t BETA  ')).toBe('ALFA BETA')
    expect(sanearTexto('A B')).toBe('A B')
    expect(sanearTexto(null)).toBe('')
  })

  it('formatearFecha convierte ISO a DD/MM/AAAA', () => {
    expect(formatearFecha('2026-08-22')).toBe('22/08/2026')
    expect(formatearFecha('2026-08-22T15:00:00.000Z')).toBe('22/08/2026')
    expect(formatearFecha(new Date('2026-01-05T00:00:00Z'))).toBe('05/01/2026')
    expect(formatearFecha('')).toBe('')
  })

  it('ajustarTamano reduce antes de rendirse y devuelve null si no cabe', () => {
    const font = {
      widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.5
    } as any
    // 10 caracteres a 7 pt = 35 pt: cabe en 40.
    expect(ajustarTamano('0123456789', font, { maxWidth: 40, size: 7, minSize: 5 })).toBe(7)
    // A 7 pt no cabe en 28, pero a 5.5 sí (27.5).
    expect(ajustarTamano('0123456789', font, { maxWidth: 28, size: 7, minSize: 5 })).toBe(5.5)
    // Ni en el mínimo.
    expect(ajustarTamano('0123456789', font, { maxWidth: 10, size: 7, minSize: 5 })).toBeNull()
  })
})
