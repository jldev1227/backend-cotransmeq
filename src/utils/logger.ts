import pino from 'pino'

/// En producción el log va en JSON de una línea y a nivel `info`: el
/// recolector de Docker/Railway lo indexa por campos, y `pino-pretty` en un
/// transport es un worker thread más que colorea para una terminal que nadie
/// mira. `debug` además volcaba el log de cada consulta y de cada petición.
/// `LOG_LEVEL` manda en los dos entornos (p. ej. `LOG_LEVEL=debug` para
/// diagnosticar en producción sin desplegar código).
const enProduccion = process.env.NODE_ENV === 'production'

export const logger = enProduccion
  ? pino({ level: process.env.LOG_LEVEL || 'info' })
  : pino({
      level: process.env.LOG_LEVEL || 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
    })
