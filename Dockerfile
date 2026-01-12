# Estágio de Construção (Build)
FROM node:20-alpine AS build

WORKDIR /app

# Instalar dependências (aproveitando cache de camadas do Docker)
COPY package*.json ./
RUN npm ci

# Copiar todo o código fonte
COPY . .

# Definir argumentos de build para variáveis de ambiente VITE
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

# Definir variáveis de ambiente para o processo de build
# ARG permite que as variáveis sejam passadas via --build-arg
# Se não forem passadas, o build tentará ler do arquivo .env (se existir)
# Executar o build de produção (Vite)
RUN npm run build

# Estágio de Produção (Serve)
FROM nginx:alpine

# Copiar os arquivos construídos do estágio anterior para o diretório padrão do Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copiar nossa configuração customizada do Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expor a porta 3000
EXPOSE 3000

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
