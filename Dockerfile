FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npx tsc

FROM node:22-slim AS runtime

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY agent.json ./
COPY .env.example ./.env.example

RUN mkdir -p logs

# EigenCompute TEE metadata
LABEL org.eigencloud.agent="sentinel-defi-guardian"
LABEL org.eigencloud.version="0.1.0"
LABEL org.eigencloud.runtime="tee"

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
