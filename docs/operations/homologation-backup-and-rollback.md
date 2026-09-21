# Runbook: Backup e Rollback de Homologação

Este documento estabelece os procedimentos operacionais para backup e rollback no ambiente de homologação do **Zafira Hub 2.1**, conforme diretrizes da **ADR-018** e do **Mapa Mestre**.

---

## 1. Princípios Fundamentais

1. **Rollback de Aplicação != Rollback de Banco de Dados:**
   - **Rollback de Aplicação:** Consiste na substituição das referências de container (`API_IMAGE_REF`, `WEB_IMAGE_REF`) pelos digests SHA256 do par estável anterior, seguido de reinicialização dos containers.
   - **Rollback de Banco de Dados:** As migrations do Prisma são estritamente *forward-only*. **Não existe comando `prisma migrate down` nem scripts SQL automáticos de reversão.** Se uma migration introduzir incompatibilidade com a versão anterior do código, a reversão do banco exige a restauração manual de um backup consistente realizado imediatamente antes da migration.
2. **Backup Obrigatório Pré-Migration:** Em qualquer ambiente persistente de homologação, antes de rodar `prisma migrate deploy`, deve-se gerar um backup do banco de dados descartável/staging.
3. **Isolamento de Produção:** Qualquer operação de backup e restore descrita neste documento aplica-se única e exclusivamente ao banco de staging (`zafira_hub_21_staging`). É expressamente proibido apontar rotinas de homologação para o banco de produção (`zafira_hub_v2`).

---

## 2. Procedimento de Backup do Banco de Staging

### 2.1 Formato Recomendado
Utilizar `pg_dump` no formato customizado comprimido (`-Fc`), que permite restauração paralela e seleção de tabelas.

### 2.2 Comando de Backup (Referência Operacional)

```bash
# Executar dentro do container PostgreSQL de homologação ou via cliente seguro
pg_dump -U <STAGING_USER> -h <STAGING_HOST> -p 5432 -d zafira_hub_21_staging -Fc -f /backups/staging_backup_$(date +%Y%m%d_%H%M%S).dump
```

*Nota: Nunca salvar ou compartilhar senhas em texto plano nos logs de execução.*

---

## 3. Procedimento de Rollback de Aplicação (Mecânico por Digest)

Se a versão recém-implantada apresentar instabilidade funcional, falhas de liveness (`/health`) ou readiness (`/health/database`), proceder com o rollback mecânico de imagens:

1. **Identificar o Par Estável Anterior:** Obter os digests SHA256 auditados e validados no CI para API e Web (ex.: artefatos da baseline estável).
2. **Validar o Par de Rollback:**
   ```bash
   CURRENT_API_REF="ghcr.io/julianogdc/zafira-hub-api@sha256:<novo_digest>" \
   CURRENT_WEB_REF="ghcr.io/julianogdc/zafira-hub-web@sha256:<novo_digest>" \
   ROLLBACK_API_REF="ghcr.io/julianogdc/zafira-hub-api@sha256:<digest_anterior>" \
   ROLLBACK_WEB_REF="ghcr.io/julianogdc/zafira-hub-web@sha256:<digest_anterior>" \
   ./scripts/homologation/validate-rollback-pair.sh
   ```
3. **Preservar o Banco de Dados:** Não reiniciar nem alterar o banco de dados caso o schema permaneça compatível.
4. **Atualizar Configuração de Imagem:** No painel de deploy ou arquivo de ambiente de homologação, atualizar:
   - `API_IMAGE_REF=<ROLLBACK_API_REF>`
   - `WEB_IMAGE_REF=<ROLLBACK_WEB_REF>`
5. **Reiniciar os Containers da Aplicação:** Reiniciar os serviços de API e Web com as imagens anteriores.
6. **Executar Smoke Tests de Validação:**
   ```bash
   WEB_BASE_URL="http://127.0.0.1:8082" ./scripts/homologation/smoke.sh
   ```
7. **Verificar os endpoints:**
   - `GET /health` => 200
   - `GET /health/database` => 200
   - `GET /hub-api/health` => 200

---

## 4. Procedimento de Rollback de Banco de Dados (Restauração Manual)

Caso uma migration com *breaking change* tenha sido aplicada e seja necessário retornar ao schema anterior:

1. **Autorização Explícita:** Interromper o processo e obter confirmação do responsável técnico.
2. **Parar a Aplicação:** Parar os containers de API e Web de homologação para interromper transações ativas.
3. **Restaurar o Dump:**
   ```bash
   # Recriar/limpar o schema de staging e restaurar o dump pré-migration
   pg_restore -U <STAGING_USER> -h <STAGING_HOST> -d zafira_hub_21_staging --clean --if-exists /backups/<staging_backup_arquivo>.dump
   ```
4. **Subir a Aplicação no Par de Rollback:** Iniciar API e Web nas versões compatíveis com o schema restaurado.
5. **Auditar o Estado:** Executar `migration-status.sh` e `smoke.sh` para confirmar integridade.
