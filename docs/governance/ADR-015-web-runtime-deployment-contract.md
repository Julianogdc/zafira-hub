# ADR-015: Contrato de Deploy e Runtime do Frontend Web (Hub 2.1)

## Status
Aceito

## Data
2026-09-21

## Contexto
Durante a revisão de fechamento da Fase 1 (Fundação), identificou-se que o frontend web (`apps/web`) continha URLs absolutas e hardcoded apontando para instâncias legadas de infraestrutura (`zafira-hub-v2-api.hvrb9d.easypanel.host`) tanto em `apps/web/src/lib/api.ts` quanto no proxy de desenvolvimento do `apps/web/vite.config.ts`.
Adicionalmente, a inicialização do SDK legado do Supabase (`apps/web/src/lib/supabase.ts`) e a presença de `ARG VITE_SUPABASE_*` no Dockerfile acoplavam a geração do bundle estático a variáveis de ambiente de build, trazendo risco de falha de inicialização ou vazamento de chamadas para ambientes antigos.

## Decisões

1. **Eliminação de Endpoints Hardcoded**: O frontend compilado para produção não contém nenhum endpoint ou URL absoluta de API hardcoded.
2. **Comunicação Same-Origin**: Em produção, a comunicação entre o navegador e a API do Hub 2.1 é estritamente same-origin através do Nginx Web que atua como reverse proxy.
3. **Prefixo Canônico `/hub-api`**:
   - Em desenvolvimento (`import.meta.env.DEV`), as requisições utilizam `/api` (redirecionadas pelo Vite proxy local para `http://127.0.0.1:3001` por padrão).
   - Em produção, as requisições utilizam o prefixo `/hub-api` (ex: `/hub-api/api/v1/auth/session` ou `/hub-api/clients`).
4. **Nginx Reverse Proxy & Runtime Upstream**:
   - O Nginx Web faz proxy reverso de `/hub-api/` para `${API_UPSTREAM}/`.
   - O upstream da API é configurado exclusivamente em **runtime** através da variável de ambiente `API_UPSTREAM` (default: `http://api:3001`).
5. **Build-Once / Deploy-Many**: A imagem Docker do Web é construída uma única vez sem conhecer URLs externas, segredos ou topologias de rede, podendo ser executada em qualquer ambiente (CI, homologação, produção).
6. **Preservação de Cookies Same-Origin**: A autenticação do Hub 2.1 baseia-se em cookies HTTP-only, `Secure` e `SameSite`, transmitidos de forma transparente e segura via same-origin.
7. **Supabase como Módulo Legado Não-Autoritativo**:
   - A autoridade de autenticação e dados canônica é a API Fastify + Prisma + PostgreSQL.
   - O SDK Supabase permanece apenas para compatibilidade de módulos legados pendentes de migração (Fases 2 a 13).
   - A ausência das variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` não impede nem derruba o bootstrap da aplicação (utilizando fallback inerte e não-secreto `https://legacy-supabase-disabled.invalid` com `LEGACY_SUPABASE_CONFIGURED = false`).
8. **Remoção de Build Args Específicos de Ambiente**: Os argumentos de build do Docker para Supabase ou API foram eliminados do `apps/web/Dockerfile`.
9. **Isolamento de Ambientes**: Nenhuma requisição do frontend do Hub 2.1 trafega para a infraestrutura ou domínios legados do Hub 2.0.

## Consequências
- A imagem Docker do frontend Web torna-se 100% reproduzível, estática e independente de variáveis no momento do `docker build`.
- Zero risco de vazamento de tráfego de homologação ou desenvolvimento para servidores legados.
- Transparência total e isolamento no tráfego de autenticação via cookies HTTP-only.
