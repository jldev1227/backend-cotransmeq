/**
 * Configuración centralizada de SARLAFT — destinatarios, teléfonos y copy
 * por cada tipo de formulario (Clientes/Proveedores, Accionistas, Personal
 * y Autorización del Propietario).
 *
 * Por diseño se mantiene este registro en un solo lugar para que cualquier
 * cambio de correos o teléfonos se haga en un único punto y se propague a
 * backend (notificaciones) y frontend (contacto al usuario).
 *
 * Los valores son los canales oficiales de COTRANSMEQ y pueden sobreescribirse
 * por variable de entorno sin tocar código — útil porque los correos de
 * cumplimiento suelen cambiar antes que el despliegue. Si en el futuro se
 * requiere persistir esta configuración en base de datos, basta con reemplazar
 * `getConfigPorTipo` por una consulta a `tabla_sarlaft_configuracion`.
 */

export type TipoFormularioSarlaft =
  | 'cliente_proveedor'
  | 'accionistas'
  | 'personal'
  | 'autorizacion_propietario'

export interface ContactoConfig {
  /** Lista de correos a los que se envía la notificación del formulario. */
  emails: string[]
  /** Etiqueta humana del área responsable (Operaciones, Talento Humano, etc.). */
  area_responsable: string
  /** Teléfono principal que se muestra al usuario (formato internacional +57 ...). */
  telefono_principal: string
  /** Teléfono "público" (sin el +57) para construir wa.me / tel: links. */
  telefono_wa: string
  /** Correo "para mostrar" al usuario, opcional (si difiere de la lista). */
  correo_publico?: string
}

/**
 * Lee una lista de correos separados por coma desde el entorno, descartando
 * cualquier dirección que no esté en `CANALES_AUTORIZADOS`.
 *
 * El filtro existe porque un `SARLAFT_EMAILS_*` mal puesto en el `.env` de un
 * despliegue bastaría para desviar formularios con documento de identidad y
 * firma manuscrita a un buzón no autorizado, sin dejar rastro en el código.
 * Si el override queda vacío tras filtrar, se cae al destinatario por defecto
 * en lugar de no notificar a nadie.
 */
function emailsDeEnv(clave: string, porDefecto: string[]): string[] {
  const raw = process.env[clave]?.trim()
  if (!raw) return porDefecto
  const lista = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)

  const permitidos = lista.filter((e) => CANALES_AUTORIZADOS.has(e.toLowerCase()))
  const rechazados = lista.filter((e) => !CANALES_AUTORIZADOS.has(e.toLowerCase()))
  if (rechazados.length > 0) {
    console.warn(
      `[SarlaftConfig] ${clave}: se ignoraron canales no autorizados -> ${rechazados.join(', ')}. ` +
        'Sólo se admiten los buzones declarados en CANALES_AUTORIZADOS.'
    )
  }
  return permitidos.length > 0 ? permitidos : porDefecto
}

// ─────────────────────────────────────────────────────────────────────────────
// CANALES AUTORIZADOS
//
// Sólo estas dos direcciones están autorizadas por COTRANSMEQ para recibir
// formularios SARLAFT + PTEE. Cualquier otro buzón que aparezca aquí es un
// canal no autorizado: estos correos transportan documento de identidad,
// firma manuscrita y adjuntos del titular, así que la lista es cerrada y no
// se amplía sin autorización expresa del Oficial de Cumplimiento.
// ─────────────────────────────────────────────────────────────────────────────

/** Buzón de Compras / Proveedores — también es el correo público de la landing. */
const CORREO_COMPRAS = 'compras.cotransmeq@hotmail.com'
/** Buzón de reportes de Cumplimiento SARLAFT. */
const CORREO_REPORTES = 'cotransmeqreportesla@gmail.com'

/**
 * Lista blanca de destinatarios. Es deliberadamente literal y no configurable
 * por entorno: es el punto de control de a dónde puede salir un formulario
 * SARLAFT. Ampliarla requiere un cambio de código revisable, no una variable
 * de entorno editable en el panel del hosting.
 */
const CANALES_AUTORIZADOS = new Set([CORREO_COMPRAS, CORREO_REPORTES])

/**
 * Destinatarios por defecto: los dos buzones autorizados reciben TODOS los
 * tipos de formulario. Es una decisión explícita de COTRANSMEQ — Compras y
 * Cumplimiento trabajan la misma bandeja de casos, así que ninguno depende de
 * que el otro reenvíe. Van en `to` (no en BCC) para que ambas áreas se vean
 * entre sí y no dupliquen la gestión del mismo radicado.
 */
const DESTINATARIOS = [CORREO_COMPRAS, CORREO_REPORTES]

/** Canal telefónico principal de COTRANSMEQ (el mismo de la landing). */
const TELEFONO_PRINCIPAL = process.env.SARLAFT_TELEFONO?.trim() || '+57 302 571 1858'
const TELEFONO_WA = process.env.SARLAFT_TELEFONO_WA?.trim() || '573025711858'

// El `correo_publico` sí cambia por tipo: es el que se le muestra al titular
// como canal de dudas, y conviene que apunte al área que atiende su caso.
export const CONFIG_POR_TIPO: Record<TipoFormularioSarlaft, ContactoConfig> = {
  cliente_proveedor: {
    emails: emailsDeEnv('SARLAFT_EMAILS_CLIENTE_PROVEEDOR', DESTINATARIOS),
    area_responsable: 'Operaciones',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA,
    correo_publico: CORREO_COMPRAS
  },
  accionistas: {
    emails: emailsDeEnv('SARLAFT_EMAILS_ACCIONISTAS', DESTINATARIOS),
    area_responsable: 'Cumplimiento',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA,
    correo_publico: CORREO_REPORTES
  },
  personal: {
    emails: emailsDeEnv('SARLAFT_EMAILS_PERSONAL', DESTINATARIOS),
    area_responsable: 'Talento Humano',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA,
    correo_publico: CORREO_REPORTES
  },
  // Autorización del Propietario (SLFT-PTEE-FR-12) — al tratarse de una
  // autorización de facturación/pago a un tercero, la revisión la hace
  // el Oficial de Cumplimiento antes de cualquier desembolso.
  autorizacion_propietario: {
    emails: emailsDeEnv('SARLAFT_EMAILS_AUTORIZACION_PROPIETARIO', DESTINATARIOS),
    area_responsable: 'Cumplimiento',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA,
    correo_publico: CORREO_REPORTES
  }
}

/**
 * Devuelve la configuración de un tipo de formulario con fallback seguro.
 */
export function getConfigPorTipo(tipo: TipoFormularioSarlaft): ContactoConfig {
  return CONFIG_POR_TIPO[tipo] ?? CONFIG_POR_TIPO.cliente_proveedor
}

/**
 * Normaliza un número de teléfono a sólo dígitos (sin +, espacios ni guiones).
 * Útil para construir wa.me y tel: links.
 */
export function telefonoSoloDigitos(tel: string): string {
  return tel.replace(/\D/g, '')
}
