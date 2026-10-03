// tests/formularios-dinamicos-etapas.test.ts
//
// Contrato de la versión por etapas de los dos preoperacionales. SIN base de
// datos: deriva las semillas y las pasa por el mismo validador del cargador.
//
// Lo que fija: en la etapa 2 se pregunta cada cuántas horas hubo pausa activa
// (obligatorio) y las fotos de las pausas siguen opcionales; en la etapa 3 el
// kilometraje final es obligatorio.

import { describe, expect, it } from 'vitest'
import { REVISION_ETAPAS, SEMILLAS_ETAPAS } from '../prisma/seeds/formularios-hseq/preoperacional-etapas'
import { revisarConjunto } from '../prisma/seeds/formularios-hseq/validate'
import type { FormFieldDraft, FormSectionDraft } from '../src/modules/formularios-dinamicos/domain'

const etapaDe = (s: FormSectionDraft) => (s.settings as { etapa?: number } | undefined)?.etapa

function campo(secciones: FormSectionDraft[], key: string): { seccion: FormSectionDraft; campo: FormFieldDraft } {
	for (const seccion of secciones) {
		const encontrado = seccion.fields.find((f) => f.key === key)
		if (encontrado) return { seccion, campo: encontrado }
	}
	throw new Error(`No existe el campo ${key}`)
}

describe('preoperacional por etapas', () => {
	it('pasa el validador del cargador', () => {
		const reporte = revisarConjunto(SEMILLAS_ETAPAS)
		expect(reporte.invalidas, JSON.stringify(reporte, null, 2)).toBe(0)
		expect(reporte.problemas).toEqual([])
	})

	it('va en la revisión 3', () => {
		expect(REVISION_ETAPAS).toBe(3)
	})

	describe.each(SEMILLAS_ETAPAS.map((s) => [s.code, s] as const))('%s', (_code, semilla) => {
		const secciones = semilla.version.sections

		it('pide en la etapa 2 cada cuántas horas hubo pausa activa, antes de las fotos', () => {
			const horas = campo(secciones, 'pausas_activas_cada_horas')
			expect(etapaDe(horas.seccion)).toBe(2)
			expect(horas.campo.type).toBe('DECIMAL')
			expect(horas.campo.required).toBe(true)

			const fotos = campo(secciones, 'pausas_activas_evidencia')
			expect(fotos.seccion).toBe(horas.seccion)
			expect(fotos.campo.required).toBe(false)
			expect(horas.campo.sortOrder).toBeLessThan(fotos.campo.sortOrder)
		})

		it('exige el kilometraje final en la etapa 3', () => {
			const km = campo(secciones, 'km_final')
			expect(etapaDe(km.seccion)).toBe(3)
			expect(km.campo.required).toBe(true)
		})
	})
})
