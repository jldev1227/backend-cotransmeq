/**
 * Resolución de audiencia: a quién le aparece un formulario.
 *
 * `condicionAcceso` es la ÚNICA definición de «accesible» del módulo: la usan
 * el listado, la apertura de una asignación, el guardado del borrador y el
 * envío final. Si deja pasar un target de más, lo deja pasar en las cuatro; si
 * olvida uno, desaparece de las cuatro. Por eso se prueba directamente el
 * `where` que construye y no solo el resultado de una de ellas.
 *
 * No toca la base: se sustituye `prisma` por un doble que devuelve la ficha del
 * actor y registra qué se le preguntó.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const fichas = {
  conductor: null as any,
  usuario: null as any,
  vehiculos: [] as any[],
}

vi.mock('../src/config/prisma', () => ({
  prisma: {
    conductores: { findFirst: async () => fichas.conductor },
    usuarios: { findFirst: async () => fichas.usuario },
    vehiculos: { findMany: async () => fichas.vehiculos },
  },
}))

vi.mock('../src/config/aws', () => ({
  getS3UploadUrl: async () => '',
  getS3SignedUrl: async () => '',
  sha256HexToBase64: () => '',
  headS3Object: async () => ({}),
  computeS3ObjectSha256: async () => '',
}))
vi.mock('../src/config/env', () => ({ env: { AWS_S3_BUCKET: 'b', JWT_SECRET: 's' } }))
vi.mock('../src/utils/logger', () => ({ logger: { warn() {}, error() {}, info() {} } }))

import { condicionAcceso } from '../src/modules/formularios-dinamicos/formularios-portal.service'
import { claveLimite } from '../src/modules/formularios-dinamicos/formularios-portal.locks'
import { FormError, TARGET_TYPES, esTargetDeUsuario } from '../src/modules/formularios-dinamicos/domain'

/** Los targets del `OR` que devuelve `condicionAcceso`, ya desenvueltos. */
async function targetsDe(actor: any): Promise<any[]> {
  const where: any = await condicionAcceso(actor)
  return where.targets.some.OR
}

/** `true` si el `OR` incluye un target de ese tipo. */
function tiene(targets: any[], type: string): boolean {
  return targets.some((t) => t.target_type === type)
}

beforeEach(() => {
  fichas.conductor = { id: 'cond-1', sede_trabajo: 'Yopal' }
  fichas.usuario = { id: 'user-1', area: ['administracion'], cargo: 'Analista HSEQ' }
  fichas.vehiculos = []
})

// ═════════════════════════════════════════════════════════════════════════════
describe('condicionAcceso · las dos familias de audiencia', () => {
  it('un conductor NUNCA alcanza targets de personal interno', async () => {
    const targets = await targetsDe({ kind: 'CONDUCTOR', id: 'cond-1' })
    for (const tipo of TARGET_TYPES.filter(esTargetDeUsuario)) {
      expect(tiene(targets, tipo)).toBe(false)
    }
    expect(tiene(targets, 'ALL_CONDUCTORS')).toBe(true)
  })

  it('un usuario interno NUNCA alcanza targets de conductor', async () => {
    const targets = await targetsDe({ kind: 'USER', id: 'user-1' })
    for (const tipo of TARGET_TYPES.filter((t) => !esTargetDeUsuario(t))) {
      expect(tiene(targets, tipo)).toBe(false)
    }
    expect(tiene(targets, 'ALL_USERS')).toBe(true)
  })

  /// Es el caso que motivó todo el trabajo: UNA asignación con
  /// `ALL_CONDUCTORS` + `AREA` tiene que alcanzar a las dos poblaciones. El
  /// resto del `where` —activa, no borrada, versión publicada— es idéntico para
  /// ambas, así que basta con que cada uno vea su propio target.
  it('la misma asignación alcanza a las dos poblaciones', async () => {
    expect(tiene(await targetsDe({ kind: 'CONDUCTOR', id: 'cond-1' }), 'ALL_CONDUCTORS')).toBe(true)
    expect(tiene(await targetsDe({ kind: 'USER', id: 'user-1' }), 'AREA')).toBe(true)
  })

  it('el resto del filtro no depende del tipo de actor', async () => {
    const deConductor: any = await condicionAcceso({ kind: 'CONDUCTOR', id: 'cond-1' } as any)
    const deUsuario: any = await condicionAcceso({ kind: 'USER', id: 'user-1' } as any)
    for (const clave of ['deleted_at', 'status'] as const) {
      expect(deUsuario[clave]).toEqual(deConductor[clave])
    }
    expect(deUsuario.version).toEqual(deConductor.version)
    /// `PAUSED` fuera y solo versiones publicadas: pausar una asignación es el
    /// rollback funcional del módulo y tiene que funcionar para los dos.
    expect(deUsuario.status).toBe('ACTIVE')
    expect(deUsuario.version.status).toBe('PUBLISHED')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('condicionAcceso · audiencia de un usuario interno', () => {
  it('USER apunta al usuario autenticado y no a otro', async () => {
    const targets = await targetsDe({ kind: 'USER', id: 'user-1' })
    expect(targets.find((t) => t.target_type === 'USER')).toEqual({
      target_type: 'USER',
      usuario_id: 'user-1',
    })
  })

  it('AREA usa TODAS las áreas del usuario, no solo la primera', async () => {
    fichas.usuario = { id: 'user-1', area: ['administracion', 'hseq'], cargo: null }
    const targets = await targetsDe({ kind: 'USER', id: 'user-1' })
    expect(targets.find((t) => t.target_type === 'AREA')?.area).toEqual({
      in: ['administracion', 'hseq'],
    })
  })

  /// Sin esta guarda, `area: { in: [] }` no casaría con nada —lo cual da la
  /// respuesta correcta por accidente— pero añadiría una rama muerta al OR de
  /// cada consulta del módulo.
  it('sin áreas no se añade la cláusula AREA', async () => {
    fichas.usuario = { id: 'user-1', area: [], cargo: null }
    expect(tiene(await targetsDe({ kind: 'USER', id: 'user-1' }), 'AREA')).toBe(false)
  })

  it('CARGO compara sin distinguir mayúsculas', async () => {
    const targets = await targetsDe({ kind: 'USER', id: 'user-1' })
    expect(targets.find((t) => t.target_type === 'CARGO')?.cargo).toEqual({
      equals: 'Analista HSEQ',
      mode: 'insensitive',
    })
  })

  it('un cargo vacío o en blanco no genera cláusula', async () => {
    for (const cargo of [null, '', '   ']) {
      fichas.usuario = { id: 'user-1', area: [], cargo }
      expect(tiene(await targetsDe({ kind: 'USER', id: 'user-1' }), 'CARGO')).toBe(false)
    }
  })

  /// Las áreas y el cargo se releen de la base en CADA petición. Si salieran del
  /// JWT, a alguien a quien se le retiró un área le seguirían apareciendo sus
  /// formularios hasta que caducara el token, que dura días.
  it('la audiencia sale de la base y no del actor recibido', async () => {
    fichas.usuario = { id: 'user-1', area: ['contabilidad'], cargo: null }
    const targets = await targetsDe({ kind: 'USER', id: 'user-1', areas: ['administracion'] } as any)
    expect(targets.find((t) => t.target_type === 'AREA')?.area).toEqual({ in: ['contabilidad'] })
  })

  it('un usuario inactivo o inexistente no accede a nada', async () => {
    fichas.usuario = null
    await expect(condicionAcceso({ kind: 'USER', id: 'user-1' } as any)).rejects.toBeInstanceOf(FormError)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('condicionAcceso · audiencia de un conductor (regresión)', () => {
  it('conserva ALL_CONDUCTORS, CONDUCTOR y SEDE', async () => {
    const targets = await targetsDe({ kind: 'CONDUCTOR', id: 'cond-1' })
    expect(tiene(targets, 'ALL_CONDUCTORS')).toBe(true)
    expect(targets.find((t) => t.target_type === 'CONDUCTOR')?.conductor_id).toBe('cond-1')
    expect(targets.find((t) => t.target_type === 'SEDE')?.sede).toBe('Yopal')
  })

  it('VEHICLE solo aparece si el conductor tiene vehículos asignados', async () => {
    expect(tiene(await targetsDe({ kind: 'CONDUCTOR', id: 'cond-1' }), 'VEHICLE')).toBe(false)
    fichas.vehiculos = [{ id: 'veh-1' }, { id: 'veh-2' }]
    const targets = await targetsDe({ kind: 'CONDUCTOR', id: 'cond-1' })
    expect(targets.find((t) => t.target_type === 'VEHICLE')?.vehicle_id).toEqual({ in: ['veh-1', 'veh-2'] })
  })

  /// `GROUP` existe en el enum, en el CHECK y en la UI, pero no hay catálogo de
  /// grupos contra el que resolverlo. Hoy no le aparece a nadie, y esta prueba
  /// existe para que eso sea una decisión visible y no un olvido.
  it('GROUP sigue sin resolverse para nadie', async () => {
    expect(tiene(await targetsDe({ kind: 'CONDUCTOR', id: 'cond-1' }), 'GROUP')).toBe(false)
    expect(tiene(await targetsDe({ kind: 'USER', id: 'user-1' }), 'GROUP')).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('claveLimite · el cupo es por persona, no por asignación', () => {
  const comun = {
    assignmentId: 'asg-1',
    limitPolicy: 'ONE_PER_PERIOD',
    frequency: 'DAILY',
    periodKey: '2026-09-01',
    contexto: {},
  }

  /// En una asignación mixta, si la clave no llevara la persona, el primer envío
  /// del día agotaría el cupo de todos los demás.
  it('dos personas de la misma asignación no comparten clave', () => {
    const a = claveLimite({ ...comun, actor: { kind: 'USER', id: 'user-1' } })
    const b = claveLimite({ ...comun, actor: { kind: 'USER', id: 'user-2' } })
    expect(a).not.toBe(b)
  })

  it('un conductor y un usuario con el mismo id tampoco la comparten', () => {
    const a = claveLimite({ ...comun, actor: { kind: 'CONDUCTOR', id: 'mismo' } })
    const b = claveLimite({ ...comun, actor: { kind: 'USER', id: 'mismo' } })
    expect(a).not.toBe(b)
  })

  it('la misma persona sí la comparte entre reintentos', () => {
    const a = claveLimite({ ...comun, actor: { kind: 'USER', id: 'user-1' } })
    const b = claveLimite({ ...comun, actor: { kind: 'USER', id: 'user-1' } })
    expect(a).toBe(b)
  })
})
