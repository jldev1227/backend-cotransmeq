export const TIPOS_VALIDOS = [
	'RETEFUENTE',
	'RETEICA',
	'RETEIVA',
	'ICA',
	'IVA',
	'RETENCIONES',
	'OTROS'
] as const;

export type TipoCertificado = (typeof TIPOS_VALIDOS)[number];

const TIPO_ALIASES: Record<string, TipoCertificado> = {
	RETEFUENTE: 'RETEFUENTE',
	RETEFTE: 'RETEFUENTE',
	FUENTE: 'RETEFUENTE',
	RTEFUENTE: 'RETEFUENTE',
	RTEFTE: 'RETEFUENTE',

	RETEICA: 'RETEICA',
	RTEICA: 'RETEICA',
	ICA: 'ICA',

	RETEIVA: 'RETEIVA',
	RTEIVA: 'RETEIVA',
	IVA: 'IVA',

	RETENCIONES: 'RETENCIONES',
	RETENCION: 'RETENCIONES'
};

export function extractNitFromFilename(filename: string): string | null {
	const base = filename.replace(/\.pdf$/i, '');
	const match = base.match(/(\d{6,15})(?:-\d+)?(?=\s|$)/);
	return match ? match[1] : null;
}

export function extractTipoFromFilename(filename: string): TipoCertificado {
	const upper = filename.toUpperCase();
	if (upper.includes('RETEFUENTE') || upper.includes('FUENTE')) return 'RETEFUENTE';
	if (upper.includes('RETEICA') || upper.includes('ICA')) return 'RETEICA';
	if (upper.includes('RETEIVA') || upper.includes('IVA')) return 'RETEIVA';
	return 'OTROS';
}

export function normalizeTipo(input: string): TipoCertificado | null {
	if (!input) return null;
	const cleaned = input
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z0-9]/g, '')
		.toUpperCase();
	return TIPO_ALIASES[cleaned] ?? null;
}

export function extractAnioFromFolder(folderName: string): number | null {
	const match = folderName.match(/\b(20\d{2})\b/);
	return match ? parseInt(match[1], 10) : null;
}

export function sanitizeSegment(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9\-_]/g, '_')
		.replace(/_+/g, '_')
		.substring(0, 100);
}

export function buildS3Key(nit: string, anio: number, tipo: TipoCertificado, filename: string): string {
	const safeName = sanitizeSegment(filename);
	return `certificados-tributarios/${nit}/AÑO ${anio}/${tipo}/${safeName}`;
}

export function parseS3Key(key: string): {
	nit: string;
	anio: number;
	tipo: TipoCertificado;
	filename: string;
} | null {
	const parts = key.split('/');
	if (parts.length < 5) return null;
	const [prefix, nit, anioFolder, tipo, ...rest] = parts;
	if (prefix !== 'certificados-tributarios') return null;
	const anio = extractAnioFromFolder(anioFolder);
	if (!anio) return null;
	if (!TIPOS_VALIDOS.includes(tipo as TipoCertificado)) return null;
	return { nit, anio, tipo: tipo as TipoCertificado, filename: rest.join('/') };
}

export function detectarRootPrefix(paths: string[]): string {
	if (paths.length === 0) return '';
	const firstSegments = paths[0].split('/').filter(Boolean);
	if (firstSegments.length < 2) return '';
	const commonRoot = firstSegments[0];
	for (const p of paths) {
		const segs = p.split('/').filter(Boolean);
		if (segs[0] !== commonRoot) return '';
	}
	return commonRoot + '/';
}
