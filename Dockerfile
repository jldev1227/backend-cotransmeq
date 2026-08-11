FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL and other dependencies required for Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci || npm install

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Install OpenSSL + Chromium (needed by Puppeteer in /api/pdf/from-html)
# - openssl, libc6-compat: Prisma runtime deps
# - chromium: headless browser for Puppeteer; provides /usr/bin/chromium-browser
# - chromium's recommended shared libs: nss, freetype, harfbuzz, ca-certificates, dumb-init
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
