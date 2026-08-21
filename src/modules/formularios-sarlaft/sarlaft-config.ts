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

/** Lee una lista de correos separados por coma desde el entorno. */
function emailsDeEnv(clave: string, porDefecto: string[]): string[] {
  const raw = process.env[clave]?.trim()
  if (!raw) return porDefecto
  const lista = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  return lista.length > 0 ? lista : porDefecto
}

/** Correo de cumplimiento (Oficial de Cumplimiento SARLAFT de COTRANSMEQ). */
const CORREO_CUMPLIMIENTO = process.env.SARLAFT_EMAIL_CUMPLIMIENTO?.trim() || 'cotransmeqsarlaft@gmail.com'
/** Correo de cara al público para dudas sobre el diligenciamiento.
 *  Es el mismo que publica la landing en su pie de página. */
const CORREO_PUBLICO = process.env.SARLAFT_EMAIL_PUBLICO?.trim() || 'compras.cotransmeq@hotmail.com'

/** Canal telefónico principal de COTRANSMEQ (el mismo de la landing). */
const TELEFONO_PRINCIPAL = process.env.SARLAFT_TELEFONO?.trim() || '+57 302 571 1858'
const TELEFONO_WA = process.env.SARLAFT_TELEFONO_WA?.trim() || '573025711858'

export const CONFIG_POR_TIPO: Record<TipoFormularioSarlaft, ContactoConfig> = {
  // Clientes / Proveedores — Notificación a Compras/Proveedores y a Cumplimiento
  cliente_proveedor: {
    emails: emailsDeEnv('SARLAFT_EMAILS_CLIENTE_PROVEEDOR', [
      'compraproveedorescotransmeq@gmail.com',
      CORREO_CUMPLIMIENTO
    ]),
    area_responsable: 'Operaciones',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA,
    correo_publico: CORREO_PUBLICO
  },
  // Accionistas — Notificación a Cumplimiento SARLAFT
  accionistas: {
    emails: emailsDeEnv('SARLAFT_EMAILS_ACCIONISTAS', [CORREO_CUMPLIMIENTO]),
    area_responsable: 'Cumplimiento',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA
  },
  // Personal — Notificación a Cumplimiento. El canal de contacto que ve el
  // aspirante es el de Operaciones, que es el que atiende en horario hábil.
  personal: {
    emails: emailsDeEnv('SARLAFT_EMAILS_PERSONAL', [CORREO_CUMPLIMIENTO]),
    area_responsable: 'Talento Humano',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA,
    correo_publico: CORREO_PUBLICO
  },
  // Autorización del Propietario (SLFT-PTEE-FR-12) — al tratarse de una
  // autorización de facturación/pago a un tercero, la revisión la hace
  // directamente el Oficial de Cumplimiento antes de cualquier desembolso.
  autorizacion_propietario: {
    emails: emailsDeEnv('SARLAFT_EMAILS_AUTORIZACION_PROPIETARIO', [CORREO_CUMPLIMIENTO]),
    area_responsable: 'Cumplimiento',
    telefono_principal: TELEFONO_PRINCIPAL,
    telefono_wa: TELEFONO_WA
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
