/**
 * Modo de envío de los correos SARLAFT/PTEE.
 *
 * En `sandbox` TODOS los correos de este módulo se redirigen a un único buzón
 * de pruebas, para que una corrida de QA no pueda alcanzar a un proveedor, a un
 * accionista ni al Oficial de Cumplimiento con datos sintéticos.
 *
 * Reglas que no se negocian:
 *
 *  - `sandbox` solo existe fuera de producción. Si alguien despliega con
 *    `NODE_ENV=production` y `SARLAFT_EMAIL_MODE=sandbox`, el resolutor lanza:
 *    redirigir correo productivo en silencio sería peor que no enviarlo, y
 *    seguir enviando a los destinatarios reales traicionaría la intención de
 *    quien puso la variable.
 *  - El destinatario de prueba NO se agrega a ninguna lista blanca productiva.
 *    Vive solo aquí, como destino de redirección.
 *  - Nunca se usa BCC: los destinatarios originales se mencionan enmascarados
 *    en el asunto/cuerpo del correo de prueba, no como copia oculta.
 */

export type SarlaftEmailMode = 'produccion' | 'sandbox'

export interface DestinoCorreo {
  /** Destinatarios efectivos del envío. */
  to: string[]
  /** Prefijo a anteponer al asunto (`[SANDBOX] ` o vacío). */
  prefijoAsunto: string
  /** Destinatarios que habrían recibido el correo en producción, enmascarados.
   *  Sirve para dejar constancia en el cuerpo del correo de prueba. */
  destinatariosOriginalesEnmascarados: string[]
  modo: SarlaftEmailMode
}

/** Enmascara una dirección: `ju****@dominio.com`. */
export function enmascararDireccion(correo: string): string {
  const v = (correo ?? '').trim()
  const [usuario, dominio] = v.split('@')
  if (!dominio) return '***'
  const visible = usuario.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`
}

/**
 * Resuelve el modo configurado.
 *
 * `nodeEnv` y `env` se inyectan para poder probar las cuatro combinaciones sin
 * tocar `process.env` del proceso de test.
 */
export function resolverModo(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): SarlaftEmailMode {
  const modo = (env.SARLAFT_EMAIL_MODE ?? '').trim().toLowerCase()
  if (modo !== 'sandbox') return 'produccion'

  if (nodeEnv === 'production') {
    throw new Error(
      '[SarlaftEmailMode] SARLAFT_EMAIL_MODE=sandbox está prohibido con NODE_ENV=production. ' +
        'El modo sandbox redirige TODOS los correos SARLAFT a un buzón de pruebas y no debe ' +
        'activarse nunca en producción. Quita la variable o corrige NODE_ENV.'
    )
  }
  if (!(env.SARLAFT_TEST_RECIPIENT ?? '').trim()) {
    throw new Error(
      '[SarlaftEmailMode] SARLAFT_EMAIL_MODE=sandbox requiere SARLAFT_TEST_RECIPIENT. ' +
        'Sin destinatario de prueba el modo sandbox no tiene a dónde redirigir.'
    )
  }
  return 'sandbox'
}

/**
 * Calcula los destinatarios efectivos de un envío SARLAFT.
 *
 * En producción devuelve los destinatarios tal cual. En sandbox los sustituye
 * por el buzón de prueba y conserva los originales enmascarados como metadata.
 */
export function resolverDestino(
  destinatariosReales: string[],
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): DestinoCorreo {
  const modo = resolverModo(env, nodeEnv)
  const limpios = destinatariosReales.map((d) => d.trim()).filter(Boolean)

  if (modo === 'produccion') {
    return {
      to: limpios,
      prefijoAsunto: '',
      destinatariosOriginalesEnmascarados: [],
      modo
    }
  }

  return {
    to: [(env.SARLAFT_TEST_RECIPIENT ?? '').trim()],
    prefijoAsunto: '[SANDBOX] ',
    destinatariosOriginalesEnmascarados: limpios.map(enmascararDireccion),
    modo
  }
}

/**
 * `true` si debe enviarse una copia del documento al declarante.
 *
 * **Por defecto NO.** Decisión de negocio: los formularios SARLAFT/PTEE se
 * revisan internamente y el declarante no recibe correo automático; los únicos
 * destinatarios son los buzones internos configurados en `sarlaft-config.ts`,
 * desde donde el área responsable aprueba, condiciona o rechaza en el
 * dashboard.
 *
 * El declarante sí conserva su copia: la descarga desde la pantalla de
 * confirmación mediante el enlace temporal, sin que el documento viaje por
 * correo a una dirección que nadie verificó.
 *
 * Activarlo requiere ponerlo explícitamente en `true`.
 */
export function copiaDeclaranteHabilitada(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SARLAFT_CLIENT_COPY_ENABLED ?? 'false').trim().toLowerCase() === 'true'
}

/** Vigencia del enlace público de descarga, en segundos. */
export function ttlDescargaPublica(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS ?? '').trim())
  if (!Number.isFinite(raw) || raw <= 0) return 3600
  // Tope de 24 h: el enlace lleva a un documento con datos personales y no
  // debe poder configurarse como permanente por descuido.
  return Math.min(Math.floor(raw), 86_400)
}

/**
 * Nota que se agrega al cuerpo de los correos en sandbox. Deja claro que el
 * mensaje es de prueba y a quién habría llegado, sin exponer las direcciones.
 */
export function avisoSandboxHtml(destino: DestinoCorreo): string {
  if (destino.modo !== 'sandbox') return ''
  const originales = destino.destinatariosOriginalesEnmascarados.join(', ') || '—'
  return `
    <div style="margin:0 0 16px;padding:12px 16px;border:1px solid #FDE68A;background:#FFFBEB;border-radius:8px;font-size:12px;color:#92400E;">
      <strong>Correo de prueba (modo sandbox).</strong> No corresponde a un trámite real.
      En producción se habría enviado a: ${originales}.
    </div>`
}
