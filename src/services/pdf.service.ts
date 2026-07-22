import puppeteer, { Browser } from "puppeteer-core";
import fs from "fs";

function resolveChromiumPath(): string {
  if (process.env.PUPPETEER_CHROMIUM_PATH) return process.env.PUPPETEER_CHROMIUM_PATH;

  if (process.platform === "darwin") {
    const macPaths = [
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error(
      "No se encontró Chrome/Chromium en macOS. Instala con: brew install --cask chromium"
    );
  }

  return "/usr/bin/chromium";
}

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;

  const chromiumPath = resolveChromiumPath();
  browserInstance = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  return browserInstance;
}

export interface PdfFromHtmlOptions {
  html: string;
  landscape?: boolean;
  marginMm?: number;
  baseUrl?: string;
  format?: "Letter" | "A4" | "Legal" | "A3" | "A5" | "Tabloid";
  /**
   * Multiplicador de la altura de la página (1.0 = alto por defecto).
   * Útil para cuando una tabla tiene 1 fila más de lo que cabe en el
   * formato seleccionado: 1.1 = +10% de alto, 1.2 = +20%, etc.
   * Solo aplica cuando se usa `format` (no cuando se pasan width/height
   * explícitos).
   */
  heightScale?: number;
  /**
   * Multiplicador del ancho de la página (1.0 = ancho por defecto).
   * Útil cuando se quiere ganar ancho horizontal sin afectar el alto.
   */
  widthScale?: number;
}

// Dimensiones base (en pulgadas) de cada formato, en orientación PORTRAIT.
// En landscape se rotan 90°, por lo que el "alto" del PDF es el ancho
// portrait y el "ancho" del PDF es el alto portrait.
const FORMAT_DIMENSIONS_INCHES: Record<string, { w: number; h: number }> = {
  Letter: { w: 8.5, h: 11 },
  Legal: { w: 8.5, h: 14 },
  Tabloid: { w: 11, h: 17 },
  A3: { w: 11.69, h: 16.54 },
  A4: { w: 8.27, h: 11.69 },
  A5: { w: 5.83, h: 8.27 }
};

export async function pdfFromHtml(opts: PdfFromHtmlOptions): Promise<Buffer> {
  const {
    html,
    landscape = true,
    marginMm = 3,
    baseUrl,
    format = "Letter",
    heightScale,
    widthScale
  } = opts;
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Calcular dimensiones finales del PDF (en pulgadas) para configurar
  // el viewport antes de renderizar. Si el viewport no coincide con el
  // tamaño del PDF, el contenido se renderiza al tamaño del viewport
  // (default ~800px) y queda espacio en blanco alrededor.
  const hasHeightScale =
    typeof heightScale === "number" && heightScale > 0 && heightScale !== 1;
  const hasWidthScale =
    typeof widthScale === "number" && widthScale > 0 && widthScale !== 1;
  const useScaledSize = hasHeightScale || hasWidthScale;
  const dims = FORMAT_DIMENSIONS_INCHES[format] || FORMAT_DIMENSIONS_INCHES.Letter;
  const pdfWidthIn = useScaledSize
    ? (landscape ? dims.h : dims.w) * (hasWidthScale ? (widthScale as number) : 1)
    : landscape
    ? dims.h
    : dims.w;
  const pdfHeightIn = useScaledSize
    ? (landscape ? dims.w : dims.h) * (hasHeightScale ? (heightScale as number) : 1)
    : landscape
    ? dims.w
    : dims.h;

  // Set viewport al tamaño del PDF (a 96 DPI) para que el contenido
  // se renderice llenando toda la página sin espacio en blanco.
  await page.setViewport({
    width: Math.round(pdfWidthIn * 96),
    height: Math.round(pdfHeightIn * 96)
  });

  try {
    if (baseUrl) {
      await page
        .goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
        .catch(() => {});
    }

    await page.setContent(html, { waitUntil: "load", timeout: 60000 });

    await page
      .evaluate(async () => {
        const fonts = (document as any).fonts;
        if (fonts && typeof fonts.ready === "object") {
          try { await fonts.ready; } catch { /* noop */ }
        }
        const imgs = Array.from(document.images);
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener("load", () => res(), { once: true });
                  img.addEventListener("error", () => res(), { once: true });
                })
          )
        );
      })
      .catch(() => {});

    const pdfOptions: any = {
      landscape,
      printBackground: true,
      margin: {
        top: `${marginMm}mm`,
        right: `${marginMm}mm`,
        bottom: `${marginMm}mm`,
        left: `${marginMm}mm`,
      },
    };

    if (useScaledSize) {
      pdfOptions.width = `${pdfWidthIn.toFixed(3)}in`;
      pdfOptions.height = `${pdfHeightIn.toFixed(3)}in`;
    } else {
      pdfOptions.format = format;
    }

    const pdf = await page.pdf(pdfOptions);

    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
