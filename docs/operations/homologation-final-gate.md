# Runbook: Portão Final Multi-Organização (Multi-Org Isolation Gate)

Este documento descreve o procedimento operacional e os critérios de validação do **Portão Oficial Final da Fase 1 (Fundação)**:
> *"Dois usuários de organizações diferentes operam com isolamento comprovado."*

---

## 1. Distinção Crucial de Escopo

| Dimensão | CI Rehearsal (Automatizado) | Homologação Física Final (Manual / Assistida) |
| :--- | :--- | :--- |
| **Ambiente** | Runner efêmero do GitHub Actions | VPS de Homologação provisionada |
| **Banco de Dados** | Container descartável `postgres-hml` | Instância PostgreSQL dedicada de staging (`zafira_hub_21_staging`) |
| **Roteamento** | Reverse proxy Nginx em `http://127.0.0.1:8082/hub-api/` | Traefik / EasyPanel com HTTPS e domínio oficial de homologação |
| **Objetivo** | Provar determinismo mecânico e ausência de regressões | Provar estabilidade sob infraestrutura real e carga da VPS |
| **Status do Portão** | **MECÂNICA VALIDADA — FASE 1 PERMANECE ABERTA** | **FECHAMENTO FORMAL DA FASE 1 (Sujeito a Aceite)** |

> [!IMPORTANT]
> **O sucesso do CI Rehearsal NÃO encerra a Fase 1.** O fechamento formal do portão exige a execução deste roteiro na homologação física após aprovação da capacidade da VPS pelo Chat de Direção.

---

## 2. Roteiro de Execução do Portão

```
[ 1. Seed da Fixture A/B ] ──> [ 2. RBAC Bootstrap ] ──> [ 3. Login Simultâneo A & B ]
                                                                      │
[ 6. Criação de Recursos ] <── [ 5. Rejeição Cross-Login ] <── [ 4. Validação de Sessão ]
        │
        ▼
[ 7. Isolamento de Listagem ] ─> [ 8. Bloqueio GET Cross-Org (404) ]
                                              │
[ 11. Auditoria e Logout ] <── [ 10. Bloqueio Tampering ] <─── [ 9. Bloqueio PATCH Cross-Org (404) ]
```

---

## 3. Passo a Passo Técnico

### 3.1 Provisionamento da Fixture de Teste
Executar dentro do container da API publicada por digest:
```bash
docker run --rm \
  --network <HML_NETWORK> \
  -e DATABASE_URL="<STAGING_DATABASE_URL>" \
  -e GATE_PASSWORD_A="<SENHA_SEGURA_A>" \
  -e GATE_PASSWORD_B="<SENHA_SEGURA_B>" \
  -v "$(pwd)/scripts/homologation/seed-multiorg-gate.mjs:/app/seed-multiorg-gate.mjs:ro" \
  "<API_IMAGE_REF>" \
  node /app/seed-multiorg-gate.mjs
```

### 3.2 Bootstrap do Catálogo RBAC
```bash
docker run --rm \
  --network <HML_NETWORK> \
  -e DATABASE_URL="<STAGING_DATABASE_URL>" \
  "<API_IMAGE_REF>" \
  npm run rbac:bootstrap --workspace=@zafira/api
```

### 3.3 Execução da Bateria de Testes HTTP
```bash
export WEB_BASE_URL="https://<DOMINIO_HOMOLOGACAO>"
export ORG_A_ID="11111111-1111-4111-8111-111111111111"
export ORG_B_ID="22222222-2222-4222-8222-222222222222"
export GATE_EMAIL_A="gate-a@zafira.invalid"
export GATE_EMAIL_B="gate-b@zafira.invalid"
export GATE_PASSWORD_A="<SENHA_SEGURA_A>"
export GATE_PASSWORD_B="<SENHA_SEGURA_B>"

./scripts/homologation/multiorg-isolation-gate.sh
```

---

## 4. Critérios de Aceite Obrigatórios

1. **Login Same-Origin (Org A e Org B):** Retornam HTTP 200 com cookie HTTP-only emitido.
2. **Rejeição de Login Cruzado:** User A tentando logar em Org B retorna **HTTP 403** (e vice-versa).
3. **Sessão Estrita:** `/auth/session` retorna exclusivamente a organização ativa vinculada ao usuário.
4. **Criação de Clientes:** Criados sob cada tenant sem interferência mútua.
5. **Isolamento de Listagem:** `GET /clients` de A contém apenas clientes de A; `GET /clients` de B contém apenas clientes de B.
6. **Isolamento por ID (GET):** `GET /clients/:idB` por User A retorna **HTTP 404** (e vice-versa).
7. **Isolamento de Mutação (PATCH):** `PATCH /clients/:idB` por User A retorna **HTTP 404**, mantendo o registro de B intacto (e vice-versa).
8. **Injeção de Header (`x-organization-id`):** Enviar header apontando para o tenant alheio em sessão autenticada não vaza nem comuta o tenant do usuário.
9. **Resultado Final:** O script emite `MULTIORG_GATE=PASS`.
