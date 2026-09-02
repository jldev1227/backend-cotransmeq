import { FastifyRequest, FastifyReply } from 'fastify';
import { NominaCanvasService } from './nomina-canvas.service';
import { CORTE_DEFECTO } from '../../lib/nomina/periodo';

/**
 * Tope de conductores por libro. Cada hoja son ~110 filas × 40 columnas y
 * Univer las monta todas al abrir; los canvas de terceros ya funcionan con
 * ~40 hojas. Con 120 el navegador empieza a sufrir, así que se corta y se
 * avisa en vez de servir un libro que no se puede abrir.
 */
const MAX_HOJAS = 120;

function leerPeriodo(request: FastifyRequest) {
  const q = (request.query ?? {}) as Record<string, string>;
  const anio = Number(q.anio);
  const mes = Number(q.mes);
  const corte = q.desde === undefined ? CORTE_DEFECTO : Number(q.desde);
  return { anio, mes, corte };
}

export class NominaCanvasController {
  /**
   * GET /nomina/canvas?anio=&mes=[&desde=][&conductores=id,id]
   *
   * El libro entero del periodo. `desde` es el día de corte (21 por defecto):
   * el periodo va del `desde` del mes anterior al `desde − 1` de este.
   */
  static async periodo(request: FastifyRequest, reply: FastifyReply) {
    const { anio, mes, corte } = leerPeriodo(request);

    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
      return reply.status(400).send({ error: 'Año inválido.' });
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Mes inválido (1-12).' });
    }
    if (!Number.isInteger(corte) || corte < 1 || corte > 28) {
      // Se corta en 28 para que el periodo exista en febrero.
      return reply.status(400).send({ error: 'Día de corte inválido (1-28).' });
    }

    const q = (request.query ?? {}) as Record<string, string>;
    const conductorIds = q.conductores
      ? q.conductores.split(',').map((x) => x.trim()).filter(Boolean)
      : undefined;

    try {
      const dto = await NominaCanvasService.construirPeriodo({ anio, mes, corte, conductorIds });

      if (dto.hojas.length > MAX_HOJAS) {
        const sobran = dto.hojas.length - MAX_HOJAS;
        dto.hojas = dto.hojas.slice(0, MAX_HOJAS);
        dto.avisos.push(
          `El periodo tiene ${MAX_HOJAS + sobran} conductores y se sirvieron los ${MAX_HOJAS} primeros por orden alfabético. Filtra por conductor para ver el resto.`,
        );
      }

      return reply.send(dto);
    } catch (error) {
      request.log.error({ err: error, anio, mes, corte }, 'nomina-canvas: fallo al construir el periodo');
      return reply.status(500).send({ error: 'No se pudo construir el periodo de nómina.' });
    }
  }

  /**
   * GET /nomina/canvas/resumen?anio=&mes=[&desde=]
   *
   * Lo mismo pero sin las hojas: sirve para el selector de periodo y para
   * saber si merece la pena cargar el libro entero.
   */
  static async resumen(request: FastifyRequest, reply: FastifyReply) {
    const { anio, mes, corte } = leerPeriodo(request);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });
    }
    try {
      const dto = await NominaCanvasService.construirPeriodo({ anio, mes, corte });
      return reply.send({
        anio: dto.anio,
        mes: dto.mes,
        corte: dto.corte,
        etiqueta: dto.etiqueta,
        dias: dto.periodo.dias.length,
        conductores: dto.hojas.length,
        conPlanilla: dto.hojas.filter((h) => h.dias.length > 0).length,
        conLiquidacion: dto.hojas.filter((h) => h.liquidacionId).length,
        avisos: dto.avisos,
      });
    } catch (error) {
      request.log.error({ err: error }, 'nomina-canvas: fallo al resumir el periodo');
      return reply.status(500).send({ error: 'No se pudo resumir el periodo de nómina.' });
    }
  }
}
