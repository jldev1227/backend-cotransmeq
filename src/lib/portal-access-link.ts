export type PortalAccessChannel = 'web' | 'mobile'

interface PortalAccessLinkOptions {
  canal?: PortalAccessChannel
  token: string
  webBaseUrl: string
  mobileBaseUrl?: string
}

export function buildPortalAccessLink({
  canal = 'web',
  token,
  webBaseUrl,
  mobileBaseUrl = 'cotransmeq://portal'
}: PortalAccessLinkOptions): string {
  const encodedToken = encodeURIComponent(token)
  const normalizedWebUrl = webBaseUrl.replace(/\/+$/, '')

  if (canal === 'mobile') {
    /// Gmail —y casi todos los clientes de correo— le quitan el destino a
    /// cualquier enlace que no sea http(s) o mailto: un `cotransmeq://portal`
    /// llega como un botón que no hace nada. Por eso el correo lleva un https
    /// a la página puente del front (`/public/abrir-app`), que abre la app
    /// instalada y, si no está, sigue en el portal web. Sirve con la app que
    /// ya está publicada: no hace falta sacar versión nueva.
    ///
    /// `MOBILE_PORTAL_URL` solo se respeta si ya es un https propio.
    const baseUrl = mobileBaseUrl.trim()
    if (/^https?:\/\//i.test(baseUrl)) {
      const separator = baseUrl.includes('?') ? '&' : '?'
      return `${baseUrl}${separator}token=${encodedToken}`
    }
    return `${normalizedWebUrl}/public/abrir-app?token=${encodedToken}`
  }

  return `${normalizedWebUrl}/public/portal?token=${encodedToken}`
}
