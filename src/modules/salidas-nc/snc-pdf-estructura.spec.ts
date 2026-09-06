/**
 * El registro de Salida No Conforme sigue diciendo lo que decía.
 *
 * El documento pasó de dibujarse con PDFKit a maquetarse en HTML. Eso es un
 * cambio de MOTOR, no de contenido: es un registro controlado por ISO
 * 9001:2015 cláusula 8.7, y sus secciones, su numeración, sus referencias
 * normativas y sus etiquetas de campo forman parte del formato aprobado.
 *
 * Este test no compara píxeles —eso exigiría levantar Chromium y comparar
 * imágenes—, sino lo que de verdad rompería el registro sin que nadie lo
 * note: que se pierda una sección, que se caiga una referencia normativa,
 * que la concesión deje de renumerar la verificación, o que el texto que un
 * usuario escribe acabe interpretado como HTML dentro del documento.
 */

import { describe, it, expect } from 'vitest';
import { renderSalidaNCPdf, type SalidaNCPdf } from './snc-pdf.template';

/** Una SNC mínima, sin concesión y sin campos opcionales. */
const BASE: SalidaNCPdf = {
  numero_snc: 7,
  fecha_deteccion: '2026-03-04T00:00:00.000Z',
  fecha_evento: '2026-03-03T00:00:00.000Z',
  detectado_por: 'Coordinador de operaciones',
  area_proceso: 'Operaciones',
  tipo_deteccion: 'DURANTE_SERVICIO',
  descripcion_nc: 'El vehículo no cumplió la ruta pactada.',
  clasificacion_nc: 'MAYOR',
  tipo_salida_nc: 'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO',
  estado: 'ABIERTA'
};

const con = (extra: Partial<SalidaNCPdf>): string => renderSalidaNCPdf({ ...BASE, ...extra });

/** Títulos de sección en el orden en que salen del documento. */
function secciones(html: string): Array<{ num: string; titulo: string; iso: string | null }> {
  return [...html.matchAll(/<span class="seccion-num">([^<]*)<\/span>\s*<h2>([^<]*)<\/h2>\s*(?:<span class="seccion-iso">([^<]*)<\/span>)?/g)].map(
    (m) => ({ num: m[1], titulo: m[2], iso: m[3] ?? null })
  );
}

describe('secciones del registro', () => {
  it('sin concesión hay cuatro secciones y la verificación es la 4', () => {
    const s = secciones(con({}));
    expect(s.map((x) => x.num)).toEqual(['1', '2', '3', '4']);
    expect(s[3].titulo).toMatch(/Verificación de conformidad/i);
  });

  it('con concesión aparece la 4 y la verificación pasa a ser la 5', () => {
    // La renumeración es la parte frágil: el número de la verificación
    // depende de si la concesión aplica, y estaba escrito en dos sitios.
    const s = secciones(con({ concesion_solicitada: true }));
    expect(s.map((x) => x.num)).toEqual(['1', '2', '3', '4', '5']);
    expect(s[3].titulo).toMatch(/Concesión formal del cliente/i);
    expect(s[4].titulo).toMatch(/Verificación de conformidad/i);
  });

  it('el tratamiento CONCESION también dispara la sección, aunque no se marque la casilla', () => {
    const s = secciones(con({ tratamiento_seleccionado: 'CONCESION' }));
    expect(s).toHaveLength(5);
  });

  it('las referencias normativas son las del formato aprobado', () => {
    const s = secciones(con({ concesion_solicitada: true }));
    expect(s.map((x) => x.iso)).toEqual([
      null,
      'ISO 8.7.2 a',
      'ISO 8.7.1 a-d / 8.7.2 b-c',
      'ISO 8.7.1 d / 8.7.2 c',
      'ISO 8.7.1 párrafo final'
    ]);
  });

  it('el pie cita la cláusula que da origen al registro', () => {
    expect(con({})).toContain(
      'Registro de Salida No Conforme según ISO 9001:2015 — Cláusula 8.7 Control de las Salidas No Conformes'
    );
  });
});

describe('campos del formato', () => {
  const ETIQUETAS = [
    'FECHA DETECCIÓN',
    'FECHA DEL EVENTO',
    'DETECTADO POR',
    'ÁREA / PROCESO',
    'TIPO DE DETECCIÓN',
    'CLASIFICACIÓN NC',
    'CONDUCTOR',
    'CÉDULA CONDUCTOR',
    'PLACA VEHÍCULO',
    'RUTA / TRAYECTO',
    'TURNO / HORARIO',
    'CLIENTE / CONTRATO',
    'SERVICIO AFECTADO',
    'TIPO DE SALIDA NO CONFORME',
    'DESCRIPCIÓN DETALLADA DE LA NO CONFORMIDAD',
    'TRATAMIENTO SELECCIONADO',
    'AUTORIDAD QUE DECIDIÓ',
    'DESCRIPCIÓN DE LA ACCIÓN TOMADA',
    'RESPONSABLE DE LA ACCIÓN',
    'FECHA DE IMPLEMENTACIÓN',
    'MÉTODO DE VERIFICACIÓN',
    '¿CUMPLE REQUISITOS?',
    'RESULTADO DE LA VERIFICACIÓN',
    'RESPONSABLE VERIFICACIÓN',
    'FECHA VERIFICACIÓN',
    'FIRMA VERIFICADOR'
  ];

  it.each(ETIQUETAS)('el registro conserva el campo «%s»', (etiqueta) => {
    expect(con({})).toContain(etiqueta);
  });

  it('los campos de la concesión aparecen cuando aplica', () => {
    const html = con({ concesion_solicitada: true });
    for (const e of [
      '¿SE SOLICITÓ CONCESIÓN?',
      'REPRESENTANTE CLIENTE',
      'FECHA AUTORIZACIÓN',
      'MEDIO DE AUTORIZACIÓN',
      'CONDICIONES DE LA CONCESIÓN'
    ]) {
      expect(html).toContain(e);
    }
  });

  it('«OBSERVACIONES» solo sale si hay observaciones', () => {
    expect(con({})).not.toContain('OBSERVACIONES');
    expect(con({ observaciones: 'Se reportó al cliente.' })).toContain('OBSERVACIONES');
  });
});

describe('valores', () => {
  it('lo vacío y lo nulo se leen «N/A», como en el formato anterior', () => {
    const html = con({ conductor_nombre: null, ruta_trayecto: '' });
    expect(html).toContain('N/A');
  });

  it('«otro» sustituye a la etiqueta del catálogo', () => {
    const html = con({ tipo_deteccion: 'OTRO', tipo_deteccion_otro: 'Aviso de un tercero' });
    expect(html).toContain('Otro: Aviso de un tercero');
  });

  it('cumple/no cumple lleva su desenlace escrito', () => {
    expect(con({ cumple_requisitos: true })).toContain('SÍ — Cierre de la SNC');
    expect(con({ cumple_requisitos: false })).toContain('NO — Escalar AC');
  });

  it('el consecutivo va a cuatro dígitos', () => {
    expect(con({ numero_snc: 7 })).toContain('SNC-0007');
    expect(con({ numero_snc: 1234 })).toContain('SNC-1234');
  });
});

describe('fechas', () => {
	it('una fecha `@db.Date` se imprime en su propio día, no en el anterior', () => {
		// Prisma devuelve las columnas `@db.Date` a medianoche UTC. Con el
		// servidor en America/Bogota (UTC-5) y sin fijar la zona, el documento
		// imprimía siempre el día de antes: una SNC detectada el 4 sale como 3.
		// El generador PDFKit anterior tenía este fallo.
		const html = renderSalidaNCPdf({
			...BASE,
			fecha_deteccion: new Date('2026-03-04T00:00:00.000Z'),
			fecha_evento: new Date('2026-01-01T00:00:00.000Z')
		});
		expect(html).toContain('04/03/2026');
		expect(html).toContain('01/01/2026');
		expect(html).not.toContain('03/03/2026');
		// El 1 de enero es el caso que además se lleva el año por delante.
		expect(html).not.toContain('31/12/2025');
	});

	it('una fecha ausente sigue siendo «N/A»', () => {
		expect(renderSalidaNCPdf({ ...BASE, fecha_verificacion: null })).toContain('N/A');
	});
});

describe('el texto del usuario no puede romper el documento', () => {
  it('se escapa lo que escribe una persona', () => {
    // `descripcion_nc` y `observaciones` los teclea un usuario. Sin escapar,
    // un `<` parte la maquetación y una etiqueta pegada desde un correo se
    // ejecutaría dentro del Chromium que genera el PDF.
    const html = con({
      descripcion_nc: '<script>alert(1)</script> ruta < 5 km',
      observaciones: 'Se avisó a "Transportes & Cía"'
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Transportes &amp; Cía');
  });
});
