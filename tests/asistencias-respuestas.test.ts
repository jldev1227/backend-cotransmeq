import { describe, it, expect, beforeEach } from 'vitest'
import { AsistenciasService } from '../src/modules/asistencias/asistencias.service'
import { prisma } from './setup'
import type { CreateRespuestaAsistenciaInput } from '../src/modules/asistencias/asistencias.schema'

describe('Asistencias - Respuestas CRUD', () => {
  let testUserId: string
  let testFormularioId: string
  let testFormularioToken: string

  beforeEach(async () => {
    // Limpiar datos
    await prisma.respuestas_asistencia.deleteMany()
    await prisma.formularios_asistencia.deleteMany()

    // Obtener o crear usuario de test
    const testUser = await prisma.usuarios.findFirst({
      where: { correo: 'test@asistencias.com' }
    })
    
    if (testUser) {
      testUserId = testUser.id
    } else {
      const newUser = await prisma.usuarios.create({
        data: {
          nombre: 'Test User',
          correo: 'test@asistencias.com',
          password: 'hashedpassword123',
          role: 'admin'
        }
      })
      testUserId = newUser.id
    }

    // Crear formulario de test
    const formulario = await AsistenciasService.crear({
      tematica: 'Capacitación de Seguridad Vial',
      objetivo: 'Reducir incidentes viales mediante entrenamiento',
      fecha: new Date('2026-01-15').toISOString(),
      hora_inicio: '08:00',
      hora_finalizacion: '12:00',
      tipo_evento: 'capacitacion',
      lugar_sede: 'Sede Principal - Auditorio',
      nombre_instructor: 'Carlos Ramírez - Especialista en Seguridad Vial'
    }, testUserId)

    testFormularioId = formulario.id
    testFormularioToken = formulario.token
  })

  describe('Crear Respuesta', () => {
    it('debe crear una respuesta exitosamente', async () => {
      const input: CreateRespuestaAsistenciaInput = {
        formulario_id: testFormularioId,
        nombre_completo: 'Juan Pérez García',
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        ip_address: '192.168.1.100',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        device_fingerprint: 'fp_12345abcde'
      }

      const respuesta = await AsistenciasService.crearRespuesta(input)

      expect(respuesta).toBeDefined()
      expect(respuesta.id).toBeDefined()
      expect(respuesta.formulario_id).toBe(testFormularioId)
      expect(respuesta.nombre_completo).toBe('Juan Pérez García')
      expect(respuesta.numero_documento).toBe('1234567890')
      expect(respuesta.cargo).toBe('Conductor')
      expect(respuesta.numero_telefono).toBe('3001234567')
      expect(respuesta.firma).toBe(input.firma)
      expect(respuesta.ip_address).toBe('192.168.1.100')
      expect(respuesta.user_agent).toBe(input.user_agent)
      expect(respuesta.device_fingerprint).toBe('fp_12345abcde')
      expect(respuesta.created_at).toBeDefined()
    })

    it('debe crear múltiples respuestas con diferentes device fingerprints', async () => {
      const respuesta1: CreateRespuestaAsistenciaInput = {
        formulario_id: testFormularioId,
        nombre_completo: 'María González',
        numero_documento: '9876543210',
        cargo: 'Supervisor',
        numero_telefono: '3007654321',
        firma: 'data:image/png;base64,test1',
        ip_address: '192.168.1.101',
        user_agent: 'Mozilla/5.0',
        device_fingerprint: 'fp_device1'
      }

      const respuesta2: CreateRespuestaAsistenciaInput = {
        formulario_id: testFormularioId,
        nombre_completo: 'Pedro Martínez',
        numero_documento: '5555555555',
        cargo: 'Auxiliar',
        numero_telefono: '3009999999',
        firma: 'data:image/png;base64,test2',
        ip_address: '192.168.1.102',
        user_agent: 'Mozilla/5.0',
        device_fingerprint: 'fp_device2'
      }

      const r1 = await AsistenciasService.crearRespuesta(respuesta1)
      const r2 = await AsistenciasService.crearRespuesta(respuesta2)

      expect(r1.id).not.toBe(r2.id)
      expect(r1.device_fingerprint).toBe('fp_device1')
      expect(r2.device_fingerprint).toBe('fp_device2')

      // Verificar que se contabilicen correctamente
      const formulario = await AsistenciasService.obtenerPorId(testFormularioId)
      expect(formulario?._count?.respuestas).toBe(2)
    })

    it('debe rechazar respuesta duplicada del mismo dispositivo (device_fingerprint)', async () => {
      const input: CreateRespuestaAsistenciaInput = {
        formulario_id: testFormularioId,
        nombre_completo: 'Juan Pérez',
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,test',
        ip_address: '192.168.1.100',
        user_agent: 'Mozilla/5.0',
        device_fingerprint: 'fp_duplicado'
      }

      // Primera respuesta exitosa
      await AsistenciasService.crearRespuesta(input)

      // Segunda respuesta con el mismo fingerprint debe fallar
      const input2: CreateRespuestaAsistenciaInput = {
        ...input,
        nombre_completo: 'Otro Nombre',
        numero_documento: '9999999999',
        device_fingerprint: 'fp_duplicado' // Mismo fingerprint
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input2)
      }).rejects.toThrow()
    })

    it('debe rechazar respuesta en formulario inactivo', async () => {
      // Desactivar el formulario
      await AsistenciasService.actualizar(testFormularioId, { activo: false })

      const input: CreateRespuestaAsistenciaInput = {
        formulario_id: testFormularioId,
        nombre_completo: 'Test Usuario',
        numero_documento: '1111111111',
        cargo: 'Test',
        numero_telefono: '3000000000',
        firma: 'data:image/png;base64,test',
        ip_address: '127.0.0.1',
        user_agent: 'test',
        device_fingerprint: 'fp_test'
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input)
      }).rejects.toThrow()
    })
  })

  describe('Obtener Respuestas', () => {
    beforeEach(async () => {
      // Crear múltiples respuestas de test
      const respuestas = [
        {
          nombre_completo: 'Ana Torres',
          numero_documento: '1111111111',
          cargo: 'Conductor',
          device_fingerprint: 'fp_ana'
        },
        {
          nombre_completo: 'Luis Vargas',
          numero_documento: '2222222222',
          cargo: 'Mecánico',
          device_fingerprint: 'fp_luis'
        },
        {
          nombre_completo: 'Sandra López',
          numero_documento: '3333333333',
          cargo: 'Supervisor',
          device_fingerprint: 'fp_sandra'
        }
      ]

      for (const r of respuestas) {
        await AsistenciasService.crearRespuesta({
          formulario_id: testFormularioId,
          nombre_completo: r.nombre_completo,
          numero_documento: r.numero_documento,
          cargo: r.cargo,
          numero_telefono: '3000000000',
          firma: 'data:image/png;base64,test',
          ip_address: '127.0.0.1',
          user_agent: 'test',
          device_fingerprint: r.device_fingerprint
        })
      }
    })

    it('debe obtener todas las respuestas de un formulario', async () => {
      const respuestas = await AsistenciasService.obtenerRespuestas(testFormularioId)

      expect(respuestas).toBeDefined()
      expect(respuestas.length).toBe(3)
      expect(respuestas[0]).toHaveProperty('nombre_completo')
      expect(respuestas[0]).toHaveProperty('numero_documento')
      expect(respuestas[0]).toHaveProperty('cargo')
      expect(respuestas[0]).toHaveProperty('firma')
    })

    it('debe retornar array vacío si formulario no tiene respuestas', async () => {
      // Crear nuevo formulario sin respuestas
      const nuevoFormulario = await AsistenciasService.crear({
        tematica: 'Formulario Sin Respuestas',
        fecha: new Date('2026-02-01').toISOString(),
        tipo_evento: 'charla'
      }, testUserId)

      const respuestas = await AsistenciasService.obtenerRespuestas(nuevoFormulario.id)

      expect(respuestas).toBeDefined()
      expect(respuestas.length).toBe(0)
    })

    it('debe incluir información del formulario al obtener respuestas', async () => {
      const formulario = await AsistenciasService.obtenerPorId(testFormularioId)

      expect(formulario).toBeDefined()
      expect(formulario?.respuestas).toBeDefined()
      expect(formulario?.respuestas.length).toBe(3)
      expect(formulario?._count?.respuestas).toBe(3)
    })
  })

  describe('Validaciones de Respuesta', () => {
    it('debe fallar si falta el nombre completo', async () => {
      const input: any = {
        formulario_id: testFormularioId,
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,test',
        ip_address: '127.0.0.1',
        user_agent: 'test',
        device_fingerprint: 'fp_test'
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input)
      }).rejects.toThrow()
    })

    it('debe fallar si falta el número de documento', async () => {
      const input: any = {
        formulario_id: testFormularioId,
        nombre_completo: 'Test Usuario',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,test',
        ip_address: '127.0.0.1',
        user_agent: 'test',
        device_fingerprint: 'fp_test'
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input)
      }).rejects.toThrow()
    })

    it('debe fallar si falta la firma', async () => {
      const input: any = {
        formulario_id: testFormularioId,
        nombre_completo: 'Test Usuario',
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        ip_address: '127.0.0.1',
        user_agent: 'test',
        device_fingerprint: 'fp_test'
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input)
      }).rejects.toThrow()
    })

    it('debe fallar si falta el device_fingerprint', async () => {
      const input: any = {
        formulario_id: testFormularioId,
        nombre_completo: 'Test Usuario',
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,test',
        ip_address: '127.0.0.1',
        user_agent: 'test'
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input)
      }).rejects.toThrow()
    })

    it('debe fallar con formulario_id inválido', async () => {
      const input: CreateRespuestaAsistenciaInput = {
        formulario_id: '00000000-0000-0000-0000-000000000000',
        nombre_completo: 'Test Usuario',
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,test',
        ip_address: '127.0.0.1',
        user_agent: 'test',
        device_fingerprint: 'fp_test'
      }

      await expect(async () => {
        await AsistenciasService.crearRespuesta(input)
      }).rejects.toThrow()
    })
  })

  describe('Eliminación de Respuestas', () => {
    it('debe eliminar respuestas al eliminar formulario', async () => {
      // Crear respuesta
      await AsistenciasService.crearRespuesta({
        formulario_id: testFormularioId,
        nombre_completo: 'Test Usuario',
        numero_documento: '1234567890',
        cargo: 'Conductor',
        numero_telefono: '3001234567',
        firma: 'data:image/png;base64,test',
        ip_address: '127.0.0.1',
        user_agent: 'test',
        device_fingerprint: 'fp_test'
      })

      const respuestasAntes = await AsistenciasService.obtenerRespuestas(testFormularioId)
      expect(respuestasAntes.length).toBe(1)

      // Eliminar formulario
      await AsistenciasService.eliminar(testFormularioId)

      // Verificar que las respuestas también se eliminaron
      const respuestasDespues = await prisma.respuestas_asistencia.findMany({
        where: { formulario_id: testFormularioId }
      })
      expect(respuestasDespues.length).toBe(0)
    })
  })
})
