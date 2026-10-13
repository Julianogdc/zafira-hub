# ADR-002 — Contratos compartilhados e padrão HTTP do Hub 2.1

Status: Aprovado

Data: 19 de setembro de 2026

## Contexto

Web e API historicamente mantêm tipos e contratos em locais separados.

A auditoria da Fase 0 identificou risco de duplicação e inconsistência de contratos, além de divergência no registro de rotas com e sem /api.

O monorepo da Fase 1 permite estabelecer contratos compartilhados antes da reconstrução dos módulos.

## Decisão

O Hub 2.1 utilizará packages/contracts como fonte compartilhada para schemas e tipos utilizados por Web e API.

Zod será a fonte preferencial para schemas runtime.

Tipos TypeScript compartilhados serão derivados com z.infer sempre que tecnicamente aplicável.

packages/contracts não poderá depender de frameworks de interface, servidor, ORM ou integrações.

São proibidas dependências diretas de:

- React
- Fastify
- Prisma
- Asana
- Postiz
- Asaas
- Banco Inter
- apps/web
- apps/api

## Versionamento HTTP

A API canônica do Hub 2.1 utilizará:

/api/v1

O prefixo faz parte do contrato externo da aplicação.

Novas APIs do 2.1 devem nascer versionadas.

Rotas legadas serão migradas módulo por módulo.

Não haverá duas convenções permanentes de rota.

Compatibilidade temporária, caso realmente necessária, deverá:

- possuir motivo documentado;
- possuir prazo de remoção;
- possuir testes;
- não ser usada como desculpa para registrar permanentemente duas rotas equivalentes.

## Estratégia de migração

Nenhuma rota existente será modificada no commit que cria packages/contracts.

O primeiro módulo funcional a adotar o contrato HTTP canônico será autenticação e sessão.

Depois dele, os demais módulos serão migrados incrementalmente.

## Contratos

Os contratos poderão conter:

- schemas de request;
- schemas de response;
- schemas de parâmetros;
- schemas de query;
- contratos de erro;
- tipos compartilhados;
- constantes HTTP realmente públicas.

Contratos não conterão:

- regras de negócio;
- queries de banco;
- autorização;
- acesso a Prisma;
- chamadas externas;
- componentes de UI.

## Erros HTTP

O formato canônico de erro do Hub 2.1 será:

{
  "error": {
    "code": "string",
    "message": "string",
    "requestId": "string opcional",
    "details": "opcional"
  }
}

code será estável e adequado para tratamento programático.

message será legível para humanos, mas não deverá expor segredos ou detalhes internos.

details será opcional e deverá ser seguro para exposição ao cliente.

## Datas e identificadores

IDs transportados pela API serão tratados como strings no contrato HTTP.

Instantes serão representados em ISO 8601.

Datas civis que não representam horário poderão utilizar YYYY-MM-DD quando o domínio exigir semântica de data pura.

## Consequências

Benefícios:

- tipos compartilhados;
- validação runtime;
- menos divergência Web/API;
- versionamento explícito;
- base consistente para autenticação e RBAC.

Custos:

- migração gradual dos módulos existentes;
- necessidade de atualizar clientes frontend;
- período temporário com módulos legados e módulos 2.1 convivendo.

## Fora de escopo

Este ADR não:

- altera rotas atuais;
- implementa autenticação;
- implementa RBAC;
- altera banco;
- migra integrações;
- cria API Gateway;
- cria microserviços.
