import { describe, it, expect } from 'vitest'
import {
  CAMPOS_SEGMENTO,
  CAMPOS_DIA,
  ValorInvalido,
  aBooleano,
  normalizar,
  validarCoherencia,
  exigirNoVacio,
  exigirDentroDelCorte,
  exigirNoFutura,
  numeroDeHoras,
  clasificarFilaNueva,
} from './recorridos-reglas'

describe('lista blanca de campos', () => {
  it('el tipo de día NO es editable desde un recorrido', () => {
    // El tipo es del día: cambiarlo en un tramo afectaría a los demás tramos de
    // la misma jornada sin que el usuario lo vea.
    expect(CAMPOS_SEGMENTO['tipo_dia']).toBeUndefined()
    expect(CAMPOS_DIA['tipo_dia']).toBe('tipo_dia')
  })

  it('la fecha es editable en las dos filas, y es la del DÍA', () => {
    // Corregir una fecha mal tecleada es la edición más común al revisar una
    // planilla. Se mueve la jornada entera: la fecha es del día, no del tramo.
    expect(CAMPOS_SEGMENTO['fecha']).toBe('fecha')
    expect(CAMPOS_DIA['fecha']).toBe('fecha')
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

describe('pernocte en una fila de DÍA', () => {
  /**
   * Los días sin recorrido —disponibilidad, descanso— son más de la mitad de
   * las filas de un corte y no tienen segmento donde colgar el pernocte. Antes
   * la casilla se pintaba y el clic moría contra la guarda.
   */
  it('es editable, y se interpreta como bandera', () => {
    expect(CAMPOS_DIA['pernocte']).toBe('flag')
  })

  it('el tipo de día sigue sin poder editarse desde un recorrido', () => {
    expect(CAMPOS_SEGMENTO['tipo_dia']).toBeUndefined()
  })
})

describe('desmarcar una casilla', () => {
  /**
   * El checkbox del canvas escribe «SÍ» / «NO», así que desmarcar llega como
   * el texto «NO» —no como `false`— y tiene que apagar la bandera.
   */
  it('«NO» apaga la bandera, y «SÍ» la enciende con o sin tilde', () => {
    expect(normalizar('pernocte', 'NO', 'flag')).toBe(false)
    expect(normalizar('pernocte', 'SÍ', 'flag')).toBe(true)
    expect(normalizar('pernocte', 'SI', 'flag')).toBe(true)
  })

  it('una celda vaciada con Supr también apaga', () => {
    expect(normalizar('pernocte', '', 'flag')).toBe(false)
    expect(normalizar('pernocte', null, 'flag')).toBe(false)
  })
})

describe('fecha', () => {
  it('exige AAAA-MM-DD y que exista en el calendario', () => {
    expect(normalizar('fecha', '2026-09-03', 'fecha')).toBe('2026-09-03')
    expect(() => normalizar('fecha', '03/09/2026', 'fecha')).toThrow(ValorInvalido)
    expect(() => normalizar('fecha', '2026-02-30', 'fecha')).toThrow(ValorInvalido)
    expect(() => normalizar('fecha', '', 'fecha')).toThrow(ValorInvalido)
  })

  it('rechaza una fecha fuera del corte abierto, con el corte en el mensaje', () => {
    const corte = { desde: '2026-08-21', hasta: '2026-09-20' }
    expect(() => exigirDentroDelCorte('2026-08-21', corte)).not.toThrow()
    expect(() => exigirDentroDelCorte('2026-09-20', corte)).not.toThrow()
    expect(() => exigirDentroDelCorte('2026-09-21', corte)).toThrow(/2026-08-21 a 2026-09-20/)
    expect(() => exigirDentroDelCorte('2026-08-20', corte)).toThrow(ValorInvalido)
  })

  it('no admite días futuros, igual que el portal del conductor', () => {
    expect(() => exigirNoFutura('2026-09-21', '2026-09-21')).not.toThrow()
    expect(() => exigirNoFutura('2026-09-22', '2026-09-21')).toThrow(/futura/)
  })
})

describe('horas tecleadas con la palabra', () => {
  it('acepta «6 horas», «6,5», «6h» y sigue rechazando texto', () => {
    // La columna muestra «6 horas» por formato numérico; quien lo ve lo teclea
    // igual. El valor guardado sigue siendo el número.
    expect(numeroDeHoras('6 horas')).toBe(6)
    expect(numeroDeHoras('6,5')).toBe(6.5)
    expect(numeroDeHoras('6.5h')).toBe(6.5)
    expect(numeroDeHoras('1 hora')).toBe(1)
    expect(Number.isNaN(numeroDeHoras('seis'))).toBe(true)
    expect(normalizar('horas_conducidas', '6 horas', 'decimal')).toBe(6)
    expect(() => normalizar('horas_conducidas', 'seis', 'decimal')).toThrow(ValorInvalido)
  })
})

describe('clasificación de una fila insertada en el canvas', () => {
  it('con placa y horario es un RECORRIDO (día LABORADO)', () => {
    const f = clasificarFilaNueva({
      fecha: '2026-09-03',
      vehiculo_placa: ' fst 006 ',
      hora_inicio: '6:00',
      hora_fin: '18:00',
      horas_conducidas: '6 horas',
    })
    expect(f.clase).toBe('recorrido')
    if (f.clase === 'recorrido') {
      expect(f.vehiculo_placa).toBe('FST006')
      expect(f.hora_inicio).toBe('06:00')
      expect(f.horas_conducidas).toBe(6)
    }
  })

  it('con placa pero sin horario, dice qué falta', () => {
    expect(() =>
      clasificarFilaNueva({ fecha: '2026-09-03', vehiculo_placa: 'FST006' }),
    ).toThrow(/la hora inicial y la hora final/)
  })

  it('sin placa ni horario es un DÍA, y necesita el tipo', () => {
    expect(() => clasificarFilaNueva({ fecha: '2026-09-03' })).toThrow(/TIPO DE DÍA/)
    const f = clasificarFilaNueva({ fecha: '2026-09-03', tipo_dia: 'descanso' })
    expect(f).toMatchObject({ clase: 'dia', tipo_dia: 'DESCANSO', vehiculo_placa: null })
  })

  it('un día LABORADO sin recorrido no existe', () => {
    expect(() => clasificarFilaNueva({ fecha: '2026-09-03', tipo_dia: 'LABORADO' })).toThrow(
      /al menos un recorrido/,
    )
  })

  it('MANTENIMIENTO lleva la placa en el día, no como recorrido', () => {
    expect(() => clasificarFilaNueva({ fecha: '2026-09-03', tipo_dia: 'MANTENIMIENTO' })).toThrow(
      /placa/,
    )
    const f = clasificarFilaNueva({
      fecha: '2026-09-03',
      tipo_dia: 'MANTENIMIENTO',
      vehiculo_placa: 'fst006',
    })
    expect(f).toMatchObject({ clase: 'dia', tipo_dia: 'MANTENIMIENTO', vehiculo_placa: 'FST006' })
  })

  it('un recorrido con tipo DESCANSO se contradice y se rechaza', () => {
    expect(() =>
      clasificarFilaNueva({
        fecha: '2026-09-03',
        tipo_dia: 'DESCANSO',
        vehiculo_placa: 'FST006',
        hora_inicio: '06:00',
        hora_fin: '18:00',
      }),
    ).toThrow(/LABORADO/)
  })

  it('aplica la coherencia de horas y kilómetros a la fila nueva', () => {
    expect(() =>
      clasificarFilaNueva({
        fecha: '2026-09-03',
        vehiculo_placa: 'FST006',
        hora_inicio: '18:00',
        hora_fin: '06:00',
      }),
    ).toThrow(/posterior/)
  })
})
