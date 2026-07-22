import * as path from 'path';
import * as fs from 'fs/promises';
import { getS3ObjectAsBase64 } from '../../config/aws'; // Reusing existing S3 utility

// TODO: Install 'pdfmake' and 'archiver' in backend-nest
// npm install pdfmake
// npm install @types/pdfmake --save-dev
// npm install archiver
// npm install @types/archiver --save-dev

// Define the Liquidacion and FirmaConUrl types (simplified for backend)
interface Liquidacion {
  id: string;
  conductor?: {
    nombre: string;
    apellido: string;
    cedula: string;
  };
  periodo_inicio: string;
  periodo_fin: string;
  salario_devengado: number;
  auxilio_transporte: number;
  total_bonificaciones: number;
  total_pernotes: number;
  total_recargos: number;
  total_anticipos: number;
  salud: number;
  pension: number;
  sueldo_total: number;
  ajuste_salarial: number;
  ajuste_parex: number;
  disponibilidad: number;
  dias_laborados: number;
  valor_incapacidad: number;
  periodo_vacaciones_inicio?: string;
  periodo_vacaciones_fin?: string;
  periodo_start_incapacidad?: string;
  periodo_end_incapacidad?: string;
  conceptos_adicionales?: any;
  bonificaciones?: any[];
  pernotes?: any[];
  recargos?: any[];
  firmas_desprendibles?: FirmaConUrl[];
  dias_laborados_villanueva?: number;
  interes_cesantias?: number;
  mostrar_recargos?: boolean;
}

interface FirmaConUrl {
  id: string;
  firma_s3_key?: string;
  presignedUrl?: string;
}

// Dynamically import pdfmake (will be installed in backend)
let pdfMake: any;
async function initializePdfMake() {
  if (!pdfMake) {
    const pdfMakeModule = await import('pdfmake/build/pdfmake');
    const pdfFontsModule = await import('pdfmake/build/vfs_fonts');
    pdfMake = pdfMakeModule.default;
    pdfMake.vfs = pdfFontsModule.default.pdfMake ? pdfFontsModule.default.pdfMake.vfs : pdfFontsModule.default.vfs;
  }
}

const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
const GEOPARK_EMPRESA_ID = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9';

function formatCurrency(value: number | string | null | undefined): string {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Sin fecha';
  const safe = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00Z';
  const date = new Date(safe);
  if (isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function monthAndYear(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase();
}

function safeValue(val: any, def: any = '') {
  return val !== undefined && val !== null ? val : def;
}

function parseValues(values: any): any[] {
  if (Array.isArray(values)) return values;
  if (typeof values === 'string') {
    try {
      const parsed = JSON.parse(values);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function agruparFechasConsecutivas(fechas: string[]): string[] {
  if (!fechas || fechas.length === 0) return [];

  const sorted = [...fechas].sort();
  const rangos: string[] = [];
  let inicio = sorted[0];
  let fin = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = new Date(sorted[i] + 'T00:00:00');
    const prev = new Date(fin + 'T00:00:00');
    const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diff === 1) {
      fin = sorted[i];
    } else {
      rangos.push(formatearRango(inicio, fin));
      inicio = sorted[i];
      fin = sorted[i];
    }
  }
  rangos.push(formatearRango(inicio, fin));

  return rangos;
}

function formatearRango(inicio: string, fin: string): string {
  const dInicio = new Date(inicio + 'T00:00:00');
  const dFin = new Date(fin + 'T00:00:00');
  const mesInicio = dInicio.toLocaleDateString('es-CO', { month: 'short' });

  if (inicio === fin) {
    return `${dInicio.getDate()} ${mesInicio}`;
  }

  const mesFin = dFin.toLocaleDateString('es-CO', { month: 'short' });
  if (mesInicio === mesFin) {
    return `${dInicio.getDate()}-${dFin.getDate()} ${mesInicio}`;
  }
  return `${dInicio.getDate()} ${mesInicio} - ${dFin.getDate()} ${mesFin}`;
}

function obtenerDiferenciaDias(startStr: string, endStr: string): number {
  try {
    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

// Backend-compatible function to get logo base64
async function getLogoBase64(esCotransmeq: boolean): Promise<string | null> {
  const s3Key = esCotransmeq
    ? process.env.S3_COTRANSMEQ_LOGO_KEY
    : process.env.S3_TRANSMERALDA_LOGO_KEY;

  if (!s3Key) {
    console.warn('S3 key for logo not configured. Skipping logo.');
    return null;
  }

  try {
    const logoBase64 = await getS3ObjectAsBase64(s3Key);
    return logoBase64;
  } catch (error) {
    console.error('Error fetching logo from S3:', error);
    return null;
  }
}

export async function generatePayslipPdfContent(
  item: Liquidacion,
  firmas: FirmaConUrl[] = [],
): Promise<any> {
  await initializePdfMake();

  const color = '#2E8B57';
  const colorBg = '#E8F5E9';
  const empresa = 'TRANSPORTES Y SERVICIOS ESMERALDA S.A.S';
  const nit = '901528440-3';

  const conductorNombre = `${safeValue(item.conductor?.nombre, 'N/A')}`;
  const conductorCedula = safeValue(
    (item.conductor as any)?.cedula || (item.conductor as any)?.numero_identificacion,
    'N/A'
  );

  // Load logo
  const logoBase64 = await getLogoBase64(false); // Assuming Cotransmeq logo for now

  const totalRecargosDirecto = item.recargos?.reduce((s, r) => s + Number(r.valor || 0), 0) || 0;
  const recargosParex = item.recargos?.filter((r) => r.empresa_id === PAREX_EMPRESA_ID) || [];
  const recargosGeopark = item.recargos?.filter((r) => r.empresa_id === GEOPARK_EMPRESA_ID) || [];
  const totalRecargosParex = recargosParex.reduce((s, r) => s + Number(r.valor || 0), 0);
  const totalRecargosGeopark = recargosGeopark.reduce((s, r) => s + Number(r.valor || 0), 0);
  let disponibilidadVal = Number(safeValue(item.disponibilidad, 0));

  const recargosNormal = totalRecargosDirecto - totalRecargosParex - totalRecargosGeopark;

  let totalRecargosParexFinal: number;
  let totalRecargosGeoparkFinal: number;
  let totalRecargosNormalFinal: number;
  const hayRecargosParex = totalRecargosParex > 0;
  const hayRecargosGeopark = totalRecargosGeopark > 0;

  let disponibilidadParaOtros = disponibilidadVal;

  if (totalRecargosParex > disponibilidadParaOtros) {
    totalRecargosParexFinal = totalRecargosParex - disponibilidadParaOtros;
    disponibilidadParaOtros = 0;
  } else {
    totalRecargosParexFinal = totalRecargosParex;
  }

  if (disponibilidadParaOtros > 0 && totalRecargosGeopark > disponibilidadParaOtros) {
    totalRecargosGeoparkFinal = totalRecargosGeopark - disponibilidadParaOtros;
    disponibilidadParaOtros = 0;
  } else {
    totalRecargosGeoparkFinal = totalRecargosGeopark;
  }

  totalRecargosNormalFinal = Math.max(0, recargosNormal - disponibilidadParaOtros);

  const bonosAgrupados: Record<string, { name: string; quantity: number; totalValue: number }> = {};
  if (item.bonificaciones && item.bonificaciones.length > 0) {
    item.bonificaciones.forEach((b) => {
      const qty = parseValues(b.values).reduce((s: number, v: any) => s + (v.quantity || 0), 0);
      if (bonosAgrupados[b.name]) {
        bonosAgrupados[b.name].quantity += qty;
        bonosAgrupados[b.name].totalValue += qty * Number(b.value);
      } else {
        bonosAgrupados[b.name] = {
          name: b.name,
          quantity: qty,
          totalValue: qty * Number(b.value)
        };
      }
    });
  }

  const bonosFilas = Object.values(bonosAgrupados)
    .filter((b) => b.quantity > 0)
    .map((b) => [
      { text: b.name || '', style: 'valueText' },
      { text: '', style: 'valueText' },
      { text: String(b.quantity), alignment: 'center' as const, style: 'valueText' },
      { text: formatCurrency(b.totalValue), alignment: 'center' as const, style: 'valueText' }
    ]);

  const parseFechas = (fechas: any): string[] => {
    if (Array.isArray(fechas)) return fechas;
    if (typeof fechas === 'string') {
      try {
        const parsed = JSON.parse(fechas);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const cantidadPernotes =
    item.pernotes?.reduce((t, p) => t + parseFechas(p.fechas).length, 0) || 0;

  let pernoteFechasTexto = '';
  if (item.pernotes && item.pernotes.length > 0) {
    try {
      const todasLasFechas: string[] = [];
      item.pernotes.forEach((pernote) => {
        const fechas = parseFechas(pernote.fechas);
        if (fechas.length > 0) {
          todasLasFechas.push(...fechas);
        }
      });
      const rangos = agruparFechasConsecutivas(todasLasFechas);
      pernoteFechasTexto = rangos.join(', ');
    } catch (error: any) {
      pernoteFechasTexto = error.message || 'Error al recolectar fechas pernoctes';
    }
  }

  const conceptosBody: any[][] = [
    // Header
    [
      { text: 'CONCEPTO', bold: true, fontSize: 10, color },
      { text: 'OBSERVACIÓN', bold: true, fontSize: 10, color },
      { text: 'CANTIDAD', bold: true, fontSize: 10, color, alignment: 'center' as const },
      { text: 'VALOR', bold: true, fontSize: 10, color, alignment: 'center' as const }
    ],
    // Bonificaciones
    ...bonosFilas,
    // Recargos (llamado "Otros" como en pdfMaker)
    [
      { text: 'Otros', style: 'valueText' },
      { text: 'Ver recargos detallados más adelante', fontSize: 10, color: '#666' },
      { text: ' ', alignment: 'center' as const },
      {
        text: formatCurrency(totalRecargosNormalFinal),
        alignment: 'center' as const,
        style: 'valueText'
      }
    ],
    // Recargos PAREX (si hay — manuales + planillas)
    ...(hayRecargosParex
      ? [
        [
          { text: 'Recargos PAREX', style: 'valueText' },
          {
            text: 'Ver recargos detallados más adelante',
            fontSize: 10,
            color: '#666'
          },
          { text: ' ', alignment: 'center' as const },
          {
            text: formatCurrency(totalRecargosParexFinal),
            alignment: 'center' as const,
            style: 'valueText'
          }
        ]
      ]
      : []),
    // Recargos Geopark (si hay — manuales + planillas)
    ...(hayRecargosGeopark
      ? [
        [
          { text: 'Recargos GEOPARK', style: 'valueText' },
          {
            text: 'Ver recargos detallados más adelante',
            fontSize: 10,
            color: '#666'
          },
          { text: ' ', alignment: 'center' as const },
          {
            text: formatCurrency(totalRecargosGeoparkFinal),
            alignment: 'center' as const,
            style: 'valueText'
          }
        ]
      ]
      : []),
    // Pernotes con fechas agrupadas
    [
      { text: 'Pernoctes', style: 'valueText' },
      { text: pernoteFechasTexto, fontSize: 10, color: '#666' },
      {
        text: String(cantidadPernotes),
        alignment: 'center' as const,
        style: 'valueText'
      },
      {
        text: formatCurrency(item.total_pernotes || 0),
        alignment: 'center' as const,
        style: 'valueText'
      }
    ]
  ];

  const empleadoBody: any[][] = [
    [{ text: 'Nombre' }, { text: conductorNombre, alignment: 'right' as const }],
    [{ text: 'C.C.' }, { text: conductorCedula, alignment: 'right' as const }],
    [
      { text: 'Días laborados' },
      {
        text: String(safeValue(item.dias_laborados, 0)),
        alignment: 'right' as const
      }
    ],
    [
      { text: 'Salario devengado' },
      {
        text: formatCurrency(item.salario_devengado),
        color: '#007AFF',
        alignment: 'right' as const
      }
    ],
    [
      { text: 'Auxilio de transporte' },
      {
        text: formatCurrency(item.auxilio_transporte),
        color: '#00000074',
        alignment: 'right' as const
      }
    ]
  ];

  if (Number(safeValue(item.valor_incapacidad, 0)) > 0) {
    const diasIncapacidad =
      item.periodo_incapacidad_inicio && item.periodo_incapacidad_fin
        ? `${obtenerDiferenciaDias(item.periodo_incapacidad_inicio, item.periodo_incapacidad_fin)} días`
        : item.periodo_start_incapacidad && item.periodo_end_incapacidad
          ? `${obtenerDiferenciaDias(item.periodo_start_incapacidad, item.periodo_end_incapacidad)} días`
          : '-';
    empleadoBody.push([
      { text: 'Remuneración por incapacidad' },
      {
        columns: [
          { text: diasIncapacidad, width: 'auto' },
          {
            text: formatCurrency(item.valor_incapacidad),
            color,
            alignment: 'right' as const,
            width: '*'
          }
        ]
      }
    ]);
  }

  empleadoBody.push([
    { text: 'Bono Nivelación de Salario' },
    {
      columns: [
        {
          text: `${safeValue(item.dias_laborados_villanueva, 0)} días`,
          width: 'auto'
        },
        {
          text: formatCurrency(item.ajuste_salarial || 0),
          color: '#FF9500',
          alignment: 'right' as const,
          width: '*'
        }
      ]
    }
  ]);

  const content: any[] = [
    // Header
    {
      columns: [
        {
          stack: [
            {
              text: empresa,
              style: 'header',
              color,
              bold: true,
              fontSize: 13,
              maxWidth: 300
            },
            { text: `NIT: ${nit}`, fontSize: 10, margin: [0, 2, 0, 0] },
            {
              text: `COMPROBANTE DE NOMINA - ${monthAndYear(item.periodo_fin)}`,
              fontSize: 10,
              color,
              bold: true,
              margin: [0, 10, 0, 0]
            },
            {
              text: `BÁSICO CORRESPONDIENTE AL MES DE ${monthAndYear(item.periodo_fin)}`,
              fontSize: 10,
              color,
              bold: true,
              margin: [0, 2, 0, 0]
            }
          ],
          width: '*'
        },
        ...(logoBase64
          ? [
            {
              image: logoBase64,
              width: 175,
              height: 100,
              alignment: 'right' as const,
              margin: [0, -15, -30, 0]
            }
          ]
          : [])
      ],
      margin: [0, 0, 0, 20]
    },

    // Datos del empleado
    {
      table: {
        widths: ['*', '*'],
        body: empleadoBody
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
        vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
        hLineColor: () => '#E0E0E0',
        vLineColor: () => '#E0E0E0',
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 4,
        paddingBottom: () => 4
      }
    },

    // Título ADICIONALES
    {
      text: `ADICIONALES ${formatDate(item.periodo_inicio)} - ${formatDate(item.periodo_fin)}`.toUpperCase(),
      alignment: 'center' as const,
      bold: true,
      color,
      fontSize: 12,
      margin: [0, 12, 0, 12]
    },

    // Tabla de conceptos (4 columnas: 30%, 40%, 15%, 15%)
    {
      table: {
        headerRows: 1,
        widths: ['30%', '40%', '15%', '15%'],
        body: conceptosBody
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
        vLineWidth: () => 1,
        hLineColor: () => '#E0E0E0',
        vLineColor: () => '#E0E0E0',
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 5,
        paddingBottom: () => 5,
        fillColor: (row: number) => (row === 0 ? colorBg : null)
      }
    }
  ];

  const conceptosAdicionales = parseValues(item.conceptos_adicionales);
  if (conceptosAdicionales.length > 0) {
    const conceptosAdicionalesBody = conceptosAdicionales.map((c: any) => {
      const isNegative = Number(c.valor) < 0;
      return [
        { text: c.observaciones || c.concepto || '', fontSize: 10 },
        { text: '1', alignment: 'center' as const },
        {
          text: `${isNegative ? '' : '+'}${formatCurrency(c.valor)}`,
          alignment: 'center' as const,
          color: isNegative ? '#e60f0f' : '#2E8B57'
        }
      ];
    });

    content.push(
      {
        text: 'CONCEPTOS ADICIONALES',
        bold: true,
        color,
        fontSize: 11,
        margin: [0, 15, 0, 6]
      },
      {
        table: {
          widths: ['40%', '15%', '15%'],
          body: conceptosAdicionalesBody
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
          vLineWidth: () => 1,
          hLineColor: () => '#E0E0E0',
          vLineColor: () => '#E0E0E0',
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 5,
          paddingBottom: () => 5
        }
      }
    );
  }

  if (disponibilidadVal > 0) {
    content.push(
      {
        text: 'DISPONIBILIDAD',
        bold: true,
        color,
        fontSize: 11,
        margin: [0, 15, 0, 6]
      },
      {
        table: {
          widths: ['*', '*'],
          body: [
            [
              { text: 'Disponibilidad' },
              {
                text: formatCurrency(disponibilidadVal),
                alignment: 'right' as const,
                color: '#2E8B57'
              }
            ]
          ]
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
          vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
          hLineColor: () => '#E0E0E0',
          vLineColor: () => '#E0E0E0',
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 4,
          paddingBottom: () => 4
        }
      }
    );
  }

  const deduccionesBody: any[][] = [
    [
      { text: 'Salud' },
      {
        text: formatCurrency(item.salud),
        color: '#e60f0f',
        alignment: 'right' as const
      }
    ],
    [
      { text: 'Pensión' },
      {
        text: formatCurrency(item.pension),
        color: '#e60f0f',
        alignment: 'right' as const
      }
    ]
  ];

  if (item.anticipos && item.anticipos.length > 0) {
    deduccionesBody.push([
      { text: 'Anticipos' },
      {
        text: formatCurrency(item.total_anticipos),
        color: '#e60f0f',
        alignment: 'right' as const
      }
    ]);
  }

  content.push(
    {
      text: 'DEDUCCIONES',
      bold: true,
      color,
      fontSize: 11,
      margin: [0, 15, 0, 6]
    },
    {
      table: {
        widths: ['*', '*'],
        body: deduccionesBody
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
        vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
        hLineColor: () => '#E0E0E0',
        vLineColor: () => '#E0E0E0',
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 4,
        paddingBottom: () => 4
      }
    }
  );

  const resumenBody: any[][] = [];

  if (Number(safeValue(item.total_vacaciones, 0)) > 0) {
    const diasVacaciones =
      item.periodo_vacaciones_inicio && item.periodo_vacaciones_fin
        ? obtenerDiferenciaDias(item.periodo_vacaciones_inicio, item.periodo_vacaciones_fin)
        : item.periodo_start_vacaciones && item.periodo_end_vacaciones
          ? obtenerDiferenciaDias(item.periodo_start_vacaciones, item.periodo_end_vacaciones)
          : 0;

    resumenBody.push([
      { text: 'Vacaciones' },
      { text: `${diasVacaciones} días` },
      {
        text: formatCurrency(item.total_vacaciones),
        color: '#FF9500',
        alignment: 'right' as const
      }
    ]);
  }

  const sueldoBase = Number(safeValue(item.sueldo_total, 0));
  const intereses = Number(safeValue(item.interes_cesantias, 0));
  const sueldoAjustado = sueldoBase - intereses;

  if (resumenBody.length > 0) {
    resumenBody.push([
      { text: 'Salario total', bold: true },
      { text: '' },
      {
        text: formatCurrency(sueldoAjustado),
        bold: true,
        color,
        alignment: 'right' as const
      }
    ]);

    content.push(
      {
        text: 'RESUMEN FINAL',
        bold: true,
        color,
        fontSize: 11,
        margin: [0, 15, 0, 6]
      },
      {
        table: {
          widths: ['*', 'auto', 'auto'],
          body: resumenBody
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
          vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
          hLineColor: () => '#E0E0E0',
          vLineColor: () => '#E0E0E0',
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 4,
          paddingBottom: () => 4
        }
      }
    );
  } else {
    content.push(
      {
        text: 'RESUMEN FINAL',
        bold: true,
        color,
        fontSize: 11,
        margin: [0, 15, 0, 6]
      },
      {
        table: {
          widths: ['*', '*'],
          body: [
            [
              { text: 'Salario total', bold: true },
              {
                text: formatCurrency(sueldoAjustado),
                bold: true,
                color,
                alignment: 'right' as const
              }
            ]
          ]
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
          vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
          hLineColor: () => '#E0E0E0',
          vLineColor: () => '#E0E0E0',
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 4,
          paddingBottom: () => 4
        }
      }
    );
  }

  if (firmas && firmas[0]?.presignedUrl) {
    try {
      const firmaBase64 = await getS3ObjectAsBase64(firmas[0].firma_s3_key || '');
      if (firmaBase64) {
        content.push({
          stack: [
            {
              image: firmaBase64,
              width: 180,
              height: 50,
              alignment: 'center' as const,
              margin: [0, 30, 0, 0]
            },
            {
              canvas: [
                {
                  type: 'line',
                  x1: 0,
                  y1: 0,
                  x2: 190,
                  y2: 0,
                  lineWidth: 1,
                  lineColor: '#BDBDBD'
                }
              ],
              width: 190,
              alignment: 'center' as const,
              margin: [0, 2, 0, 0]
            },
            {
              text: 'Firma de recibido',
              fontSize: 10,
              color: '#2E8B57',
              alignment: 'center' as const,
              bold: true,
              margin: [0, 4, 0, 7]
            }
          ],
          alignment: 'center' as const
        });
      }
    } catch {
      // Si falla la carga de la firma, no mostrarla
    }
  }

  content.push({
    text: `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
    fontSize: 9,
    color: '#9E9E9E',
    alignment: 'center' as const,
    margin: [0, 20, 0, 0]
  });

  // IMPORTANT: Do NOT include the "HORAS EXTRAS Y RECARGOS" section (page 2+)
  // as per user's request: "por el momento unicamente la pagina 1 del desprendible NO las tablas de recargos"
  // The original code has this conditional block:
  // if (recargosData?.planillas && recargosData.planillas.length > 0 && item.mostrar_recargos) { ... }
  // By not passing recargosData or ensuring item.mostrar_recargos is false, this section is skipped.

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 30, 40, 30],
    content,
    styles: {
      header: {
        fontSize: 13,
        bold: true,
        margin: [0, 0, 0, 2]
      },
      tableHeader: {
        bold: true,
        fontSize: 10
      },
      valueText: {
        fontSize: 12
      }
    },
    defaultStyle: {
      fontSize: 12
    }
  };

  return docDefinition;
}
