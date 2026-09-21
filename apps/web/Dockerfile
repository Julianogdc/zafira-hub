# ---------- STAGE 1: BUILD ----------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

# Mapeia ARGs para variáveis de ambiente para o build
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build:web

# ---------- STAGE 2: PRODUCTION ----------
FROM nginx:alpine

# Remove config padrão do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia a config correta
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copia o build do Vite
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Porta correta
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

# Inicia o nginx
CMD ["nginx", "-g", "daemon off;"]
