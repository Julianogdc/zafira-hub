# ADR-006 — CI e gate de integração PostgreSQL

Status: Aprovado

Data: 19 de setembro de 2026

## Contexto

Os testes unitários e de caracterização do Hub 2.1 validam regras de autorização e isolamento usando mocks e dependências simuladas.

A Fase 1 também exige provar migrations, constraints e isolamento em PostgreSQL real antes da homologação.

O computador local de desenvolvimento não possui Docker disponível.

A VPS de produção não deve ser utilizada como ambiente de teste da fundação.

## Decisão

O repositório utilizará GitHub Actions com PostgreSQL 16 descartável como primeiro gate de integração real.

Cada execução nasce com um banco vazio e descartável.

A pipeline deverá:

1. instalar dependências;
2. gerar Prisma Client;
3. aplicar todas as migrations com prisma migrate deploy;
4. preparar duas organizações fictícias;
5. executar o bootstrap RBAC;
6. executar o bootstrap novamente para testar idempotência;
7. executar testes de integração contra PostgreSQL real;
8. executar as validações normais da aplicação.

## Segurança

Nenhuma credencial de produção será utilizada.

O DATABASE_URL do CI utilizará credenciais descartáveis.

Scripts de teste deverão recusar execução quando:

- NODE_ENV=production;
- a flag explícita de banco de teste estiver ausente;
- o banco alvo não for o banco CI aprovado.

## Dados de teste

O conjunto mínimo possuirá:

Organization A
Organization B

usuários/memberships separados

clients pertencentes a cada organização

um MEMBER da organização A com Client atribuído e outro não atribuído.

Nenhum dado real de cliente será usado.

## Gate

Nenhuma nova migration da Fundação será considerada validada apenas porque prisma generate ou prisma validate passou.

Ela deve conseguir ser aplicada do zero no PostgreSQL descartável da pipeline.

## Fora de escopo

Este ADR não:

- cria ambiente de produção;
- define a topologia final de homologação;
- utiliza VPS;
- executa migrations de produção;
- substitui backup/restore;
- implementa deploy do Hub 2.1.
