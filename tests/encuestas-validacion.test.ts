import { describe, expect, it } from 'vitest'
import { encuestaSchema, type Pregunta } from '../src/modules/encuestas/encuestas.schema'
import { validarRespuestas } from '../src/modules/encuestas/encuestas.service'

const opcionA = { id: '11111111-1111-4111-8111-111111111111', texto: 'A' }
const opcionB = { id: '22222222-2222-4222-8222-222222222222', texto: 'B' }
const pregunta: Pregunta = {
  id: '33333333-3333-4333-8333-333333333333', titulo: '¿Qué opción?',
  descripcion: '', tipo: 'OPCION_UNICA', requerida: true, opciones: [opcionA, opcionB]
}

describe('encuestas públicas', () => {
  it('rechaza opciones ajenas y preguntas inventadas', () => {
    expect(() => validarRespuestas([pregunta], { [pregunta.id]: 'otra' })).toThrow('Opción inválida')
    expect(() => validarRespuestas([pregunta], { [pregunta.id]: opcionA.id, otra: 'x' })).toThrow('La encuesta cambió')
  })

  it('exige texto real en preguntas obligatorias', () => {
    const texto: Pregunta = { ...pregunta, tipo: 'TEXTO_CORTO', opciones: [] }
    expect(() => validarRespuestas([texto], { [texto.id]: '   ' })).toThrow('Responde')
  })

  it('valida fechas de calendario y límites de escala', () => {
    const fecha: Pregunta = { ...pregunta, tipo: 'FECHA', opciones: [] }
    const escala: Pregunta = { ...pregunta, id: '44444444-4444-4444-8444-444444444444', tipo: 'ESCALA', opciones: [], minimo: 1, maximo: 5 }
    expect(() => validarRespuestas([fecha], { [fecha.id]: '2026-02-31' })).toThrow('Fecha inválida')
    expect(() => validarRespuestas([escala], { [escala.id]: 6 })).toThrow('Valor fuera de escala')
  })

  it('requiere dos opciones y preguntas con identificadores únicos', () => {
    const base = {
      titulo: 'Encuesta de prueba', descripcion: null, mensaje_final: null,
      nombre_modo: 'NO', correo_modo: 'NO', registrar_origen: false,
      politica_origen: 'PERMITIR', fecha_cierre: null
    }
    expect(encuestaSchema.safeParse({ ...base, preguntas: [{ ...pregunta, opciones: [opcionA] }] }).success).toBe(false)
    expect(encuestaSchema.safeParse({ ...base, preguntas: [pregunta, pregunta] }).success).toBe(false)
  })
})
