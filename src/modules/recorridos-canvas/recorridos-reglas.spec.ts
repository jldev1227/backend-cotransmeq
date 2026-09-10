import { describe, it, expect } from 'vitest'
import {
  CAMPOS_SEGMENTO,
  CAMPOS_DIA,
  ValorInvalido,
  aBooleano,
  normalizar,
  validarCoherencia,
  exigirNoVacio,
} from './recorridos-reglas'

describe('lista blanca de campos', () => {
  it('el tipo de día NO es editable desde un recorrido', () => {
    // El tipo es del día: cambiarlo en un tramo afectaría a los demás tramos de
    // la misma jornada sin que el usuario lo vea.
    expect(CAMPOS_SEGMENTO['tipo_dia']).toBeUndefined()
    expect(CAMPOS_DIA['tipo_dia']).toBe('tipo_dia')
  })

  it('la fecha no es editable en ninguna fila', () => {
    // Mover un recorrido de día descuadraría los conteos de bono por mes.
    expect(CAMPOS_SEGMENTO['fecha']).toBeUndefined()
    expect(CAMPOS_DIA['fecha']).toBeUndefined()
  })

  it('no deja escribir campos derivados ni de identidad', () => {
    for (const campo of ['id', 'version', 'registro_dia_id', 'cliente_id', 'vehiculo_id']) {
      expect(CAMPOS_SEGMENTO[campo]).toBeUndefined()
    }
  })
})

describe('lectura de la casilla', () => {
  it('acepta las formas en que puede llegar un SÍ', () => {
    for (const v of ['SÍ', 'SI', 'sí', 'si', true, 1, 'X', 'x', 'TRUE', 'Verdadero']) {
      expect(aBooleano(v)).toBe(true)
    }
  })

  it('todo lo demás es NO', () => {
    for (const v of ['NO', '', null, undefined, false, 0, 'quizá']) {
      expect(aBooleano(v)).toBe(false)
    }
  })
})

describe('normalización de horas', () => {
  it('rellena con cero a la izquierda', () => {
    // No es cosmético: la CHECK de la tabla compara las horas como TEXTO, y en
    // esa comparación «9:00» es MAYOR que «10:00».
    expect(normalizar('hora_inicio', '7:15', 'hora')).toBe('07:15')
    expect(normalizar('hora_inicio', '07:15', 'hora')).toBe('07:15')
  })

  it('rechaza lo que no es una hora', () => {
    for (const v of ['25:00', '07:99', '7', 'mañana', '7.15']) {
      expect(() => normalizar('hora_inicio', v, 'hora')).toThrow(ValorInvalido)
    }
  })

  it('una hora vacía se guarda como nula, no como cadena vacía', () => {
    expect(normalizar('hora_fin', '', 'hora')).toBeNull()
    expect(normalizar('hora_fin', null, 'hora')).toBeNull()
  })
})

describe('normalización de números', () => {
  it('las horas conducidas se limitan a un decimal y al rango 0-24', () => {
    expect(normalizar('horas_conducidas', '8.26', 'decimal')).toBe(8.3)
    expect(() => normalizar('horas_conducidas', 25, 'decimal')).toThrow(ValorInvalido)
    expect(() => normalizar('horas_conducidas', -1, 'decimal')).toThrow(ValorInvalido)
  })

  it('una celda vacía de horas es 0, no NaN', () => {
    expect(normalizar('horas_conducidas', '', 'decimal')).toBe(0)
  })

  it('el kilometraje vacío es nulo (no se conoce), no cero', () => {
    // Cero significaría «el odómetro marcaba 0», que es otra cosa.
    expect(normalizar('km_inicial', '', 'entero')).toBeNull()
    expect(normalizar('km_inicial', '1500.7', 'entero')).toBe(1501)
    expect(() => normalizar('km_inicial', 'abc', 'entero')).toThrow(ValorInvalido)
  })
})

describe('tipo de día', () => {
  it('acepta los cuatro tipos, en cualquier caja', () => {
    expect(normalizar('tipo_dia', 'laborado', 'tipo_dia')).toBe('LABORADO')
    expect(normalizar('tipo_dia', 'MANTENIMIENTO', 'tipo_dia')).toBe('MANTENIMIENTO')
  })

  it('rechaza un tipo inventado y dice cuáles valen', () => {
    expect(() => normalizar('tipo_dia', 'VACACIONES', 'tipo_dia')).toThrow(/LABORADO/)
  })
})

describe('coherencia de la fila', () => {
  const base = {
    hora_inicio: '08:00',
    hora_fin: '17:00',
    pernocte: false,
    km_inicial: 100,
    km_final: 200,
  }

  it('deja pasar una jornada normal', () => {
    expect(() => validarCoherencia(base)).not.toThrow()
  })

  it('rechaza que el fin sea anterior al inicio sin pernocte', () => {
    expect(() => validarCoherencia({ ...base, hora_fin: '06:00' })).toThrow(
      /debe ser posterior/,
    )
  })

  it('PERMITE que el fin sea anterior al inicio CON pernocte', () => {
    // Es un turno que cruza la medianoche: sale a las 20:00 y llega a las 06:00.
    expect(() =>
      validarCoherencia({ ...base, hora_inicio: '20:00', hora_fin: '06:00', pernocte: true }),
    ).not.toThrow()
  })

  it('rechaza un kilometraje final menor que el inicial', () => {
    expect(() => validarCoherencia({ ...base, km_final: 50 })).toThrow(/no puede ser menor/)
  })

  it('no exige kilometraje: si falta uno de los dos, no hay nada que comparar', () => {
    expect(() => validarCoherencia({ ...base, km_final: null })).not.toThrow()
    expect(() => validarCoherencia({ ...base, km_inicial: null })).not.toThrow()
  })

  it('no exige horas: un día sin horario es válido', () => {
    expect(() =>
      validarCoherencia({ ...base, hora_inicio: null, hora_fin: null }),
    ).not.toThrow()
  })
})

describe('campos que no se pueden vaciar', () => {
  it('rechaza vaciar la placa y las horas de un recorrido', () => {
    // En cotransmeq esas columnas son NOT NULL; en transmeralda no, pero un
    // recorrido sin vehículo ni horario no significa nada en ninguna de las dos.
    for (const campo of ['vehiculo_placa', 'hora_inicio', 'hora_fin']) {
      for (const vacio of ['', null, undefined]) {
        expect(() => exigirNoVacio(campo, vacio)).toThrow(/no puede quedar vacía/)
      }
    }
  })

  it('deja vaciar lo que sí admite estar en blanco', () => {
    for (const campo of ['cliente_nombre', 'observaciones', 'km_inicial']) {
      expect(() => exigirNoVacio(campo, '')).not.toThrow()
    }
  })

  it('no molesta cuando el valor viene lleno', () => {
    expect(() => exigirNoVacio('vehiculo_placa', 'FST006')).not.toThrow()
  })
})
