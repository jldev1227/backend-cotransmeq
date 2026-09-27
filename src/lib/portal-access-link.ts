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

  if (canal === 'mobile') {
    const baseUrl = mobileBaseUrl.trim() || 'cotransmeq://portal'
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}token=${encodedToken}`
  }

  const normalizedWebUrl = webBaseUrl.replace(/\/+$/, '')
  return `${normalizedWebUrl}/public/portal?token=${encodedToken}`
}
