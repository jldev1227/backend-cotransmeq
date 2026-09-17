/**
 * Borrado lógico de envíos: retirar un formulario abierto por error.
 *
 * ── EL PROBLEMA QUE SE PRUEBA AQUÍ ──────────────────────────────────────────
 *
 * Abrir un formulario en el portal YA crea la fila: el primer backup del
 * borrador inserta un `form_submissions` en `DRAFT`. Quien entra a mirar un
 * preoperacional y se sale deja una tarjeta abierta que se acumula en el portal
 * y en el explorador del dashboard, y hasta ahora la única forma de retirarla
 * era un `DELETE` físico —que se llevaba respuestas, evidencia y bitácora por
 * cascada— o un script contra la base.
 *
 * Lo que estas pruebas fijan:
 *
 *   1. Descartar MARCA, no borra: la fila, sus respuestas y su evidencia siguen
 *      ahí, y queda un evento `DISCARDED` con quién lo hizo.
 *   2. Lo descartado DESAPARECE de todas las lecturas: la tarjeta del portal, el
 *      historial y el detalle.
 *   3. Nada lo REVIVE. Es la parte que no es obvia: el teléfono conserva el
 *      borrador en su outbox y lo reintenta, así que el backup y el envío final
 *      tienen que rechazarlo con un código terminal en vez de volver a
 *      escribirlo. Sin esto, el conductor borra la tarjeta y reaparece sola.
 *   4. Un envío ENTREGADO no se descarta: eso es anular (`VOIDED`), que conserva
 *      el registro y exige motivo.
 *
 * No se conecta a ninguna base de datos ni a S3: todo corre contra el doble de
 * `tests/helpers/forms-concurrencia.ts`, que aplica los predicados escalares
 * —`deleted_at` incluido— y los locks con semántica de Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { crearEntorno, usarEntorno, type Entorno } from './helpers/forms-concurrencia'

// ── Sustitución de los bordes, igual que en la suite de concurrencia ────────

vi.mock('../src/config/prisma', async () => {
  const h = await import('./helpers/forms-concurrencia')
  return { prisma: h.prismaProxy }
})

vi.mock('../src/config/aws', async () => {
  const h = await import('./helpers/forms-concurrencia')
  return {
    getS3UploadUrl: (...a: any[]) => h.awsProxy.getS3UploadUrl(...a),
    getS3SignedUrl: (...a: any[]) => h.awsProxy.getS3SignedUrl(...a),
    sha256HexToBase64: (...a: any[]) => h.awsProxy.sha256HexToBase64(...a),
    headS3Object: (...a: any[]) => h.awsProxy.headS3Object(...a),
    computeS3ObjectSha256: (...a: any[]) => h.awsProxy.computeS3ObjectSha256(...a),
  }
})

vi.mock('../src/config/env', async () => {
  const h = await import('./helpers/forms-concurrencia')
  return { env: h.envProxy }
})

vi.mock('../src/utils/logger', async () => {
  const h = await import('./helpers/forms-concurrencia')
  return { logger: h.loggerProxy, default: h.loggerProxy }
})

vi.mock('../src/modules/formularios-dinamicos/formularios-dinamicos.repository', () => ({
  findVersionAggregate: async () => ({ id: 'ver-1' }),
}))

vi.mock('../src/modules/formularios-dinamicos/formularios-dinamicos.mapper', () => ({
  toVersionDto: () => ({ id: 'ver-1', sections: [], fields: [] }),
  toSubmissionDetailDto: (row: any) => row,
  toSubmissionSummaryDto: (row: any) => row,
}))

vi.mock('../src/modules/formularios-dinamicos/formularios-respuestas', () => ({
  validateSubmissionAnswers: () => ({ errors: [], prepared: [] }),
}))

import {
  descartarBorradorPortal,
  enviarSubmission,
  guardarBorradorPortal,
  iniciarAdjunto,
  listarAsignacionesPortal,
  listarEnviosPortal,
  obtenerEnvioPortal,
} from '../src/modules/formularios-dinamicos/formularios-portal.service'
import { descartarEnvio } from '../src/modules/formularios-dinamicos/formularios-envios.service'

// ── Fixtures ────────────────────────────────────────────────────────────────

const ACTOR = { kind: 'CONDUCTOR', id: 'cond-1', cedula: '1000', nombre: 'Conductor Uno' } as const
const OTRO = { kind: 'CONDUCTOR', id: 'cond-2', cedula: '2000', nombre: 'Conductor Dos' } as const
const ADMIN = { id: 'user-1', nombre: 'HSEQ' }
const ZONA = 'America/Bogota'
const CSID = 'csid-a'

let entorno: Entorno

function sembrarBase() {
  entorno.sembrar('conductores', [
    { id: 'cond-1', deleted_at: null, sede_trabajo: 'Bogotá' },
    { id: 'cond-2', deleted_at: null, sede_trabajo: 'Bogotá' },
  ])
  entorno.sembrar('vehiculos', [{ id: 'veh-1', conductor_id: 'cond-1', deleted_at: null }])
  entorno.sembrar('form_assignment', [
    {
      id: 'asg-1',
      deleted_at: null,
      status: 'ACTIVE',
      version_id: 'ver-1',
      name: 'Preoperacional',
      frequency: 'DAILY',
      limit_policy: 'ONE_PER_PERIOD',
      timezone: ZONA,
      starts_at: null,
      ends_at: null,
      context_schema_json: null,
      settings_json: null,
      created_at: new Date('2026-08-01T00:00:00.000Z'),
      /// El doble ignora los `select`, así que la relación se siembra tal cual
      /// la consume `listarAsignacionesPortal`.
      version: {
        id: 'ver-1',
        form_id: 'form-1',
        version_number: 1,
        title: 'Preoperacional',
        revision: 3,
        form: { code: 'FR-09', name: 'Preoperacional' },
      },
    },
  ])
  entorno.sembrar('form_field', [
    { id: 'campo-foto', version_id: 'ver-1', type: 'PHOTO', key: 'foto' },
    { id: 'campo-texto', version_id: 'ver-1', type: 'TEXT', key: 'texto' },
  ])
}

/** Borrador ya existente en el servidor, con una respuesta y una evidencia. */
function sembrarBorrador(over: Record<string, any> = {}) {
  entorno.sembrar('form_submission', [
    {
      id: 'sub-1',
      client_submission_id: CSID,
      assignment_id: 'asg-1',
      version_id: 'ver-1',
      conductor_id: ACTOR.id,
      usuario_id: null,
      status: 'DRAFT',
      business_date: new Date('2026-08-19T00:00:00.000Z'),
      period_key: null,
      submitted_at: null,
      started_at: new Date('2026-08-19T10:00:00.000Z'),
      updated_at: new Date('2026-08-19T10:05:00.000Z'),
      vehicle_id: null,
      service_id: null,
      context_json: {},
      device_json: { progress: 40 },
      deleted_at: null,
      ...over,
    },
  ])
  entorno.sembrar('form_answer', [
    { id: 'ans-1', submission_id: 'sub-1', field_id: 'campo-texto', value_json: { draftValue: 'ok' } },
  ])
  entorno.sembrar('form_attachment', [
    {
      id: 'adj-1',
      submission_id: 'sub-1',
      client_attachment_id: 'cadj-1',
      kind: 'PHOTO',
      status: 'UPLOADED',
      object_key: 'formularios-dinamicos/ver-1/sub-1/cadj-1.jpeg',
      mime_type: 'image/jpeg',
      byte_size: BigInt(1024),
      sha256: 'a'.repeat(64),
      answer_id: null,
      uploaded_at: new Date('2026-08-19T10:04:00.000Z'),
      metadata_json: { fieldId: 'campo-foto', occurrenceId: null },
    },
  ])
}

function envio(id = 'sub-1') {
  return entorno.tabla('form_submission').find((f) => f.id === id)
}

function eventos(tipo: string) {
  return entorno.tabla('form_submission_event').filter((e) => e.event_type === tipo)
}

function codigo(err: unknown): string {
  return (err as any)?.code ?? `SIN_CODIGO(${String(err)})`
}

function entradaEnvio(over: Record<string, any> = {}): any {
  return {
    clientSubmissionId: CSID,
    assignmentId: 'asg-1',
    versionId: 'ver-1',
    answers: [{ fieldId: 'campo-texto', value: 'ok' }],
    attachments: [],
    context: {},
    device: { installationId: 'inst-1' },
    startedAt: null,
    ...over,
  }
}

beforeEach(() => {
  entorno = crearEntorno({ limiteEsperaMs: 1_500 })
  usarEntorno(entorno)
  sembrarBase()
})

// ═════════════════════════════════════════════════════════════════════════════
// Descartar marca, no destruye
// ═════════════════════════════════════════════════════════════════════════════

describe('descartar un borrador', () => {
  it('marca la fila y CONSERVA respuestas, evidencia y bitácora', async () => {
    sembrarBorrador()

    const resultado = await descartarBorradorPortal(ACTOR, CSID)

    expect(resultado).toMatchObject({ id: 'sub-1', deleted: true, alreadyGone: false })
    /// La fila sigue existiendo: es la diferencia con el `DELETE` que había
    /// antes, que se llevaba las tres tablas por cascada.
    expect(envio()).toBeDefined()
    expect(envio()!.deleted_at).toBeInstanceOf(Date)
    expect(envio()!.status).toBe('DRAFT')
    expect(entorno.tabla('form_answer')).toHaveLength(1)
    expect(entorno.tabla('form_attachment')).toHaveLength(1)
  })

  it('deja constancia de quién lo descartó', async () => {
    sembrarBorrador()

    await descartarBorradorPortal(ACTOR, CSID)

    /// Sustituye a una columna `deleted_by`: la bitácora de este módulo son los
    /// eventos, y ahí es donde hay que poder responder «¿quién lo quitó?».
    expect(eventos('DISCARDED')).toHaveLength(1)
    expect(eventos('DISCARDED')[0]).toMatchObject({
      submission_id: 'sub-1',
      actor_type: 'CONDUCTOR',
      actor_id: ACTOR.id,
    })
  })

  it('es idempotente: repetirlo no falla ni escribe un segundo evento', async () => {
    sembrarBorrador()

    await descartarBorradorPortal(ACTOR, CSID)
    const segundo = await descartarBorradorPortal(ACTOR, CSID)

    expect(segundo).toMatchObject({ deleted: false, alreadyGone: true })
    expect(eventos('DISCARDED')).toHaveLength(1)
  })

  it('descartar algo que nunca existió tampoco falla', async () => {
    expect(await descartarBorradorPortal(ACTOR, 'csid-que-no-existe')).toMatchObject({
      id: null,
      deleted: false,
    })
  })

  it('no descarta el borrador de otra persona', async () => {
    sembrarBorrador()

    await expect(descartarBorradorPortal(OTRO, CSID)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(envio()!.deleted_at).toBeNull()
  })

  it('NO descarta un envío ya entregado: eso es anular', async () => {
    sembrarBorrador({ status: 'SUBMITTED', submitted_at: new Date('2026-08-19T11:00:00.000Z') })

    await expect(descartarBorradorPortal(ACTOR, CSID)).rejects.toMatchObject({
      code: 'SUBMISSION_IMMUTABLE',
    })
    expect(envio()!.deleted_at).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Lo descartado desaparece de las lecturas
// ═════════════════════════════════════════════════════════════════════════════

describe('lecturas del portal', () => {
  it('la tarjeta deja de mostrar el borrador descartado', async () => {
    sembrarBorrador()

    const antes = await listarAsignacionesPortal(ACTOR)
    expect(antes.meta.drafts).toBe(1)
    expect(antes.data[0].draft).not.toBeNull()

    await descartarBorradorPortal(ACTOR, CSID)

    /// Este es el síntoma que originó todo: el formulario abierto por error que
    /// se queda "a medias" en la pantalla del conductor.
    const despues = await listarAsignacionesPortal(ACTOR)
    expect(despues.meta.drafts).toBe(0)
    expect(despues.data[0].draft).toBeNull()
    expect(despues.data[0].drafts).toHaveLength(0)
  })

  it('el historial y el detalle tampoco lo devuelven', async () => {
    sembrarBorrador({ status: 'SUBMITTED', submitted_at: new Date('2026-08-19T11:00:00.000Z') })
    /// Se marca a mano: por producto un entregado no se descarta, pero la
    /// lectura no debe depender de esa regla para filtrar.
    entorno.tabla('form_submission')[0].deleted_at = new Date()

    const historial = await listarEnviosPortal(ACTOR, { page: 1, limit: 20 } as any)
    expect(historial.data).toHaveLength(0)
    expect(historial.meta.total).toBe(0)

    await expect(obtenerEnvioPortal(ACTOR, 'sub-1')).rejects.toMatchObject({
      code: 'SUBMISSION_NOT_FOUND',
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Nada lo revive
// ═════════════════════════════════════════════════════════════════════════════

describe('la outbox del teléfono no revive lo descartado', () => {
  it('el backup del borrador se rechaza con un código terminal', async () => {
    sembrarBorrador()
    await descartarBorradorPortal(ACTOR, CSID)

    const entrada = {
      assignmentId: 'asg-1',
      versionId: 'ver-1',
      answers: [{ fieldId: 'campo-texto', value: 'escrito después de borrar' }],
      context: {},
      device: {},
      progress: 60,
      startedAt: null,
    } as any

    await expect(guardarBorradorPortal(ACTOR, CSID, entrada)).rejects.toMatchObject({
      code: 'SUBMISSION_DISCARDED',
    })
    /// Y no reescribió nada: la respuesta original sigue siendo la única.
    expect(entorno.tabla('form_answer')).toHaveLength(1)
    expect(envio()!.deleted_at).toBeInstanceOf(Date)
  })

  it('el envío final se rechaza y el borrador NO pasa a entregado', async () => {
    sembrarBorrador()
    await descartarBorradorPortal(ACTOR, CSID)

    await expect(enviarSubmission(ACTOR, entradaEnvio())).rejects.toMatchObject({
      code: 'SUBMISSION_DISCARDED',
    })
    /// Lo contrario sería lo más desconcertante posible: el conductor quita la
    /// tarjeta y el formulario reaparece como ENTREGADO.
    expect(envio()!.status).toBe('DRAFT')
    expect(envio()!.submitted_at).toBeNull()
  })

  it('la cadena de evidencia se corta: no se admiten adjuntos nuevos', async () => {
    sembrarBorrador()
    await descartarBorradorPortal(ACTOR, CSID)

    await expect(
      iniciarAdjunto(ACTOR, {
        clientSubmissionId: CSID,
        clientAttachmentId: 'cadj-2',
        fieldId: 'campo-foto',
        occurrenceId: null,
        kind: 'PHOTO',
        mimeType: 'image/jpeg',
        byteSize: 2048,
        sha256: 'b'.repeat(64),
        originalName: 'otra.jpg',
      } as any),
    ).rejects.toMatchObject({ code: 'SUBMISSION_DISCARDED' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Descarte desde el dashboard
// ═════════════════════════════════════════════════════════════════════════════

describe('descarte desde el dashboard', () => {
  it('marca el borrador y lo apunta como hecho por un usuario interno', async () => {
    sembrarBorrador()

    const resultado = await descartarEnvio('sub-1', ADMIN)

    expect(resultado).toMatchObject({ id: 'sub-1', deleted: true, alreadyGone: false })
    expect(envio()!.deleted_at).toBeInstanceOf(Date)
    expect(eventos('DISCARDED')[0]).toMatchObject({ actor_type: 'USER', actor_id: ADMIN.id })
  })

  it('repetirlo es idempotente', async () => {
    sembrarBorrador()

    await descartarEnvio('sub-1', ADMIN)
    expect(await descartarEnvio('sub-1', ADMIN)).toMatchObject({ deleted: false, alreadyGone: true })
    expect(eventos('DISCARDED')).toHaveLength(1)
  })

  it('un envío entregado NO se descarta desde aquí: se anula', async () => {
    sembrarBorrador({ status: 'SUBMITTED', submitted_at: new Date('2026-08-19T11:00:00.000Z') })

    await expect(descartarEnvio('sub-1', ADMIN)).rejects.toMatchObject({
      code: 'SUBMISSION_IMMUTABLE',
    })
    expect(envio()!.deleted_at).toBeNull()
  })

  it('un envío inexistente da 404 y no crea nada', async () => {
    await expect(descartarEnvio('no-existe', ADMIN)).rejects.toMatchObject({
      code: 'SUBMISSION_NOT_FOUND',
    })
    expect(entorno.tabla('form_submission_event')).toHaveLength(0)
  })
})
