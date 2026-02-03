import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { documentosService } from './documentos.service';

export async function documentosRoutes(app: FastifyInstance) {
  // Ver documento (stream directo para visualización en navegador)
  app.get('/documentos/ver/*', async (request: FastifyRequest<{
    Params: { '*': string }
  }>, reply: FastifyReply) => {
    try {
      const key = (request.params as any)['*'];
      
      if (!key) {
        return reply.status(400).send({
          success: false,
          message: 'La clave del documento es requerida'
        });
      }
      
      // Obtener el stream del archivo desde S3
      const { stream, contentType, contentLength } = await documentosService.obtenerDocumento(key);

      // Configurar headers para visualización en el navegador
      reply.header('Content-Type', contentType || 'application/pdf');
      reply.header('Content-Disposition', 'inline');
      
      if (contentLength) {
        reply.header('Content-Length', contentLength);
      }

      // Enviar el stream
      return reply.send(stream);
    } catch (error: any) {
      request.log.error({ error }, 'Error al obtener documento');
      
      if (error.name === 'NoSuchKey' || error.code === 'NoSuchKey') {
        return reply.status(404).send({
          success: false,
          message: 'Documento no encontrado'
        });
      }
      
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener el documento',
        error: error.message
      });
    }
  });

  // Obtener URL firmada (para descarga con expiración)
  app.get('/documentos/url-firma', async (request: FastifyRequest<{
    Querystring: { key: string }
  }>, reply: FastifyReply) => {
    try {
      const { key } = request.query;
      
      if (!key) {
        return reply.status(400).send({
          success: false,
          message: 'El parámetro "key" es requerido'
        });
      }
      
      const url = await documentosService.obtenerUrlFirmada(key);
      
      return reply.send({
        success: true,
        data: { url }
      });
    } catch (error: any) {
      request.log.error({ error }, 'Error al generar URL firmada');
      
      return reply.status(500).send({
        success: false,
        message: 'Error al generar URL firmada',
        error: error.message
      });
    }
  });
}
