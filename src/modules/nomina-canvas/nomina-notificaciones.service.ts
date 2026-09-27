import { prisma } from '../../config/prisma';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function enviarExpo(
  tokens: string[],
  contenido: { title: string; body: string; data: Record<string, string> },
): Promise<ExpoTicket[]> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        sound: 'default',
        channelId: 'nomina',
        priority: 'high',
        title: contenido.title,
        body: contenido.body,
        data: contenido.data,
      })),
    ),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: ExpoTicket[]; errors?: { message?: string }[] }
    | null;
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message ?? `Expo Push respondió ${response.status}.`);
  }
  return payload?.data ?? [];
}

export const NominaNotificacionesService = {
  /**
   * Crea primero el inbox y después intenta el push. Así el aviso no se pierde
   * si Expo, APNs/FCM o el teléfono están temporalmente fuera de servicio.
   */
  async enviar(params: { liquidacionIds: string[]; anio: number; mes: number }) {
    const liquidaciones = await prisma.liquidaciones.findMany({
      where: { id: { in: params.liquidacionIds }, deleted_at: null },
      select: {
        id: true,
        estado_flujo: true,
        conductor_id: true,
        conductores: { select: { id: true, nombre: true, apellido: true } },
      },
    });
    const encontradas = new Map(liquidaciones.map((item) => [item.id, item]));
    const periodo = `${MESES[params.mes - 1]} de ${params.anio}`;
    const resultados: Array<{
      liquidacion_id: string;
      conductor: string;
      estado: 'ENVIADA' | 'SIN_DISPOSITIVO' | 'ERROR' | 'OMITIDA';
      error?: string;
    }> = [];

    for (const id of params.liquidacionIds) {
      const liquidacion = encontradas.get(id);
      const conductor = liquidacion?.conductores;
      if (!liquidacion || !conductor) {
        resultados.push({
          liquidacion_id: id,
          conductor: 'Desconocido',
          estado: 'OMITIDA',
          error: 'Liquidación o conductor no encontrado.',
        });
        continue;
      }
      if (liquidacion.estado_flujo !== 'PAGADA') {
        resultados.push({
          liquidacion_id: id,
          conductor: `${conductor.nombre} ${conductor.apellido}`.trim(),
          estado: 'OMITIDA',
          error: 'Solo se notifican liquidaciones PAGADAS.',
        });
        continue;
      }

      const primerNombre = conductor.nombre.trim().split(/\s+/)[0] || 'Conductor';
      const titulo = 'Tu nómina ya está disponible';
      const cuerpo =
        `Hola ${primerNombre}, tu desprendible de nómina de ${periodo} ` +
        'ya se encuentra disponible para firmar y consultar.';
      const datos = {
        route: '/desprendibles',
        type: 'NOMINA_DISPONIBLE',
        liquidacion_id: liquidacion.id,
      };
      const inbox = await prisma.conductor_notification.create({
        data: {
          conductor_id: conductor.id,
          liquidacion_id: liquidacion.id,
          tipo: 'NOMINA_DISPONIBLE',
          titulo,
          cuerpo,
          datos,
        },
      });
      const dispositivos = await prisma.conductor_push_device.findMany({
        where: { conductor_id: conductor.id, activo: true },
        select: { id: true, expo_push_token: true },
      });

      if (!dispositivos.length) {
        await prisma.conductor_notification.update({
          where: { id: inbox.id },
          data: { estado_push: 'SIN_DISPOSITIVO' },
        });
        resultados.push({
          liquidacion_id: id,
          conductor: `${conductor.nombre} ${conductor.apellido}`.trim(),
          estado: 'SIN_DISPOSITIVO',
        });
        continue;
      }

      try {
        const tickets = await enviarExpo(
          dispositivos.map((item) => item.expo_push_token),
          { title: titulo, body: cuerpo, data: datos },
        );
        const aceptado = tickets.find((ticket) => ticket.status === 'ok');
        const errores = tickets.filter((ticket) => ticket.status === 'error');
        for (const [index, ticket] of tickets.entries()) {
          if (ticket.details?.error === 'DeviceNotRegistered' && dispositivos[index]) {
            await prisma.conductor_push_device.update({
              where: { id: dispositivos[index].id },
              data: { activo: false },
            });
          }
        }
        if (!aceptado) {
          throw new Error(
            errores.map((ticket) => ticket.message ?? ticket.details?.error).filter(Boolean).join('; ') ||
              'Expo no aceptó ningún dispositivo.',
          );
        }
        await prisma.conductor_notification.update({
          where: { id: inbox.id },
          data: {
            estado_push: 'ENVIADA',
            expo_ticket_id: aceptado.id ?? null,
            enviada_at: new Date(),
            error_push: errores.length ? errores.map((ticket) => ticket.message).join('; ') : null,
          },
        });
        resultados.push({
          liquidacion_id: id,
          conductor: `${conductor.nombre} ${conductor.apellido}`.trim(),
          estado: 'ENVIADA',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo enviar el push.';
        await prisma.conductor_notification.update({
          where: { id: inbox.id },
          data: { estado_push: 'ERROR', error_push: message },
        });
        resultados.push({
          liquidacion_id: id,
          conductor: `${conductor.nombre} ${conductor.apellido}`.trim(),
          estado: 'ERROR',
          error: message,
        });
      }
    }

    return {
      total: params.liquidacionIds.length,
      enviadas: resultados.filter((item) => item.estado === 'ENVIADA').length,
      sin_dispositivo: resultados.filter((item) => item.estado === 'SIN_DISPOSITIVO').length,
      resultados,
    };
  },
};
