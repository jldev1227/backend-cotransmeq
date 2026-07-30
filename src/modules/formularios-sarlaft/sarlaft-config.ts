/**
 * Configuración centralizada de SARLAFT — destinatarios, teléfonos y copy
 * por cada tipo de formulario (Clientes/Proveedores, Accionistas, Personal).
 *
 * Por diseño se mantiene este registro en un solo lugar para que cualquier
 * cambio de correos o teléfonos se haga en un único punto y se propague a
 * backend (notificaciones) y frontend (contacto al usuario).
 *
 * Los valores por defecto reflejan los correos oficiales entregados por
 * TRANSMERALDA S.A.S. Si en el futuro se requiere persistir esta
 * configuración en base de datos, basta con reemplazar `getConfigPorTipo`
 * por una consulta a `tabla_sarlaft_configuracion`.
 */

export type TipoFormularioSarlaft = 'cliente_proveedor' | 'accionistas' | 'personal'

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

export const CONFIG_POR_TIPO: Record<TipoFormularioSarlaft, ContactoConfig> = {
  // Clientes / Proveedores — Notificación a Compras/Proveedores y a Cumplimiento
  cliente_proveedor: {
    emails: ['compraproveedorestransmeralda@gmail.com', 'transmeraldasarlaft@gmail.com'],
    area_responsable: 'Operaciones',
    telefono_principal: '+57 323 2340117',
    telefono_wa: '573232340117',
    correo_publico: 'operaciones.transmeraldasas@gmail.com'
  },
  // Accionistas — Notificación a Cumplimiento SARLAFT
  accionistas: {
    emails: ['transmeraldasarlaft@gmail.com'],
    area_responsable: 'Cumplimiento',
    telefono_principal: '311 508 7120',
    telefono_wa: '573115087120'
  },
  // Personal — Notificación a Cumplimiento (Talento Humano no tiene número, se
  // reutiliza el de Operaciones para que el usuario tenga un canal de contacto).
  personal: {
    emails: ['transmeraldasarlaft@gmail.com'],
    area_responsable: 'Talento Humano',
    telefono_principal: '+57 323 2340117',
    telefono_wa: '573232340117',
    correo_publico: 'operaciones.transmeraldasas@gmail.com'
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
