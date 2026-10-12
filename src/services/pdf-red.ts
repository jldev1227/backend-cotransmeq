import type { Page } from "puppeteer-core";
import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * Qué puede pedir Chromium mientras pinta HTML que puede venir del cliente.
 *
 * `pdfFromHtml` renderiza HTML que manda el navegador (`POST /api/pdf/from-html`,
 * documentos de formularios, canvas de cierres) con el Chromium del servidor,
 * que vive dentro de su red. Una `<img>`, un `<link>` o un `fetch` en ese HTML
 * hacia `localhost`, `169.254.169.254` (metadatos de la nube) o un host del
 * túnel los pedía él, y con JavaScript activo el resultado podía acabar
 * escrito en el PDF y volver al cliente. Es SSRF de manual.
 *
 * Se deja pasar `data:`, `blob:` y `about:`, y http(s) solo hacia direcciones
 * públicas. Las plantillas propias no necesitan más: sus imágenes son `data:`
 * o URLs públicas (S3), y ninguna usa JavaScript.
 */

/** Rangos que no son internet: loopback, privados, enlace local, CGNAT (Tailscale), etc. */
function ipv4Interna(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipInterna(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ipv4Interna(ip);
  if (version === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    /// IPv4 dentro de IPv6: `::ffff:10.0.0.1`, o como lo normaliza el parser
    /// de URL, `::ffff:a00:1`.
    const mapeada = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return ipv4Interna(mapeada[1]);
    const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const [alto, bajo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return ipv4Interna(`${alto >> 8}.${alto & 255}.${bajo >> 8}.${bajo & 255}`);
    }
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

/// Una consulta DNS por host y por un rato: un documento pide decenas de
/// imágenes al mismo bucket.
const cacheDns = new Map<string, { hasta: number; interna: boolean }>();
const CACHE_DNS_MS = 5 * 60_000;

async function hostInterno(host: string): Promise<boolean> {
  const nombre = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(nombre)) return ipInterna(nombre);
  /// Nombres sin punto (`frontend`, `postgres`) y dominios reservados para
  /// redes internas: no se resuelven, se rechazan.
  if (!nombre.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(nombre)) return true;

  const enCache = cacheDns.get(nombre);
  if (enCache && enCache.hasta > Date.now()) return enCache.interna;
  let interna = true;
  try {
    const direcciones = await lookup(nombre, { all: true });
    /// Basta una dirección interna: un nombre público que apunte a la red
    /// interna es justo el truco que se quiere cortar.
    interna = direcciones.length === 0 || direcciones.some((d) => ipInterna(d.address));
  } catch {
    interna = true;
  }
  if (cacheDns.size > 1000) cacheDns.clear();
  cacheDns.set(nombre, { hasta: Date.now() + CACHE_DNS_MS, interna });
  return interna;
}

export async function urlPermitidaParaPdf(url: string): Promise<boolean> {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return false;
  }
  if (destino.protocol === "data:" || destino.protocol === "blob:" || destino.protocol === "about:") return true;
  if (destino.protocol !== "http:" && destino.protocol !== "https:") return false;
  return !(await hostInterno(destino.hostname));
}

/**
 * Prepara una página antes de `setContent` con HTML que no controla el
 * servidor: sin JavaScript y con cada petición filtrada por
 * `urlPermitidaParaPdf`. Lo que se bloquea simplemente no carga (una imagen
 * rota en el PDF), no tumba la generación.
 */
export async function blindarPagina(page: Page): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", (peticion) => {
    if (peticion.isInterceptResolutionHandled()) return;
    urlPermitidaParaPdf(peticion.url())
      .then((permitida) => (permitida ? peticion.continue() : peticion.abort("blockedbyclient")))
      .catch(() => peticion.abort("blockedbyclient").catch(() => undefined));
  });
}
