# Estágio de Construção (Build)
FROM node:20-alpine AS build

WORKDIR /app

# Instalar dependências (aproveitando cache de camadas do Docker)
COPY package*.json ./
RUN npm ci

# Copiar todo o código fonte
COPY . .

# Executar o build de produção (Vite)
RUN npm run build

# Estágio de Produção (Serve)
FROM nginx:alpine

# Copiar os arquivos construídos do estágio anterior para o diretório padrão do Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copiar nossa configuração customizada do Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expor a porta 80
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
