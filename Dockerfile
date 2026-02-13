FROM node:20-slim AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
COPY bin/ ./bin/
RUN npx tsup

FROM node:20-slim

WORKDIR /cortexos
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist/ ./dist/

ENV NODE_ENV=production
EXPOSE 3100

ENTRYPOINT ["node", "dist/cortexos.js"]
CMD ["--help"]
