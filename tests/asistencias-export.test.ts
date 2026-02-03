import { describe, it, expect, beforeEach } from 'vitest'
import { AsistenciasService } from '../src/modules/asistencias/asistencias.service'
import { prisma } from './setup'

describe('Asistencias - Exportar Respuestas', () => {
  let testUserId: string
  let testFormularioId: string

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

    // Crear formulario con todos los detalles
    const formulario = await AsistenciasService.crear({
      tematica: 'Capacitación Integral de Seguridad Vial',
      objetivo: 'Reducir en un 30% los incidentes viales mediante formación especializada',
      fecha: new Date('2026-03-15').toISOString(),
      hora_inicio: '08:00',
      hora_finalizacion: '17:00',
      tipo_evento: 'capacitacion',
      lugar_sede: 'Sede Principal - Auditorio Principal Piso 3',
      nombre_instructor: 'Ing. Carlos Ramírez Mora - Especialista ARL Sura'
    }, testUserId)

    testFormularioId = formulario.id

    // Crear múltiples respuestas de test
    const respuestas = [
      {
        nombre_completo: 'Juan Carlos Pérez García',
        numero_documento: '1234567890',
        cargo: 'Conductor Clase A',
        numero_telefono: '3001234567',
        device_fingerprint: 'fp_juan'
      },
      {
        nombre_completo: 'María Fernanda González López',
        numero_documento: '9876543210',
        cargo: 'Supervisora de Operaciones',
        numero_telefono: '3007654321',
        device_fingerprint: 'fp_maria'
      },
      {
        nombre_completo: 'Pedro Antonio Martínez Silva',
        numero_documento: '5555555555',
        cargo: 'Mecánico Senior',
        numero_telefono: '3009999999',
        device_fingerprint: 'fp_pedro'
      },
      {
        nombre_completo: 'Ana Lucía Torres Ramírez',
        numero_documento: '1111111111',
        cargo: 'Auxiliar Administrativo',
        numero_telefono: '3002222222',
        device_fingerprint: 'fp_ana'
      },
      {
        nombre_completo: 'Luis Eduardo Vargas Castro',
        numero_documento: '7777777777',
        cargo: 'Conductor Clase B',
        numero_telefono: '3008888888',
        device_fingerprint: 'fp_luis'
      }
    ]

    for (const r of respuestas) {
      await AsistenciasService.crearRespuesta(
        testFormularioId,
        {
          nombre_completo: r.nombre_completo,
          numero_documento: r.numero_documento,
          cargo: r.cargo,
          numero_telefono: r.numero_telefono,
          firma: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          device_fingerprint: r.device_fingerprint
        },
        '192.168.1.100',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      )
    }
  })

  describe('Estructura de Datos de Exportación', () => {
    it('debe retornar datos del formulario y respuestas', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      expect(exportData).toBeDefined()
      expect(exportData).toHaveProperty('formulario')
      expect(exportData).toHaveProperty('respuestas')
    })

    it('debe incluir todos los campos del formulario', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      expect(exportData.formulario).toBeDefined()
      expect(exportData.formulario.tematica).toBe('Capacitación Integral de Seguridad Vial')
      expect(exportData.formulario.objetivo).toBe('Reducir en un 30% los incidentes viales mediante formación especializada')
      expect(exportData.formulario.fecha).toBeDefined()
      expect(exportData.formulario.hora_inicio).toBe('08:00')
      expect(exportData.formulario.hora_finalizacion).toBe('17:00')
      expect(exportData.formulario.duracion_minutos).toBe(540) // 9 horas = 540 minutos
      expect(exportData.formulario.tipo_evento).toBe('capacitacion')
      expect(exportData.formulario.lugar_sede).toBe('Sede Principal - Auditorio Principal Piso 3')
      expect(exportData.formulario.nombre_instructor).toBe('Ing. Carlos Ramírez Mora - Especialista ARL Sura')
    })

    it('debe incluir todas las respuestas', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      expect(exportData.respuestas).toBeDefined()
      expect(exportData.respuestas.length).toBe(5)
    })

    it('debe incluir los campos correctos de cada respuesta', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      const primeraRespuesta = exportData.respuestas[0]
      
      expect(primeraRespuesta).toHaveProperty('nombre_completo')
      expect(primeraRespuesta).toHaveProperty('numero_documento')
      expect(primeraRespuesta).toHaveProperty('cargo')
      expect(primeraRespuesta).toHaveProperty('numero_telefono')
      expect(primeraRespuesta).toHaveProperty('fecha_respuesta')

      // Verificar que NO incluye datos sensibles
      expect(primeraRespuesta).not.toHaveProperty('firma')
      expect(primeraRespuesta).not.toHaveProperty('ip_address')
      expect(primeraRespuesta).not.toHaveProperty('user_agent')
      expect(primeraRespuesta).not.toHaveProperty('device_fingerprint')
    })

    it('debe ordenar respuestas por fecha de creación (más antigua primero)', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      // Verificar orden cronológico
      for (let i = 0; i < exportData.respuestas.length - 1; i++) {
        const fechaActual = new Date(exportData.respuestas[i].fecha_respuesta)
        const fechaSiguiente = new Date(exportData.respuestas[i + 1].fecha_respuesta)
        expect(fechaActual.getTime()).toBeLessThanOrEqual(fechaSiguiente.getTime())
      }
    })
  })

  describe('Casos Especiales', () => {
    it('debe exportar correctamente formulario sin respuestas', async () => {
      // Crear formulario nuevo sin respuestas
      const nuevoFormulario = await AsistenciasService.crear({
        tematica: 'Charla de Primeros Auxilios',
        fecha: new Date('2026-04-01').toISOString(),
        tipo_evento: 'charla'
      }, testUserId)

      const exportData = await AsistenciasService.exportarRespuestas(nuevoFormulario.id)

      expect(exportData.formulario).toBeDefined()
      expect(exportData.respuestas).toBeDefined()
      expect(exportData.respuestas.length).toBe(0)
    })

    it('debe exportar formulario con tipo_evento "otro"', async () => {
      // Crear formulario con tipo "otro"
      const formularioOtro = await AsistenciasService.crear({
        tematica: 'Evento Especial',
        fecha: new Date('2026-05-10').toISOString(),
        tipo_evento: 'otro',
        tipo_evento_otro: 'Workshop Práctico de Innovación'
      }, testUserId)

      const exportData = await AsistenciasService.exportarRespuestas(formularioOtro.id)

      expect(exportData.formulario.tipo_evento).toBe('otro')
      expect(exportData.formulario.tipo_evento_otro).toBe('Workshop Práctico de Innovación')
    })

    it('debe exportar formulario con campos opcionales vacíos', async () => {
      // Crear formulario mínimo
      const formularioMinimo = await AsistenciasService.crear({
        tematica: 'Reunión Rápida',
        fecha: new Date('2026-06-15').toISOString(),
        tipo_evento: 'reunion'
      }, testUserId)

      const exportData = await AsistenciasService.exportarRespuestas(formularioMinimo.id)

      expect(exportData.formulario.tematica).toBe('Reunión Rápida')
      expect(exportData.formulario.objetivo).toBeUndefined()
      expect(exportData.formulario.hora_inicio).toBeUndefined()
      expect(exportData.formulario.hora_finalizacion).toBeUndefined()
      expect(exportData.formulario.duracion_minutos).toBeUndefined()
      expect(exportData.formulario.lugar_sede).toBeUndefined()
      expect(exportData.formulario.nombre_instructor).toBeUndefined()
    })

    it('debe fallar al exportar formulario inexistente', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'

      await expect(async () => {
        await AsistenciasService.exportarRespuestas(fakeId)
      }).rejects.toThrow('Formulario no encontrado')
    })
  })

  describe('Integridad de Datos', () => {
    it('debe exportar la cantidad correcta de respuestas', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      // Contar respuestas directamente en la BD
      const countDB = await prisma.respuestas_asistencia.count({
        where: { formulario_id: testFormularioId }
      })

      expect(exportData.respuestas.length).toBe(countDB)
      expect(exportData.respuestas.length).toBe(5)
    })

    it('debe verificar que todos los nombres están en la exportación', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      const nombresEsperados = [
        'Juan Carlos Pérez García',
        'María Fernanda González López',
        'Pedro Antonio Martínez Silva',
        'Ana Lucía Torres Ramírez',
        'Luis Eduardo Vargas Castro'
      ]

      const nombresExportados = exportData.respuestas.map(r => r.nombre_completo)

      for (const nombre of nombresEsperados) {
        expect(nombresExportados).toContain(nombre)
      }
    })

    it('debe verificar formato ISO de fechas', async () => {
      const exportData = await AsistenciasService.exportarRespuestas(testFormularioId)

      // Verificar fecha del formulario
      expect(() => new Date(exportData.formulario.fecha)).not.toThrow()
      const fechaFormulario = new Date(exportData.formulario.fecha)
      expect(fechaFormulario.toISOString()).toBe(exportData.formulario.fecha)

      // Verificar fechas de respuestas
      for (const respuesta of exportData.respuestas) {
        expect(() => new Date(respuesta.fecha_respuesta)).not.toThrow()
        const fechaRespuesta = new Date(respuesta.fecha_respuesta)
        expect(fechaRespuesta.toISOString()).toBe(respuesta.fecha_respuesta)
      }
    })
  })

  describe('Tipos de Evento', () => {
    const tiposEvento = [
      { tipo: 'capacitacion', label: 'Capacitación' },
      { tipo: 'asesoria', label: 'Asesoría' },
      { tipo: 'charla', label: 'Charla' },
      { tipo: 'induccion', label: 'Inducción' },
      { tipo: 'reunion', label: 'Reunión' },
      { tipo: 'divulgacion', label: 'Divulgación' }
    ]

    for (const { tipo, label } of tiposEvento) {
      it(`debe exportar correctamente formulario tipo "${label}"`, async () => {
        const formulario = await AsistenciasService.crear({
          tematica: `${label} de Test`,
          fecha: new Date('2026-07-01').toISOString(),
          tipo_evento: tipo as any
        }, testUserId)

        const exportData = await AsistenciasService.exportarRespuestas(formulario.id)

        expect(exportData.formulario.tipo_evento).toBe(tipo)
      })
    }
  })
})
