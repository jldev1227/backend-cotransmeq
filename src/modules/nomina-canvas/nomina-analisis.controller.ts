import { FastifyReply, FastifyRequest } from 'fastify';
import { NominaAnalisisService } from './nomina-analisis.service';

/** `?anios=2025,2026` → `[2025, 2026]`. Vacío o ausente → sin filtro. */
function csv(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap((v) => csv(v));
  if (typeof valor !== 'string') return [];
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvNumeros(valor: unknown): number[] {
  return csv(valor)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n));
}

export class NominaAnalisisController {
  /**
   * GET /nomina/analisis?anios=&meses=&placas=&conductores=&estados=
   *
   * Todos los filtros son listas separadas por coma y todos son opcionales.
   * `anio`/`mes` en singular también valen: es lo que manda el «Ir a…» de los
   * otros canvas del módulo.
   */
  static async consultar(request: FastifyRequest, reply: FastifyReply) {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const anios = [...csvNumeros(q.anios), ...csvNumeros(q.anio)];
    const meses = [...csvNumeros(q.meses), ...csvNumeros(q.mes)].filter((m) => m >= 1 && m <= 12);
    try {
      const resultado = await NominaAnalisisService.consultar({
        anios: Array.from(new Set(anios)),
        meses: Array.from(new Set(meses)),
        placas: csv(q.placas).map((p) => p.toUpperCase()),
        conductores: csv(q.conductores),
        estados: csv(q.estados).map((e) => e.toUpperCase()),
      });
      return reply.send({ success: true, ...resultado });
    } catch (error) {
      request.log.error({ err: error }, 'nomina-analisis: fallo al consultar');
      return reply.status(500).send({ success: false, error: 'No se pudo cargar el análisis de nómina.' });
    }
  }
}
