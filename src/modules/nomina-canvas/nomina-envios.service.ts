/**
 * Constancia de los envíos de desprendibles.
 *
 * Hoy el envío de nómina (`liquidaciones.routes.ts`) manda un magic-link al
 * portal y NO deja rastro de ningún tipo: si un correo rebota, nadie se
 * entera salvo que estuviera mirando la pantalla en ese momento, y no hay
 * forma de responder a «¿a quién ya se le mandó?». Esto lo arregla, copiando
 * el planteamiento de `liquidacion_tercero_envio`.
 *
 * La fila NACE en `ENVIANDO`, antes de intentar nada, y luego pasa a
 * `ENVIADO` o `ERROR`. Así un proceso que se muere a mitad deja evidencia de
 * lo que estaba haciendo en vez de desaparecer sin dejar nada.
 */
import { prisma } from '../../config/prisma';

export interface RegistroEnvioNomina {
  liquidacion_id: string;
  conductor_id: string;
  anio: number;
  mes: number;
  email_destino: string;
  asunto: string;
  mensaje?: string | null;
  adjuntos: { filename: string; size: number; tipo: string }[];
  es_prueba: boolean;
  enviado_por_id: string | null;
  enviado_por: string | null;
}

/** Resumen por liquidación, para pintar el estado en el canvas. */
export interface EstadoEnvioLiquidacion {
  liquidacion_id: string;
  /** Último envío REAL (no prueba) que terminó bien. */
  ultimo_enviado: { email_destino: string; enviado_at: string } | null;
  /** Último fallo real POSTERIOR al último envío correcto, si lo hay. */
  ultimo_error: { email_destino: string; error: string | null; created_at: string } | null;
  enviados: number;
  pruebas: number;
}

export const NominaEnviosService = {
  /** Crea la fila en ENVIANDO. La cola la resuelve después. */
  async crearRegistro(input: RegistroEnvioNomina) {
    return prisma.nomina_envio.create({
      data: {
        liquidacion_id: input.liquidacion_id,
        conductor_id: input.conductor_id,
        anio: input.anio,
        mes: input.mes,
        email_destino: input.email_destino.slice(0, 255),
        asunto: input.asunto,
        mensaje: input.mensaje ?? null,
        adjuntos: input.adjuntos as any,
        estado: 'ENVIANDO',
        es_prueba: input.es_prueba,
        enviado_por_id: input.enviado_por_id,
        enviado_por: input.enviado_por,
      },
      select: { id: true },
    });
  },

  async marcarEnviado(id: string, proveedor: string, messageId?: string | null) {
    await prisma.nomina_envio.update({
      where: { id },
      data: {
        estado: 'ENVIADO',
        proveedor,
        message_id: messageId ?? null,
        enviado_at: new Date(),
        error: null,
      },
    });
  },

  async marcarError(id: string, error: string) {
    await prisma.nomina_envio.update({
      where: { id },
      // El mensaje se recorta: algunos errores de SMTP traen la traza entera
      // y no aporta nada guardar kilobytes por fila.
      data: { estado: 'ERROR', error: error.slice(0, 2000) },
    });
  },

  /**
   * Estado agregado del periodo, indexado por liquidación.
   *
   * Se trae el periodo entero y se reduce en memoria: son decenas de filas y
   * una consulta agregada por liquidación serían decenas de consultas.
   */
  async estadoPorPeriodo(anio: number, mes: number): Promise<Record<string, EstadoEnvioLiquidacion>> {
    const filas = await prisma.nomina_envio.findMany({
      where: { anio, mes },
      orderBy: { created_at: 'asc' },
    });

    const out: Record<string, EstadoEnvioLiquidacion> = {};
    for (const f of filas) {
      const acc = (out[f.liquidacion_id] ??= {
        liquidacion_id: f.liquidacion_id,
        ultimo_enviado: null,
        ultimo_error: null,
        enviados: 0,
        pruebas: 0,
      });

      if (f.estado === 'ENVIADO') {
        if (f.es_prueba) {
          acc.pruebas++;
        } else {
          acc.enviados++;
          acc.ultimo_enviado = {
            email_destino: f.email_destino,
            enviado_at: (f.enviado_at ?? f.created_at).toISOString(),
          };
          // Un envío correcto cancela el error anterior: lo que interesa es
          // si HOY hay algo pendiente, no el histórico de tropiezos.
          acc.ultimo_error = null;
        }
      } else if (f.estado === 'ERROR' && !f.es_prueba) {
        acc.ultimo_error = {
          email_destino: f.email_destino,
          error: f.error,
          created_at: f.created_at.toISOString(),
        };
      }
    }
    return out;
  },

  /** Historial de una liquidación, del más reciente al más antiguo. */
  async historial(liquidacionId: string) {
    return prisma.nomina_envio.findMany({
      where: { liquidacion_id: liquidacionId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  },
};
