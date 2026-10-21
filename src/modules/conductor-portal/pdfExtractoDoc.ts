/**
 * Maquetación del extracto de contrato (FUEC, formato OP-FR-04) para pdfmake:
 * la página 1 es el formato y la 2 el texto de la Resolución 6652/2019 que
 * iba impreso por detrás, igual que en el libro de Excel.
 *
 * ESPEJO EXACTO. Este archivo existe, byte a byte, en el front
 * (`src/lib/utils/pdfExtractoDoc.ts`) y en su backend gemelo
 * (`src/modules/conductor-portal/pdfExtractoDoc.ts`): el dashboard arma el PDF
 * en el navegador y la app del conductor lo pide al servidor, y los dos tienen
 * que entregar el MISMO documento —es el que la policía compara con la página
 * del QR—. No se puede importar de un repo al otro (son builds y despliegues
 * distintos), así que `pdfExtractoDoc.spec.ts` del backend lee este archivo
 * del disco y falla si las dos copias no son idénticas. Se edita aquí, se
 * formatea con el Prettier del front y se copia tal cual al backend.
 *
 * Por eso no importa nada: ni `$lib`, ni pdfmake, ni la librería del QR.
 * Cargar imágenes y fuentes depende del entorno (canvas en el navegador,
 * disco en el servidor) y lo resuelve quien llama; aquí solo se describe la
 * hoja. Se arma SOLO con el `snapshot` que firmó el servidor: lo que se
 * imprime es lo que se validará en la página pública del QR. Las cédulas y el
 * NIT van con puntos y las fechas en DD/MM/AAAA, como en el formato original.
 */

/** Lo que firmó el servidor: exactamente lo que se imprime. */
export interface SnapshotDocExtracto {
	numero: string;
	consecutivo: number;
	empresa: { razon_social: string; nit: string };
	contrato_numero: string;
	contratante: { nombre: string; nit: string | null };
	objeto_contrato: string;
	origen_destino: string;
	convenio: string;
	vigencia_desde: string;
	vigencia_hasta: string;
	vehiculo: {
		placa: string;
		modelo: string | null;
		marca: string | null;
		clase: string | null;
		numero_interno: string | null;
		tarjeta_operacion: string | null;
	};
	conductores: Array<{ nombre: string; cedula: string | null; licencia_vigencia: string | null }>;
	responsable: {
		nombre: string | null;
		cedula: string | null;
		telefono: string | null;
		direccion: string | null;
	};
}

/** Datos fijos de la empresa que imprime (los de `fuec.config.ts` del backend). */
export interface EmpresaDocExtracto {
	razon_social: string;
	codigo_formato: string;
	version: string;
	fecha_formato: string;
	direccion: string;
	email: string;
	telefono: string;
	firmante_cargo: string;
}

export interface OpcionesDocExtracto {
	empresa: EmpresaDocExtracto;
	codigo_verificacion: string | null;
	huella: string | null;
	/** A donde lleva el QR: `<origen del front>/public/extracto/<código>`. */
	url_publica: string | null;
	/** «Copia» en los importados del libro, sin firma del sistema. */
	marca?: string | null;
}

/** Imágenes ya convertidas a data URL (PNG o JPEG: pdfmake no lee webp). */
export interface ImagenesDocExtracto {
	logo: string | null;
	firma: string | null;
	mintransporte: string | null;
	supertransporte: string | null;
	qr: string | null;
}

const NARANJA_CLARO = '#FFE0B2';
const NEGRO = '#111111';
const GRIS = '#555555';

/** «901528440-3» → «901.528.440-3». Lo que no es número se deja tal cual. */
function conPuntos(v: string | null | undefined): string {
	if (!v) return '';
	const [cuerpo, dv] = v.replace(/\./g, '').split('-');
	if (!/^\d+$/.test(cuerpo)) return v;
	return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dv ? `-${dv}` : '');
}

/** YYYY-MM-DD → DD/MM/YYYY */
function fechaFormato(ymd: string | null | undefined): string {
	if (!ymd) return '';
	const [a, m, d] = ymd.slice(0, 10).split('-');
	return a && m && d ? `${d}/${m}/${a}` : ymd;
}

const X = (texto: string | null | undefined, fallback = 'XXXX') =>
	texto && texto.trim() ? texto : fallback;

function celda(text: unknown, extra: Record<string, unknown> = {}) {
	return { text: text ?? '', fontSize: 7.5, alignment: 'center', margin: [2, 3, 2, 3], ...extra };
}
function titulo(text: string, extra: Record<string, unknown> = {}) {
	return celda(text, { fillColor: NARANJA_CLARO, bold: true, ...extra });
}
function etiqueta(text: string, extra: Record<string, unknown> = {}) {
	return celda(text, { fillColor: NARANJA_CLARO, bold: true, alignment: 'left', ...extra });
}
const vacia = () => ({ text: '' });

function filaConductor(
	n: number,
	c?: { nombre: string; cedula: string | null; licencia_vigencia: string | null }
) {
	const ced = c?.cedula ? conPuntos(c.cedula) : 'XXXX';
	return [
		[
			etiqueta(`DATOS DEL\nCONDUCTOR ${n}`, { rowSpan: 2, margin: [2, 6, 2, 3] }),
			titulo('NOMBRES Y APELLIDOS', { colSpan: 2 }),
			vacia(),
			titulo('No. CÉDULA'),
			titulo('LICENCIA\nCONDUCCIÓN'),
			titulo('VIGENCIA')
		],
		[
			vacia(),
			celda(c ? c.nombre : '##########', { colSpan: 2 }),
			vacia(),
			celda(ced),
			celda(ced),
			celda(c?.licencia_vigencia ? fechaFormato(c.licencia_vigencia) : 'XXXX')
		]
	];
}

function dia(ymd: string) {
	const [a, m, d] = ymd.split('-');
	return { d: String(Number(d)), m: String(Number(m)), a };
}

export function docExtracto(
	s: SnapshotDocExtracto,
	o: OpcionesDocExtracto,
	imagenes: ImagenesDocExtracto
) {
	const e = o.empresa;
	const desde = dia(s.vigencia_desde);
	const hasta = dia(s.vigencia_hasta);
	const images: Record<string, string> = {};
	if (imagenes.logo) images.logo = imagenes.logo;
	if (imagenes.firma) images.firma = imagenes.firma;
	if (imagenes.mintransporte) images.mintransporte = imagenes.mintransporte;
	if (imagenes.supertransporte) images.supertransporte = imagenes.supertransporte;
	if (imagenes.qr) images.qr = imagenes.qr;

	const conductores = [0, 1, 2].flatMap((i) => filaConductor(i + 1, s.conductores[i]));
	const r = s.responsable;
	const urlPublica = o.codigo_verificacion ? o.url_publica : null;

	const cuerpo: unknown[][] = [
		[
			{
				colSpan: 3,
				margin: [4, 4, 4, 2],
				stack: [
					imagenes.mintransporte
						? { image: 'mintransporte', fit: [260, 54] }
						: { text: 'Mintransporte', bold: true },
					{ text: `Código: ${e.codigo_formato}`, fontSize: 6.5, color: GRIS, margin: [0, 2, 0, 0] }
				]
			},
			vacia(),
			vacia(),
			{
				colSpan: 3,
				margin: [4, 4, 4, 2],
				stack: [
					imagenes.logo
						? { image: 'logo', fit: [160, 48], alignment: 'center' }
						: { text: e.razon_social, bold: true, alignment: 'right' },
					{
						columns: [
							{ text: `Versión: ${e.version}`, fontSize: 6.5, color: GRIS },
							{ text: `Fecha: ${e.fecha_formato}`, fontSize: 6.5, color: GRIS, alignment: 'right' }
						],
						margin: [0, 2, 0, 0]
					}
				]
			},
			vacia(),
			vacia()
		],
		[
			celda(
				'FORMATO ÚNICO DE EXTRACTO DEL CONTRATO DEL SERVICIO PÚBLICO DE TRANSPORTE TERRESTRE AUTOMOTOR ESPECIAL',
				{ colSpan: 6, bold: true, fontSize: 8 }
			),
			vacia(),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			celda(`No. ${s.numero}`, { colSpan: 6, bold: true, fontSize: 9 }),
			vacia(),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			celda(
				{ text: [{ text: `${s.empresa.razon_social}\n`, bold: true }, `NIT: ${s.empresa.nit}`] },
				{ colSpan: 6, fontSize: 8 }
			),
			vacia(),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			etiqueta('CONTRATO No.'),
			celda(s.contrato_numero, { colSpan: 5, bold: true }),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			etiqueta('CONTRATANTE:'),
			celda(s.contratante.nombre, { colSpan: 3, bold: true }),
			vacia(),
			vacia(),
			etiqueta('NIT:', { alignment: 'center' }),
			celda(conPuntos(s.contratante.nit))
		],
		[titulo('OBJETO DEL CONTRATO:', { colSpan: 6 }), vacia(), vacia(), vacia(), vacia(), vacia()],
		[
			celda(s.objeto_contrato, { colSpan: 6, margin: [6, 5, 6, 5] }),
			vacia(),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			etiqueta('ORIGEN - DESTINO'),
			celda(s.origen_destino, { colSpan: 5 }),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			etiqueta('CONVENIO COLABORACION EMPRESARIAL', { colSpan: 3, alignment: 'center' }),
			vacia(),
			vacia(),
			celda(X(s.convenio, 'N/A'), { colSpan: 3 }),
			vacia(),
			vacia()
		],
		[titulo('VIGENCIA DEL CONTRATO', { colSpan: 6 }), vacia(), vacia(), vacia(), vacia(), vacia()],
		[
			etiqueta('FECHA INICIAL', { colSpan: 3, rowSpan: 2, margin: [2, 8, 2, 3] }),
			vacia(),
			vacia(),
			titulo('DIA'),
			titulo('MES'),
			titulo('AÑO')
		],
		[vacia(), vacia(), vacia(), celda(desde.d), celda(desde.m), celda(desde.a)],
		[
			etiqueta('FECHA VENCIMIENTO', { colSpan: 3, rowSpan: 2, margin: [2, 8, 2, 3] }),
			vacia(),
			vacia(),
			titulo('DIA'),
			titulo('MES'),
			titulo('AÑO')
		],
		[vacia(), vacia(), vacia(), celda(hasta.d), celda(hasta.m), celda(hasta.a)],
		[
			titulo('CARACTERÍSTICAS DEL VEHÍCULO', { colSpan: 6 }),
			vacia(),
			vacia(),
			vacia(),
			vacia(),
			vacia()
		],
		[
			titulo('PLACA'),
			titulo('MODELO'),
			titulo('MARCA', { colSpan: 2 }),
			vacia(),
			titulo('CLASE', { colSpan: 2 }),
			vacia()
		],
		[
			celda(s.vehiculo.placa, { bold: true }),
			celda(X(s.vehiculo.modelo)),
			celda(X(s.vehiculo.marca), { colSpan: 2 }),
			vacia(),
			celda(X(s.vehiculo.clase), { colSpan: 2 }),
			vacia()
		],
		[
			titulo('NÚMERO INTERNO:', { colSpan: 3 }),
			vacia(),
			vacia(),
			titulo('No. TARJETA DE OPERACIÓN:', { colSpan: 3 }),
			vacia(),
			vacia()
		],
		[
			celda(X(s.vehiculo.numero_interno), { colSpan: 3 }),
			vacia(),
			vacia(),
			celda(X(s.vehiculo.tarjeta_operacion), { colSpan: 3 }),
			vacia(),
			vacia()
		],
		...conductores,
		[
			etiqueta('RESPONSABLE DEL\nCONTRATANTE', { rowSpan: 2, margin: [2, 6, 2, 3] }),
			titulo('NOMBRES Y APELLIDOS', { colSpan: 2 }),
			vacia(),
			titulo('No. CÉDULA'),
			titulo('TELEFONO'),
			titulo('DIRECCIÓN')
		],
		[
			vacia(),
			celda(X(r.nombre, ''), { colSpan: 2 }),
			vacia(),
			celda(conPuntos(r.cedula)),
			celda(X(r.telefono, '')),
			celda(X(r.direccion, ''))
		],
		[
			{
				colSpan: 3,
				margin: [4, 6, 4, 4],
				stack: [
					imagenes.supertransporte
						? { image: 'supertransporte', fit: [110, 36], alignment: 'center' }
						: { text: '' },
					{ text: e.direccion, fontSize: 7, bold: true, alignment: 'center', margin: [0, 3, 0, 0] },
					{ text: e.email, fontSize: 7, bold: true, alignment: 'center' },
					{ text: e.telefono, fontSize: 7, bold: true, alignment: 'center' }
				]
			},
			vacia(),
			vacia(),
			{
				margin: [2, 4, 2, 4],
				stack: imagenes.qr
					? [
							{ image: 'qr', fit: [62, 62], alignment: 'center' },
							{
								text: o.codigo_verificacion ?? '',
								fontSize: 6.5,
								bold: true,
								alignment: 'center',
								margin: [0, 1, 0, 0]
							}
						]
					: [
							{
								text: o.marca ?? '',
								fontSize: 6.5,
								color: GRIS,
								alignment: 'center',
								margin: [0, 20, 0, 0]
							}
						]
			},
			{
				colSpan: 2,
				margin: [4, 4, 4, 4],
				stack: [
					imagenes.firma
						? { image: 'firma', fit: [150, 52], alignment: 'center' }
						: { text: '\n\n' },
					{
						text: e.firmante_cargo,
						fontSize: 7.5,
						bold: true,
						alignment: 'center',
						margin: [0, 2, 0, 0]
					}
				]
			},
			vacia()
		]
	];

	const pie = urlPublica
		? {
				text: [
					{ text: 'Documento firmado electrónicamente. ', bold: true },
					`Valide su autenticidad escaneando el QR o en ${urlPublica}`,
					o.huella ? ` · Huella ${o.huella}` : ''
				],
				fontSize: 6.5,
				color: GRIS,
				alignment: 'center',
				margin: [0, 6, 0, 0]
			}
		: {
				text: o.marca ?? '',
				fontSize: 6.5,
				color: GRIS,
				alignment: 'center',
				margin: [0, 6, 0, 0]
			};

	return {
		pageSize: 'LETTER',
		pageMargins: [34, 28, 34, 28],
		defaultStyle: { font: 'Roboto', fontSize: 7.5, color: NEGRO },
		info: { title: `FUEC ${s.numero}`, subject: 'Extracto de contrato' },
		images,
		content: [
			{
				table: { widths: [86, 84, '*', 78, 78, 82], body: cuerpo },
				layout: {
					hLineWidth: () => 0.6,
					vLineWidth: () => 0.6,
					hLineColor: () => NEGRO,
					vLineColor: () => NEGRO,
					paddingLeft: () => 1,
					paddingRight: () => 1,
					paddingTop: () => 0,
					paddingBottom: () => 0
				}
			},
			pie,
			{ text: '', pageBreak: 'after' },
			...paginaResolucion()
		]
	};
}

/** Página 2: el texto de la Resolución 6652/2019 que va impreso por detrás. */
function paginaResolucion() {
	const p = (text: unknown, extra: Record<string, unknown> = {}) => ({
		text,
		fontSize: 8.5,
		alignment: 'justify',
		margin: [0, 0, 0, 5],
		...extra
	});
	const territoriales = [
		['Antioquia-Chocó', '305', 'Huila-Caquetá', '441'],
		['Atlántico', '208', 'Magdalena', '247'],
		['Bolívar-San Andrés y Providencia', '213', 'Meta-Vaupés-Vichada', '550'],
		['Boyacá-Casanare', '415', 'Nariño-Putumayo', '352'],
		['Caldas', '317', 'N/Santander-Arauca', '454'],
		['Cauca', '319', 'Quindío', '363'],
		['Cesar', '220', 'Risaralda', '366'],
		['Córdoba-Sucre', '223', 'Santander', '468'],
		['Cundinamarca', '425', 'Tolima', '473'],
		['Guajira', '241', 'Valle del Cauca', '376']
	];
	return [
		{
			text: 'RESOLUCION FUEC 6652 MINISTERIO DE TRANSPORTE',
			bold: true,
			fontSize: 13,
			alignment: 'center',
			margin: [0, 30, 0, 0]
		},
		{ text: '27/12/2019', bold: true, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 12] },
		p([
			{ text: 'Artículo 3. ', bold: true },
			'Contenido del Formato Único de Extracto del Contrato (FUEC). El Formato Único de Extracto del Contrato (FUEC) contendrá los siguientes datos, conforme a lo señalado en la ficha anexa a la presente resolución.'
		]),
		{
			ol: [
				'Número del FUEC.',
				'Razón Social de la Empresa.',
				'Número del Contrato.',
				'Contratante.',
				'Objeto del contrato.',
				'Origen-destino',
				'Convenio de Colaboración Empresarial, en caso de que aplique.',
				'Duración del contrato, indicando su fecha de iniciación y terminación.',
				'Características del vehículo (placa, modelo, marca, clase y número interno del vehículo).',
				'Número de Tarjeta de Operación.',
				'Identificación de los conductores.'
			],
			fontSize: 8.5,
			margin: [0, 0, 0, 6]
		},
		p([
			{ text: 'Artículo 4. ', bold: true },
			'Conformación del número consecutivo del FUEC. La identificación del Formato Único de Extracto del Contrato “FUEC” estará constituida por los siguientes números:'
		]),
		p(
			'a) Los tres primeros dígitos de izquierda a derecha corresponderán al código de la Dirección Territorial que otorgó la habilitación de la empresa de Servicio Público de Transporte Terrestre Automotor Especial.'
		),
		{
			table: {
				widths: ['*', 36, '*', 36],
				body: territoriales.map((f) =>
					f.map((t, i) => ({
						text: t,
						fontSize: 8,
						margin: [3, 1, 3, 1],
						alignment: i % 2 ? 'center' : 'left'
					}))
				)
			},
			layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
			margin: [40, 2, 40, 8]
		},
		p(
			'b) Los cuatro dígitos siguientes señalarán el número de resolución mediante la cual se otorgó la habilitación de la Empresa. En caso de que la resolución no tenga estos dígitos, los faltantes serán completados con ceros a la izquierda;'
		),
		p(
			'c) Los dos siguientes dígitos corresponderán a los dos últimos del año en que la empresa fue habilitada;'
		),
		p(
			'd) A continuación, cuatro dígitos que corresponderán al año en el que se expide el extracto del contrato;'
		),
		p(
			'e) Posteriormente, cuatro dígitos que identifican el número del contrato. La numeración debe ser consecutiva, establecida por cada empresa e iniciará con los contratos de prestación del servicio celebrados para el transporte de estudiantes, asalariados, turistas o grupo de usuarios, vigentes al momento de entrar en vigencia la presente resolución;'
		),
		p(
			'f) Finalmente, los cuatro últimos dígitos corresponderán al número consecutivo del extracto de contrato. Se debe expedir un nuevo extracto por vencimiento del plazo inicial del mismo o por cambio del vehículo.'
		),
		p(
			[
				{ text: 'Artículo 9. Parágrafo 1. ', bold: true },
				'Para el caso de contratos celebrados con empresas de servicios públicos domiciliarios, entidades públicas, empresas o entidades pertenecientes al sistema de salud, en los que indique que se requiere la disposición total del vehículo para atender los requerimientos del contratante, en la jurisdicción de un mismo municipio, distrito o área metropolitana o municipios en un mismo departamento, debe especificarse tal condición en el contrato y en el FUEC señalando las zonas y municipios, en los que se prestará el servicio según el caso.'
			],
			{ margin: [0, 6, 0, 0] }
		)
	];
}

/** Opciones del QR: las mismas en el navegador y en el servidor, para que el dibujo coincida. */
export const OPCIONES_QR_EXTRACTO = { margin: 0, width: 240, errorCorrectionLevel: 'M' } as const;

export function nombreArchivoExtracto(
	s: Pick<SnapshotDocExtracto, 'consecutivo' | 'vigencia_desde'> & {
		vehiculo: { placa: string };
	}
): string {
	return `FUEC-${s.consecutivo}-${s.vehiculo.placa}-${s.vigencia_desde}.pdf`;
}
