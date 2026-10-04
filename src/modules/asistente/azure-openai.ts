import OpenAI from 'openai'

/**
 * Cliente de Azure OpenAI para el asistente.
 *
 * El endpoint de Azure (`…/openai/v1`) habla el protocolo de OpenAI, así que
 * basta el SDK oficial con `baseURL`. Se crea perezosamente: el backend tiene
 * que arrancar aunque falten las variables, y el chat responde entonces con un
 * error claro en vez de tumbar el servidor en el arranque.
 *
 * Variables: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`.
 */
let cliente: OpenAI | null = null

export function asistenteConfigurado(): boolean {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT,
  )
}

export function clienteAzure(): OpenAI {
  if (!asistenteConfigurado()) {
    throw new Error(
      'Asistente sin configurar: faltan AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY o AZURE_OPENAI_DEPLOYMENT',
    )
  }
  cliente ??= new OpenAI({
    apiKey: process.env.AZURE_OPENAI_KEY!,
    baseURL: process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, ''),
  })
  return cliente
}

export function deploymentAzure(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT!
}
