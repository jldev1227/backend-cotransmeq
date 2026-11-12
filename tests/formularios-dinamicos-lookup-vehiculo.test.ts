import { describe, expect, it } from 'vitest'
import { SEMILLAS_HSEQ } from '../prisma/seeds/formularios-hseq'
import { validateSubmissionAnswers } from '../src/modules/formularios-dinamicos/formularios-respuestas'
import type {
  FormFieldDto,
  FormOptionDto,
  FormVersionDto,
} from '../src/modules/formularios-dinamicos/formularios-dinamicos.mapper'

let id = 0
const nextId = () => `test-${++id}`

function option(value: string): FormOptionDto {
  return { id: nextId(), value, label: value, color: null, score: null, sortOrder: 100, metadata: {} }
}

function field(over: Partial<FormFieldDto> & { key: string; type: FormFieldDto['type'] }): FormFieldDto {
  return {
    id: nextId(),
    parentFieldId: null,
    label: over.key,
    helpText: null,
    placeholder: null,
    required: false,
    sortOrder: 100,
    config: {},
    validation: {},
    visibilityRule: null,
    defaultValue: null,
    options: [],
    children: [],
    ...over,
  }
}

function version(fields: FormFieldDto[]): FormVersionDto {
  return {
    id: nextId(),
    formId: nextId(),
    versionNumber: 1,
    status: 'PUBLISHED',
    title: 'Test',
    revision: 1,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    publishedAt: '2026-11-11T00:00:00.000Z',
    archivedAt: null,
    description: null,
    instructions: null,
    settings: {},
    sourceMetadata: {},
    sections: [{
      id: nextId(),
      key: 'identificacion',
      title: 'Identificación',
      description: null,
      sortOrder: 100,
      settings: {},
      fields,
    }],
  }
}

describe('LOOKUP de placa condicional', () => {
  it('incluye un LOOKUP requerido en VEHICULO en los cuatro seeds afectados', () => {
    for (const code of ['HSEQ-FR-04', 'HSEQ-FR-05', 'HSEQ-FR-17', 'HSEQ-FR-22']) {
      const seed = SEMILLAS_HSEQ.find((item) => item.code === code)!
      const fields = seed.version.sections.flatMap((section) => section.fields)
      const vehicle = fields.find((item) => item.key === 'vehiculo')
      expect(vehicle?.type, code).toBe('LOOKUP')
      expect(vehicle?.required, code).toBe(true)
      expect(vehicle?.config, code).toEqual({ source: 'VEHICLE', bindContext: 'vehicleId' })
      expect(vehicle?.visibilityRule?.all?.[0], code).toMatchObject({
        fieldKey: 'ubicacion_tipo',
        operator: 'equals',
        value: 'VEHICULO',
      })
    }
  })

  it('requiere una placa solo si la respuesta seleccionó VEHICULO', () => {
    const location = field({
      key: 'ubicacion_tipo',
      type: 'SINGLE_CHOICE',
      options: [option('VEHICULO'), option('SEDE')],
    })
    const vehicle = field({
      key: 'vehiculo',
      type: 'LOOKUP',
      required: true,
      config: { source: 'VEHICLE', bindContext: 'vehicleId' },
      visibilityRule: {
        version: 1,
        all: [{ fieldKey: 'ubicacion_tipo', operator: 'equals', value: 'VEHICULO' }],
        effect: { action: 'show', targetFieldKey: 'vehiculo' },
      },
    })
    const site = field({
      key: 'ubicacion_sede',
      type: 'SHORT_TEXT',
      required: true,
      visibilityRule: {
        version: 1,
        all: [{ fieldKey: 'ubicacion_tipo', operator: 'equals', value: 'SEDE' }],
        effect: { action: 'show', targetFieldKey: 'ubicacion_sede' },
      },
    })
    const definition = version([location, vehicle, site])
    const missingPlate = validateSubmissionAnswers({
      definition,
      answers: [{ fieldId: location.id, optionValues: ['VEHICULO'] }],
      attachments: [],
    })
    const vehicleAnswer = validateSubmissionAnswers({
      definition,
      answers: [
        { fieldId: location.id, optionValues: ['VEHICULO'] },
        { fieldId: vehicle.id, value: { id: 'vehicle-id', placa: 'ABC123' } },
      ],
      attachments: [],
    })
    const siteAnswer = validateSubmissionAnswers({
      definition,
      answers: [
        { fieldId: location.id, optionValues: ['SEDE'] },
        { fieldId: site.id, value: 'Bodega principal' },
      ],
      attachments: [],
    })

    expect(missingPlate.errors.map((issue) => issue.code)).toEqual(['REQUIRED'])
    expect(vehicleAnswer.errors).toEqual([])
    expect(siteAnswer.errors).toEqual([])
  })
})
