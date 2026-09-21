FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/

RUN npm ci --include=dev

COPY . .

RUN npm run prisma:generate
RUN npm run build:api

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "--workspace=@zafira/api"]
