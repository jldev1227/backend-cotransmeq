/**
 * La maquetación del FUEC es UNA sola, copiada en dos repos.
 *
 * El dashboard arma el PDF del extracto en el navegador y la app del conductor
 * lo recibe de este backend. Si las dos copias de `pdfExtractoDoc.ts`
 * divergen no se rompe nada a la vista: simplemente el conductor porta una
 * hoja distinta de la que operaciones descargó, y nadie lo nota hasta que un
 * agente de tránsito las compara. Por eso se exige igualdad byte a byte con
 * el archivo del front, leído del disco (no se puede importar: es otro build).
 *
 * También se genera un PDF de verdad con un snapshot fijo: la copia del
 * backend no la ejercita ningún navegador, y un `require` mal resuelto de
 * pdfmake o una imagen que falta solo se verían en producción.
 */
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { generarPdfExtracto } from './extracto-pdf'
import { docExtracto, type SnapshotDocExtracto } from './pdfExtractoDoc'
import { FUEC } from '../extractos/fuec.config'

const PROPIO = resolve(__dirname, 'pdfExtractoDoc.ts')
const ESPEJO = resolve(__dirname, '../../../../cotransmeq-app/src/lib/utils/pdfExtractoDoc.ts')

const SNAPSHOT: SnapshotDocExtracto = {
  numero: '415464522202600030001',
  consecutivo: 1,
  empresa: { razon_social: FUEC.razon_social, nit: FUEC.nit },
  contrato_numero: '0003',
  contratante: { nombre: 'CONTRATANTE DE PRUEBA', nit: '900123456-7' },
  objeto_contrato: 'CONTRATO PARA TRANSPORTE DE PERSONAL Y HERRAMIENTAS',
  origen_destino: 'YOPAL - TAURAMENA (VICEVERSA)',
  convenio: 'N/A',
  vigencia_desde: '2026-10-01',
  vigencia_hasta: '2026-10-31',
  vehiculo: { placa: 'ZZZ999', modelo: '2025', marca: 'TOYOTA', clase: 'CAMIONETA', numero_interno: '0101', tarjeta_operacion: '123456' },
  conductores: [{ nombre: 'CONDUCTOR DE PRUEBA', cedula: '1234567890', licencia_vigencia: '2028-01-01' }],
  responsable: { nombre: null, cedula: null, telefono: null, direccion: null }
}

const URL_PUBLICA = 'https://app.ejemplo.test/public/extracto/ABCDEFGH2345'

describe('pdfExtractoDoc', () => {
  const hay = existsSync(ESPEJO)
  const test = hay ? it : it.skip

  test('es idéntico al del front', () => {
    expect(readFileSync(PROPIO, 'utf8')).toBe(readFileSync(ESPEJO, 'utf8'))
  })

  it('pone el QR y la URL pública solo si el extracto está firmado', () => {
    const firmado = JSON.stringify(
      docExtracto(SNAPSHOT, { empresa: FUEC, codigo_verificacion: 'ABCDEFGH2345', huella: 'AAAA-BBBB', url_publica: URL_PUBLICA }, {
        logo: null,
        firma: null,
        mintransporte: null,
        supertransporte: null,
        qr: 'data:image/png;base64,AAAA'
      })
    )
    expect(firmado).toContain('"image":"qr"')
    expect(firmado).toContain(URL_PUBLICA)

    const copia = JSON.stringify(
      docExtracto(SNAPSHOT, { empresa: FUEC, codigo_verificacion: null, huella: null, url_publica: null, marca: 'Copia del libro' }, {
        logo: null,
        firma: null,
        mintransporte: null,
        supertransporte: null,
        qr: null
      })
    )
    expect(copia).not.toContain('"image":"qr"')
    expect(copia).toContain('Copia del libro')
  })

  it('genera un PDF de dos páginas con las imágenes del formato', async () => {
    const pdf = await generarPdfExtracto(SNAPSHOT, {
      empresa: FUEC,
      codigo_verificacion: 'ABCDEFGH2345',
      huella: 'AAAA-BBBB',
      url_publica: URL_PUBLICA
    })
    const texto = pdf.toString('latin1')
    expect(texto.startsWith('%PDF-')).toBe(true)
    expect(texto).toMatch(/\/Count 2\b/)
    /// Logo, firma, dos sellos y el QR: cinco imágenes. Si falta un archivo
    /// de `src/assets/fuec/` el PDF sale igual pero con menos.
    expect(texto.match(/\/Subtype \/Image/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })
})
