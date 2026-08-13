# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# En el build solo transpilamos TS; no necesitamos descargar navegadores
# (los provee la imagen oficial de Playwright en la etapa de producción).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json* yarn.lock* ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production stage
# Imagen oficial de Playwright (Ubuntu jammy) con Chromium ya instalado.
# La versión de la imagen debe coincidir con la del paquete npm "playwright".
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_PROFILE_PATH=/app/playwright-profile \
    PLAYWRIGHT_HEADLESS=true

# dumb-init + xvfb: en Docker no hay X11 real; xvfb permite headed Chromium
# (mejor frente al WAF que headless puro).
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init xvfb \
  && rm -rf /var/lib/apt/lists/*

# Copy built application and node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Usuario no root para seguridad + directorio del perfil persistente.
# Al crear el dir con este propietario, el volumen nombrado montado aquí
# hereda la propiedad de "nodejs" en su primera inicialización.
RUN groupadd -g 1001 nodejs \
  && useradd -r -u 1001 -g nodejs nodejs \
  && mkdir -p /app/playwright-profile \
  && chown -R nodejs:nodejs /app/playwright-profile

USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 4000

ENTRYPOINT ["dumb-init", "--"]
# -a elige un display libre; -s define resolución del framebuffer virtual
CMD ["xvfb-run", "-a", "-s", "-screen 0 1365x900x24", "node", "dist/server.js"]
