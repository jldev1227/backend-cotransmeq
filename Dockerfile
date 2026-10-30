FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL and other dependencies required for Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build).
# Sin `|| npm install`: si el lockfile no cuadra con package.json el build debe
# fallar aquí (y antes, en el job `verificar` del workflow), no resolver en
# silencio versiones distintas de las que se probaron.
RUN npm ci

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript. Falla con cualquier error de tipos (`npm run build` ya no
# lleva `|| true`): el despliegue se aborta antes de tocar el contenedor vivo.
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Install OpenSSL + Chromium (Puppeteer for PDF rendering and Playwright for SIMIT)
# - openssl, libc6-compat: Prisma runtime deps
# - chromium: headless browser for Puppeteer; provides /usr/bin/chromium-browser
# - chromium's recommended shared libs: nss, freetype, harfbuzz, ca-certificates, dumb-init
# - ghostscript: comprime los PDF que se suben a las hojas de vida (documentos del
#   conductor); sin él se guardan sin comprimir.
RUN apk add --no-cache \
    openssl \
    libc6-compat \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    dumb-init \
    ttf-freefont \
    ghostscript \
  && mkdir -p /app/.cache/puppeteer \
  && chown -R node:node /app/.cache/puppeteer

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser \
    CHROMIUM_PATH=/usr/bin/chromium-browser

# Copy package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./

# Copy prisma directory and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Install only production dependencies
RUN npm ci --only=production || npm install --production

EXPOSE 4000

CMD ["node", "dist/server.js"]
