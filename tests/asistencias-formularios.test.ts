import { describe, it, expect, beforeEach } from 'vitest'
import { AsistenciasService } from '../src/modules/asistencias/asistencias.service'
import { prisma } from './setup'
import type { CreateFormularioAsistenciaInput, UpdateFormularioAsistenciaInput } from '../src/modules/asistencias/asistencias.schema'

describe('Asistencias - Formularios CRUD', () => {
  let testUserId: string
  let createdFormularioId: string

  beforeEach(async () => {
    // Limpiar datos de test anteriores
    await prisma.respuestas_asistencia.deleteMany()
    await prisma.formularios_asistencia.deleteMany()

    // Crear usuario de test si no existe
    const testUser = await prisma.usuarios.upsert({
      where: { correo: 'test@asistencias.com' },
      update: {},
      create: {
        nombre: 'Test User',
        correo: 'test@asistencias.com',
        password: 'hashedpassword123',
        role: 'admin'
      }
    })
    testUserId = testUser.id
  })

  describe('Crear Formulario', () => {
    it('debe crear un formulario básico exitosamente', async () => {
      const input: CreateFormularioAsistenciaInput = {
        tematica: 'Capacitación de Seguridad',
        objetivo: 'Entrenar al personal en normas de seguridad',
        fecha: new Date('2026-01-15').toISOString(),
        tipo_evento: 'capacitacion'
      }

      const formulario = await AsistenciasService.crear(input, testUserId)

      expect(formulario).toBeDefined()
      expect(formulario.id).toBeDefined()
      expect(formulario.tematica).toBe(input.tematica)
      expect(formulario.objetivo).toBe(input.objetivo)
      expect(formulario.tipo_evento).toBe('capacitacion')
      expect(formulario.token).toBeDefined()
      expect(formulario.token).toHaveLength(64)
      expect(formulario.activo).toBe(true)
      expect(formulario._count?.respuestas).toBe(0)

      createdFormularioId = formulario.id
    })

    it('debe crear formulario con todos los campos opcionales', async () => {
      const input: CreateFormularioAsistenciaInput = {
        tematica: 'Inducción a Nuevos Empleados',
        objetivo: 'Familiarizar a nuevos empleados con la empresa',
        fecha: new Date('2026-01-20').toISOString(),
        hora_inicio: '09:00',
        hora_finalizacion: '17:00',
        tipo_evento: 'induccion',
        lugar_sede: 'Oficina Principal - Sala de Conferencias',
        nombre_instructor: 'Juan Pérez - Recursos Humanos'
      }

      const formulario = await AsistenciasService.crear(input, testUserId)

      expect(formulario.tematica).toBe(input.tematica)
      expect(formulario.objetivo).toBe(input.objetivo)
      expect(formulario.hora_inicio).toBe('09:00')
      expect(formulario.hora_finalizacion).toBe('17:00')
      expect(formulario.duracion_minutos).toBe(480) // 8 horas = 480 minutos
      expect(formulario.tipo_evento).toBe('induccion')
      expect(formulario.lugar_sede).toBe(input.lugar_sede)
      expect(formulario.nombre_instructor).toBe(input.nombre_instructor)
    })

    it('debe crear formulario con tipo_evento "otro"', async () => {
      const input: CreateFormularioAsistenciaInput = {
        tematica: 'Evento Especial',
        fecha: new Date('2026-02-01').toISOString(),
        tipo_evento: 'otro',
        tipo_evento_otro: 'Workshop Práctico'
      }

      const formulario = await AsistenciasService.crear(input, testUserId)

      expect(formulario.tipo_evento).toBe('otro')
      expect(formulario.tipo_evento_otro).toBe('Workshop Práctico')
    })

    it('debe calcular duración correctamente para horarios que cruzan medianoche', async () => {
      const input: CreateFormularioAsistenciaInput = {
        tematica: 'Capacitación Nocturna',
        fecha: new Date('2026-01-25').toISOString(),
        hora_inicio: '22:00',
        hora_finalizacion: '02:00',
        tipo_evento: 'capacitacion'
      }

      const formulario = await AsistenciasService.crear(input, testUserId)

      expect(formulario.duracion_minutos).toBe(240) // 4 horas = 240 minutos
    })
  })

  describe('Obtener Formularios', () => {
    beforeEach(async () => {
      // Crear múltiples formularios de test
      await AsistenciasService.crear({
        tematica: 'Charla de Primeros Auxilios',
        objetivo: 'Enseñar técnicas básicas de primeros auxilios',
        fecha: new Date('2026-01-10').toISOString(),
        tipo_evento: 'charla',
        lugar_sede: 'Sede Norte'
      }, testUserId)

      await AsistenciasService.crear({
        tematica: 'Reunión de Coordinación',
        fecha: new Date('2026-01-12').toISOString(),
        hora_inicio: '14:00',
        hora_finalizacion: '16:00',
        tipo_evento: 'reunion'
      }, testUserId)
    })

    it('debe obtener todos los formularios', async () => {
      const formularios = await AsistenciasService.obtenerTodos()

      expect(formularios).toBeDefined()
      expect(formularios.length).toBeGreaterThanOrEqual(2)
      expect(formularios[0]).toHaveProperty('tematica')
      expect(formularios[0]).toHaveProperty('fecha')
      expect(formularios[0]).toHaveProperty('_count')
    })

    it('debe obtener formulario por ID', async () => {
      const formularios = await AsistenciasService.obtenerTodos()
      const formularioId = formularios[0].id

      const formulario = await AsistenciasService.obtenerPorId(formularioId)

      expect(formulario).toBeDefined()
      expect(formulario?.id).toBe(formularioId)
      expect(formulario?.tematica).toBeDefined()
    })

    it('debe obtener formulario por token (público)', async () => {
      const formularios = await AsistenciasService.obtenerTodos()
      const token = formularios[0].token

      const formulario = await AsistenciasService.obtenerPorToken(token)

      expect(formulario).toBeDefined()
      expect(formulario?.token).toBe(token)
      expect(formulario?.tematica).toBeDefined()
      expect(formulario?.activo).toBeDefined()
      // No debe incluir información sensible del creador en versión pública
      expect(formulario).not.toHaveProperty('creado_por')
    })
  })

  describe('Actualizar Formulario', () => {
    let formularioId: string

    beforeEach(async () => {
      const formulario = await AsistenciasService.crear({
        tematica: 'Asesoría Inicial',
        objetivo: 'Asesorar sobre el proceso',
        fecha: new Date('2026-01-18').toISOString(),
        tipo_evento: 'asesoria',
        hora_inicio: '10:00',
        hora_finalizacion: '11:00'
      }, testUserId)
      formularioId = formulario.id
    })

    it('debe actualizar campos básicos del formulario', async () => {
      const updateData: UpdateFormularioAsistenciaInput = {
        tematica: 'Asesoría Avanzada',
        objetivo: 'Asesorar sobre temas avanzados'
      }

      const updated = await AsistenciasService.actualizar(formularioId, updateData)

      expect(updated.tematica).toBe('Asesoría Avanzada')
      expect(updated.objetivo).toBe('Asesorar sobre temas avanzados')
      expect(updated.tipo_evento).toBe('asesoria') // No cambia
    })

    it('debe actualizar horarios y recalcular duración', async () => {
      const updateData: UpdateFormularioAsistenciaInput = {
        hora_inicio: '08:00',
        hora_finalizacion: '12:30'
      }

      const updated = await AsistenciasService.actualizar(formularioId, updateData)

      expect(updated.hora_inicio).toBe('08:00')
      expect(updated.hora_finalizacion).toBe('12:30')
      expect(updated.duracion_minutos).toBe(270) // 4.5 horas = 270 minutos
    })

    it('debe cambiar tipo de evento', async () => {
      const updateData: UpdateFormularioAsistenciaInput = {
        tipo_evento: 'capacitacion',
        lugar_sede: 'Sede Sur - Auditorio',
        nombre_instructor: 'María García - ARL Sura'
      }

      const updated = await AsistenciasService.actualizar(formularioId, updateData)

      expect(updated.tipo_evento).toBe('capacitacion')
      expect(updated.lugar_sede).toBe('Sede Sur - Auditorio')
      expect(updated.nombre_instructor).toBe('María García - ARL Sura')
    })

    it('debe desactivar formulario', async () => {
      const updateData: UpdateFormularioAsistenciaInput = {
        activo: false
      }

      const updated = await AsistenciasService.actualizar(formularioId, updateData)

      expect(updated.activo).toBe(false)
    })
  })

  describe('Eliminar Formulario', () => {
    it('debe eliminar formulario exitosamente', async () => {
      const formulario = await AsistenciasService.crear({
        tematica: 'Formulario a Eliminar',
        fecha: new Date('2026-01-30').toISOString(),
        tipo_evento: 'divulgacion'
      }, testUserId)

      await AsistenciasService.eliminar(formulario.id)

      const deleted = await AsistenciasService.obtenerPorId(formulario.id)
      expect(deleted).toBeNull()
    })

    it('debe eliminar formulario y todas sus respuestas (CASCADE)', async () => {
      const formulario = await AsistenciasService.crear({
        tematica: 'Formulario con Respuestas',
        fecha: new Date('2026-02-05').toISOString(),
        tipo_evento: 'capacitacion'
      }, testUserId)

      // Crear algunas respuestas
      await prisma.respuestas_asistencia.createMany({
        data: [
          {
            formulario_id: formulario.id,
            nombre_completo: 'Juan Pérez',
            numero_documento: '123456789',
            cargo: 'Conductor',
            numero_telefono: '3001234567',
            firma: 'data:image/png;base64,test',
            ip_address: '127.0.0.1',
            user_agent: 'test',
            device_fingerprint: 'fingerprint1'
          },
          {
            formulario_id: formulario.id,
            nombre_completo: 'María González',
            numero_documento: '987654321',
            cargo: 'Supervisor',
            numero_telefono: '3007654321',
            firma: 'data:image/png;base64,test2',
            ip_address: '127.0.0.2',
            user_agent: 'test',
            device_fingerprint: 'fingerprint2'
          }
        ]
      })

      const respuestasAntes = await prisma.respuestas_asistencia.count({
        where: { formulario_id: formulario.id }
      })
      expect(respuestasAntes).toBe(2)

      await AsistenciasService.eliminar(formulario.id)

      const respuestasDespues = await prisma.respuestas_asistencia.count({
        where: { formulario_id: formulario.id }
      })
      expect(respuestasDespues).toBe(0)
    })
  })

  describe('Validaciones', () => {
    it('debe fallar al crear formulario sin temática', async () => {
      const input: any = {
        fecha: new Date('2026-01-15').toISOString(),
        tipo_evento: 'capacitacion'
      }

      await expect(async () => {
        await AsistenciasService.crear(input, testUserId)
      }).rejects.toThrow()
    })

    it('debe fallar al actualizar formulario inexistente', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const updateData: UpdateFormularioAsistenciaInput = {
        tematica: 'Nueva Temática'
      }

      await expect(async () => {
        await AsistenciasService.actualizar(fakeId, updateData)
      }).rejects.toThrow()
    })
  })
})
