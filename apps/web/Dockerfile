# ---------- STAGE 1: BUILD ----------
FROM node:24.12.0-alpine AS build

WORKDIR /app

RUN npm install -g npm@11.6.2

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/

RUN npm ci

COPY . .

RUN npm run build:web

# ---------- STAGE 2: PRODUCTION ----------
FROM nginx:alpine

# Remove config padrão do nginx
RUN rm -f /etc/nginx/conf.d/default.conf

# Copia o template do nginx para processamento por envsubst em runtime
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Copia o build do Vite
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Configurações padrão de runtime para Nginx
ENV API_UPSTREAM=http://api:3001
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM

# Porta correta
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

# Inicia o nginx
CMD ["nginx", "-g", "daemon off;"]
