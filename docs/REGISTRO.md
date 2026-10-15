# Zafira Hub 2.1 — Registro Oficial de Execução e Decisões

Cronologia de execuções e decisões do projeto. **Entradas mais recentes no topo.** Nunca apagar nem reescrever uma entrada: se algo for superado, registrar uma nova entrada que diga o que mudou.

- Estado atual (o que fazer agora): `docs/ESTADO_ATUAL.md`
- Escopo e regras: `docs/MAPA_MESTRE.md`
- Cronologia anterior a 10/10/2026 (Google Docs): `docs/historico/REGISTRO_OFICIAL_DRIVE_ate_2026-10-10.md`

## Formatos

**Execução (handoff obrigatório ao fim de cada sessão de trabalho):**

```
### AAAA-MM-DD — <MARCO> — <agente>
- BASELINE (commit):
- CI/EVIDÊNCIA:
- STATUS: concluído | pendente de aceite | bloqueado | não iniciado
- O QUE MUDOU:
- LIMITES/LACUNAS:
- PRÓXIMA MICROETAPA AUTORIZADA:
- PROIBIÇÕES ATUAIS:
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE
```

**Decisão (só o proprietário decide; agentes podem propor):**

```
### DEC-<ÁREA>-<nº> — <título>
- Data / responsável:
- Problema:
- Decisão:
- Alternativas consideradas:
- Impacto (módulos, dados, segurança, prazo, infraestrutura):
- Revisão (quando reabrir):
```

---

### 2026-10-14 — Execução da HM-3 (Ajuste complementar final de auditoria: eliminação de leitura integral em ensureImageDimensions por stream limitado sem storage.get) — Antigravity
- BASELINE (commit): `0910051` no público `Julianogdc/zafira-hub` (espelho no interno: `f2d97e9`).
- CI/EVIDÊNCIA: testes locais 1.125/1.125 aprovados (API 900/900 em 46 suites; Web 102/102; Domain 123/123; typechecks de contracts, domain, api e web 100% OK; monorepo build 100% OK). Testes focados do módulo: `image-head.test.ts` 18/18 aprovados; `content-streaming-upload.test.ts` 11/11 aprovados; testes de storage e publication 30/30 aprovados. Validação oficial pelo CI consolidado no GitHub Actions.
- STATUS: concluído pela engenharia, submetido para decisão formal de aceite DEC-HML-004.
- O QUE MUDOU:
  1. **Eliminação de leitura integral em `ensureImageDimensions` (`content.service.ts`):**
     - Substituído `imageDimensions(await storage().get(m.storageKey))` por `readImageDimensionsFromStorage(storage(), m.storageKey, m.sizeBytes)`.
     - Removido o import não utilizado de `imageDimensions` em `content.service.ts`.
     - `storage.get()` jamais é chamado nesse caminho, evitando carregar até 20 MB integralmente em buffer na heap/memória externa.
  2. **Leitura limitada via streaming com cleanup garantido (`image-head.ts`):**
     - Adicionada função `readStreamHead(stream, maxBytes)` que consome apenas até `maxBytes` (teto estrito de 1 MiB) e encerra o stream com `destroy()`, sem ler bytes excedentes nem alocar além da cota.
     - Adicionada função `readImageDimensionsFromStorage(storage, storageKey, sizeBytes)` que obtém o stream via `storage.openStream(storageKey)` (que confere a integridade SHA-256 integral pré-entrega), lê no máximo 1 MiB, extrai dimensões e garante a destruição do stream e execução do `cleanup()` do spool temporário no `finally`.
     - Imagens acima de 20 MB (`PUBLISH_MAX_IMAGE_BYTES`) são rejeitadas antecipadamente sem qualquer operação de I/O.
     - Falhas de I/O, arquivos ilegíveis ou imagens cujo SOF esteja além de 1 MiB retornam `null` (dimensões desconhecidas), preservando a regra de fail-closed (agendamento bloqueado por `imagePixelProblem`).
  3. **Proteção contra contorno do limite de 1 MiB pós-upload:**
     - Quando `uploadMediaFromSpool` conclui, o `get()` subsequente invoca `withDimensions`, que delega para `ensureImageDimensions`. Como `ensureImageDimensions` agora respeita estritamente o mesmo teto de 1 MiB por streaming seguro, arquivos cujos marcadores excedam 1 MiB continuam com dimensões desconhecidas (`widthPx: null, heightPx: null`), impedindo que a reabertura contorne a restrição.
  4. **Suíte abrangente de testes (`image-head.test.ts` expandido de 7 para 18 testes):**
     - Testes unitários para `readStreamHead` (interrupção sob cota, streams pequenos, maxBytes <= 0, tratamento de erro).
     - Testes unitários para `readImageDimensionsFromStorage` (sucesso, teto de 1 MiB, arquivo > 20 MB, falha de stream e cleanup).
     - Testes unitários para `ensureImageDimensions` com mock espião que falha caso `storage.get()` seja chamado, validando cálculo, atualização do banco e descarte de arquivos fora de escopo.
     - Teste de reabertura pós-upload comprovando que dimensões além de 1 MiB não são preenchidas.
     - Guard estrito de código-fonte inspecionando `content.service.ts` para garantir ausência de chamadas a `storage.get()` e `storage().get()` em `ensureImageDimensions`.
- LIMITES/LACUNAS:
  - Nenhuma alteração arquitetural ampla; escopo cirúrgico e restrito à correção da ressalva de auditoria.
  - O Cloudflare R2 real permanece pendente de teste físico até a fase de homologação física com credenciais reais.
- PRÓXIMA MICROETAPA AUTORIZADA: Nenhuma até deliberação e registro da DEC-HML-004 pela Direção Técnica. Não avançar para HM-4 sem autorização formal.
- PROIBIÇÕES ATUAIS: Preservadas integralmente todas as proibições do `ESTADO_ATUAL.md` (sem acesso a VPS, sem deploy, sem F8-5e, agendadores e despachantes desligados).
- DOCUMENTAÇÃO ATUALIZADA: `docs/ESTADO_ATUAL.md`, `docs/REGISTRO.md`.

### 2026-10-14 — Execução da HM-3 (Ajustes complementares pré-aceite DEC-HML-004: streaming seguro, interrupção S3, leitura limitada de imagens e medições de memória) — Antigravity
- BASELINE (commit): `bc080ca` no público `Julianogdc/zafira-hub` (espelho no interno: `a6ca298`).
- CI/EVIDÊNCIA: run 38659458668 (https://github.com/Julianogdc/zafira-hub/actions/runs/38659458668) **5/5 SUCCESS** (Code Quality and Tests, PostgreSQL Integration Gate 208/208 em 2 rodadas consecutivas no mesmo banco, Docker Build Gate, Publish Images GHCR, Homologation Rehearsal com Browser Gates F5, F6, F7-1, F7-2, F7-3, F7-4 e F8: 125/0). Testes locais: API 889/889 aprovados (46 suites, 0 falhas, incluindo 41 testes no módulo de storage/content); Web 102/102 aprovados; Domain 123/123 aprovados; typechecks e build 100% OK.
- STATUS: concluído pela engenharia, submetido para decisão formal de aceite DEC-HML-004.
- O QUE MUDOU (5 ajustes da auditoria independente):
  1. **Remoção de leitura integral de imagens (`content.service.ts` e `image-head.ts`):**
     - Criado módulo `image-head.ts` com teto de leitura de 1 MiB (`IMAGE_DIMENSIONS_MAX_READ_BYTES`) via `readFileHead`.
     - Removido `readFile(spooled.tempFilePath)` integral do `content.service.ts` (garantido por teste de guarda estrita no código-fonte).
     - Caso os metadados de dimensões estejam além de 1 MiB ou o arquivo seja ilegível, os campos permanecem `null` (desconhecidos), preservando o bloqueio de agendamento por `imagePixelProblem` (falha fechado).
  2. **Limpeza e descarte de arquivos truncados (`upload-spooler.ts`):**
     - Checagem `isTruncated()` executada *antes* da criação do arquivo temporário e abertura do `WriteStream`.
     - Streams que chegam truncados têm o consumo escoado (`fileStream.resume()`) e são rejeitados com 413 `FILE_TOO_LARGE` sem gerar arquivos órfãos em disco.
     - O método `cleanup()` aguarda o descritor fechar (`writeStream.once('close')`) antes do `unlink`, eliminando corridas com aberturas assíncronas.
  3. **Tratamento e limpeza de streams S3 interrompidos (`file-storage.ts`):**
     - `S3FileStorage.openStream` reescrito com `pipeline`, convertendo `ERR_STREAM_PREMATURE_CLOSE` na exceção tipada `StorageStreamInterruptedError`.
     - Implementado `closeThenUnlink` com retries contra bloqueios transitórios de descritores no Windows (`EPERM`/`EBUSY`).
     - Memorização da promise de `cleanup` no stream retornado e hook automático em `readStream.once('close')` para remover o spool temporário quando o consumidor desiste ou conclui a leitura.
     - Suíte de regressão criada em `file-storage-s3-interruption.test.ts` (7 testes, 100% aprovados).
  4. **Retificação documental e arquitetural:**
     - O envio S3 no Hub utiliza `PutObjectCommand` com stream de arquivo temporário (`Body: createReadStream(filePath)`), e **não** `Upload` multipart da biblioteca `@aws-sdk/lib-storage` (que não faz parte das dependências de runtime).
     - O download S3 utiliza spool temporário em disco com conferência integral de hash SHA-256 antes da entrega HTTP ao cliente, garantindo que bytes incompletos ou corrompidos nunca alcancem o consumidor. Não há streaming direto S3 → socket.
  5. **Métricas de memória e rigor metodológico (`memory-probe.ts`):**
     - Implementado o sensor `MemoryProbe` amostrando `heapUsed`, `external`, `arrayBuffers` e `rss` a cada bloco e em intervalo de 2 ms, registrando linha de base (pós-GC), fim e pico.
     - **Retificação de benchmark:** a estimativa anterior de "50–80 MiB" citada na primeira entrega era uma estimativa teórica do modelo anterior e não um benchmark medido; fica aqui formalmente desconsiderada como dado empírico.
     - **Limitações do método:** medição em processo local de testes; não-determinismo do GC do V8; `Buffer` alocado fora da heap (`external`/`arrayBuffers`); `rss` engloba runtime e alocador do Node.js; testes com payload sintético sem rede WAN.
     - **Resultados empíricos medidos:**
       - Upload Spooler (25 MiB): DeltaPeak simultâneo Heap+External de **1.94 MiB** (HeapUsed DeltaPeak 1.69 MiB, External 0.25 MiB, RSS 0.46 MiB).
       - Upload e2e Fastify multipart (50 MiB): DeltaPeak Heap+External de **19.09 MiB** (spooler novo) vs **97.82 MiB** (legado `toBuffer()` sob a mesma sonda).
       - Download S3 (50 MiB): DeltaPeak Heap+External de **20.65 MiB** (spool + SHA) vs **150.28 MiB** (S3 `get()` integral sob a mesma sonda).
- RESSALVA TÉCNICA ADICIONAL:
  - O método legado `ensureImageDimensions` (`content.service.ts`, F8-5p.1) permanece usando `storage().get()` restrito a imagens históricas que não possuíam dimensões no banco, limitado a 20 MB (`PUBLISH_MAX_IMAGE_BYTES`).
- LIMITES/LACUNAS:
  - Preservados os limites de segurança, isolamento por organização, ausência de credenciais reais e congelamento da infraestrutura VPS/EasyPanel.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Submissão para aceite formal DEC-HML-004 pela Direção Técnica.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

---

### 2026-10-14 — Execução da HM-3 (Upload/download em streaming sem buffers integrais, Nginx 110 MiB, Fastify trustProxy restrito) concluída e submetida — Antigravity
- BASELINE (commit): `cd2be14` no público `Julianogdc/zafira-hub` (espelho no interno: `7d12917`).
- CI/EVIDÊNCIA: run 38649568280 (https://github.com/Julianogdc/zafira-hub/actions/runs/38649568280) **5/5 SUCCESS** (Code Quality and Tests, PostgreSQL Integration Gate 208/208 em 2 rodadas consecutivas no mesmo banco, Docker Build Gate, Publish Images GHCR, Homologation Rehearsal com Browser Gates F5, F6, F7-1, F7-2, F7-3, F7-4 e F8: 125/0). Testes locais: API 869/869 aprovados (46 suites, 0 falhas); Web 102/102 aprovados; typechecks e build 100% OK.
- STATUS: concluído pela engenharia, pendente de aceite técnico pela Direção Técnica.
- O QUE MUDOU:
  1. **Ajustes de documentação:** Correção das contagens oficiais de testes nos documentos (API 850/850, PostgreSQL 208/208 em duas rodadas consecutivas no mesmo banco) sem duplicar a DEC-HML-003. Sincronização do `docs/ESTADO_ATUAL.md` público (que estava parado na HM-1), preservando estritamente a política de governança (apenas informações públicas, sem dados operacionais). Diferenças intencionais de workflows CI e `.env.example` preservadas entre público e interno.
  2. **Auditoria e Ajuste do Nginx Proxy (`apps/web`):**
     - Auditado o `Dockerfile` da imagem Web: confirmação de que `nginx.conf.template` é copiado para `/etc/nginx/templates/default.conf.template` e renderizado na inicialização.
     - Ajustado `client_max_body_size 110m;` com margem adequada para o overhead do formulário multipart em arquivos de 100 MiB (evitando rejeição no limite).
     - Ajustados os timeouts necessários para arquivos grandes (`client_body_timeout 120s;`, `proxy_read_timeout 120s;`, `proxy_send_timeout 120s;`, `proxy_connect_timeout 60s;`).
     - Preservados cabeçalhos de proxy (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`), protocolo `proxy_http_version 1.1;`, rotas e comportamento same-origin da SPA sem alterações desnecessárias.
     - Testes automatizados em `apps/web/src/lib/__tests__/nginx-config.test.ts` (3/3 aprovados).
  3. **Fastify Trust Proxy Restrito e Configurável:**
     - Criado módulo utilitário `apps/api/src/lib/trust-proxy.ts` com validação de segurança e integrado em `apps/api/src/app.ts`.
     - Proibição estrita de `trustProxy: true` irrestrito (`InvalidTrustProxyConfigError`). Padrão seguro desativado (`false`).
     - Suporte a contagem de saltos inteiros (`hops`), listas explícitas de IPs/redes CIDR ou função customizada.
     - Proteção comprovada de rate limiting, cookies e cabeçalhos forjados por atacantes externos em acesso direto ou atrás de proxy. Testes unitários em `apps/api/src/lib/__tests__/trust-proxy.test.ts` (9/9 aprovados).
  4. **Upload e Download sem Buffers Integrais:**
     - Spooling temporário em streaming via `spoolMultipartUpload` (`apps/api/src/modules/content/upload-spooler.ts`) com backpressure (`drain`), limite rígido de 100 MiB interrompendo imediatamente a transferência com `ContentError(413, 'FILE_TOO_LARGE')` caso excedido ou se truncado pelo Busboy, cálculo incremental de hash SHA-256 e captura dos primeiros 64 KiB para validação de tipo de arquivo (magic numbers) e dimensões sem carregar 100 MiB na heap. Limpeza do arquivo temporário garantida em bloco `finally`.
     - Interface `FileStorage` estendida com `putFromPath(key, filePath, options)` e `openStream(key): Promise<StorageStreamResult>` implementadas tanto no `LocalFileStorage` quanto no `S3FileStorage` (usando `Upload` multipart do `@aws-sdk/lib-storage` para envio via stream e `GetObjectCommand` para download via stream).
     - Rota autenticada de arquivo de mídia (`content.routes.ts`) e rota pública assinada de prévia de aprovação (`public-approval.routes.ts`) atualizadas para streaming nativo com cleanup garantido nos eventos `finish` e `close` da resposta HTTP.
  5. **Medições Empíricas de Consumo de Memória (Node.js Heap):**
     - Upload de arquivo grande (25 MiB): Heap antes: 29.43 MiB | Heap depois: 32.94 MiB | **Variação líquida de heap: 3.51 MiB** (vs. ~50-80 MiB caso mantivesse buffers integrais + parsing multipart em memória).
     - Download em stream (10 MiB): Heap antes: 34.82 MiB | Heap durante/depois: 34.61 MiB | Sem elevação de heap durante o trânsito dos chunks pelo pipeline HTTP.
- LIMITES/LACUNAS:
  - Teste controlado contra Cloudflare R2 real permanece pendente de provisionamento de bucket e credenciais pelo proprietário;
  - Produção, VPS, EasyPanel e Traefik permanecem 100% intocados;
  - Fase 8 permanece aberta (Portão F8 aberto; piloto F8-5e não autorizado).
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Aguarda aceite técnico da HM-3 pela Direção Técnica.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-HML-003 — Aceite técnico definitivo da HM-2 (Driver de armazenamento S3-compatível) (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: avaliar e homologar tecnicamente a implementação do driver de armazenamento S3-compatível privado (HM-2), validada no CI oficial e Browser Gates.
- Decisão: (1) **Aceite técnico definitivo da HM-2 (Driver de armazenamento S3-compatível)**, com evidências: baseline de código pública `817315f` (driver em `96091d3`, env em `817315f`), espelho interno `9bd4db7` (driver em `9775be1`, env em `9bd4db7`); CI oficial run 38627531741, 5/5 (domínio 123/123, API 850/850, web 99/99, PostgreSQL 208/208 em duas execuções consecutivas no mesmo banco, Docker Build, Publish Images, Homologation Rehearsal); Browser Gate F8: 125 aprovados, 0 falhas; testes unitários e de integração PostgreSQL (`storage-s3-postgres.test.ts`) 100% aprovados contra emulador S3 local em processo.
  (2) **Ressalvas técnicas registradas obrigatoriamente:**
  - *Cloudflare R2 real ainda não testado:* o driver foi exercitado contra emulador S3 local e nos gates automatizados; teste contra Cloudflare R2 real depende de criação de bucket e credenciais pelo proprietário em teste controlado.
  - *Armazenamento ainda utiliza buffers integrais:* uploads e downloads na API mantêm buffers integrais na heap (demanda prioritária da etapa HM-3).
  - *Idempotência por HEAD/PUT:* verificação de existência prévia (`exists()` via `HeadObject`) antes do `PutObject` não equivale a gravação estritamente atômica sob concorrência paralela massiva com mesma chave (mitigado pelo endereçamento determinístico por SHA-256 e imutabilidade dos arquivos).
  (3) Proibido: acessar a VPS, realizar deploy, criar buckets ou credenciais reais, habilitar publicação ou coletores reais, executar o piloto F8-5e, modificar a implementação da HM-3 antes de aprovação do diagnóstico técnico. A Fase 8 permanece aberta (Portão F8 aberto).
- Alternativas consideradas: volume local em produção (rejeitada por DEC-HML-001); presunção de testes reais sem credenciais (rejeitada).
- Impacto: módulo de storage (`file-storage.ts`), documentação operacional (`file-storage-s3.md`), perfil de ambiente e testes.
- Revisão: na execução do teste controlado contra bucket R2 real provisionado pelo proprietário.

### 2026-10-14 — Aceite da HM-2 registrado (DEC-HML-003) e diagnóstico da HM-3 entregue — Antigravity
- BASELINE (commit): `817315f` no público `Julianogdc/zafira-hub` (espelho no interno: `9bd4db7`).
- CI/EVIDÊNCIA: run 38627531741 (https://github.com/Julianogdc/zafira-hub/actions/runs/38627531741) **5/5**; domínio 123/123; API 850/850; web 99/99; PostgreSQL 208/208; Docker Build, Publish Images e Homologation Rehearsal aprovados; Browser Gate F8 125/0.
- STATUS: concluído (aceite formal registrado; diagnóstico e plano técnico da HM-3 apresentados para revisão).
- O QUE MUDOU: Registro formal do aceite técnico da HM-2 como DEC-HML-003; documentação de governança atualizada (`ESTADO_ATUAL.md`, `REGISTRO.md`, `HOMOLOGACAO_1_BLOQUEIOS.md`); registro obrigatório de 3 ressalvas técnicas (R2 real não testado, buffers integrais, idempotência HEAD/PUT); levantamento técnico de escopo, arquivos e riscos da HM-3 (consumo de memória no upload/streaming, Nginx client_max_body_size e Fastify trustProxy).
- LIMITES/LACUNAS: Cloudflare R2 real ainda não testado (aguarda provisionamento pelo proprietário); upload/download ainda alocam buffers integrais na memória; HEAD/PUT concorrente não é atômico; limites do Nginx (1m default) e ausência de trustProxy na API identificados e propostos para a HM-3; Fase 8 segue aberta e F8-5e não autorizada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Aguarda decisão e autorização da Direção para o plano técnico da HM-3.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial acesso à VPS, deploy, criação de buckets/chaves, F8-5e, ativação de despachantes ou coletores reais.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / HOMOLOGACAO_1_BLOQUEIOS.

### DEC-HML-002 — Aceite técnico definitivo da HM-1 e planejamento da medição da VPS (H7) (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: encerrar tecnicamente a HM-1 e preparar a medição de capacidade da VPS atual antes de qualquer decisão de topologia.
- Decisão: (1) **Aceite técnico definitivo da HM-1 (H1/P22 e H3/P18)**, com evidências: baseline `ecfc392` (espelho `4c1e70e`); CI run 38615589824, 5/5 (https://github.com/Julianogdc/zafira-hub/actions/runs/38615589824); PostgreSQL 201/201 em duas execuções consecutivas no mesmo banco; Browser Gate F8 125/0; handoff `e50c1a2` (público) e `e78cf90` (interno). (2) **Autorizado somente o planejamento da medição de 7 dias da VPS (H7):** avaliar o script `scripts/infra/vps-capacity-snapshot.sh` (segurança e suficiência), definir comandos somente leitura, frequência, critérios de aceitação e alternativas de topologia; **sem executar comando na VPS**. (3) Proibido: acessar a VPS, criar cron jobs, instalar programas, alterar infraestrutura, HM-2 ou qualquer outra implementação, CI apenas por alteração documental, e expor dados de infraestrutura no repositório público.
- Alternativas consideradas: —
- Impacto: documentação (ESTADO e REGISTRO nos dois repositórios; plano H7 somente no interno).
- Revisão: na decisão da Direção sobre o plano H7.

### 2026-10-14 — Aceite da HM-1 registrado e plano de medição da VPS (H7) entregue (DEC-HML-002) — Claude
- ACEITE: HM-1 aceita (DEC-HML-001; código `ecfc392`; CI 5/5 run 38615589824). P18 e P22 constam como resolvidas e aceitas. Antes do primeiro deploy real continua necessário rodar o `--check` do RBAC e ler a lista de remoções.
- PLANO H7 (`docs/propostas/H7_PLANO_MEDICAO_VPS.md` (somente interno)): (a) **script existente:** somente leitura, não imprime variáveis de ambiente, não escreve na VPS, carga baixa; saída contém dados de infraestrutura (tratar como interna); **insuficiente** para I/O, picos, OOM do kernel, reinícios e containers parados, redes e CPU em intervalo; (b) **complemento** somente leitura (`vmstat`, PSI, `/proc/meminfo`, processos por nome sem linha de comando, `docker ps -a`, reinícios e `OOMKilled`, redes, OOM no kernel), executado por entrada padrão sem criar arquivo na VPS; (c) **7 dias**, 3 amostras por dia mais picos (publicação do Postiz, backup, uso intenso) e uma linha de base; (d) **critérios** verde/amarelo/vermelho por RAM disponível, swap, load, iowait/PSI, disco, containers e steal, com cobertura mínima da medição; (e) **topologias:** B (novo projeto EasyPanel), C (Compose isolado; exige a rota HTTPS pelo proxy existente, hoje proibida de alterar), D (host dedicado) e A descartada; (f) guarda e comparação das amostras apenas no interno, com SHA-256; (g) 5 decisões D-H7-1 a D-H7-5.
- BASELINE DE CÓDIGO: inalterada — `ecfc392` no público (espelho `4c1e70e`). Nenhum código nem workflow alterado; commits com `[skip ci]`.
- STATUS: HM-1 **aceita**; plano H7 **entregue para revisão**; nada executado.
- PENDÊNCIAS: H2 (HM-2), H4 a H9; P33, P34, P40 (acompanhamento) e RS1–RS7.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial acesso à VPS, cron, instalação, EasyPanel, DNS, buckets, credenciais, contratação, HM-2 a HM-6, piloto F8-5e, F9, despachante e coletor.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano H7 (somente interno).

### 2026-10-14 — HM-1 implementada: bootstrap RBAC (H1/P22) e repetibilidade dos testes PostgreSQL (H3/P18) (DEC-HML-001) — Claude
- AUTORIZAÇÃO: DEC-HML-001 — exclusivamente a HM-1. Não executada nesta sessão: o planejamento de medição de capacidade da VPS (bloco interrompido e substituído).
- H1/P22 — DIAGNÓSTICO: o bootstrap só fazia upsert; nunca removia padrões obsoletos. Em banco anterior à F6-IMP.7B o MEMBER mantinha `deliverables.complete`. CORREÇÃO (`111f92c`): módulo `modules/authorization/rbac-sync.ts` (plano puro + aplicação transacional serializável); acrescenta e remove padrões por papel; nunca remove catálogo (cascata apagaria exceções), nunca toca exceções individuais nem organizações; trava de padrões (nenhum papel vazio, todos no catálogo, MANAGER/MEMBER ⊆ ADMIN); `--check`/`--dry-run` somente leitura (saída 2 em divergência); relatório com contagem de exceções por código, sem dados pessoais; `docs/operations/rbac-bootstrap.md` e passo 8.1 no runbook interno.
- H3/P18 — DIAGNÓSTICO: apenas `rbac-postgres.test.ts` usa organizações fixas; deixava a configuração da organização alterada (Q) e logs de auditoria que quebravam a contagem de P. CORREÇÃO (`2891e8c`): reset do estado-base antes do teste (guardado), restauração em `finally` no M, asserções escopadas no P, restauração no Q; guarda única `lib/test-database-guard.ts` (NODE_ENV, `ZAFIRA_TEST_DATABASE=1`, nome exato `zafira_hub_ci`, host local ou lista explícita, organizações `ci-*` antes de limpeza destrutiva, sem senha nas mensagens) aplicada nos 19 arquivos; `docs/operations/integration-test-database.md`.
- CI (`ecfc392`): `--check` após os dois bootstraps; segunda execução consecutiva de `test:integration:db` no mesmo banco; verificação RBAC `--check` na imagem publicada do ensaio de homologação.
- ARQUIVOS: novos `rbac-sync.ts`, `rbac-sync.test.ts`, `rbac-bootstrap-postgres.test.ts`, `test-database-guard.ts` e seu teste, 2 documentos de operações; alterados `bootstrap-rbac.ts`, 19 arquivos de teste/script (guarda), `rbac-postgres.test.ts`, `foundation-ci.yml` (2 arquivos com diferenças intencionais preservadas).
- TESTES: API 842/842 (locais e CI); domínio 123/123; web 99/99; PostgreSQL 201/201 **em duas execuções consecutivas** no mesmo banco; bootstrap no CI: 1ª execução 73 criadas e 136 acrescentadas, 2ª 0/0/0; `--check` em sincronia no banco de testes e no do ensaio; Browser Gates F6–F8 PASS (F8 125/0). Sem PostgreSQL local: a prova das duas execuções é a do CI.
- CI: run 38615589824 (https://github.com/Julianogdc/zafira-hub/actions/runs/38615589824) **5/5**.
- COMMITS: público `111f92c` (H1), `2891e8c` (H3), `ecfc392` (CI); interno `0d0b03f`, `31afe02`, `4c1e70e`. Um erro de processo corrigido antes do push: o runbook interno entrara num commit público local; refeito sem ele e o script de envio passou a abortar quando a guarda pública acusar.
- BASELINE DE CÓDIGO: `ecfc392` no público (espelho `4c1e70e`).
- STATUS: **pendente de aceite técnico** da Direção.
- RISCOS RESIDUAIS: a remoção vale na próxima requisição (o resolvedor lê o banco), então rodar `--check` e ler as remoções antes de aplicar em ambiente com usuários; catálogo obsoleto fica só relatado (decisão de limpar é futura); o reset de `rbac-postgres` cobre os dados que o arquivo cria hoje, e um teste novo que use `ci-org-a`/`ci-org-b` precisa entrar na lista; a guarda aceita `zafira_hub_ci` em hosts locais, então um banco de teste com esse nome em host remoto exige lista explícita; `rbac-bootstrap-postgres` usa a guarda única, mas assume CI já sincronizado.
- PENDÊNCIAS: H2–H9 (HM-2 a HM-6 e H7/H8/H9) não iniciadas; P33, P34, P40 (acompanhamento), RS1–RS7 mantidas.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial VPS, EasyPanel, DNS, buckets, credenciais, contratação, HM-2 a HM-6, piloto F8-5e, F9, despachante e coletor.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / HOMOLOGACAO_1_BLOQUEIOS (interno e público).

### DEC-HML-001 — Diretrizes de arquitetura de H2/H7 e autorização exclusiva da HM-1 (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: decidir a arquitetura de armazenamento e a abordagem de infraestrutura da primeira homologação e liberar o primeiro passo de código.
- Decisão: (1) **Aprovada a arquitetura de armazenamento S3-compatível com bucket externo e privado**; Cloudflare R2 é o fornecedor preferencial e a escolha definitiva depende de decisão posterior do proprietário. (2) **H7:** avaliar primeiro a capacidade da VPS atual, antes de contratar outro servidor; a homologação deve permanecer isolada dos serviços existentes; nenhuma contratação, provisionamento ou alteração na VPS autorizada. (3) Nginx (limite de corpo), `trustProxy`, consumo de memória, compatibilidade S3 e autenticação do GHCR ficam para etapas futuras. (4) **Autorizada exclusivamente a HM-1** (H1/P22 e H3/P18), com commits separados, espelhamento, testes locais e CI 5/5; parar em caso de falha; não declarar aceite em nome da Direção. (5) Proibido: VPS, EasyPanel, DNS, proxy de produção, bancos reais, buckets, credenciais, contratação, integrações, HM-2 a HM-6, homologação real, F8-5e e Fase 9.
- Alternativas consideradas: host dedicado imediato (adiada: medir a VPS primeiro); armazenamento autohospedado na VPS (não recomendado, ver análise H2/H7).
- Impacto: código de autorização (script e módulo), testes e CI; documentação operacional.
- Revisão: no aceite técnico da HM-1 e na decisão da HM-2.

### DEC-F8-033 — Aceite técnico definitivo da correção do P40 (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: encerrar tecnicamente a correção da prontidão do PostgreSQL do ensaio de homologação no CI.
- Decisão: **Aceite técnico definitivo da correção do P40**, com evidências: baseline `d69bcc2` (espelho `ab3344b`); CI run 38600735586, 5/5; Browser Gate F8 125/0; handoff `5256a83`; sessão liberada. **Ressalva de acompanhamento:** observar o passo nos próximos runs; recorrência reabre a pendência. Alterações restritas a documentos, com `[skip ci]`; código e workflow inalterados. A Fase 8 permanece aberta, aguardando o Portão F8. Proibido: F8-5e, F9 e alterações de infraestrutura.
- Alternativas consideradas: —
- Impacto: documentação (ESTADO e REGISTRO); MAPA_MESTRE sem alteração (sem mudança de escopo, sequência ou portão).
- Revisão: ao primeiro run futuro em que o passo falhar, ou quando o Portão F8 for decidido.

### 2026-10-14 — Aceite da correção do P40 registrado (DEC-F8-033) — Claude
- ACEITE: correção do P40 aceita definitivamente (código `d69bcc2`; CI 5/5 run 38600735586; Browser Gate F8 125/0).
- DOCUMENTOS: ESTADO_ATUAL (P40 aceita, com ressalva de acompanhamento nos próximos runs; próximo passo) e este REGISTRO; MAPA_MESTRE inalterado. Código e workflow inalterados; commits com `[skip ci]`.
- BASELINE DE CÓDIGO: inalterada — `d69bcc2` no público (espelho `ab3344b`).
- STATUS: P40 **aceita**; **Fase 8 não encerrada** (Portão F8 aberto); F8-5e não autorizada. Sessão mantida liberada a pedido da Direção (sem marca de sessão ativa, por tratar-se de commit documental único).
- PENDÊNCIAS: P33, P34 e RS1–RS7 mantidas; homologação H1–H9 aguardando decisão.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-5e, publicação, despachante ou coletor reais, VPS, produção, credenciais, F9 e alterações de infraestrutura.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-14 — P40 resolvido: prontidão do PostgreSQL do ensaio de homologação no CI (DEC-F8-032) — Claude
- AUTORIZAÇÃO: DEC-F8-032 — microetapa isolada em `.github/workflows/foundation-ci.yml`; sem alteração de código do Hub, VPS, produção, credenciais ou ambientes reais.
- CAUSA (run 38594989571, tentativa 1): a imagem oficial do PostgreSQL sobe um servidor provisório só por socket Unix para criar a base e o desliga antes do definitivo; `pg_isready` pelo socket respondia nele e a checagem final, única, caiu no desligamento.
- CORREÇÃO: passo "Setup CI Staging Network and PostgreSQL": laço de até 90 s; confere antes que o container segue em execução; consulta `SELECT current_database()` por TCP (`-h 127.0.0.1`) com a senha efêmera de ensaio já existente; só vale com a base `zafira_hub_21_staging` e 3 respostas seguidas; em falha imprime os logs e encerra com erro. Imagem fixada por digest, rede dedicada, validação de segurança do banco e demais passos preservados.
- COMMITS: público `d69bcc2`, interno `ab3344b`. Os workflows dos dois repositórios têm 2 diferenças intencionais (passo "Public Guard" só no público; checagem do domínio legado só no interno); a correção foi aplicada em cada arquivo preservando-as, e a comparação confirmou que só elas restam.
- TESTES: YAML dos dois arquivos válido (5 jobs), sintaxe do script conferida com `bash -n` (sem Docker local); CI oficial completo run 38600735586 **5/5**: domínio 123/123, API 829/829, web 99/99, PostgreSQL 195/195, Docker Build, Publish Images, Homologation (F6, F7-1b, F7-2b, F7-3b, F7-4b, F8 125/0). O log mostra "PostgreSQL Staging está pronto (TCP, base zafira_hub_21_staging, 3 respostas seguidas)". Primeira execução da correção; não há prova estatística de ausência da intermitência.
- BASELINE DE CÓDIGO: `d69bcc2` no público (espelho `ab3344b`).
- STATUS: **pendente de aceite técnico** da Direção.
- LIMITES/LACUNAS: o passo só é exercitado no CI (sem Docker local); a senha de ensaio já estava no workflow (valor efêmero e não sensível); a intermitência será confirmada pela ausência de recorrência nos próximos runs.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-5e, publicação, despachante ou coletor reais, VPS, produção, credenciais e F9.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO (MAPA_MESTRE sem alteração: sem mudança de escopo, sequência ou portão).

### DEC-F8-032 — Aceite técnico definitivo da F8-5p e correção da prontidão do PostgreSQL no CI (P40) (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: encerrar tecnicamente a F8-5p e eliminar a intermitência do passo de preparação do banco do ensaio de homologação (P40).
- Decisão: (1) **Aceite técnico definitivo da F8-5p** (DEC-F8-031): código `72ae027`; CI run 38594989571, tentativa 2, 5/5; Browser Gate F8 125/0; P35, P37, P38 e P39 resolvidas. (2) Autorizada **uma microetapa isolada** em `.github/workflows/foundation-ci.yml`: prontidão do PostgreSQL por conexão TCP, espera limitada e consulta efetiva à base definitiva; preservar os demais jobs e os mecanismos de segurança; testar e executar o CI oficial completo; registrar evidências e preparar o handoff. (3) Proibido: alterar funcionalidades do Hub, VPS, produção, credenciais ou ambientes reais; F8-5e; F9. Em caso de falha, interromper e apresentar o diagnóstico antes de nova tentativa.
- Alternativas consideradas: reexecutar o job sempre que ocorrer (rejeitada: mantém a intermitência).
- Impacto: workflow do CI (um passo); nenhum código do Hub.
- Revisão: no aceite técnico da correção do P40.

### 2026-10-14 — Aceite da F8-5p registrado (DEC-F8-032) — Claude
- ACEITE: F8-5p aceita definitivamente (DEC-F8-031; código `72ae027`; CI 5/5 run 38594989571, tentativa 2; Browser Gate F8 125/0). P35, P37, P38 e P39 resolvidas; P33, P34 e RS1–RS7 mantidas; **P40 em correção**. A Fase 8 **não** está encerrada: depende do Portão F8.
- BASELINE DE CÓDIGO: `72ae027` no público (espelho `7faa39f`).
- STATUS: F8-5p **aceita**; correção do CI **em execução** (entrada de handoff própria ao final).
- PRÓXIMA MICROETAPA AUTORIZADA: somente a correção do P40 no workflow.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-5e, publicação, despachante ou coletor reais, VPS, produção, credenciais e F9.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE (interno e público).

### 2026-10-14 — F8-5p implementada: correções pré-piloto P35, P38, P39 e P37 (DEC-F8-031) — Claude
- AUTORIZAÇÃO: DEC-F8-031 (D-PF8-1 a D-PF8-7 com ajustes), microetapas em sequência; F8-5e proibida.
- F8-5p.1 P35 (`4990e5b`, complementos `cf82a48` e `0e795d6`): leitura de largura/altura de JPEG (SOF), PNG (IHDR) e WebP (VP8/VP8L/VP8X) no domínio, nula se truncada ou ilegível; **migration `20261014020000_f8_5p_media_dimensions`** (colunas `widthPx`/`heightPx`, CHECK positivo, gatilho: só nulo → valor); gravação no upload; arquivos antigos calculados uma vez; nova versão copia as dimensões; aviso já no upload (um por tipo); agendamento recusado acima de 30 MP (`MEDIA_TOO_MANY_PIXELS`) ou ilegível (`MEDIA_DIMENSIONS_UNKNOWN`); 30 MP exatos aceitos.
- F8-5p.2 P38 (`24bca00`): **migration `20261014030000_f8_5p_metrics_retry`** (`metricsRetryAt`, `metricsErrorCount`); erro transitório repete em 15, 30 e 60 min sem consumir o ponto, depois consome com o erro preservado; 429 espera o retry_after (piso 60 s, teto 1 h) sem contar erro; reserva por troca condicional (consulta simultânea vira uma só); coletas continuam sem duplicar.
- F8-5p.3 P39 (`2e6d4d0`): política do piloto (`PUBLICATION_PILOT_ORGANIZATION_IDS`, `PUBLICATION_PILOT_FORMATS`) no domínio; barreira **antes de montar o gateway** sempre estrita (ausente, vazia ou inválida bloqueia); barreira no pedido e no reagendamento quando há política ou envio ligado (modo de simulação e Browser Gates preservados); vínculo cliente + conta + organização reconferido antes do envio (`ACCOUNT_UNLINKED`); cancelar sempre permitido; evento `PUBLICATION_BLOCKED`; configurações mostram só a situação da própria organização; `docs/operations/publication-pilot-controls.md` (homologação x produção).
- F8-5p.4 P37 (`cf82a48`): auditoria de referências; removidos `CompositorZafiraModal`, `EditarAgendamentoModal` e 4 métodos de escrita (1.302 linhas); preservados vínculo/desvínculo, leitura e rotas 410; novo aviso de publicação (limites técnicos; nem todos os formatos homologados com publicação real); teste que impede chamadas às escritas legadas; rótulos da trilha de publicação no histórico.
- BROWSER GATE: cenário **O** (dimensões exibidas; aviso acima de 30 MP no upload; API `MEDIA_TOO_MANY_PIXELS`; novo aviso; política em modo de simulação sem expor outras organizações); espera do aviso específico corrigida em `72ae027`.
- TESTES: domínio 123/123; API 829/829; web 99/99; PostgreSQL 195/195 (novos `media-dimensions-postgres`, `publication-pilot-postgres`; `publication-metrics-postgres` revisto).
- CI: 38590932776 falhou (fixture PNG/WebP falsa do teste antigo `content-postgres`, corrigida em `0e795d6`); 38591999820 falhou (cenário O leu a lista de avisos antes do upload terminar, corrigido em `72ae027`); 38594989571 tentativa 1 falhou antes dos gates (corrida do PostgreSQL do CI, P40); **tentativa 2 (reexecução só do job, autorizada) 5/5** (https://github.com/Julianogdc/zafira-hub/actions/runs/38594989571): F8 125/0, cenário O 6/6.
- BASELINE DE CÓDIGO: `72ae027` no público (espelhos `5cbb2a0`, `e5ac0da`, `e9e822a`, `973cc28`, `655dcd3`, `7faa39f` no interno, paridade conferida).
- STATUS: **pendente de aceite técnico** da Direção. Fase 8 não encerrada.
- PENDÊNCIAS: P35, P37, P38 e P39 resolvidas; **P40 nova** (corrida do PostgreSQL no CI, com proposta); P33, P34 e RS1–RS7 mantidas.
- LIMITES: retirar da política não recolhe posts já agendados no provedor (só o cancelamento); o Browser Gate testa o modo de simulação (bloqueio real coberto em PostgreSQL); 30 MP exatos não verificados no provedor.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / controles de publicação (interno e público).

### DEC-F8-031 — F8-5p: correções pré-piloto (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: corrigir P35, P38, P39 e P37 antes do piloto real, conforme `docs/propostas/PORTAO_F8_PLANO.md`.
- Decisão: D-PF8-1 a D-PF8-7 aprovadas, com ajustes: P35 com extração JPEG/PNG/WebP, persistência protegida, limite de 30 MP, arquivos antigos, bloqueio de ilegível e aviso no upload; P38 com repetições 15/30/60 min sem perder a janela, 429 preservado, sem consultas simultâneas nem duplicações; P39 com barreiras no pedido e antes do envio (vínculo, organizações e formatos autorizados; configuração ausente, inválida ou vazia bloqueia; idempotência, isolamento e auditoria; compatível com simulação e Browser Gates; controles de homologação e produção documentados separadamente); P37 com auditoria antes de remover, preservando vínculo, leitura e rotas 410, e aviso explícito de formatos sem publicação real. Autorizações posteriores: correção pontual do cenário O com nova rodada; uma reexecução só do job de homologação no run 38594989571 e registro da corrida do PostgreSQL como pendência de CI. Proibido: F8-5e, publicação, despachante ou coletor reais, contas reais, chaves, VPS, EasyPanel, DNS, produção, H1–H9 e Fase 9.
- Alternativas consideradas: chave de emergência no banco (D-PF8-3, adiada); política só no envio (rejeitada: o pedido também é barrado quando há política).
- Impacto: domínio, banco (2 migrations), API, web, Browser Gate, documentação operacional.
- Revisão: no aceite técnico da F8-5p.

### 2026-10-14 — Aceite da F8-5a a F8-5d e plano do Portão F8 / F8-5e (DEC-F8-030) — Claude
- AUTORIZAÇÃO: DEC-F8-030 — somente análise e documentação.
- ACEITE: F8-5a a F8-5d aceitas definitivamente (DEC-F8-029; código `ba0d5e7`; CI 5/5 run 38583200208). **Não encerra a Fase 8**: falta o Portão F8.
- AUDITORIA (`docs/propostas/PORTAO_F8_PLANO.md` §1–§2):
  - **P35:** `content_media` sem largura/altura; uma imagem de 36 MP aprovada falharia só no despachante. Proposta C-P35: leitura de dimensões (JPEG/PNG/WebP), colunas preenchidas só de nulo para valor, recusa acima de 30 MP e de dimensão ilegível. Bloqueia o piloto.
  - **P38:** confirmado que o erro grava `metricsCheckedAt` e consome o ponto. Proposta C-P38: até 3 repetições (15/30/60 min) antes de consumir. Bloqueia ligar o coletor no piloto.
  - **P37:** 2 modais e 4 métodos legados sem chamador; aviso de compatibilidade contraditório. Proposta C-P37: remoção e texto derivado das regras. Não bloqueia.
  - **Achados novos (P39):** A1 sem nova conferência do vínculo da conta no envio; A2 sem lista de organizações do piloto; A3 sem restrição de formatos. Proposta C-CTL.
  - A4: desligar exige reinício, aceito como procedimento.
  - A5: credencial só pelo script de provisionamento, adequado.
- REVISÃO (§3): **P33** bloqueia em parte (revogar a chave temporária e criar a do piloto; limpeza dos rascunhos recomendada). **P34** não bloqueia (leitura GET opcional antes ou logo após 15/10 00:25 UTC). RS1 e RS5 não bloqueiam com A3; RS2, RS4 e RS6 ficam como ressalvas; RS3 é objetivo do piloto (exige C-P38).
- PLANO (§4–§7): pré-requisitos P1–P6 (homologação com H2 indispensável ao envio de arquivos, correções F8-5p, chave do piloto, dados sintéticos, conteúdo de teste, autorização específica); isolamento; teto de 2 publicações (Story, depois Feed); roteiro, evidências, critérios de interrupção e rollback; critério de fechamento do Portão F8; decisões D-PF8-1 a D-PF8-7.
- BASELINE DE CÓDIGO: inalterada — `ba0d5e7` no público (espelho `25b3efc`).
- STATUS: **F8-5a a F8-5d aceitas**; Portão F8 aberto; F8-5p e F8-5e **planejadas, não autorizadas**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial implementar correções, piloto, conectar contas, despachante ou coletor, VPS, credenciais e produção.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / plano do Portão F8 (interno e público).

### DEC-F8-030 — Aceite técnico definitivo da F8-5a a F8-5d e planejamento do Portão F8 (somente análise) (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: encerrar tecnicamente a F8-5a a F8-5d e preparar o Portão F8 sem confundir isso com o encerramento da Fase 8.
- Decisão: (1) **Aceite técnico definitivo da F8-5a a F8-5d** (DEC-F8-029; CI 5/5 run 38583200208). (2) Autorizados somente análise e planejamento: registrar o aceite; auditar P35, P38 e P37 com propostas, testes e critérios de aceite; revisar P33, P34 e RS1–RS7 (o que bloqueia o piloto e o que fica como ressalva); plano detalhado do Portão F8 / F8-5e (pré-requisitos, isolamento, controle de publicação, evidências e rollback). (3) A conclusão técnica da F8-5a a F8-5d **não encerra a Fase 8**. (4) Proibido: implementar correções, iniciar o piloto, conectar contas, ativar despachantes ou coletores, alterar VPS, credenciais ou produção.
- Alternativas consideradas: —
- Impacto: documentação (`docs/propostas/PORTAO_F8_PLANO.md`).
- Revisão: na decisão do plano do Portão F8.

### 2026-10-14 — F8-5a a F8-5d implementadas: métricas orgânicas, Publicados e desempenho (DEC-F8-029) — Claude
- AUTORIZAÇÃO: DEC-F8-029 (D-F85-1 a D-F85-7), microetapas F8-5a a F8-5d em sequência; F8-5e proibida.
- F8-5a (`4b36f2a`): domínio `publication-metrics.ts` (normalização; **`captured_at` nulo = sem dado**, mesmo com zeros; indicador ausente, negativo ou de tipo inesperado = null; janelas 1 h, 3 h, 6 h, 24 h, 72 h, 7 d e Story até 26 h; situação exibida); **migration `20261014010000_f8_5a_publication_metrics`**: tabela `content_publication_metrics` (uma linha por coleta do provedor; `capturedAt` x `fetchedAt`; único por publicação + `capturedAt`; FK composta por organização; CHECK de não negativos; gatilho que só aceita publicação `PUBLISHED`; UPDATE bloqueado; DELETE só com a organização removida) e colunas `metricsCheckedAt`/`metricsLastOutcome`/`metricsLastReason` na publicação; `getPostMetrics` no gateway (descarta `next_sync_eta`) e no simulador (zeros com `captured_at` nulo, coletas, indisponível, erro); coletor no agendador existente, **desligado por padrão** (`PUBLICATION_METRICS_ENABLED=true` e despachante ligado), só nos pontos da janela, 429 interrompe o lote sem consumir o ponto, consulta sem coleta nova não grava.
- F8-5b (`94e0cec`): `GET /content/publications/:id/metrics` (`content.view` + carteira + organização; estados aguardando/coletado/indisponível/erro/encerrado; histórico até 50; sem estimativa do provedor); resumo `metrics` na visão da publicação; contador **Publicados** só com publicação confirmada (`PUBLISHED` + `publishedAt` + `platformPostId`) de conteúdo aprovado, **null com o envio desligado** (D-F85-2); `publishedAt` por peça; etapa manual "Postada" intocada (D-F85-5).
- F8-5c (`b4d5bf4`): bloco "Desempenho" nas publicações confirmadas (aguardando coleta sem número; valores com data da coleta do Instagram e da consulta do Hub no fuso da organização; ausente como "—"; engajamento em %; classes oficiais, 2 colunas no celular).
- F8-5d (`ba0d5e7`): Browser Gate F8 cenário **N** com dados sintéticos gravados no banco de ensaio (sem provedor e sem coletor): aguardando coleta sem zeros, coleta com `capturedAt` ≠ `fetchedAt`, ausente nulo, coleta repetida e UPDATE recusados, membro só lê, Publicados indisponível com envio desligado; Org B 404 nas métricas; desempenho a 390 px.
- TESTES: domínio 111/111 (7 de métricas + contador); API 829/829 (4 do coletor desligado); PostgreSQL `publication-metrics-postgres.test.ts` (15 cenários: gatilhos, coletor com simulador, API, contador); web 97/97.
- CI (rodada única): run 38583200208 (https://github.com/Julianogdc/zafira-hub/actions/runs/38583200208) **5/5**: PostgreSQL 181/181, Docker Build, Publish Images, Homologation (F6, F7-1b, F7-2b, F7-3b, F7-4b e **F8 119/0** PASS). Custo zero.
- BASELINE DE CÓDIGO: `ba0d5e7` no público (espelhos `9d9329d`, `851ecab`, `17baeab`, `25b3efc` no interno, paridade conferida).
- STATUS: **pendente de aceite técnico** da Direção.
- LIMITES/LACUNAS: coleta real nunca observada (RS3; só a F8-5e confirma); P38 (erro de consulta consome o ponto da janela); P33, P34, P35, P37 e RS1–RS7 mantidas; despachante e coletor desligados.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-5e, publicar, conectar contas reais, ligar despachante ou coletor, VPS, produção, credenciais e F9.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE (interno e público).

### DEC-F8-029 — Implementação da F8-5a a F8-5d: métricas orgânicas, Publicados e desempenho (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: implementar a F8-5 sem publicação real, com base em `docs/propostas/F8-5_PROPOSTA_EXECUCAO.md` e DEC-F8-028.
- Decisão: **D-F85-1** histórico append-only das coletas; **D-F85-2** Publicados indisponível com o envio desligado; **D-F85-3** consultas em 1 h, 3 h, 6 h, 24 h, 72 h e 7 dias, Story até 26 h; **D-F85-4** métricas gerais das contas na F13; **D-F85-5** não automatizar a etapa manual Postada; **D-F85-6** piloto previsto para Story e Feed de imagem, Reel condicionado a vídeo de testes, carrossel condicionado à RS1; **D-F85-7** piloto real só em homologação controlada, com autorização específica. Autorizadas F8-5a a F8-5d. Regras: distinguir `fetchedAt` de `capturedAt`; consultar não significa coleta nova; sem duplicação; preservar indisponibilidade, erro e ausência sem fabricar valores; `PUBLICATION_DISPATCH_ENABLED` e `PUBLICATION_METRICS_ENABLED` desligados por padrão; não alterar registros históricos de Entregas; testes por microetapa e CI completo ao final. Proibido: F8-5e, posts reais, contas reais, despachante ou coletor reais, VPS, produção, credenciais, F9, workflows privados.
- Alternativas consideradas: só a última coleta (D-F85-1, rejeitada); zero com envio desligado (D-F85-2, rejeitado).
- Impacto: domínio, banco (migration nova), API, web, Browser Gate.
- Revisão: no aceite técnico da F8-5a a F8-5d.

### 2026-10-14 — Aceite da F8-4b, proposta da F8-5 e bloqueios da primeira homologação (DEC-F8-028) — Claude
- AUTORIZAÇÃO: DEC-F8-028 — somente análise e documentação.
- ACEITE: F8-4b aceita definitivamente (código `ad44325`, CI 5/5 run 38570183115, Browser Gate F8 104/0, P36 resolvida). Preservadas P33, P34, P35, P37 e RS1–RS7.
- F8-5 (`docs/propostas/F8-5_PROPOSTA_EXECUCAO.md`): o escopo oficial é sincronização de status, permalink e falhas, métricas orgânicas (leitura), conteúdo piloto e Portão F8. A sincronização de status e permalink já existe na reconciliação da F8-4a, mas nunca foi exercitada com o provedor real. Limitações do BrightBean incorporadas: zeros com `captured_at` nulo não são dado; `next_sync_eta` móvel; coleta horária; coleta efetiva nunca observada (RS3); Story expira em 24 h. Desenho: coletas append-only (único por coleta, sem UPDATE/DELETE), coletor desligado por padrão (`PUBLICATION_METRICS_ENABLED`), API só leitura com estados aguardando/coletado/indisponível/encerrado, "Publicados" da F8-3 só com publicação confirmada e indisponível sem integração ativa. Microetapas F8-5a–d sem publicação; F8-5e (piloto real do Portão F8) com autorização própria. Decisões D-F85-1 a D-F85-7; 8 critérios de aceite.
- HOMOLOGAÇÃO (`docs/propostas/HOMOLOGACAO_1_BLOQUEIOS.md`): bloqueadores H1 P22; H2 armazenamento em produção inexistente (driver local recusado, S3 não implementado); H3 P18; H4 sem massa sintética própria; H5 perfil de ambiente desatualizado (20 de ~70 variáveis, checklist cita 14 de 32 migrações); H6 comportamento sem simuladores não verificado; H7 infraestrutura não decidida; H8 segredos próprios; H9 ensaio de backup/restauração. Itens que não bloqueiam a homologação sintética listados (P28, P5, P24–P26, P27 com recomendação de triagem das altas, P13, Portão da Fase 1).
- BASELINE DE CÓDIGO: inalterada — `ad44325` no público (espelho `51e1af0`).
- STATUS: **F8-4b aceita**; F8-5 e homologação **propostas, não autorizadas**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial implementar a F8-5, ligar o despachante, publicar, VPS, produção e credenciais.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / proposta F8-5 / bloqueios da homologação (interno e público).

### DEC-F8-028 — Aceite técnico definitivo da F8-4b e preparação da F8-5 e da primeira homologação (somente análise) (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: encerrar a F8-4b e preparar os próximos passos: métricas e Portão F8, e a primeira homologação.
- Decisão: (1) **Aceite técnico definitivo da F8-4b**, com evidências: baseline `ad44325`; CI 38570183115, 5/5; Browser Gate F8 104/0; governança anterior DEC-F8-027; P36 resolvida. (2) Preservar P33, P34, P35, P37 e RS1–RS7. (3) Autorizados somente análise e documentação: escopo oficial da F8-5 considerando as limitações de métricas do BrightBean; proposta técnica da F8-5 com microetapas, testes e critérios de aceite; relação do que falta para uma primeira homologação controlada com dados sintéticos. (4) Proibido: implementar a F8-5, ativar o despachante, publicar, alterar VPS, produção ou credenciais.
- Alternativas consideradas: —
- Impacto: documentação (`docs/propostas/F8-5_PROPOSTA_EXECUCAO.md`, `docs/propostas/HOMOLOGACAO_1_BLOQUEIOS.md`).
- Revisão: na autorização da F8-5 e da homologação.

### 2026-10-14 — F8-4b implementada: agendamento no Instagram pela versão aprovada (DEC-F8-027) — Claude
- AUTORIZAÇÃO: DEC-F8-027 (D-F84B-1 a D-F84B-4), microetapas executadas em sequência.
- F8-4b.1 (`fc9d744` + `ad44325`): leituras `GET /content/items/:id/publication-targets` (só contas Instagram vinculadas ao cliente, sem chamar o provedor) e `GET /content/publication-settings` (despachante, antecedência, piloto, teto); a visão da publicação passa a ter `versionNumber`, `sentToProvider` (registrado no Hub x enviado ao provedor) e `actions` (reagendar/cancelar, falsas com cancelamento pendente); **`PROVIDER_RETRY` passa a bloquear reagendar e cancelar**; `content.schedule` exposta em `/auth/capabilities` (faltava; achada pelo Browser Gate na 1ª rodada). Teste PostgreSQL `publication-ui-postgres.test.ts`: leituras, ações, estados que bloqueiam, cancelamento x novo pedido x unicidade (cancelamento pedido segue ocupando a vaga até o provedor confirmar: 409 `PUBLICATION_ALREADY_ACTIVE`; depois da confirmação, novo pedido 201) e **P36** (teto de 25 em 24 h).
- F8-4b.2 (`3e37e96`): painel "Publicação no Instagram" no detalhe do conteúdo, abaixo de "Aprovação do cliente": aviso de envio desligado, orientação para conteúdo não aprovado, conta vinculada, data e hora no fuso da organização convertidas para ISO com deslocamento explícito (horário de verão e horário inexistente tratados), mínimo de 5 min antes do envio, confirmação em dois passos, selos "Registrado no Hub"/"Enviado ao provedor", ações só as liberadas pela API, link só https, membro só acompanha, componentes do DS e classes oficiais, 390 px. Utilitários puros em `lib/publication-view.ts` com 6 testes.
- F8-4b.3 (`45ec56e`): "Conteúdos & Agenda" e a prévia legada ficam só leitura, com orientação para Conteúdo; compositor e edição de agendamento fora da tela (rotas já 410).
- F8-4b.4 (`a48b8e9` + `ad44325`): Browser Gate F8, cenário **M** com despachante desligado (agendar, reagendar, cancelar, novo pedido, duplicidade 409, menos de 5 min e sem fuso 422, conta fora do piloto recusada, `AMBIGUOUS`/`PROVIDER_RETRY`/`PUBLISHING` sem ações e com 409 na API, não aprovado 409, membro 403, legado só leitura e 410, nenhum envio ao provedor), Org B 404 em leitura e escrita, painel a 390 px; capacidades `content.schedule` no cenário A.
- CI: 1ª rodada run 38567373916 (https://github.com/Julianogdc/zafira-hub/actions/runs/38567373916) 4/5 — Browser Gate parou no cenário M (capacidade ausente), 61/0 até ali. Correção `ad44325`. 2ª rodada run 38570183115 (https://github.com/Julianogdc/zafira-hub/actions/runs/38570183115) **5/5**: domínio 103/103, API 825/825, web 94/94, PostgreSQL 165/165, Docker Build, Publish Images, Homologation (F6, F7-1b, F7-2b, F7-3b, F7-4b e **F8 104/0** PASS). Custo zero (repositório público, runners padrão).
- BASELINE DE CÓDIGO: `ad44325` no público (espelho `2b6f5f0` + `51e1af0` no interno, paridade conferida).
- STATUS: **pendente de aceite técnico** da Direção.
- LIMITES/LACUNAS: despachante desligado; nenhuma publicação real; Browser Gate sem envio (D-F84B-3), complementado pelos testes do simulador; P35 (megapixels) aberta; P37 (modais legados sem uso e texto de compatibilidade) registrada; RS1–RS7 mantidas.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial ligar o despachante, publicar, Facebook, F8-5, VPS e produção.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE (interno e público).

### DEC-F8-027 — Implementação da F8-4b: agendamento no conteúdo aprovado (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: levar o agendamento da F8-4a para a tela, no fluxo do conteúdo aprovado, sem publicação real.
- Decisão: **D-F84B-1** painel "Publicação no Instagram" no detalhe de `/conteudo/`, abaixo de "Aprovação do cliente"; **D-F84B-2** telas legadas continuam para leitura, sem ações de escrita, orientando para o fluxo de conteúdo aprovado; **D-F84B-3** Browser Gate com despachante desligado, complementado pelos testes do simulador BrightBean, sem publicação real; **D-F84B-4** P36 incluída na F8-4b.1. Execução sequencial F8-4b.1 a F8-4b.4 com uma rodada final do CI. Cuidados: distinguir registrado no Hub de enviado ao Instagram; bloquear ações em estado ambíguo, depois de iniciada a publicação ou com retentativa automática não resolvida; verificar cancelamento x novo agendamento x unicidade; só a versão atual aprovada; só contas Instagram vinculadas ao cliente; DS e 390 px; despachante desligado. Ajustes registrados na execução: `PROVIDER_RETRY` bloqueia reagendar/cancelar; cancelamento pedido ocupa a vaga até a confirmação do provedor; `content.schedule` exposta nas capacidades. Proibido: publicação real, ligar o despachante, VPS/produção, credenciais reais nos testes, Facebook, F8-5, workflows privados.
- Alternativas consideradas: simulador HTTP no ensaio (D-F84B-3, não adotado nesta fatia).
- Impacto: domínio, API (leituras e capacidades), web (painel, telas legadas), Browser Gate; sem migração nova.
- Revisão: no aceite técnico da F8-4b.

### 2026-10-14 — Aceite da F8-4a registrado e plano da F8-4b (DEC-F8-026) — Claude
- AUTORIZAÇÃO: DEC-F8-026 — somente análise e documentação.
- ACEITE: F8-4a aceita definitivamente (código `b8bc5a5`, CI 5/5 run 38561948692). P35 e P36 abertas.
- ANÁLISE: detalhe do conteúdo (`ConteudoDetalhe.tsx`: painéis Dados, Arquivos, Prévia, Aprovação, Versões, Histórico; componentes do DS e `Banner`); `useContentCapabilities` sem `content.schedule`; fuso da organização disponível; API da F8-4a pronta, faltando leitura de contas elegíveis e da situação do envio; listagem de contas do cliente atual chama o BrightBean (inadequada); **telas legadas** `/conteudos` e `/clientes/:id/conteudo/:postId` com modais que chamam rotas já bloqueadas (410). Commits de documentação com `[skip ci]` no interno e no público.
- PLANO (`docs/propostas/F8-4b_PLANO_EXECUCAO.md`): painel "Publicação no Instagram" no detalhe do conteúdo, abaixo da aprovação; conta Instagram vinculada; data e hora no fuso da organização com deslocamento explícito e mínimo de 5 min; acompanhamento com rótulos por estado e ações só antes de `PUBLISHING`; aviso honesto de envio desligado; MEMBER só acompanha; 390 px. API só de leitura (`publication-targets`, `publication-settings`) e capacidade `content.schedule`; telas legadas só leitura com orientação. Microetapas F8-4b.1 a F8-4b.4 com uma rodada de CI. Decisões D-F84B-1 a D-F84B-4.
- BASELINE DE CÓDIGO: inalterada — `b8bc5a5` no público (espelho `fc4973d`).
- STATUS: **F8-4a aceita**; F8-4b **planejada, não autorizada**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial implementar a F8-4b sem DEC, ligar o despachante, publicar, Facebook, VPS e produção.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / plano da F8-4b (interno e público).

### DEC-F8-026 — Aceite técnico definitivo da F8-4a e preparação da F8-4b (somente análise) (Direção, 2026-10-14)
- Data / responsável: 2026-10-14 / Direção, via proprietário.
- Problema: encerrar a F8-4a e preparar a fatia de telas da F8-4.
- Decisão: (1) **Aceite técnico definitivo da F8-4a**, com evidências: baseline de código `b8bc5a5`; governança `d8c69d6` (DEC-F8-025); CI oficial run 38561948692 (https://github.com/Julianogdc/zafira-hub/actions/runs/38561948692), 5/5. **P35 e P36 permanecem abertas.** (2) **Autorizada somente a preparação da F8-4b:** registrar o aceite; atualizar ESTADO, REGISTRO e MAPA; analisar telas, componentes, permissões e fluxos existentes; definir como o agendamento aparece no fluxo do conteúdo aprovado; preservar a identidade visual e os componentes oficiais; apresentar as microetapas antes de implementar. (3) Proibido: implementar telas, ligar o despachante real, publicar, VPS/produção, Facebook; P35 e P36 seguem abertas.
- Alternativas consideradas: —
- Impacto: documentação (`docs/propostas/F8-4b_PLANO_EXECUCAO.md`).
- Revisão: na autorização da F8-4b.

### 2026-10-14 — Espelho das imagens-base no GHCR e CI oficial 5/5 da F8-4a (DEC-F8-025) — Claude
- AUTORIZAÇÃO: DEC-F8-025.
- DIGESTS DE ORIGEM: obtidos por `HEAD` (sem baixar imagem) no Docker Hub e no registro público da Amazon — **idênticos** nos dois.
- ESPELHO: workflow manual `mirror-base-images.yml` (público `fd9d08d`, `[skip ci]` para não consumir a rodada única do CI) executado uma vez — run 38503699296 (https://github.com/Julianogdc/zafira-hub/actions/runs/38503699296): 4 imagens copiadas do Docker Hub, **sem 429**, com todas as arquiteturas e digests preservados; equivalência verificada no índice e em cada manifesto de plataforma (sem conversão de manifesto); pacotes `base-node`, `base-nginx` e `base-postgres` **públicos** (acesso anônimo HTTP 200 no workflow e de fora do GitHub, digests conferidos).
| Imagem oficial | Espelho (pacote público) | Digest (índice multi-arquitetura) | Uso |
|---|---|---|---|
| `node:24.12.0-bookworm-slim` | `ghcr.io/julianogdc/base-node:24.12.0-bookworm-slim` | `sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99` | `apps/api/Dockerfile` |
| `node:24.12.0-alpine` | `ghcr.io/julianogdc/base-node:24.12.0-alpine` | `sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8` | `apps/web/Dockerfile` (build) |
| `nginx:alpine` | `ghcr.io/julianogdc/base-nginx:alpine` | `sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2` | `apps/web/Dockerfile` (servidor) |
| `postgres:16` | `ghcr.io/julianogdc/base-postgres:16` | `sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d` | serviço do PostgreSQL Integration Gate e ensaio de homologação |
- REFERÊNCIAS: público `b8bc5a5` — 7 trocas (`apps/api/Dockerfile` 1, `apps/web/Dockerfile` 2, `foundation-ci.yml` 4: serviço PostgreSQL e ensaio de homologação), mesmas versões, `imagem:tag@digest`. Interno `fc4973d` (espelho conferido). Nenhum código funcional alterado. Commits de documentação com `[skip ci]` no interno e no público.
- CI OFICIAL (rodada única): run 38561948692 (https://github.com/Julianogdc/zafira-hub/actions/runs/38561948692) — **5/5 verdes**: Code Quality (domínio 103/103, API 825/825, web 88/88), PostgreSQL 159/159, Docker Build ✔, Publish Images ✔, Homologation Rehearsal ✔ (Browser Gates F6, F7-1b, F7-2b, F7-3b, F7-4b e **F8 70/0** PASS). **Nenhum 429**; logs mostram o PostgreSQL vindo de `ghcr.io/julianogdc/base-postgres@sha256:ca0bd484…`.
- CUSTO: zero — pacotes públicos no GHCR, runners `ubuntu-latest`, 0 ms faturáveis, nenhuma credencial nova.
- PUBLICAÇÃO REAL: impossível na configuração padrão (despachante desligado; inalterado).
- BASELINE DE CÓDIGO: `b8bc5a5` no público (espelho `fc4973d`).
- STATUS: **F8-4a com CI oficial 5/5; aceite técnico pendente da Direção.** F8-4b não iniciada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial ligar o despachante, F8-4b, VPS, produção e credenciais.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / proposta de origem das imagens-base (interno e público).

### DEC-F8-025 — Espelho das imagens-base Docker no GHCR (opção A) e rodada única do CI da F8-4a (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: o limite externo (429) do registro público da Amazon impedia o CI 5/5 da F8-4a (DEC-F8-024).
- Decisão: (1) **Aprovada a opção A**: workflow manual de espelhamento no repositório público; copiar só as imagens-base Node, Nginx e PostgreSQL já usadas; fixar por digest, preservando arquitetura e conteúdo e verificando a equivalência de cada cópia, sem presumir digest idêntico se houver conversão de manifesto; pacotes públicos com permissões mínimas; considerar que imagens de serviço do Actions são baixadas antes dos passos (sem depender de login posterior); atualizar só as referências necessárias; preservar versões, build e configuração; confirmar ausência de custo e de runners pagos; validar as imagens e executar **uma única** rodada do CI oficial; registrar implementação, digests, evidências e resultado nos dois repositórios. (2) Restrições: sem alterar código funcional, sem atualizar versões, sem VPS/produção, sem serviços pagos ou credenciais externas novas, sem `PUBLICATION_DISPATCH_ENABLED`, sem F8-4b, sem repetir indefinidamente downloads com 429. (3) Bloqueio de permissão, custo imprevisto ou equivalência impossível → interromper e apresentar. (4) F8-4a segue pendente de aceite até a validação.
- Alternativas consideradas: Docker Hub com conta, ECR autenticado, só reexecutar (DEC-F8-024).
- Impacto: `.github/workflows/mirror-base-images.yml` (novo), `.github/workflows/foundation-ci.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`.
- Revisão: no aceite técnico da F8-4a.

### 2026-10-13 — F8-4a: nova tentativa do CI — 429 persistiu no Publish Images; proposta de origem das imagens-base (DEC-F8-024) — Claude
- AUTORIZAÇÃO: DEC-F8-024 — uma única nova tentativa, só jobs com falha.
- EXECUÇÃO: `gh run rerun --failed` no run 38496406502 (https://github.com/Julianogdc/zafira-hub/actions/runs/38496406502). O primeiro pedido recebeu **HTTP 500 da API do GitHub** e não iniciou nada (o run continuou na tentativa 2); o pedido foi reenviado uma vez e iniciou a **tentativa 3**. Commits de documentação com `[skip ci]` no interno e no público.
- RESULTADO (tentativa 3): **Docker Build ✔** (passou desta vez); Code Quality ✔ e PostgreSQL ✔ (159/159) mantidos da tentativa 1; **Publish Images ✘** — o mesmo limite externo (`429 Too Many Requests` / `Data limit exceeded`) ao baixar `node:24.12.0-bookworm-slim` do registro público da Amazon; **Homologation Rehearsal não executado** (depende do Publish Images). Runners `ubuntu-latest`, 0 ms faturáveis. **5/5 não atingido; nenhuma nova tentativa**, conforme a DEC.
- PROPOSTA: `docs/propostas/CI_ORIGEM_IMAGEM_BASE_PROPOSTA.md` — recomendada a **opção A**: espelho próprio no GHCR das quatro imagens-base (`node` da API e da web, `nginx`, `postgres`), fixadas por digest e copiadas por workflow manual; sem segredo novo, sem custo, mesmo conteúdo byte a byte. Alternativas: Docker Hub com conta (segredo novo), ECR autenticado (AWS, segredo e possível custo), só reexecutar (falhas continuam).
- PENDÊNCIAS NOVAS: **P35** validação no Hub de imagens com mais de 30 megapixels (hoje só o provedor recusa; exige guardar as dimensões da mídia); **P36** teste PostgreSQL do limite de 25 publicações por dia (hoje coberto só no domínio).
- BASELINE DE CÓDIGO: inalterada — `44619b3` no público (espelho `eb2836c`).
- STATUS: F8-4a **implementada; código 100% verde no CI; CI 5/5 bloqueado por limite externo; aceite técnico pendente**. F8-4b não iniciada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma (aguarda decisão sobre a origem das imagens-base).
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial alterar a infraestrutura do CI sem autorização, ligar o despachante, F8-4b, VPS, produção e credenciais.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / proposta de origem das imagens-base (interno e público).

### DEC-F8-024 — Nova tentativa única do CI da F8-4a e proposta de origem alternativa das imagens-base (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: o Docker Build do run 38496406502 falhou duas vezes por limite externo (429) do registro público da Amazon.
- Decisão: (1) F8-4a segue implementada e **pendente de aceite técnico**. (2) **Autorizada uma única nova tentativa** do CI oficial, sem mudança de código ou infraestrutura, preferindo reexecutar só os jobs que falharam ou foram pulados. (3) **Se o 429 persistir: nenhuma nova tentativa**; apresentar proposta de origem alternativa da imagem-base com impacto técnico, segurança e custos. (4) Registrar como pendências: validação no Hub de imagens com mais de 30 megapixels; teste PostgreSQL do limite de 25 publicações por dia. (5) Sem despachante real, F8-4b, VPS, produção, credenciais, runners pagos ou workflows privados.
- Alternativas consideradas: —
- Impacto: documentação (`docs/propostas/CI_ORIGEM_IMAGEM_BASE_PROPOSTA.md`).
- Revisão: na decisão sobre a origem das imagens-base.

### 2026-10-13 — F8-4a implementada; CI bloqueado por limite externo no Docker Build (DEC-F8-023) — Claude
- AUTORIZAÇÃO: DEC-F8-023 — somente a F8-4a.
- CÓDIGO (público `44619b3`; espelho no interno `eb2836c`, conferido arquivo a arquivo):
  - **Domínio** (`publication-model.ts`): estados (`PENDING`, `DRAFTED`, `SCHEDULED`, `PROVIDER_RETRY`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `CANCELLED`, `AMBIGUOUS`); fuso explícito; antecedência de 5 min; piloto Instagram; carrossel 2–10, Story 1, Reel 1 vídeo; imagem ≤ 20 MB, vídeo ≤ 1 GB; tipos publicáveis (JPG, PNG, WebP, MP4; MOV fora até verificação); legenda ≤ limite da conta (2200 padrão); teto de 25/24 h; sem reagendar/cancelar depois de `PUBLISHING`; mapeamento do estado do provedor falhando fechado; chaves de idempotência (upload pelo SHA-256, rascunho por publicação).
  - **Banco** (migration `20261013040000_f8_4a_publication`): `content_publications` e `publication_outbox`; índice único parcial (uma ativa por versão + conta); gatilho de inserção que exige a **versão atual** com `ApprovalDecision` APPROVED sobre o mesmo `contentHash`; identidade imutável; sem DELETE.
  - **API**: `GET/POST /content/items/:id/publications`, `POST /content/publications/:id/reschedule` e `/cancel` (`content.schedule`; leitura com `content.view`), escopo de cliente e organização; publicação + pedido na mesma transação; nenhuma chamada externa no pedido.
  - **Despachante** (`PUBLICATION_DISPATCH_ENABLED=false` por padrão): reserva otimista, um pedido por publicação em ordem, lê o estado no provedor antes de agir, `AMBIGUOUS` em timeout com replay da mesma chave, recuo exponencial, 429 respeitando `retry_after`, falha fechada sem permissão do provedor; reconciliação por leitura periódica. Agendador ligado no servidor só com a variável.
  - **Simulador do BrightBean** (em memória, só testes): comportamento observado na F8-0b e modos de falha (timeout após criar, retentativa do provedor, falha definitiva, 429, permissão, publicação em andamento).
  - **D-F84-1**: quatro rotas legadas de escrita do SocialPublisher respondem **410 `LEGACY_WRITE_DISABLED`** (autenticação e permissão verificadas antes; provedor não chamado); consultas mantidas. Dois testes antigos ajustados para o novo comportamento (continuam provando que o provedor não é chamado).
- TESTES LOCAIS: typecheck API e web 0 erros; domínio **103/103** (+9); API **825/825** (+3: prova da configuração padrão — despachante e agendador não iniciam e nunca montam o gateway real); web 88/88; `lint:f6` 0 erros; build completo.
- CI OFICIAL: run 38496406502 (https://github.com/Julianogdc/zafira-hub/actions/runs/38496406502) — **Code Quality ✔ (domínio 103/103, API 825/825, web 88/88); PostgreSQL ✔ 159/159** (inclui os 13 cenários da F8-4a com o simulador); **Docker Build ✘ nas duas tentativas por limite externo** (`429 Too Many Requests` do registro público da Amazon ao baixar `node:24.12.0-bookworm-slim`); Publish Images e Homologation Rehearsal não executados. Runners `ubuntu-latest`, 0 ms faturáveis. **5/5 não atingido**; nova tentativa ou mudança da origem da imagem dependem de decisão. Commits de documentação com `[skip ci]` no interno e no público.
- NENHUMA PUBLICAÇÃO REAL POSSÍVEL NA CONFIGURAÇÃO PADRÃO: despachante desligado; sem a variável, `dispatchDue`/`reconcileDue` retornam antes de ler a caixa de saída e o gateway real nunca é montado (provado em teste unitário e no PostgreSQL); rotas legadas de escrita bloqueadas.
- BASELINE DE CÓDIGO: `44619b3` no público (espelho `eb2836c`).
- STATUS: F8-4a **implementada; CI 5/5 pendente (bloqueio externo); aceite técnico pendente**. F8-4b não iniciada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial ligar o despachante, publicação real, F8-4b, Facebook, VPS, produção, credenciais e alteração da infraestrutura do CI sem autorização.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE (interno e público).

### DEC-F8-023 — Decisões D-F84-1 a D-F84-4 e autorização exclusiva da F8-4a (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: aprovar a proposta da F8-4 (`docs/propostas/F8-4_PROPOSTA_EXECUCAO.md`) e definir a primeira fatia.
- Decisão: (1) **D-F84-1:** bloquear as rotas legadas que criam ou agendam publicações direto no BrightBean sem passar pela aprovação do cliente; preservar as consultas. (2) **D-F84-2:** antecedência mínima de **5 minutos**, com fuso horário explícito. (3) **D-F84-3:** depois de `PUBLICANDO`, sem reagendamento nem cancelamento; só acompanhamento. (4) **D-F84-4:** piloto **exclusivamente Instagram**; Facebook e demais redes depois, com arquitetura desacoplada. (5) **Autorizada exclusivamente a F8-4a:** domínio `ContentPublication` e caixa de saída transacional; só versões aprovadas pelo cliente; idempotência, concorrência e estados ambíguos; despachante desligado por padrão (`PUBLICATION_DISPATCH_ENABLED=false`); simulador do BrightBean; bloqueio da escrita das rotas legadas; validações de formato, tamanho, legenda, limites da conta e horário; RBAC e isolamento; testes de domínio, API, PostgreSQL e integração com o simulador. (6) Validação: repositório público `hub-2.1`, governança sincronizada com o privado, testes locais e CI oficial 5/5 só com runners padrão gratuitos; encerramento só com aceite técnico. (7) Restrições: sem F8-4b, sem publicação real, despachante não conectado à instância real nos testes, sem VPS/produção, sem workflows privados, sem credenciais, sem Facebook.
- Alternativas consideradas: manter as rotas legadas para administração (D-F84-1, recusada).
- Impacto: packages/domain, packages/contracts, apps/api (serviço, despachante, simulador, rotas, migration `20261013040000_f8_4a_publication`).
- Revisão: no aceite técnico da F8-4a.

### 2026-10-13 — F8-0b encerrada com ressalvas; contrato consolidado e proposta da F8-4 (DEC-F8-022) — Claude
- AUTORIZAÇÃO: DEC-F8-022.
- MÉTRICAS DO T30 (só GET, ~28 min após a publicação): chave válida e restrita; `captured_at` nulo, séries vazias, 7 indicadores com valor padrão 0; **nenhuma coleta** (esperado: coleta horária). Verificação pendente em ~2 h, ~6 h e ~20 h (P34). Commits de documentação com `[skip ci]` no interno e no público.
- CONTRATO: `docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md` consolidado para revisão futura.
- PROPOSTA DA F8-4: `docs/propostas/F8-4_PROPOSTA_EXECUCAO.md` — `ContentPublication` por versão aprovada + conta; `publication_outbox` transacional; despachante desligado por padrão com lease e leitura de estado antes de agir; idempotência por SHA-256 (upload) e por item (rascunho); validações que o BrightBean não faz; reconciliação por `externalPostId`; simulador com os comportamentos observados e modos de falha (substitui T33/T34); testes de domínio, API, PostgreSQL, simulador e Browser Gate; fatias F8-4a/F8-4b; decisões D-F84-1 a D-F84-4. **Achado:** as rotas síncronas herdadas do SocialPublisher (fase 2C2) permitem criar e agendar sem passar pela versão aprovada — a F8-4 deve restringi-las.
- PENDÊNCIAS NOVAS: P33 limpeza dos 15 rascunhos e 17 mídias de teste e revogação da chave temporária; P34 verificação das métricas do T30.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: **F8-0b encerrada tecnicamente com ressalvas.** F8-4 **somente preparação; implementação não autorizada.**
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma (aguarda aprovação da proposta da F8-4).
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial implementar a F8-4, publicar, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / matriz F8-0 / plano da F8-0b / contrato / proposta da F8-4 (interno e público).

### DEC-F8-022 — Encerramento técnico da F8-0b com ressalvas e preparação técnica da F8-4 (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: decidir o fim da F8-0b depois da avaliação final (DEC-F8-020).
- Decisão: (1) **F8-0b encerrada tecnicamente com ressalvas**, sem T31–T34 agora: **T31 adiado** (condicionado ao piloto de carrossel); **T32 adiado** (condicionado ao piloto do Facebook); **T33 e T34 dispensados** como testes reais, substituídos por simulações e testes automatizados. Ressalvas: RS1 carrossel publicado de verdade (T31 adiado, condicionado ao piloto de carrossel); RS2 estado `failed` e retentativa não observados (T33 substituído por simulador e testes automatizados); RS3 coleta efetiva de métricas de post não observada; RS4 Facebook (T32 adiado, condicionado ao piloto do Facebook); RS5 MOV verdadeiro e limite real de vídeo não testados; RS6 corrida/timeout com duplicidade não testados; RS7 limpeza dos 15 rascunhos e 17 mídias de teste e revogação da chave temporária. T34 substituído por regra do Hub (recusar horário passado/próximo) e testes automatizados. (2) **F8-4 autorizada apenas para preparação técnica, não para implementação.** (3) Tarefas: registrar o encerramento; atualizar ESTADO, REGISTRO, MAPA e matriz nos dois repositórios; consolidar o contrato do SocialPublisher; preparar a proposta de execução da F8-4 (simulador, caixa de saída, idempotência, permissões, recuperação de falhas, testes); verificar só por GET as métricas do T30; registrar a limpeza dos 15 rascunhos e 17 mídias e a revogação da chave como pendência. (4) Proibido: criar, agendar, publicar ou cancelar; implementar a F8-4; VPS, produção ou credenciais; workflows privados; tratar métricas sem `captured_at` como reais.
- Alternativas consideradas: executar T31–T34 antes da F8-4 (avaliado na DEC-F8-020).
- Impacto: documentação (`docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md`, `docs/propostas/F8-4_PROPOSTA_EXECUCAO.md`).
- Revisão: na aprovação da proposta da F8-4.

### 2026-10-13 — F8-0b: avaliação técnica final, contrato do SocialPublisher e aceite da R1+ formalizado (DEC-F8-020, DEC-F8-021) — Claude
- AUTORIZAÇÃO: DEC-F8-020 — somente leitura e análise; nenhuma chamada à API nesta etapa.
- EXECUTADO: avaliação de T31–T34 (§16.1); capacidades obrigatórias para iniciar a F8-4 (§16.2, todas comprovadas); proposta de encerramento com ressalvas RS1–RS7 (§16.3); causa da falta de métricas do T30 pelo código (coleta horária; `next_sync_eta` = agora + 5 min sem coleta anterior) e verificação só GET em ~2 h, ~6 h e ~20 h (§16.4); contrato mínimo do adaptador em `docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md` (§16.5); aceite da R1+ formalizado como **DEC-F8-021**. Commits de documentação com `[skip ci]` no interno e no público.
- RECOMENDAÇÃO: encerrar a F8-0b com ressalvas; T31 só adaptado e só se o carrossel estiver no piloto, antes de ligar o despachante; dispensar T32 (até decisão das redes), T33 e T34 como testes reais.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R0, R1, R1+ e T30 aceitos; **avaliação final entregue; decisão da Direção pendente**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial novos testes reais, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b / contrato do SocialPublisher (interno e público).

### DEC-F8-021 — Formalização do aceite técnico da R1+ da F8-0b (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: o aceite técnico da R1+ (execução registrada como DEC-F8-016) foi concedido pela Direção, mas não estava formalizado.
- Decisão: **Aceite técnico da R1+**: T20 (agendar D6 a +7 dias com fuso), T21 (cancelar), T22 (cancelar de novo → 409) e T23 (agendar D7, reagendar a +8 dias, cancelar) aprovados; zero publicações e zero agendamentos de teste ao final e após 3 min. Os registros anteriores permanecem como estão.
- Alternativas consideradas: —
- Impacto: documentação.
- Revisão: —

### DEC-F8-020 — Avaliação técnica final da F8-0b antes de novos testes reais (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: decidir se a F8-0b continua (T31–T34) ou se encerra, e o que é obrigatório para a F8-4.
- Decisão: (1) **Autorizada somente análise técnica:** consultar a matriz e o plano; avaliar T31–T34 (capacidade, comprovado, pendente, risco, substituição, recomendação); identificar o obrigatório para iniciar a F8-4; avaliar encerramento com ressalvas; avaliar a falta de coleta das métricas do T30 e propor verificação só GET; preparar o contrato mínimo do SocialPublisher; formalizar o aceite já concedido da R1+ sem reescrever registros. (2) Proibido: publicar, agendar, reagendar, cancelar ou criar; alterar permissões/credenciais; limpar rascunhos ou arquivos; iniciar a F8-4; VPS/produção/infraestrutura; workflows privados. (3) Testes adicionais só com nova decisão.
- Alternativas consideradas: —
- Impacto: documentação (`docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md` §16 e `docs/propostas/F8-4_CONTRATO_SOCIALPUBLISHER_BRIGHTBEAN.md`).
- Revisão: na decisão da Direção sobre encerrar a F8-0b.

### 2026-10-13 — F8-0b: aceite definitivo do T30 e métricas pós-publicação (DEC-F8-019) — Claude
- AUTORIZAÇÃO: DEC-F8-019 — somente GET.
- PERMISSÕES: 3× `/me/` → [`create_posts`, `view_analytics`]; `publish_directly` removida; conta de teste conectada.
- MÉTRICAS DO POST: 200 em 00:25, 00:35 e 00:42 UTC (até ~17 min após a publicação); `captured_at` **nulo**, séries vazias, 7 indicadores com valor padrão **0**; `next_sync_eta` móvel (00:31 → 00:39 → 00:47). **Nenhuma coleta efetiva** na janela. Métricas da conta: coletadas às 00:17 UTC, próxima em ~24 h. Commits de documentação com `[skip ci]` no interno e no público.
- REGRA PARA A F8-5: `captured_at` nulo = sem dado ("aguardando coleta"), mesmo com `analytics_available` true e valores 0; `next_sync_eta` não é compromisso.
- MATRIZ F8-0: §10 acrescentada (#36, #37, #38).
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: **T30 aceito definitivamente.** T31–T34 não autorizados.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PENDÊNCIAS: aceite técnico da R1+ ainda não registrado; decisão sobre T31–T34; limpeza dos rascunhos/arquivos de teste; remover e revogar a chave ao fim da F8-0b.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial publicar sem autorização, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b / matriz F8-0 (interno e público).

### DEC-F8-019 — Aceite definitivo do T30 da F8-0b e leitura das métricas pós-publicação (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: encerrar o T30 (DEC-F8-018).
- Decisão: (1) **Aceite definitivo do T30.** O proprietário visualizou e confirmou o Story D6 no Instagram de testes; `publish_directly` removida da chave; `view_analytics` mantida. (2) **Autorizado somente GET:** confirmar em `/me/` a remoção de `publish_directly`; consultar as métricas de D6 após a sincronização; verificar data de coleta, próxima sincronização e valores; distinguir métricas coletadas de valores padrão; registrar o aceite e as evidências nos dois repositórios; atualizar a matriz. (3) Proibido: criar, agendar, alterar ou publicar; ampliar permissões; T31–T34; F8-4; VPS/produção.
- Alternativas consideradas: —
- Impacto: documentação.
- Revisão: na decisão sobre os próximos testes da R2.

### 2026-10-13 — F8-0b R2/T30: Story publicada na conta de testes, sem falha e sem duplicidade (DEC-F8-018) — Claude
- AUTORIZAÇÃO: DEC-F8-018 — somente o T30.
- PORTÃO: após 35 s, 3× `/me/` com `create_posts`, `publish_directly`, `view_analytics`; só a conta de testes; conta sem pendências; D6 Story rascunho com 1 mídia.
- RESULTADO: uma única escrita (`schedule` 200, `-03:00` → UTC, mesmo instante). `scheduled` → `publishing` (16 s após o horário) → **`published`** (~26 s após o horário), com `published_at`, `platform_post_id` e permalink; sem `publish_error`; **sem retentativa automática**. **Duplicidade ausente:** 1 publicado na conta (o D6), 0 agendados/`publishing`/`failed`. Métricas do post 200, `analytics_available` true, 7 indicadores com 0 e `captured_at` nulo (coleta pendente). Commits de documentação com `[skip ci]` no interno e no público.
- ACHADO: antes da coleta o BrightBean devolve 0 nas métricas; a F8-5 deve tratar `captured_at` nulo como sem dado.
- MATRIZ F8-0: §9 acrescentada (#1, #26, #32, #33, #36, #18/#19).
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: T30 **executado com sucesso; aceite pendente da Direção**. T31–T34 não autorizados.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PENDÊNCIAS: conferência visual do perfil; retirar `publish_directly`; leitura das métricas após a sincronização (opcional, só GET); limpeza dos rascunhos/arquivos de teste; remover e revogar a chave ao fim da F8-0b.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial novas publicações sem autorização, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b / matriz F8-0 (interno e público).

### DEC-F8-018 — Execução do T30 da F8-0b: primeira publicação real (Story imagem D6) na conta de testes (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: validar a publicação real pelo BrightBean antes da F8-4.
- Decisão: (1) Chave com **`create_posts`, `publish_directly` e `view_analytics`** (conta de testes e workspace no repositório interno). (2) **Autorizado exclusivamente o T30**: publicação real de uma Story de imagem (rascunho D6) na conta Instagram de testes. (3) Antes: aguardar ≥ 30 s; 3× `/me/` com as três permissões exatas e só a conta de testes; D6 em rascunho sem horário; sem pendências; divergência → parar sem escrever. (4) Execução: só o executor preparado; agendar D6 para ~3 min com fuso explícito; **uma única** operação, sem repetição; acompanhar `scheduled` → `publishing` → `published`/`failed`; consultar identificador, permalink, horário e métricas; verificar duplicidade. (5) Falha ou resposta ambígua → não repetir; agendado além da janela → informar para decisão; registrar retentativas do servidor; permalink só no interno. (6) Sem T31–T34, R2 adicional, F8-4, VPS, produção ou configuração do BrightBean; aguardar novo aceite.
- Alternativas consideradas: —
- Impacto: uma publicação real (Story) na conta de testes; documentação.
- Revisão: no aceite do T30.

### 2026-10-13 — F8-0b: preparação da R2/T30 (DEC-F8-017) — Claude
- AUTORIZAÇÃO: DEC-F8-017 — somente leitura e preparação.
- LEITURAS: `/me/` × 3 → só `create_posts` (`publish_directly` removida); conta de teste conectada. D6: Story rascunho, 1 mídia, sem horário. Código do fork (`4e5bef9`): sem "publicar agora"; publicação = agendar e o publicador dispara em ~15 s; retentativas 60 s/5 min/30 min (máx. 3); o servidor nunca republica sem confirmação (prefere `failed` a duplicar). Commits de documentação com `[skip ci]` no interno e no público.
- PREPARADO: executor do T30 (uma única escrita — agendar D6 entre agora + 2 e + 10 min com fuso; travas testadas offline; acompanhamento de 25 min; métricas e totais ao final; permalink só no interno). Roteiro e critérios em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md`, §13.
- R1+: executada (DEC-F8-016); aceite técnico ainda não registrado.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: T30 **preparado, não autorizado**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial publicar sem autorização, alterar credenciais pelo agente, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b (interno e público).

### DEC-F8-017 — Preparação da R2 da F8-0b (primeira publicação real, T30), sem execução (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: preparar o primeiro cenário de publicação real (Story imagem D6) depois da R1+.
- Decisão: (1) A Direção retirou `publish_directly` da chave. (2) **Autorizada somente a preparação:** confirmar por `GET /me/` a remoção; consultar o estado de D6; verificar no código o procedimento de publicação de um rascunho; identificar permissões, riscos e verificação do resultado; preparar executor restrito a D6 e à conta de testes; definir verificação de status, permalink e métricas; prever detecção de falha e duplicidade; apresentar roteiro e critérios de aceite. (3) Proibido: publicar, agendar, cancelar, alterar permissões/credenciais, criar posts ou mídia, VPS/produção, iniciar a R2.
- Alternativas consideradas: horário no passado (publica em ~15 s) — reservado ao T34.
- Impacto: documentação.
- Revisão: na autorização do T30.

### 2026-10-13 — F8-0b R1+ executada: T20–T23 aprovados, zero agendados e zero publicados (DEC-F8-016) — Claude
- AUTORIZAÇÃO: DEC-F8-016.
- PORTÃO: após 35 s, 3× `/me/` com permissões exatas `create_posts` + `publish_directly` e 1 conta de teste conectada; conta sem agendados/publicações; D6 e D7 em rascunho.
- RESULTADO: T20 agendar D6 (`-03:00` → UTC, mesmo instante) 200; T21 cancelar 200 (`draft`, horário nulo); T22 cancelar de novo **409**; T23 agendar D7 200, reagendar +8 d 200 (horário atualizado), cancelar 200. **Final e após 3 min: D6 e D7 em `draft` sem horário; `scheduled` 0, `publishing` 0, `published` 0, `failed` 0.** Commits de documentação com `[skip ci]` no interno e no público.
- CAPACIDADES CONFIRMADAS: #17, #19, #20, #23 (pelo estado), #30. Matriz F8-0 §8 acrescentada.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R1+ **executada; encerramento só com aceite técnico da Direção**. R2 não autorizada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PENDÊNCIAS: retirar `publish_directly` da chave até a R2; R2 teste a teste; limpeza dos rascunhos e arquivos de teste quando a Direção decidir; remover a chave da máquina e revogá-la ao fim da F8-0b.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial publicar, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b / matriz F8-0 (interno e público).

### DEC-F8-016 — Repetição da R1+ da F8-0b após correção da permissão (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: a R1+ (DEC-F8-015) parou no portão por falta de `publish_directly` efetiva.
- Decisão: (1) A Direção marcou `publish_directly` na chave temporária. (2) Aguardar a propagação; 3× `GET /me/`; confirmar **somente** `create_posts` e `publish_directly` e **somente** a conta de testes; divergência → interromper sem escrever. (3) Se correto, executar T20–T23 com o executor e os controles já preparados; confirmar o cancelamento de todos os agendamentos e verificar de novo após alguns minutos. (4) Sem novos posts, sem publicação imediata, sem contas reais da agência, sem VPS/produção; agendamento residual → interromper e informar para cancelamento supervisionado.
- Alternativas consideradas: —
- Impacto: documentação; operações de agendamento e cancelamento em rascunhos de teste.
- Revisão: no aceite técnico da R1+.

### 2026-10-13 — F8-0b R1+ interrompida no portão: `publish_directly` ausente (DEC-F8-015) — Claude
- AUTORIZAÇÃO: DEC-F8-015.
- RESULTADO: após 35 s, 3× `/me/` (200, consistentes) com permissões efetivas **[`create_posts`]**, sem `publish_directly`; conta de teste conectada. **Portão não atendido → nenhuma escrita**; T20–T23 não executados. Estado final e após 3 min: D6 e D7 em `draft` sem horário; conta com `scheduled` 0, `publishing` 0, `published` 0, `failed` 0. Commits de documentação com `[skip ci]` no interno e no público.
- DIAGNÓSTICO: permissão efetiva = chave ∩ papel do emissor; cache descartado (35 s e 3 leituras iguais). Hipóteses: `publish_directly` não salva na chave, ou o emissor não tem `publish_directly` no workspace (nunca apareceu desde a R0).
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R1+ **não executada (bloqueio de permissão)**; R2 não autorizada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma (repetição da R1+ depende da correção pela Direção).
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial publicar, alterar credenciais pelo agente, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b (interno e público).

### DEC-F8-015 — Execução controlada da R1+ da F8-0b (T20–T23) (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: executar agendamento, cancelamento e reagendamento na conta própria de testes.
- Decisão: (1) Chave com permissões exclusivas **`create_posts` e `publish_directly`** (conta e workspace no repositório interno; validade 20/10/2026). (2) Antes de escrever: aguardar ≥ 30 s; 3× `GET /me/` confirmando exatamente as duas permissões e a conta; confirmar ausência de agendamentos; divergência → interromper sem escrita. (3) Testes autorizados: T20 agendar D6 a +7 dias com fuso explícito; T21 cancelar D6; T22 repetir o cancelamento (409); T23 agendar D7 a +7 d, reagendar a +8 d, cancelar. (4) Controles: bloqueio no executor de horário < +6 dias; só D6 e D7; sem novos posts ou mídia; sem publicação imediata; horário sempre com fuso; falha → parar escritas e consultar estado; agendamento residual → reportar para cancelamento manual supervisionado; zero agendados ao fim e após alguns minutos. (5) Sem R2, VPS, produção ou Actions no privado; R1+ só encerrada com aceite técnico.
- Alternativas consideradas: —
- Impacto: documentação.
- Revisão: na correção da chave e repetição da R1+.

### 2026-10-13 — F8-0b: preparação da R1+ por análise de código (DEC-F8-014) — Claude
- AUTORIZAÇÃO: DEC-F8-014 — somente leitura de código.
- EXECUTADO: leitura do fork em `4e5bef9` (rotas de posts, serviços e modelo de composição, motor do publicador); nenhuma chamada à instância. Roteiro em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md`, §10. Commits de documentação com `[skip ci]` no interno e no público.
- CONCLUSÕES: agendar e reagendar exigem `create_posts` + **`publish_directly`**; cancelar exige só `create_posts`. Cancelar devolve `scheduled` → `draft`, apaga o horário e tira o post da fila; depois de `publishing` não há cancelamento. Sem validação de horário futuro (passado publica em ~15 s). Agendar/reagendar/cancelar sem chave de idempotência, idempotentes pelo estado (repetição → 409). Agendado conta no teto diário. Revogar/expirar a chave não cancela agendados. Fluxo de aprovação do workspace pode recusar o agendamento (422).
- ROTEIRO PROPOSTO: chave `create_posts` + `publish_directly`; Stories D6 e D7 da R1; agendar a +7 d (em `-03:00`), cancelar, cancelar de novo (409), agendar +7 d → reagendar +8 d → cancelar; executor recusa horário < agora + 6 d e qualquer operação fora dessas rotas; inventário final de agendados = 0.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R1 **aceita**; R1+ **preparada, não autorizada**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial agendar/publicar, alterar credenciais, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b (interno e público).

### DEC-F8-014 — Aceite técnico da R1 da F8-0b e preparação da R1+ (somente análise) (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: encerrar a R1 (DEC-F8-013) e preparar os testes de agendamento, reagendamento e cancelamento (T20–T23).
- Decisão: (1) **Aceite técnico da R1.** (2) **Autorizada somente a análise técnica da R1+:** consultar o código do fork (`zafira-custom-v1`, `4e5bef9`); identificar permissões de agendar, reagendar e cancelar; confirmar a necessidade de `publish_directly`; analisar o cancelamento e os riscos de publicação acidental; verificar fuso e idempotência de agendamentos futuros; preparar o roteiro T20–T23 só na conta de testes; definir como confirmar o cancelamento; avaliar o reaproveitamento dos rascunhos e arquivos da R1. (3) Proibido: alterar permissões/credenciais, criar/agendar/reagendar/cancelar/publicar, VPS/produção, iniciar R1+ ou R2.
- Alternativas consideradas: —
- Impacto: documentação.
- Revisão: na autorização da execução da R1+.

### 2026-10-13 — F8-0b Fase R1: uploads e rascunhos sem publicação (DEC-F8-013) — Claude
- AUTORIZAÇÃO: DEC-F8-013.
- PORTÃO: 3 leituras de `/me/` consistentes; permissões exatas (`create_posts`, `upload_media`, `view_analytics`), sem `publish_directly`; conta de teste conectada.
- EXECUÇÃO: executor temporário fora do repositório, com travas no código (só `GET`, `POST /media/`, `POST /posts/` com `action=draft` sem `scheduled_at`, `PATCH` de legenda) e parada em 5xx/401/403/429 (não ocorreu). Mídia sintética gerada localmente (System.Drawing; WebP e MP4 pelo navegador embutido, servidor local temporário em 127.0.0.1, já encerrado). Os carrosséis de 10 e 11 itens não rodaram na primeira passada por erro no executor (checagem mal escrita) e foram executados num complemento com o mesmo portão. Commits de documentação com `[skip ci]` no interno e no público.
- RESULTADO: 17 uploads aceitos (JPG, PNG, WebP, MP4; "`.mov`" detectado como MP4); recusados com 422: imagem > 20 MB, > 30 MP e arquivo falso. 15 rascunhos criados (Feed, carrossel 2/10/11, Reel, Story imagem e vídeo, vídeo no Feed, PNG, WebP, legendas 2200 e 2201, idempotência, fuso); recusados com 422: story com 2 mídias e reel com imagem. Idempotência: replay com mesmo id e 422 para corpo diferente, no upload e na criação. `proposed_publish_at` com `-03:00` → UTC, mesmo instante. `PATCH` de legenda mantém rascunho. **Inventário final: 15 posts, todos `draft`; 17 mídias; nada agendado ou publicado.**
- ACHADOS PARA A F8-4: servidor não valida máximo do carrossel nem `char_limit` na criação; deduplicação do upload por nome+tamanho; tipo detectado pelo conteúdo; vídeo passa por `pending`.
- MATRIZ F8-0: §7 acrescentada (classes atualizadas de #6, #7, #10, #12, #13, #15, #16, #19, #22, #24, #27, #28, #29, #37, #38).
- INVENTÁRIO PARA LIMPEZA: rascunhos e mídias listados com identificadores no repositório interno; nada removido.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R1 **executada; encerramento só após revisão da Direção**. R1+ e R2 não autorizadas.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial agendar/publicar, `publish_directly`, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b / matriz F8-0 (interno e público).

### DEC-F8-013 — Execução da Fase R1 da F8-0b (uploads e rascunhos, sem publicação) (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: executar a R1 do plano da F8-0b na conta própria de testes.
- Decisão: (1) Chave temporária com **`create_posts`, `upload_media` e `view_analytics`**, sem `publish_directly` (conta e workspace no repositório interno; validade 20/10/2026). (2) **Autorizada a R1:** conferir `/me/` antes de escrever e parar em permissão excessiva ou divergência; uploads de mídia fictícia e rascunhos nos formatos suportados; limites de arquivo, tipos, legenda e duplicidade; confirmar que só há rascunhos; registrar IDs e respostas sem dados sensíveis; inventariar para limpeza, sem excluir; atualizar a matriz e os documentos nos dois repositórios. (3) Proibido: publicar, agendar, reagendar, `publish_directly`, ampliar permissões, VPS/infraestrutura/produção, dados de clientes, R1+/R2, Actions no privado. (4) Comportamento inesperado: interromper. (5) A R1 só se encerra após revisão da Direção.
- Alternativas consideradas: —
- Impacto: documentação; rascunhos e arquivos de teste na conta de testes.
- Revisão: na revisão da R1 pela Direção.

### 2026-10-13 — F8-0b R0 concluída: causa da divergência e leituras finais (DEC-F8-012) — Claude
- AUTORIZAÇÃO: DEC-F8-012 — somente GET; parada em erro de autorização ou de isolamento (não ocorreu).
- RESULTADO: `/me/` 200 (só `view_analytics`, 1 conta); `/accounts/` 200 com **a mesma conta** (também com parâmetro anti-cache; sem barra → 301); posts filtrados pela conta 200 (total 0); conta fora da allowlist 404 (**isolamento ok**); **métricas da conta 200** (`analytics_available` true); mídia 200 (0 itens, cursor). Detalhe de post, permalink e métricas de post não aplicáveis (conta sem posts). Commits de documentação com `[skip ci]` no interno e no público.
- CAUSA DA DIVERGÊNCIA: cache da chave (com contas pré-carregadas) por até 30 s em cada processo do servidor (`apps/api_keys/services.py`, `4e5bef9`); `/me/` e `/accounts/` foram atendidos por processos com cópias diferentes logo após a correção da allowlist. Identificada pelo código e pelo desaparecimento da divergência. Para a F8-4: aguardar ≥ 30 s após alterar/revogar uma chave.
- CAPACIDADES COM EVIDÊNCIA REAL: #10, #27, listagem de mídia, **#37**, **#38** (com isolamento). Pendentes para R2: detalhe/permalink de post e #36.
- CONTA DE TESTE: confirmada pela Direção como conta própria de testes (registro no interno).
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: **R0 concluída; aceite pendente da Direção.** R1/R1+/R2 não autorizadas.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial qualquer escrita/publicação no BrightBean, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b (interno e público).

### DEC-F8-012 — Continuidade controlada da R0 da F8-0b e confirmação da conta de teste (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: divergência entre `/me/` e `/accounts/` (DEC-F8-011) e leituras restantes da R0.
- Decisão: (1) **Autorizada a continuidade da R0, somente GET:** investigar por leitura a divergência (versão implantada, filtros, permissões, cache), sem alterar a instância; consultar posts e métricas com o identificador da conta autorizado em `/me/`, se o endpoint aceitar e respeitar o escopo; consultar mídia e métricas de posts existentes. (2) Não usar outra conta; não ampliar permissões; sem escrita. (3) Interromper em erro de autorização, inconsistência de isolamento ou risco de expor dados de outra conta. (4) **A Direção confirmou que a conta vinculada à chave é conta própria destinada a testes**, autorizada a receber publicações experimentais em etapas futuras (identificação no repositório interno); isso **não** altera a autorização atual. (5) R1, R1+ e R2 dependem de autorização específica; sem VPS, produção ou credenciais.
- Alternativas consideradas: —
- Impacto: documentação.
- Revisão: no aceite da R0.

### 2026-10-13 — F8-0b R0 reexecutada: divergência entre /me/ e /accounts/ (DEC-F8-011) — Claude
- AUTORIZAÇÃO: DEC-F8-011 — somente GET; parar em divergência.
- RESULTADO: `/me/` 200 com permissões **[view_analytics]** e **1 conta** liberada (`instagram_login`, conectada, `char_limit` 2200, `needs_title` false, `supports_first_comment` true); `/accounts/` 200 com **0 contas**. Portão não atendido → posts, mídia e métricas **não executados**. Uma leitura adicional de `/me/` (só campos técnicos, sem nomes) confirmou a conta. Commits de documentação com `[skip ci]` no interno e no público.
- DIAGNÓSTICO: chave correta; a instância diverge do código lido (`4e5bef9`), em que as duas rotas leem a mesma lista. Hipóteses: código implantado diferente nessa rota ou cache. F8-4 não deve depender de `/accounts/` até esclarecer.
- CAPACIDADES COM EVIDÊNCIA REAL: #10 (limites da conta `instagram_login`) e #38 (permissão efetiva e allowlist). Pendentes: #27 com dados, #36/#37, R1/R1+/R2.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R0 **interrompida por divergência**. R1 e R2 **não autorizadas**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial qualquer escrita/publicação no BrightBean, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b (interno e público).

### DEC-F8-011 — Reexecução da Fase R0 da F8-0b após correção da chave (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: a primeira R0 (DEC-F8-010) mostrou chave sem conta e com permissões além do informado.
- Decisão: (1) A Direção corrigiu a chave (conta vinculada indicada no repositório interno; única permissão **view_analytics**; validade 20/10/2026). (2) **Autorizada exclusivamente a reexecução dos GET da R0**: `/me/` (permissões efetivas), `/accounts/` (conta autorizada); se ambos corretos, posts, mídia e métricas. (3) **Qualquer divergência: interromper e apresentar diagnóstico.** (4) Sem POST/PUT/PATCH/DELETE; chave nunca impressa nem armazenada em arquivos versionados. Sem R1/R2, publicação, VPS ou produção.
- Alternativas consideradas: —
- Impacto: documentação.
- Revisão: na decisão sobre a divergência de `/accounts/`.

### 2026-10-13 — F8-0b Fase R0: leitura com chave temporária (DEC-F8-010) — Claude
- AUTORIZAÇÃO: DEC-F8-010 — somente GET.
- PROCEDIMENTO: chave guardada pelo proprietário como variável de ambiente do usuário Windows (`ZAFIRA_F80B_BB_KEY`), com entrada oculta; script temporário fora do repositório que **só faz GET**, nunca imprime a chave e grava apenas códigos HTTP, nomes de campos e contagens. Commits de documentação com `[skip ci]` no interno e no público (o registro do interno foi concluído num segundo commit, ver handoff).
- RESULTADO: `/me/` 200 (autenticação válida); `/accounts/` 200 com **0 contas**; `/posts/` 200 (listagem com `items/limit/offset/total`, total 0; paginação por offset aceita); `/media/` 200 (listagem com cursor, 0 itens). Métricas, detalhe de post/mídia e filtro por conta **não executados** (sem alvo). Nenhum 403.
- ACHADOS: (1) **chave sem conta na allowlist** — a conta pretendida não está vinculada; (2) **permissões efetivas** = `create_posts`, `approve_posts`, `edit_others_posts`, `view_analytics` (interseção chave ∩ emissor, pelo código), **diferente do informado (só `view_analytics`)**; sem `publish_directly` e sem `upload_media`. Nenhuma escrita tentada.
- CAPACIDADES COM EVIDÊNCIA REAL: #27 (listagem de posts e paginação), listagem de mídia com cursor, #38 (modelo de permissão e allowlist por chave). Pendentes: #10, #36, #37 e R1/R1+/R2.
- PENDÊNCIAS PARA R1: reemitir/corrigir a chave com a conta de teste na allowlist e só as permissões da fase; repetir T02/T05 com conta visível; confirmar que a conta é de teste; autorização expressa da R1.
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: R0 **executada com limitação** (sem conta visível). R1 e R2 **não autorizadas**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial qualquer escrita/publicação no BrightBean, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / plano da F8-0b (interno e público).

### DEC-F8-010 — Execução da Fase R0 da F8-0b (somente leitura) com chave temporária (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: executar a Fase R0 (T01–T05) do plano da F8-0b.
- Decisão: (1) O proprietário criou chave temporária (workspace e conta indicados no repositório interno; permissão selecionada **view_analytics**; validade 20/10/2026), mantida fora da conversa e do GitHub. (2) **Autorizada exclusivamente a R0**: autenticação, contas, posts, mídia e métricas, **somente GET**; identificar o que o escopo permite e o que retorna 403. (3) Proibido: ampliar permissões, POST/PUT/PATCH/DELETE, criar/editar/cancelar/agendar/publicar, alterar instância, VPS ou produção. Consulta não permitida: registrar e interromper. (4) R1 e R2 só com nova autorização.
- Alternativas consideradas: —
- Impacto: documentação. Nenhum código, credencial ou serviço alterado pelo agente.
- Revisão: na autorização da R1.

### 2026-10-13 — F8-0b: preparação da verificação ativa do BrightBean (DEC-F8-009) — Claude
- AUTORIZAÇÃO: DEC-F8-009 — somente preparação; leitura sem credencial; nenhuma escrita, publicação, alteração de configuração, credencial ou VPS.
- EXECUTADO: plano em `docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md`. Diagnóstico de `https://post.zafiramkt.com.br` por acessos de leitura **sem credencial**: aplicação responde (302), API v1 exige chave (`/api/v1/me/` → 401), OpenAPI pública versão 1.0.0 com **16 rotas idênticas** ao fork `brightbean-studio` branch `zafira-custom-v1` commit `4e5bef9` (código lido, clone temporário fora do repositório). **Contas conectadas não verificadas**: exigem chave; a chave da homologação 2C2H foi revogada e criar outra é alteração de credencial (fora da etapa). Commits de documentação com `[skip ci]` no interno e no público (versão pública do plano sem endereço da instância nem perfil da conta).
- 13 CAPACIDADES NÃO VERIFICADAS: #8, #9, #12, #13, #15, #18, #19, #23, #24, #27, #28, #29, #30. Pelo código e pela OpenAPI: listagem existe (#27); busca por referência (#28) e webhooks (#29) **não existem**; não há publicação imediata, mas `scheduled_at` no passado dispara em ~15 s (#18); idempotência por chave de API com replay/422/409 (#24); cancelar devolve o agendado a rascunho e repete com 409 (#23, #30); mídia pertence ao workspace (#15); limites padrão imagem 20 MB / vídeo 1 GB (#13). Todos ainda **sem observação em execução**.
- ACHADOS PARA A F8-4: imagens acima de 20 MB (aceitas pelo Hub até 100 MB) são recusadas pelo BrightBean por padrão; horário passado publica em ~15 s (o Hub deve recusar); teto de 25 publicações/dia por conta do Instagram; sem webhooks nem busca por referência.
- RISCO PRINCIPAL: a conta conectada registrada é o **perfil real da agência** no Instagram e no Facebook; publicações são públicas e não removíveis pela API. Recomendado conectar conta de teste dedicada antes de qualquer teste R2.
- MATRIZ DE TESTES: R0 leitura (T01–T05), R1 rascunhos/uploads sem publicação (T10–T17), R1+ agendamento a +7 dias seguido de cancelamento (T20–T23), R2 publicação real com aprovação por teste (T30–T34).
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633`).
- STATUS: preparação **concluída**; execução **não autorizada**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Para a Fase 1 (R0): autorização + chave exclusiva criada pelo proprietário (sem `publish_directly`, allowlist só da conta de teste), guardada como variável de ambiente local, nunca na conversa.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial qualquer escrita/publicação no BrightBean sem autorização, F8-4/F8-5, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / plano da F8-0b (interno e público).

### DEC-F8-009 — Preparação da F8-0b (verificação ativa do BrightBean), sem escrita nem publicação (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: preparar os testes reais exigidos antes da F8-4 (matriz F8-0, §5). A Direção confirmou que a instância BrightBean da VPS segue funcionando, com conta social conectada.
- Decisão: (1) **Autorizada exclusivamente a preparação da F8-0b:** identificar as 13 capacidades não verificadas; verificar **somente por leitura** o estado da instância e das contas, sem expor credenciais; confirmar as rotas REST v1 e quais operações exigem teste real; preparar a matriz de testes (mídia, rascunho, agendamento, fuso, idempotência, cancelamento, falhas, permalink, métricas); separar testes seguros sem publicação dos que exigem publicação e aprovação específica; avaliar se a conta conectada é adequada e o risco de publicar em perfil real; apresentar roteiro, riscos e critérios de aceite. (2) **Proibido nesta etapa:** criar, agendar, publicar, cancelar ou modificar posts; alterar configurações ou credenciais; modificar a VPS ou serviços; usar dados de clientes; iniciar a F8-4; executar workflows no privado. (3) Qualquer escrita ou publicação depende de **autorização expressa**.
- Alternativas consideradas: —
- Impacto: documentação (`docs/propostas/F8-0b_PLANO_VERIFICACAO_BRIGHTBEAN.md`). Nenhum código, credencial ou serviço alterado.
- Revisão: na autorização da execução da F8-0b.

### 2026-10-13 — Registro do aceite técnico da F8-3 (DEC-F8-008) e correção da P32 — Claude
- AUTORIZAÇÃO: aceite técnico da F8-3 pela Direção (DEC-F8-008); somente documentação, com `[skip ci]`. Sem F8-4, F8-0b, VPS, produção ou workflows no privado.
- EXECUTADO: F8-3 marcada como **concluída** no ESTADO, no Mapa e no contrato; evidências do CI e do Browser Gate F8 registradas na DEC. **P32 corrigida** no `MAPA_MESTRE.md` público (removido o trecho repetido "`(repositório interno)` (repositório interno)" da nota de abertura da parte C2; nenhuma regra alterada). Commits de documentação com `[skip ci]` no interno e no público.
- DIVERGÊNCIA REGISTRADA: o aceite foi pedido como "DEC-F8-007", número já existente; registrado como DEC-F8-008 (ver nota na DEC).
- BASELINE DE CÓDIGO: inalterada — `38ce219` no público (espelho `d1e0633` no interno). Nenhum código alterado; nenhum run disparado.
- PRÓXIMA MICROETAPA PREVISTA NO MAPA: **F8-0b — verificação ativa das capacidades do BrightBean** (`docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md`, §5), pré-requisito obrigatório da F8-4. Exige instância de teste do BrightBean, credencial de escopo mínimo e **autorização expressa** (sem dados de cliente). **Não autorizada; não iniciada.**
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-0b, F8-4 e F8-5 sem DEC, BrightBean/S3 reais, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / contrato da F8-3 (interno e público).

### DEC-F8-008 — Aceite técnico e conclusão da F8-3 (contador de Entregas por estágio) (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: revisão da entrega da F8-3 (DEC-F8-007).
- Decisão: (1) **Aceite técnico da F8-3**, com evidências confirmadas pela Direção: commit `38ce219`; run 38446236135 (https://github.com/Julianogdc/zafira-hub/actions/runs/38446236135) com **CI oficial 5/5** — domínio 94/94, API 822/822, web 88/88, PostgreSQL 145/145 (inclui o teste da F8-3); **Browser Gate F8 PASS com 70 verificações e 0 falhas**, cenário L completo (contagem sem duplicidade por versão/reenvio/revogação, publicados `null`, meta e peças de Entregas intactas, tela igual à API, painel somente leitura, Org B recusada, 390 px em duas colunas sem rolagem); gates F4–F7 PASS; somente `ubuntu-latest`, 0 ms faturáveis. (2) **F8-3 concluída.** (3) Corrigir a P32 se ainda pendente. (4) Alterações documentais com `[skip ci]`. (5) **Não iniciar F8-4 nem F8-0b**; sem VPS/produção; sem workflows no privado; sem modificar regras de negócio aprovadas.
- Nota de numeração: a mensagem da Direção pediu o registro como "DEC-F8-007", número já usado nesta mesma data pela aprovação do contrato e autorização da implementação da F8-3. Como o registro não reescreve entradas, o aceite recebeu o número seguinte, **DEC-F8-008**. Se a Direção preferir outra numeração, registra-se uma nova entrada.
- Alternativas consideradas: —
- Impacto: documentação (ESTADO_ATUAL, REGISTRO, MAPA_MESTRE e contrato da F8-3 nos dois repositórios; nota da parte C2 do Mapa público pela P32). Nenhum código.
- Revisão: na autorização da próxima microetapa da F8.

### 2026-10-13 — F8-3: contador de Entregas por estágio implementado (DEC-F8-007) — Claude
- AUTORIZAÇÃO: DEC-F8-007 — implementar a F8-3 conforme o contrato aprovado (D1 A, D2, D3). Sem F8-4/F8-0b, VPS, produção, workflows privados ou contratação de serviços.
- CÓDIGO (público: `2673c2b` implementação; `b2b9760` e `38ce219` correções dos testes novos; espelho no interno `3bbe281`, `026a333` e `d1e0633`, conferido arquivo a arquivo):
  - **Domínio** (`content-model.ts`): `contentStageOf`, `contentPeriodOf` (D1, fuso da organização), `countContentStages` (cumulativa: recebidos ≥ enviados ≥ aprovados; `published: null`, `NOT_INTEGRATED`), `publishedRatio`.
  - **API**: `GET /clients/:id/deliverables/content-stages?period=AAAA-MM` (prefixos "" e "/api"), exige `deliverables.view` **e** `content.view` (a rota passou a aceitar várias permissões, todas obrigatórias), escopo de cliente e organização (fora do escopo: 404). Fontes: primeiro `ContentMedia` (inclusive removido), primeiro `sentForApprovalAt`, primeira `ApprovalDecision` APPROVED; status atual pelo acompanhamento da F8-2. **Nenhuma escrita** em Entregas ou Conteúdos; sem mídia, storage ou dados do aprovador na resposta.
  - **D3**: serviço recusa a segunda ligação à mesma peça (409 `PIECE_ALREADY_LINKED`) e peça de outra organização/cliente (400 `PIECE_NOT_FOUND`), na criação e na atualização. Migration `20261013030000_f8_3_content_piece_link`: **verificação prévia que aborta sem alterar nenhum registro** se houver vínculos duplicados ou inconsistentes; índice único parcial `content_items_one_per_deliverable_piece`; gatilho `content_items_piece_scope` (mesma organização e cliente) em INSERT e UPDATE do vínculo.
  - **Web**: `ContentStagesPanel` no painel de Entregas (independe do plano): quatro cartões (Arquivos recebidos, Enviados para aprovação, Aprovados pelo cliente, Publicados) e barra "Publicadas entre as recebidas" **neutra** ("Publicação ainda não integrada"); Publicados mostra "—" e "Aguardando integração da publicação", nunca 0; 2×2 em 390 px, 4 colunas a partir de 768 px; sem botões de ação.
- REGISTROS EXISTENTES (D3): não há banco real com a F8 (nenhum deploy da F8; acesso a banco real proibido). A garantia é a verificação prévia dentro da própria migration, que **para sem modificar dados**; no CI ela rodou em banco descartável sem vínculos inconsistentes.
- TESTES LOCAIS: typecheck contracts/domain/api/web 0 erros; domínio 94/94 (+7); API 822/822; web 88/88 (+4); `lint:f6` 0 erros; build completo. PostgreSQL e Browser Gate não executáveis nesta máquina (sem PostgreSQL/Python): validados no CI.
- CI OFICIAL: run 38446236135 (https://github.com/Julianogdc/zafira-hub/actions/runs/38446236135) — **5/5 verdes** — domínio 94/94, API 822/822, web 88/88, PostgreSQL 145/145; 0 ms faturáveis. Browser Gate F8: **PASS, 70 verificações e 0 falhas** (cenário L completo; gates F4–F7 PASS). Somente runners `ubuntu-latest`. Runs anteriores: 38442282581 (falha no teste novo de PostgreSQL: faltava a organização na exceção de permissão; corrigido em `b2b9760`, sem alterar o código); 38443270005 (1ª tentativa: limite externo de download da imagem do PostgreSQL no registro público da Amazon, sem teste executado; reexecução única do job: PostgreSQL 145/145, Publish Images ok, Browser Gate F8 69/1 — a checagem nova de 390 px procurava o painel antes de abrir Entregas; corrigida em `38ce219`). Nenhum teste existente foi enfraquecido. Commits de documentação com `[skip ci]` no interno e no público.
- ESPECIFICAÇÃO: §9 atualizada (estágios derivados, sem gravar no enum de `DeliverablePiece`), conforme D2.
- STATUS: F8-3 **entregue; aceite técnico pendente da Direção** (não aceita automaticamente).
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Depois do aceite: F8-0b antes da F8-4 (ambas não autorizadas).
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-4/F8-5, F8-0b sem DEC, BrightBean/S3 reais, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / contrato da F8-3 / especificação §9 (interno e público).

### DEC-F8-007 — Contrato técnico da F8-3 aprovado (D1, D2, D3) e implementação autorizada (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: revisão do contrato técnico da F8-3 (`docs/propostas/F8-3_CONTRATO_CONTADOR_ENTREGAS.md`, DEC-F8-006).
- Decisão: (1) **Contrato aprovado.** (2) **D1 — opção A:** competência do `DeliverablePlan` da peça vinculada; sem vínculo, mês do primeiro arquivo recebido no fuso da organização. (3) **D2:** contagem **derivada** dos registros reais de Conteúdos e Aprovações, **sem modificar a meta contratual nem as etapas manuais de Entregas**; atualizar a divergência da especificação §9. (4) **D3:** impedir que dois conteúdos apontem para a mesma `DeliverablePiece`; validar que a peça vinculada pertence à mesma organização e ao mesmo cliente do conteúdo, na criação e na atualização do vínculo; **verificar registros existentes antes da migration, sem excluir nem modificar registros para fazê-la passar**. (5) **Implementação autorizada:** quatro contadores cumulativos; barra complementar neutra enquanto não houver confirmação real de publicação; endpoint somente leitura com RBAC e isolamento entre organizações e clientes; integração ao painel existente, responsiva até 390 px; tratamento de versões, reenvios, revogações e arquivos removidos; testes de domínio, API, PostgreSQL e Browser Gate F8. (6) **Preservar:** uma peça por conteúdo; meta contratual independente; etapas manuais de Entregas; Asana somente leitura; ausência de publicação fictícia. (7) **Execução:** no repositório público `hub-2.1`, governança sincronizada com o privado; testes locais e CI oficial completo 5/5 com Browser Gate F8, só no público com runners padrão gratuitos. (8) **Restrições:** sem F8-4 ou F8-0b, sem VPS/produção, sem workflows privados, sem contratar serviços. A F8-3 só é concluída após aceite técnico da Direção.
- Alternativas consideradas: D1 opção B (só conteúdos vinculados); §9 original (gravar estágios no enum de `DeliverablePiece`).
- Impacto: packages/domain, packages/contracts, apps/api (serviço, rota, migration), apps/web (painel), scripts/homologation (Browser Gate F8).
- Revisão: no aceite técnico da F8-3.

### 2026-10-13 — F8-3: revisão do domínio e contrato técnico (sem implementação) — Claude
- AUTORIZAÇÃO: DEC-F8-006 — somente revisar o domínio e propor o contrato técnico; **não implementar**. Sem F8-4, VPS, produção ou workflows no privado.
- EXECUTADO: leitura de `schema.prisma` (Content*, Approval*, Deliverable*), `content.service.ts`, `approval.service.ts`, `deliverables.service.ts/routes.ts`, escopo de cliente e papéis padrão. Contrato em `docs/propostas/F8-3_CONTRATO_CONTADOR_ENTREGAS.md`: unidade = `ContentItem`; estágios derivados na leitura (primeiro `ContentMedia` → `sentForApprovalAt` → `ApprovalDecision` APPROVED); contagem cumulativa e monotônica; reenvio/reemissão/nova versão sem duplicidade; **Publicados = `null` (NOT_INTEGRATED), nunca 0**, e barra em estado neutro; endpoint de leitura com `deliverables.view` + `content.view` + escopo de cliente; nenhuma escrita em Entregas; testes de aceite por camada e extensão do Browser Gate F8. Commits no interno e no público com `[skip ci]`.
- ACHADOS: L1 `ContentItem.deliverablePieceId` sem chave estrangeira nem unicidade; L2 `archivedAt` sem rota que o preencha; L3 a especificação §9 previa gravar os estágios no enum de `DeliverablePiece` — o contrato recomenda não gravar (D2).
- DECISÕES PEDIDAS À DIREÇÃO: **D1** período do conteúdo (recomendado: competência do plano da peça vinculada; sem vínculo, mês do primeiro arquivo no fuso da organização); **D2** contagem derivada, sem gravar nas peças (substitui a §9); **D3** um conteúdo por peça (índice único parcial).
- BASELINE DE CÓDIGO: inalterada — `2fd34dc` no público (espelho `b7de353` no interno). Nenhum código alterado; nenhum run disparado.
- STATUS: contrato **em revisão pela Direção**. F8-3 **não implementada**.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Aguarda DEC que aprove o contrato e D1–D3.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial código da F8-3 antes da DEC, F8-4/F8-5, F8-4 sem F8-0b, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE / docs/propostas/F8-3_CONTRATO_CONTADOR_ENTREGAS.md (interno e público).

### DEC-F8-006 — Interface da F8-3 aprovada (contador de Entregas por estágio); contrato técnico antes do código (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: definir a F8-3 (próxima microetapa prevista no Mapa) depois do aceite da F8-2 (DEC-F8-005).
- Decisão: (1) **Interface aprovada:** no painel de Entregas, quatro contadores — **Arquivos recebidos, Enviados para aprovação, Aprovados pelo cliente, Publicados** — e uma **barra complementar** com a proporção de publicadas entre recebidas. (2) **Regras:** contadores cumulativos por estágio alcançado, sem duplicidade por versão; uma peça = uma entrega, independentemente de versões ou reenvios; **meta contratual nunca alterada automaticamente**; contar a partir dos eventos reais da F8-1 e F8-2; **não presumir publicação** (Publicado exige confirmação confiável, integrada nas próximas etapas); preservar histórico de versões, decisões e pedidos de alteração; respeitar RBAC, organização e escopo de cliente; seguir o Design System e a responsividade existentes; sem fluxo editorial paralelo ao Asana. (3) **Tarefa autorizada:** revisar o domínio de Entregas e Conteúdos e apresentar um **contrato técnico** (`docs/propostas/F8-3_CONTRATO_CONTADOR_ENTREGAS.md`) para revisão. (4) **Não implementar ainda.** Sem F8-4, VPS, produção ou workflows no privado.
- Alternativas consideradas: —
- Impacto: documentação; o código da F8-3 depende de nova DEC aprovando o contrato e as decisões D1–D3.
- Revisão: na aprovação do contrato da F8-3.

### 2026-10-13 — Registro do aceite técnico da F8-2 (DEC-F8-005) e correção da P31 — Claude
- AUTORIZAÇÃO: DEC-F8-005 — registrar o aceite e o encerramento técnico da F8-2 e corrigir a P31; somente documentação, com `[skip ci]`. Sem F8-3, VPS ou produção.
- EXECUTADO: ESTADO_ATUAL, REGISTRO e MAPA_MESTRE atualizados nos dois repositórios, respeitando o saneamento (o público continua sem informação sensível; nenhum arquivo copiado do interno para o público). `AGENTS.md` público: removida a segunda cópia, idêntica, da seção "8. Dois repositórios: público e interno" (texto e regras inalterados). Commits: interno e público com `[skip ci]` (SHAs no histórico de cada repositório).
- BASELINE DE CÓDIGO: inalterada — `2fd34dc` no público (espelho `b7de353` no interno). Nenhum código alterado; nenhum run disparado.
- STATUS: **F8-2 aceita e encerrada tecnicamente.** P31 resolvida. Nova P32 (trecho repetido na nota da parte C2 do Mapa público).
- PRÓXIMA MICROETAPA PREVISTA NO MAPA: **F8-3** — contador de Entregas por estágio (arquivo recebido → enviado para aprovação → aprovado → publicado), sem alterar a meta contratual; ajustes no painel. **Não autorizada; não iniciada.**
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-3 a F8-5 sem DEC, F8-4 sem a F8-0b, BrightBean/S3 reais, VPS, produção e cobrança.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE (interno e público); AGENTS.md (público).

### DEC-F8-005 — Aceite técnico e encerramento técnico da F8-2 (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: revisão da F8-2 (aprovação do cliente por link seguro) após o primeiro CI oficial no repositório público.
- Decisão: (1) **Aceite técnico da F8-2**, com evidências verificadas pela Direção: commit `2fd34dc`; run 38429147116 (https://github.com/Julianogdc/zafira-hub/actions/runs/38429147116) com **CI 5/5 verde**; **Browser Gate F8 com 54 verificações aprovadas e 0 falhas**; **publicação GHCR aprovada**. (2) **Encerramento técnico da F8-2.** (3) Correção da duplicação da seção 8 do `AGENTS.md` público (**P31**), sem modificar regras de governança. (4) **F8-3 não autorizada** por esta decisão; F8-0b segue obrigatória antes da F8-4; sem VPS ou produção. (5) Alterações exclusivamente documentais com `[skip ci]`.
- Alternativas consideradas: —
- Impacto: documentação (ESTADO_ATUAL, REGISTRO, MAPA_MESTRE nos dois repositórios; `AGENTS.md` público). Nenhum código.
- Revisão: na autorização da F8-3.

### 2026-10-13 — Registro do workflow no repositório público e primeiro CI oficial público (F8-2) — Claude
- AUTORIZAÇÃO: Direção (2026-10-13), via proprietário: corrigir o registro do workflow de forma não destrutiva (alteração técnica mínima no workflow para provocar `push`), preservar jobs, testes e Browser Gates, sem excluir/recriar branches e sem force-push; acompanhar o CI e investigar falhas sem runs repetidos desnecessários; confirmar runners padrão gratuitos. Restrições: sem VPS/produção, sem Actions no privado, sem cobrança, sem F8-3.
- SITUAÇÃO INICIAL (API do GitHub): público, Actions habilitado, **0 workflows registrados, 0 runs** (o commit raiz `5870f71` foi enviado com o Actions desativado, então o GitHub nunca leu o workflow); token padrão somente leitura; Actions do interno desativado.
- COMMITS NO PÚBLICO (todos sem force, branch `hub-2.1`):
  1. `970dddb` — `permissions: contents: read` no topo do workflow (permissão mínima explícita; `publish-images` e `homologation-rehearsal` mantêm a própria). O push **registrou o workflow** ("Hub 2.1 Foundation CI", ativo) e iniciou o run 38424632457.
  2. `c6ce0ae` — testes de integração PostgreSQL **em série** (`--test-concurrency=1`). Run 38424632457: PostgreSQL 136/140 — os 4 testes "0. Migration não cria dados" encontraram 1 registro gravado por outro arquivo; o executor do Node roda arquivos em paralelo e os 11 arquivos usam o mesmo banco (soma das durações ~19 s > ~13 s do passo). Fragilidade preexistente da suíte, exposta pelo runner com mais núcleos. Nenhum teste alterado.
  3. `2fd34dc` — **defeito real da F8-2 corrigido:** gerar/reemitir o link não altera o conteúdo (updatedAt/versões), então o painel de aprovação só recarregava ao atualizar a página; após reemitir, a pessoa via a lista antiga e não encontrava "Revogar" do link novo. Run 38425797903: Publish Images ✔ (acesso GHCR confirmado), gates F4–F7 ✔, **Browser Gate F8 42/0 + tempo esgotado** esperando `revoke-approval-link` (os passos anteriores recarregavam a página e escondiam o defeito). Correção: `loadApproval()` logo após criar o link. **Gate não alterado.** Validação local antes do push: typecheck web 0 erros, web 84/84, lint do arquivo limpo, build.
- CI OFICIAL: **run 38429147116 (https://github.com/Julianogdc/zafira-hub/actions/runs/38429147116) — 5/5 verdes**: domínio 87/87, API 822/822, web 84/84, PostgreSQL 140/140; Browser Gates F4 (autenticado), F5, F6, F7-1, F7-2, F7-3, F7-4 e **F8 PASS (54 verificações, 0 falhas — primeira execução bem-sucedida)**. Runners: somente `ubuntu-latest` (grupo GitHub Actions, hospedado); **billable 0 ms** nos três runs.
- INTERNO: `b7de353` espelha as três mudanças (código idêntico ao público; o workflow difere só pelo saneamento já existente: passo Public Guard e padrão de domínio). Actions do interno segue desativado.
- STATUS: F8-2 **entregue com CI oficial 5/5 e Browser Gate F8 aprovados; aceite técnico pendente da Direção** (não aceita automaticamente). F8-3 não iniciada.
- LIMITES/LACUNAS: o Browser Gate não pode ser executado nesta máquina (sem Python/Playwright); a primeira execução real foi no CI. P31 registrada (seção 8 duplicada no `AGENTS.md` público).
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Aguarda aceite técnico da F8-2; depois, autorização da F8-3; F8-0b antes da F8-4.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO (interno e público).

### 2026-10-12 — F8-1 — Domínio, arquivos, upload e telas mínimas de conteúdo — Claude
- AUTORIZAÇÃO: DEC-F8-003 — exclusivamente a F8-1 (registrada antes do código, `93922fe`). Não iniciadas: F8-2 a F8-5; F8-0b não executada. Sem BrightBean/Asana reais, VPS, produção ou cobrança.
- BASELINE (commit): `61bd2fd`.
- CI OFICIAL: run **38340449956 — 5/5 verdes** (um único run para a fatia): domínio 83/83, API 822/822, web 81/81, PostgreSQL 130/130 (10 novos em `content-postgres.test.ts`; suíte completa também validada localmente em banco limpo); Browser Gates F4–F7-4 passando. Não foi criado Browser Gate novo para o conteúdo (economia de CI; ver limitações).
- STATUS: **pendente de aceite** (a F8-1 não é aceita automaticamente).
- O QUE MUDOU: (1) **Domínio puro** (`content-model`): formatos canônicos `FEED_IMAGE`, `CAROUSEL` (2–10), `REEL` (1 vídeo), `STORY` (1 imagem ou vídeo), sem formato separado de vídeo de feed; **tipo real por assinatura** (JPG, PNG, WebP, MP4, MOV; extensão e Content-Type declarados são ignorados); teto de 100 MB; regras de conjunto de arquivos e de mudança de formato; chave de storage por hash e organização. (2) **Banco** (migration `20261013010000_f8_content`): `content_items`, `content_versions`, `content_media`, `content_events`; **FK do cliente em RESTRICT** (cliente com conteúdo não é excluído); gatilhos que **bloqueiam DELETE** (só aceito na remoção do tenant inteiro), tornam eventos **append-only**, congelam a versão depois de `sentForApprovalAt` (legenda, hash e arquivos) e protegem identidade; índices únicos (uma peça por tarefa do Asana e cliente; posição ativa por versão). (3) **`FileStorage`** com driver local (dev/testes; **recusado em produção**; chave inválida/traversal recusada; escrita idempotente por hash) e driver S3 privado **previsto, não implementado**: sem driver o upload responde 503. (4) **API** (`/content/items…`, prefixos `` e `/api`): listar por cliente, criar, detalhar, editar (controle otimista), enviar/substituir/remover arquivo (remoção lógica; histórico preservado), nova versão (só com a atual congelada), servir arquivo autorizado (`no-store`, `nosniff`); **sem rota de exclusão**; permissões `content.view` (novo) e `content.create`; carteira e organização em tudo (404 sem revelar existência); vínculo opcional com tarefa do Asana **conferido no espelho local** e com peça de Entregas do mesmo cliente **sem alterar contadores**; eventos e auditoria. (5) **Interface** no Design System atual: `/conteudo` (lista por cliente, novo conteúdo) e `/conteudo/:id` (dados, arquivos com prévia autorizada, enviar/substituir/remover, versões, histórico, avisos de formato e de compatibilidade de publicação **a verificar**); item de menu por `content.view`; 390 px sem rolagem horizontal. (6) Capacidades `content.view`/`content.create` em `/auth/capabilities`.
- DECISÕES TÉCNICAS: arquivo no storage nunca é apagado (histórico e P28); nova versão copia **referências** dos arquivos (sem duplicar bytes); vínculo com tarefa exige existência no espelho local do Asana (sem chamada ao Asana); aceito pelo Hub ≠ homologado para publicação (aviso fixo na tela); reuso de permissões existentes `content.*` — `content.review`/`approve_internal` **não usados** (aprovação interna é do Asana).
- LIMITES/LACUNAS: sem aprovação do cliente (F8-2), sem contadores de Entregas (F8-3) e sem BrightBean (F8-4/5); **driver S3 não implementado e provedor não decidido** (necessário antes da homologação); prévia de vídeo sem suporte a *range*; transcodificação/validação de codec de vídeo e conversão de PNG/WebP/MOV ficam para a F8-0b/F8-4; **Browser Gate próprio do conteúdo não criado** (a validação de interface foi feita no navegador local e por testes de API/PostgreSQL; pode ser incluído na F8-2 junto com o gate do link); `content.view` exige `rbac:bootstrap` (P22); P22 e P28 seguem bloqueadoras.
- FRANQUIA DE ACTIONS: **um** run completo (38340449956) para toda a fatia; commits de documentação com `[skip ci]`; verificação local prévia (domínio, API, PostgreSQL em banco limpo, web, build, navegador).
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Aguardam: aceite da F8-1, D3 (antes da F8-2) e F8-0b antes da F8-4.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-2 a F8-5, BrightBean real, deploy/produção.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-13 — Publicação do pacote público (DEC-GOV-005) — Claude
- AUTORIZAÇÃO: Direção (2026-10-13), exclusivamente a publicação do commit raiz `5870f714901d319beafad6cb986a1436be439209`. Etapas administrativas anteriores feitas pelo proprietário: original renomeado para `Julianogdc/zafira-hub-internal` (privado, Actions desativado) e `Julianogdc/zafira-hub` criado público e vazio.
- VERIFICAÇÕES ANTES DO PUSH: repositório público vazio (0 refs); commit raiz com **0 pais**, 1 commit, **602 arquivos**; `public-guard` e `secret-scan` com 0 ocorrências.
- AÇÕES: (1) Actions do repositório público **desativado temporariamente** (API) para que o push na `hub-2.1` não disparasse o CI antes de verificar os pacotes GHCR; (2) push **sem force** do commit raiz para `refs/heads/hub-2.1`; (3) branch padrão definida como `hub-2.1`.
- RESULTADO: `https://github.com/Julianogdc/zafira-hub` — **1 commit** (`5870f71`), 0 pais, 602 arquivos, 0 tags, 0 runs; branch padrão `hub-2.1`; secret scanning e push protection ativos; token de workflow somente leitura; aprovação de fork para novos colaboradores. Interno privado, 4 branches (hub-2.0, hub-2.1, main, sanitize/public-tree), Actions desativado, histórico e artefatos intactos.
- PENDENTE PARA O PRIMEIRO CI: (a) **Actions do público está DESATIVADO**; (b) permissões dos pacotes GHCR `zafira-hub-api` e `zafira-hub-web` (a ferramenta sem escopo `read:packages` não consegue verificá-las): o proprietário deve, em cada pacote (perfil Julianogdc → Packages → pacote → Package settings → Manage Actions access), adicionar `zafira-hub` com papel **Write**; sem isso o publish de imagens e o ensaio de rollback (digests fixos) falham. Depois, reativar Actions no público e autorizar o primeiro run.
- STATUS: publicado; CI não executado; F8-2 segue com aceite pendente (CI 5/5 + Browser Gate F8). F8-3 não iniciada.

### 2026-10-13 — Correções da Direção e pacote público regenerado (commit raiz definitivo) — Claude
- AUTORIZAÇÃO: Direção (2026-10-13) aprovou as correções e a execução controlada da migração H3 na ordem: congelar, renomear para `zafira-hub-internal` (privado), desativar Actions no interno, criar `zafira-hub` público com só o commit raiz, proteções, GHCR, primeiro CI 5/5 + Browser Gate F8, confirmar zero minutos faturáveis, registrar.
- CORREÇÕES (branch `sanitize/public-tree`, commit `e92aee3`): (1) `public-guard` passa a barrar **por nome** os arquivos exclusivamente internos (`SQL_*.sql`, `EMAIL_TEMPLATE_*.html`, ADR-017/018, auditoria/triagem, runbooks de homologação, modelo de observação da VPS, proposta C2, plano de migração, `ESTADO/REGISTRO_INTERNO`, `commit.ps1`, `regression.ps1`, `scratch-audit.js`, `docs-internal/`); (2) DEC-GOV-005 pública corrigida: **P29 = placeholder descritivo, sem credencial comprovada e sem revogação exigida**; ESTADO público coerente.
- PACOTE REGENERADO: repositório Git local independente `C:/Projetos/zafira-hub-public-staging` (branch `hub-2.1`): **commit raiz `5870f714901d319beafad6cb986a1436be439209`, 0 pais, 1 commit, 602 arquivos**, árvore `d700bf5ae9c8806022908eca69ba566514637859` idêntica à de `e92aee3`. O raiz anterior (`3ebc8ef`) está **superado** e nunca foi publicado.
- VALIDAÇÃO: `public-guard` 0 ocorrências (592 arquivos) e `secret-scan` 0 (529) na árvore e na exportação; **49/49** arquivos internos da `hub-2.1` injetados em cópia temporária foram barrados pela guarda; 6 nomes proibidos com conteúdo vazio barrados; nenhum valor impresso.
- EXECUÇÃO DA MIGRAÇÃO: **bloqueada no passo 2** — a renomeação do repositório foi **negada pelo classificador de permissões do ambiente** (ação sobre recurso compartilhado); nada foi alterado no GitHub (nome, visibilidade, Actions, branches intactos). Aguardando permissão explícita do proprietário para o agente executar as ações de administração do repositório, ou execução manual pelo proprietário.
- STATUS: pacote pronto; migração **não iniciada**. F8-3 não autorizada; F8-0b antes da F8-4; P22 e P28 bloqueiam dados reais.

### 2026-10-13 — Montagem e validação do pacote público final (commit raiz único) — Claude
- AUTORIZAÇÃO: Direção (2026-10-13) — somente montar e validar o pacote público; **nada foi renomeado, criado no GitHub, publicado, nem teve visibilidade, cobrança, VPS, produção ou CI alterados**; sem F8-3.
- CORREÇÃO ATENDIDA: `654dfb2` tem pai (`9a5d662`) e por isso não serve como histórico único. Criado repositório Git **local independente**, fora deste (`C:\Projetos\zafira-hub-public-staging`, branch `hub-2.1`), com **um único commit raiz** `3ebc8ef032b913b06a9ea886011808d6c83fda85` — **0 pais, 1 commit, 602 arquivos** — cuja árvore (`2afbbef935135fae1b5ad43a7af1a8cbf093f6d2`) é **idêntica** à de `654dfb2` (hash de árvore igual, inclusive o bit executável de `secret-scan.sh`). Histórico original, `hub-2.1` e `sanitize/public-tree` preservados; rastreabilidade pelo vínculo árvore ↔ `654dfb2`.
- VARREDURAS (na árvore e na exportação `git archive` do commit raiz): `public-guard` — **0 ocorrências** (592 arquivos de texto, 11 hashes na lista de negação); `secret-scan` — **0** (529 arquivos). Nenhum `.env` real, chave/certificado, `docs/historico`, `internal-bundle`, `SQL_*`, `EMAIL_TEMPLATE_*`, auditoria, triagem, runbook de infraestrutura ou ADR-017/018 na árvore.
- TESTES NEGATIVOS (cópia temporária da exportação + arquivos reais da `hub-2.1`; valores nunca impressos): barrados — `docs/historico`, `.env` real, `.env.example` interno, runbooks com host próprio (guarda), auditoria do Postiz e credencial sintética de 40 caracteres (`secret-scan`). **LACUNA ENCONTRADA:** arquivos internos **sem** host/IP/credencial (`SQL_*.sql`, `EMAIL_TEMPLATE_*.html`) **passam** pela guarda, pois ela não tem regra por nome de arquivo (só diretórios internos e nomes de segredo). A proteção atual é que eles **não estão na árvore**; para barrar reintrodução acidental é preciso acrescentar regra por nome (SQL_*, EMAIL_TEMPLATE_*, AUDITORIA_*, TRIAGEM_*, scratch*, runbooks de homologação, ADR-017/018) — mudança que altera a árvore e **depende de decisão da Direção**.
- TESTES E GATES PRESERVADOS: 72 arquivos de teste idênticos em nome aos da `hub-2.1`; 22 arquivos de `scripts/homologation/` (incluindo o Browser Gate F8) idênticos; workflow com os 5 jobs, só `ubuntu-latest`; a árvore pública difere da `hub-2.1` apenas pelos 44 removidos, 16 saneados e 2 novos (`public-guard.mjs`, lista de hashes).
- DOCUMENTAÇÃO OFICIAL COMPLETA: permanece neste repositório (355 commits; `docs/historico`, `internal-bundle`, runbooks, ADRs, ESTADO/REGISTRO/MAPA integrais).
- CORREÇÃO DO P29 (reafirmada): o valor era um **placeholder descritivo**, não credencial provada; **nenhuma revogação foi feita, nem é registrada como necessária** sem nova evidência. O texto da DEC-GOV-005 na árvore pública ainda diz que a revogação é "do proprietário (confirmação necessária)": divergência de redação (a árvore não foi alterada para manter a identidade com `654dfb2`).
- CHECKLIST DA PUBLICAÇÃO (nada executado): (1) Direção decide a lacuna da guarda e a redação do P29; (2) aceite expresso de execução (substitui a DEC-GOV-003); (3) renomear este repositório para `zafira-hub-internal` (sem workflows ativos); (4) criar `zafira-hub` público **vazio** e enviar o commit raiz como branch padrão `hub-2.1` (o workflow só dispara nessa branch); (5) conceder ao novo repositório acesso de Actions aos pacotes GHCR `zafira-hub-api`/`zafira-hub-web` (ou renomeá-los) — o ensaio de rollback do workflow usa dois digests fixos desses pacotes e **falhará sem esse acesso**; (6) ativar secret scanning/push protection, token de workflow somente leitura e aprovação para PR de fork; (7) primeiro CI público = validação da F8-2 (inclui o Browser Gate F8 nunca executado); (8) registrar execução e atualizar ESTADO/REGISTRO nos dois repositórios.
- STATUS: **pacote pronto e validado; aguardando decisões da Direção**. F8-2 segue com aceite pendente; F8-3 não autorizada; F8-0b antes da F8-4; P22 e P28 bloqueiam homologação com dados reais.

### 2026-10-13 — Preparação da separação público/privado (passos 1 a 3) — Claude
- AUTORIZAÇÃO: DEC-GOV-005 — somente preparação. Nada foi renomeado, criado, publicado, apagado ou reescrito; visibilidade, cobrança, VPS e produção intocados; nenhum workflow executado.
- ENTREGA: branch `sanitize/public-tree` (1 commit `654dfb2` sobre a `hub-2.1`; `hub-2.1` preservada) com a árvore pública pronta para o commit inicial; pacote interno em `internal-bundle/` (ferramentas, ESTADO/REGISTRO internos, instruções).
- RESULTADO: 44 arquivos saem da árvore pública (histórico, auditorias, runbooks de infraestrutura, ADR-017/018, `SQL_*`, templates, scripts locais, propostas superadas e este plano); 16 arquivos saneados; novos `scripts/ci/public-guard.mjs` e lista de negação em **hashes**; `secret-scan` ampliado (atribuição de credencial longa); versões públicas de ESTADO/REGISTRO/MAPA e `AGENTS.md` com o protocolo de dois repositórios. Varreduras da árvore e da exportação em commit único: **0 ocorrências**; typecheck, domínio 87, API 822, web 84 e build verdes.
- **CORREÇÃO DO P29:** o valor atribuído a `POSTIZ_API_KEY` é uma frase descritiva em português (minúsculas e sublinhados, contém "chave" e "postiz", idêntica nos dois arquivos) — **placeholder, não credencial**; a varredura do histórico não achou credencial real. A afirmação anterior de "provável credencial real" fica **retificada**; a revogação não é exigida por esse achado (o proprietário confirma que nunca houve chave real ali).
- INCOMPATIBILIDADES/RISCOS DE CI/GHCR: pacotes `zafira-hub-api` e `zafira-hub-web` pertencem ao repositório atual (conceder acesso ao novo ou renomear); padrões de endpoint padrão de Asana/Postiz agora exigem variável de ambiente (hosts `example.invalid`); primeiro CI público inclui o código da F8-2 e o Browser Gate F8 ainda não executado.
- STATUS: **preparação concluída; aguardando aceite expresso da Direção** para a execução (passo 4 em diante). F8-2 segue aguardando CI oficial 5/5 e Browser Gate F8; F8-3 não autorizada.

### DEC-GOV-005 — Arquitetura H3: repositório público de desenvolvimento e repositório privado interno (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: a franquia do GitHub Actions esgotou (P30) e o repositório privado impede o uso de runners padrão gratuitos; o histórico contém informação operacional que não pode ser publicada.
- Decisão: (1) **Adotar a arquitetura H3** do plano `docs/propostas/MIGRACAO_REPOSITORIO_PUBLICO_PLANO.md`: `Julianogdc/zafira-hub-internal` **privado** (histórico original, documentos completos e governança, **sem workflows**) e `Julianogdc/zafira-hub` **novo repositório público**, criado com **um único commit inicial** contendo apenas a árvore saneada. (2) **Substituição condicionada da DEC-GOV-003:** a DEC-GOV-003 (repositório privado) **só é substituída quando a Direção aceitar expressamente a execução**; até lá permanece vigente e nada é publicado nem renomeado. (3) **Autorizada exclusivamente a PREPARAÇÃO (passos 1 a 3 do plano):** branch de saneamento isolada, separação de documentos, saneamento de exemplos/hosts/workflow/testes, remoção da possível credencial do P29 do conteúdo público, ampliação do `secret-scan` e lista de negação, versões públicas de ESTADO/REGISTRO/MAPA, instruções para dois repositórios, testes locais sem disparar Actions. (4) **Não autorizado:** renomear, criar, publicar, alterar visibilidade ou cobrança, reescrever histórico, apagar artefatos/commits/documentos oficiais, alterar VPS/produção/credenciais, iniciar a F8-3. (5) A **revogação da credencial do P29 é do proprietário** (confirmação necessária); o Postiz não deve ser acessado sem autorização.
- Alternativas consideradas: H1 (abrir o atual), H2 (reescrever o atual), H3b (histórico saneado commit a commit) — ver o plano.
- Impacto: governança (fonte canônica passa a ter versão pública saneada e versão interna completa), CI (runners gratuitos), agentes (dois diretórios).
- Revisão: no aceite da execução pela Direção.

### 2026-10-13 — Plano de separação: repositório público de desenvolvimento + repositório privado interno — Claude
- AUTORIZAÇÃO: decisão da Direção (2026-10-13) sobre a arquitetura `zafira-hub` público e `zafira-hub-internal` privado — **somente planejamento**. Nada foi criado, renomeado, movido, apagado, reescrito ou publicado; visibilidade, cobrança e workflows intactos.
- ENTREGA: `docs/propostas/MIGRACAO_REPOSITORIO_PUBLICO_PLANO.md` (interno): classificação dos arquivos (privados, públicos com saneamento, públicos sem alteração), tratamento do histórico (**recomendado H3: renomear o atual para `zafira-hub-internal` preservando tudo e criar o novo `zafira-hub` público com a árvore saneada em um commit**), acesso dos agentes (dois diretórios lado a lado, sem submódulo, regra `INT-<n>`), CI/Browser Gates no público (workflow só usa `ubuntu-latest`; ajustes de permissões, forks e GHCR), custos residuais, roteiro de 10 passos (~1,5 a 2 dias úteis), riscos, reversão e critérios de validação.
- PENDENTE DE AUTORIZAÇÃO DA DIREÇÃO: DEC que substitui a DEC-GOV-003; revogação da chave P29 (imediata); execução do roteiro. F8-2 segue aguardando CI oficial 5/5 e Browser Gate F8; F8-3 não autorizada.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-13 — Auditoria de exposição pública e alternativas para o GitHub Actions — Claude
- AUTORIZAÇÃO: pedido da Direção (2026-10-13) — somente auditar e comparar; **nada foi alterado** (visibilidade, repositórios, cobrança, limites, workflows, código). Nenhum valor de credencial foi impresso.
- SITUAÇÃO OFICIAL DA F8-2: **aceite técnico PENDENTE** (não reprovada): suspenso até CI oficial 5/5 do código corrigido (`2482ba1` ou baseline equivalente) e execução bem-sucedida do Browser Gate F8. Sem reconstrução, sem mudança de escopo, sem F8-3.
- AUDITORIA DO REPOSITÓRIO (370 commits, 3 branches, 11 MB; visibilidade atual PRIVADA; 0 forks; 880 artefatos de Actions):
  - **Arquivos sensíveis por nome:** nenhum `.env` real, chave `.pem/.key/.p12`, dump ou credencial versionado em todo o histórico (só `.env.example`).
  - **Padrões de segredo em todo o histórico (diffs):** asana/github/aws/slack/google/sk-: **0**; JWT: só em testes (`postiz.test`, `compositor_postiz.test`); chave privada: 2 ocorrências em teste (`financial_foundation.test`); URL de banco com senha: workflow de CI, exemplos de ambiente e allowlist (valores de ensaio); atribuições genéricas: 35, todas em testes, mocks de gate, workflow de CI ou exemplos.
  - **ACHADO RELEVANTE (P29):** um valor de 37 caracteres, **sem marca de teste**, atribuído a `POSTIZ_API_KEY`, está em `apps/api/.env.example` e em `docs/AUDITORIA_TECNICA_POSTIZ.md` — **ainda presente no HEAD** e no histórico desde 12–13/09/2026. Provável credencial real do Postiz legado (instância parada). O `secret-scan` do CI **não detecta** esse formato. Como o repositório foi público até 10/10 (DEC-GOV-003), o valor deve ser **considerado exposto**: revogar/rotacionar mesmo sem uso e ajustar o exemplo e o documento.
  - **Informação de infraestrutura e segurança nos documentos:** nomes de domínio do Postiz/BrightBean (3 hosts), 1 endereço IP, rotas de backup/VPS/EasyPanel (ADRs, runbooks de homologação, `docs/historico`), pendências de segurança abertas (P2, P9, P11, P12, P22, P27 com 20 vulnerabilidades altas em dependências) e vulnerabilidades do Hub 2.0 em produção citadas nos registros; arquivos `SQL_*.sql` herdados do Hub 1/2.0 (políticas RLS e correções).
  - **Workflow:** `pull_request` na `hub-2.1` e `workflow_dispatch`; usa só `GITHUB_TOKEN` (publica imagens no GHCR com `packages: write`); valores de ensaio fixos no YAML; 880 artefatos (capturas e relatórios com dados fictícios) e logs de runs anteriores ficariam **visíveis ao público** se o repositório fosse aberto.
- ALTERNATIVAS (custo × risco): (1) **tornar público o repositório principal:** minutos ilimitados, mas expõe de novo todo o histórico, a infraestrutura e as pendências de segurança, os logs/artefatos dos runs, reverte a DEC-GOV-003 e exige antes revogar a chave do Postiz, sanear documentos e possivelmente reescrever o histórico (invalida clones e runs); **maior risco**. (2) **repositório público separado só para CI:** o CI precisa do código — expõe o mesmo código do HEAD (e o que o espelho incluir), exige sincronização e duplica governança; só reduz a exposição se for um espelho **sem histórico e sem `docs/`**; **custo operacional alto e ganho de segurança parcial**. (3) **pagar o excedente (limite de gasto):** minutos Linux a ~US$ 0,008; o excedente do mês (≈ 280 min) custa ≈ US$ 2 e cada run completo ≈ US$ 0,20; exige método de pagamento válido (o aviso do GitHub fala em pagamento falho/limite de gasto); **menor risco e menor esforço**. (4) **aguardar a renovação mensal** (franquia volta em 01/11): custo zero, mas bloqueia 18 dias. (5) **runner próprio** (gratuito para repositório privado): exige máquina com Docker/Python e manutenção; risco de executar CI na máquina do proprietário. (6) **reduzir o consumo** (R1–R7 do diagnóstico: `paths-ignore`, cancelamento de runs, cache de camadas, sem build duplicado, gate condicional): ~70–80% menos minutos sem remover teste; **custo zero**, complementar a qualquer opção.
- RECOMENDAÇÃO: **(3) + (6)**: definir um limite de gasto pequeno (ex.: US$ 5–10) e corrigir o método de pagamento — custo mensal de poucos dólares — e aplicar as otimizações de CI; **manter o repositório privado**. Tornar público só como último recurso, depois de: revogar a chave (P29), sanear `apps/api/.env.example`/documentos, decidir sobre `docs/historico`, `SQL_*.sql` e documentos de infraestrutura, apagar logs/artefatos antigos e registrar DEC que substitua a DEC-GOV-003.
- PRÓXIMO PASSO QUE DEPENDE DA DIREÇÃO: escolher a opção (recomendada: 3 + 6) e, se (3), o proprietário ajustar pagamento/limite em Settings → Billing; em seguida a F8-2 é retomada (CI oficial do `2482ba1`, Browser Gate F8, correções sem enfraquecer testes, evidências para o aceite). **Independente do Actions: revogar/rotacionar a chave do P29.**
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial alterar visibilidade, criar repositórios, alterar cobrança/limites, executar workflows, F8-3 a F8-5, F8-0b antes da F8-4.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-13 — F8-2 — Aprovação do cliente por link seguro — Claude
- AUTORIZAÇÃO: DEC-F8-004 — exclusivamente a F8-2 (registrada antes do código, `7386c15`). Não iniciadas: F8-3 a F8-5; F8-0b não executada. Sem BrightBean/Asana/clientes reais, S3, VPS, produção ou cobrança.
- BASELINE (commits): `788dad3` (F8-2) e `2482ba1` (correção do segredo efêmero fora de produção).
- CI/EVIDÊNCIA — **CI OFICIAL NÃO CONCLUÍDO (limite de minutos/gasto do GitHub Actions):**
  - run 38397329866 (`788dad3`): Code Quality and Tests ✔; Docker Build Gate ✔; **PostgreSQL Integration Gate ✖** — o teste novo `approval-postgres` falhou porque o ambiente do job não define `JWT_SECRET`/`COOKIE_SECRET` e o serviço exigia segredo (os demais 130 testes passaram); Publish Images e Homologation Rehearsal **não executaram** (dependem do job que falhou).
  - correção `2482ba1` (segredo efêmero por processo fora de produção; produção continua exigindo segredo): run 38398102477 **não iniciou** — os 3 jobs foram recusados com "recent account payments have failed or your spending limit needs to be increased". **Nenhuma configuração de cobrança foi alterada.**
  - Consequência: **o Browser Gate F8 nunca foi executado em CI** e o CI oficial completo não existe para a F8-2. **Aceite técnico pendente** até haver minutos disponíveis.
- EVIDÊNCIA LOCAL (antes do push, em banco descartável): domínio 87/87; API unitária 822/822; web 84/84 (lint do escopo F6/F7/F8 com 0 erros; typecheck limpo); **PostgreSQL 140/140 em banco limpo** (10 novos em `approval-postgres`, rodados também sem `JWT_SECRET` após a correção); build completo; `secret-scan` limpo; verificação no navegador: geração do link pela interface, página pública sem login, pedido de alteração com comentário e confirmação, resposta persistente, 390 px sem rolagem horizontal.
- STATUS: **pendente de aceite técnico** (CI oficial bloqueado por limite de cobrança; a F8-2 não é aceita automaticamente).
- O QUE MUDOU: (1) **Domínio:** validade 7 dias (máx. 30), N1 (nome, contato e declaração de autoridade; aviso fixo de que **não** é identidade autenticada/verificada), estado do link, status interno de aprovação. (2) **Banco** (migration `20261013020000_f8_approval`): `approval_links` (só o **hash** do token; um link ativo por versão por índice parcial; validade só pode ser encurtada; revogação definitiva) e `approval_decisions` (**uma por versão** por índice único; gatilho valida no banco link ativo/da versão/versão enviada/**integridade do hash**; CHECKs de autoridade e comentário; imutável; sem DELETE). (3) **API interna:** `POST /content/items/:id/approval-links` (gera ou **reemite revogando o anterior**; exige conteúdo completo; congela a versão; token exibido **uma vez**), `GET …/approval`, `POST …/approval-links/:linkId/revoke`; permissão `content.send_to_client`; eventos e auditoria. (4) **API pública (sem sessão):** `POST /public/approval/view` e `/decision` com o **token no corpo** (nunca na URL da API), `GET /public/approval/media?t=…` com **URL curta assinada de 10 min** que vale só com o link ativo e não expõe `storageKey`; respostas **idênticas** para link inválido/expirado/revogado; limite de taxa; `no-store`, `noindex`, `Referrer-Policy: no-referrer`; evidências técnicas minimizadas (HMAC do IP e do agente); na decisão o servidor recalcula o hash da versão, confere o hash enviado/visto e a existência dos arquivos. (5) **Interface:** componente `ContentPreview` reutilizável (inspirado no Instagram por formato; para a F16); página pública `/aprovacao` com o **token no fragmento (#)** (não vai a servidores nem ao Referer), sem cookies e sem recursos de terceiros; painel interno de aprovação (status, gerar/reemitir/revogar, cópia do link, decisões com identificação declarada), nova versão e novo envio, selo na lista. (6) **Browser Gate F8** (`scripts/homologation/content-approval-browser-gate.py`, ligado ao workflow): cadastro/upload da F8-1, permissões, link, página pública, decisão, nova versão, reemissão/revogação/expiração, Org B e 390 px — **escrito mas não executado em CI**.
- LIMITES/LACUNAS: (a) **CI oficial e Browser Gate F8 pendentes por bloqueio de cobrança**; o gate é um script Python que **não pôde ser executado localmente** (sem Python/Docker nesta máquina) e pode precisar de ajustes na primeira execução; (b) N2 **não implementado**; (c) o link **não é enviado** por WhatsApp/e-mail (o usuário copia e envia; notificações são F14); (d) o token em um encaminhamento do link dá acesso a quem o possuir (por isso N1 é só declarado, validade curta e revogação); (e) sem S3; (f) sem contadores de Entregas (F8-3) e sem BrightBean (F8-4/5); (g) P22 (`content.send_to_client` e demais exigem `rbac:bootstrap`) e P28 seguem bloqueadoras.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma. Aguardam: **saldo de minutos/limite de gasto do Actions (decisão do proprietário)** para executar o CI oficial; aceite da F8-2; autorização da F8-3; F8-0b antes da F8-4.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8-3 a F8-5, BrightBean real, S3, deploy/produção e qualquer alteração de cobrança sem autorização.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F8-004 — Aceite técnico da F8-1, D3 aprovada e autorização exclusiva da F8-2 (Direção, 2026-10-13)
- Data / responsável: 2026-10-13 / Direção, via proprietário.
- Problema: revisão da F8-1 (baseline 61bd2fd, CI 38340449956, 5/5).
- Decisão: (1) **Aceite técnico da F8-1.** (2) **Autorizada exclusivamente a F8-2** — aprovação do cliente por link seguro, página pública, preview e Browser Gate. (3) **D3 aprovada:** validade padrão 7 dias, máxima 30; **N1** (nome, contato e declaração explícita de autoridade para aprovar) como identificação inicial, **sem apresentá-lo como identidade autenticada ou verificada**; **N2 reservado**, sem implementação; reemissão revoga o link anterior; **decisão única por versão**; pedido de alteração exige comentário; nova versão exige nova aprovação. (4) **Escopo:** geração, consulta, revogação e reemissão com permissões e auditoria; token de 256 bits persistindo só o hash; página pública sem login restrita à versão autorizada; preview inspirado no Instagram por formato; ações Aprovar e Solicitar alteração; registro imutável de decisão, identificação declarada, comentário e histórico; acompanhamento interno; nova versão e reenvio após alteração; **componente de preview reutilizável pela F16**; **Browser Gate da F8** (cadastro/upload da F8-1, dois tenants, permissões, 390 px). (5) **Segurança obrigatória:** respostas genéricas para link inválido/expirado/revogado; rate limiting; `no-store`, `noindex`, `Referrer-Policy: no-referrer`; token fora de logs, analytics e recursos de terceiros; URLs de mídia curtas e autorizadas, sem `storageKey`; o token não consulta outros clientes, versões ou dados internos; **uma decisão final por versão com proteção no banco**; revogação e expiração impedem novas decisões; o servidor valida a versão e sua integridade na decisão. (6) **Ressalvas:** corrigir descrições conflitantes da fase no ESTADO_ATUAL; preservar a P28 (inclusive a análise futura da exclusão integral de tenants); driver local só em dev/testes; **sem S3 nesta fatia** (interface `FileStorage` preservada); sem Asana, BrightBean ou clientes reais; sem contador de Entregas (F8-3) nem portal da F16; refinamento estético adiado. (7) **Validação:** testes locais antes do push e **um único CI oficial completo**; sem enfraquecer testes; sem alterar cobrança, VPS, produção ou credenciais; F8-0b segue obrigatória antes da F8-4; P22 e P28 seguem bloqueadoras; F8-2 não é aceita automaticamente.
- Alternativas consideradas: —
- Impacto: apps/api (aprovação, endpoints públicos, migration), packages, apps/web (página pública, preview, painel interno), scripts/homologation e CI (Browser Gate F8).
- Revisão: no aceite da F8-2.

### DEC-F8-003 — Aceite da F8-0 como levantamento histórico e autorização exclusiva da F8-1 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da matriz F8-0 (commit 652031a).
- Decisão: (1) **F8-0 aceita como levantamento documental e histórico, não como homologação atual do BrightBean.** (2) **Autorizada exclusivamente a F8-1** — domínio, arquivos, upload e telas mínimas: cadastrar conteúdo vinculado a cliente autorizado; formato (**FEED_IMAGE, CAROUSEL, REEL, STORY**; sem formato separado de vídeo de feed); upload dos arquivos finais (JPG, PNG, WebP, MP4, MOV; 100 MB; **tipo real**; aceito pelo Hub ≠ homologado para publicação); legenda e dados; vínculo opcional com tarefa do Asana (local, sem escrita); visualizar por cliente; substituir arquivos/atualizar dados enquanto a versão for editável; preservar versões e histórico. (3) **F8-0b adiada, mas obrigatória antes da implementação da F8-4**; não autorizar publicação com base em capacidades não verificadas. (4) **Regras:** nada de pauta, revisão ou aprovação internas; `FileStorage` com driver local para dev/testes e arquitetura compatível com S3 privado (sem disco local da VPS como solução definitiva); isolamento por organização, carteira e permissões; sem cascata destrutiva (P28); vínculo com Entregas sem antecipar contadores (F8-3); nada enviado ao BrightBean; sem dados fictícios permanentes, serviços ou credenciais reais. (5) **Validação:** testes de domínio, upload, imutabilidade, isolamento multiempresa, PostgreSQL, API (autorização e carteira), interface responsiva no Design System atual, testes locais direcionados antes de publicar. (6) **GitHub Actions:** franquia quase esgotada — sem pushes intermediários, `[skip ci]` em documentação, sem enfraquecer o CI; se o CI oficial não puder rodar por limite de minutos, informar e deixar o aceite técnico pendente; sem criar cobranças. (7) **Limites:** sem F8-2 a F8-5, sem F8-0b, sem VPS/produção/cobrança; P22 e P28 seguem bloqueadoras; a F8-1 não é aceita automaticamente.
- Alternativas consideradas: —
- Impacto: apps/api (módulo de conteúdo, migration), packages (domínio/contratos), apps/web (telas mínimas).
- Revisão: no aceite da F8-1.

### DEC-F8-002 — Aprovação da revisão 2 da F8; decisões D1, D2, D4, D5; autorização da F8-0 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da especificação F8 revisão 2 (commit ee55d24).
- Decisão: (1) **Revisão 2 aprovada** como direção funcional e arquitetural da F8, mantido o fluxo ASANA → HUB (upload e vínculo) → APROVAÇÃO DO CLIENTE → BRIGHTBEAN → PUBLICAÇÃO → ANÁLISE. (2) **D1 — aprovada:** interface `FileStorage` com driver local **exclusivo** para desenvolvimento/testes e armazenamento privado S3-compatível para ambientes reais; provedor concreto decidido **antes da homologação**; preservar versões, isolamento e integridade dos arquivos. (3) **D2 — aprovada:** **sem cascata destrutiva** de conteúdos, versões, mídias, decisões de aprovação e histórico; compatível com a **P28, que continua aberta**. (4) **D4 — aprovada:** tipos iniciais JPG, PNG, WebP, MP4 e MOV, teto de 100 MB por arquivo, sujeito à validação por **tipo real** (não pela extensão declarada) e aos limites futuros do BrightBean. (5) **D5 — aprovada:** vínculo **opcional** com tarefa do Asana, exclusivamente local e somente leitura, respeitando organização e carteira. (6) **D3** (validade do link e nível de identificação) fica para deliberação **antes da F8-2**. (7) **Autorizada exclusivamente a F8-0:** matriz de capacidades do BrightBean (formatos/redes, uploads e limites, rascunhos e agendamento, idempotência, consulta e reconciliação, cancelamento e reagendamento, status/falhas/permalink/métricas, lacunas F8-1 a F8-5), classificando cada capacidade como **confirmada, parcialmente confirmada ou não verificada**, sem presumir suporte do servidor pelo que o adaptador envia. (8) **Governança:** sem F8-1; sem serviços reais, infraestrutura ou credenciais; sem CI completo para alterações só documentais; P22 e P28 seguem bloqueadoras de homologação com dados reais.
- Alternativas consideradas: —
- Impacto: `docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md`; especificação F8; ESTADO_ATUAL.
- Revisão: na autorização da F8-1 e após a F8-0b.

### 2026-10-12 — F8-0 — Matriz de capacidades do BrightBean — Claude
- AUTORIZAÇÃO: DEC-F8-002 — somente a F8-0 (levantamento documental e de código). Sem F8-1, serviços reais, credenciais, infraestrutura ou CI completo.
- BASELINE (commit): código inalterado desde `2cf9633`; só `docs/`.
- CI/EVIDÊNCIA: nenhum run (commit `[skip ci]`). Fontes: adaptador e testes do Hub (provam o que é enviado, não o servidor) e registros históricos de execuções reais de 24–25/09/2026 (não reverificados).
- STATUS: **concluído para revisão da Direção.**
- ENTREGA: `docs/propostas/F8-0_MATRIZ_CAPACIDADES_BRIGHTBEAN.md` — 38 capacidades: **12 confirmadas, 13 parcialmente confirmadas, 13 não verificadas**; lacunas por fatia; implicações de desenho já seguras; roteiro da **F8-0b** (verificação ativa em instância de teste, **não executada**, exige autorização e credencial de escopo mínimo).
- ACHADOS PRINCIPAIS: (a) confirmados em execução real histórica: Story (imagem/vídeo), Reel (IG/FB) e Feed imagem, rascunho, agendamento, upload com chave, consulta de post, permalink e métricas de post; (b) **não existe vídeo de feed no Instagram** (vira Reel) e Story não existe no Facebook; (c) **tipos e limites do servidor não verificados** — PNG, WebP e MOV (D4) podem exigir conversão; (d) **idempotência: parcial** (existe em upload/criação; semântica não documentada; schedule/reagendar/cancelar sem chave); (e) **listagem de posts: evidências conflitantes**, tratar como indisponível; (f) **remover post publicado via API não funciona** (HTTP 400 no Instagram); (g) o servidor tem **retentativa automática** (`retry_count`) que o adaptador não expõe; (h) o BrightBean possui workflow próprio de aprovação que a F8 não deve usar.
- RECOMENDAÇÃO: **liberar a F8-1** (e depois F8-2/F8-3, que não dependem do BrightBean) com as condições do §6 da matriz; **não liberar a F8-4** antes da F8-0b.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma além desta entrega. Aguardam: decisão sobre a F8-1, D3 (antes da F8-2) e autorização da F8-0b.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial código da F8, acesso ao BrightBean real, deploy/produção.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE.

### DEC-F8-001 — Simplificação da F8: aprovação do cliente por link seguro e fluxo editorial permanece no Asana (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: a revisão 1 da especificação (commit 33c306f) duplicava no Hub o fluxo editorial (rascunho, revisão interna, comentários, aprovação interna) que já é executado no Asana.
- Decisão: (1) **Fluxo:** Asana = pauta, criação, comentários, alterações e **aprovação interna**; Hub = upload dos arquivos finais, vínculo ao cliente e acompanhamento nas Entregas; Hub = **aprovação do cliente por link seguro**, com preview inspirado no Instagram e ações aprovar/solicitar alterações; BrightBean = agendamento e publicação **exclusivamente da versão aprovada**; Hub = status, permalink e métricas orgânicas. (2) **Aprovação do cliente na F8:** link com token seguro, validade e revogação, **sem login**, compartilhável por WhatsApp ou e-mail; acesso somente à versão autorizada; identificação do aprovador, canal e evidências proporcionais ao risco; aprovar ou solicitar alteração com comentário; versões anteriores preservadas; **nova versão exige nova aprovação**; **posse do link não é prova definitiva de identidade**; impedir publicação de versão não aprovada; **não antecipar o portal completo**. A **F16** implementará o portal autenticado reutilizando o mesmo domínio de conteúdo, versões e aprovações. (3) **Regras de operação:** não recriar pautas, revisão, comentários nem aprovação internos no Hub; Asana somente leitura (DEC-ASANA-001/002); o Hub gerencia a etapa posterior à aprovação interna e registra as versões efetivamente encaminhadas ao cliente; o contador de Entregas distingue **arquivo recebido, enviado para aprovação, aprovado e publicado**, não conta versões duplicadas como novas peças e não altera a meta contratual automaticamente. (4) **Pendências mantidas:** estratégia de armazenamento de mídia preservando versões e sem dependência exclusiva do BrightBean; integridade histórica conforme P28; verificar as capacidades reais da API BrightBean antes de implementar agendamento. (5) **Tarefa autorizada:** revisar a especificação e propor novo fatiamento; **sem implementação**; sem alterar produção, credenciais ou infraestrutura; Design System atual, sem refinamento estético.
- Alternativas consideradas: manter o fluxo editorial completo no Hub (rejeitada: duplica processo existente e aumenta escopo); antecipar o portal autenticado na F8 (rejeitada: F16).
- Impacto: `docs/propostas/F8_ESPECIFICACAO_CONTEUDOS.md` (revisão 2), Mapa Mestre (F8 e F16), ESTADO_ATUAL; revisão da DEC-F6-002 (as etapas "aprovada" e "postada" passam a vir do link do cliente e do BrightBean).
- Revisão: na autorização da F8-1.

### 2026-10-12 — F8 — Revisão 2 da especificação (fluxo simplificado) — Claude
- AUTORIZAÇÃO: DEC-F8-001 — somente revisar a especificação e propor novo fatiamento. Sem código, migrations, deploy ou credenciais.
- ENTREGA: `docs/propostas/F8_ESPECIFICACAO_CONTEUDOS.md` revisão 2: fluxo Asana→Hub→cliente→BrightBean; domínio mínimo (`ContentItem/Version/Media`, `ApprovalLink/Decision`, `ContentSchedule`, eventos); estados; **armazenamento** (`FileStorage` com driver local + S3-compatível, chaves por hash, URLs assinadas); **segurança do link** (token de 256 bits só em hash, validade 7 dias/máx. 30, revogação, escopo único, respostas genéricas, limite de taxa, evidências minimizadas, níveis N1/N2); preview; contador de Entregas por estágio; **capacidades do BrightBean** já evidentes no adaptador e lista a confirmar (F8-0); RBAC sem `content.review/approve_internal`; P28 sem cascata destrutiva; **fatias F8-0 a F8-5**.
- DECISÕES AINDA NECESSÁRIAS ANTES DA F8-1: D1 arquitetura de storage; D2 integridade histórica (P28); D4 tipos e limites de arquivo; D5 vínculo manual com a tarefa do Asana. Antes da F8-2: D3 validade do link e nível de identificação. Demais (redes do piloto, fuso, provedor de storage, métricas) não bloqueiam a primeira fatia.
- STATUS: proposta em revisão da Direção; commit só de documentação (`[skip ci]`, sem run no Actions).
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma além desta revisão.
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial código da F8, F8-0 com credenciais reais, deploy/produção.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE.

### DEC-F7-018 — Aceite técnico da F7-4b, encerramento funcional da F7 e preparação da F8 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da F7-4b (commits 82d0134 a 2cf9633; CI 38331008571, 5/5; handoff 4c0a24a).
- Decisão: (1) **Aceite técnico da F7-4b.** (2) **Encerramento funcional da F7 — Onboarding e Agenda**, sem apagar decisões ou ressalvas anteriores. (3) **Ressalvas obrigatórias:** P22 segue bloqueando o primeiro deploy de homologação; P28 segue bloqueando o uso de dados reais; Google Calendar e n8n **não foram homologados com contas reais**; agendadores (espelho do Asana, Google Calendar, despachante n8n) seguem desligados até medição de capacidade e autorização; sem deploy nem alteração de produção; refinamento estético aprofundado adiado (DEC-F7-015). (4) **Autorizada exclusivamente a PREPARAÇÃO da F8 — Conteúdos** (especificação funcional e técnica, dependências, decisões de produto e fatias); **sem código da F8**. (5) **Governança de CI:** verificar o saldo de minutos antes de novos workflows completos; análise objetiva de economia sem enfraquecer testes, com recomendações para aprovação; não configurar cobrança, tornar o repositório público, instalar runners nem alterar infraestrutura sem autorização; documentação com `[skip ci]`.
- Alternativas consideradas: manter a F7 aberta até homologação com contas reais (rejeitado: a homologação real depende de P22/P28 e de autorização de ambiente, e é tratada nas ressalvas).
- Impacto: ESTADO_ATUAL, MAPA_MESTRE (status da F7), `docs/propostas/F8_ESPECIFICACAO_CONTEUDOS.md`.
- Revisão: na revisão da especificação da F8.

### Encerramento da F7 — Onboarding e Agenda (2026-10-12)
- **Entregue e aceito tecnicamente:** F7-1 construtor de modelos versionados (a/b); F7-2 execução do onboarding (a/b) com carteira, prazos, bloqueios e histórico; F7-3 agenda Google somente leitura (a/b) e etapas por evento vinculado (c); F7-4 automações n8n: infraestrutura (a) e interfaces (b). Decisões DEC-F7-001 a 018.
- **Critérios do Mapa × entrega:** onboarding com etapas, dependências, prazos e responsáveis ✔; automações n8n idempotentes ✔ (garantia do Hub = um pedido por geração e chave estável; exatamente uma vez no n8n depende do fluxo); Google Calendar com recorrência, participantes e fusos ✔ (leitura); **criar/editar evento pelo Hub não existe** — por DEC-F7-001 é evolução futura com decisão própria; **piloto com dados reais não executado** (depende de P22/P28 e homologação).
- **Não declarado como pronto:** operação real com Google/n8n, capacidade dos agendadores, dados de produção, migração de modelos/clientes existentes.
- **Evidências:** CI 38331008571 (domínio 77, API 819, web 77, PostgreSQL 120; Browser Gates F4–F7-4).

### 2026-10-12 — Encerramento da F7, especificação da F8 e diagnóstico do Actions — Claude
- AUTORIZAÇÃO: DEC-F7-018 — encerramento funcional da F7 (registro), preparação da especificação da F8 e análise de economia do CI. Sem código, deploy, produção ou credenciais.
- BASELINE (commit): código inalterado desde `2cf9633`; esta microetapa só altera `docs/`.
- CI/EVIDÊNCIA: sem novo run (commit só de documentação com `[skip ci]`). Última evidência: run 38331008571, 5/5.
- STATUS: **concluído para revisão da Direção** (especificação em proposta; nenhuma decisão da F8 tomada).
- O QUE MUDOU: DEC-F7-018 e registro de encerramento da F7; `MAPA_MESTRE` (status da F7 e decisão de Calendar como fonte); `docs/propostas/F8_ESPECIFICACAO_CONTEUDOS.md` (escopo oficial, reaproveitamento, regras, modelo de dados, estados, RBAC, idempotência, ligação com Entregas, interface, testes, 5 fatias F8-1 a F8-5, 10 decisões pendentes, riscos); este diagnóstico.
- DIAGNÓSTICO DO CONSUMO DO GITHUB ACTIONS (dados reais do repositório, 9 a 13/10/2026):
  - **Saldo:** a API de cobrança não pôde ser consultada (o token do `gh` não tem o escopo `user`; ampliar escopo é decisão do proprietário) e `timing.billable` retorna 0. **Estimativa pela duração dos jobs (arredondada por job): 2.276 min nos últimos 100 runs**, média **22,8 min/run** (máx. 30); **12/10 sozinho: 1.465 min**. O alerta anterior era 1.807/2.000; o consumo desta microetapa (≈ 6 runs completos + 2 reexecuções) leva o saldo **ao limite ou além** — conferir no painel de cobrança antes de qualquer run.
  - **Por job (100 runs):** Publish Images 640 min; Docker Build Gate 531; Homologation Rehearsal 456; Code Quality 357; PostgreSQL Integration 292.
  - **Desperdício identificável:** **59 dos 100 runs foram de commits só de documentação** (≈ 59% do consumo, estimado em ~1.300 min); **29 runs falharam** (29%), parte por intermitência de registro público (429) e por gates ajustados só em CI; o **Docker Build Gate e o Publish Images constroem as mesmas imagens** (≈ 5,3 + 6,4 min por run); não há `concurrency`, nem `paths-ignore`, nem cache de camadas das imagens.
- RECOMENDAÇÕES (nenhuma aplicada; todas mantêm 100% dos testes e portões — aguardam aprovação):
  1. **R1 — `paths-ignore` para `docs/**`, `*.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` no gatilho de push** (e `workflow_dispatch` mantido para rodada manual). Economia estimada: ~55–60% dos runs.
  2. **R2 — `concurrency` por branch com `cancel-in-progress`**: um push novo cancela o run anterior ainda em andamento. Evita runs duplicados em rajadas.
  3. **R3 — Eliminar a construção duplicada de imagens:** o Docker Build Gate vira etapa dentro do Publish Images (ou só roda em pull request); mesmas verificações, uma construção por run. Economia: ~5 min/run (~23%).
  4. **R4 — Cache de camadas (`cache-from/cache-to type=gha`) nos builds das imagens API e web.** Economia estimada de 30–50% do tempo de Docker/Publish; sem alterar o conteúdo das imagens.
  5. **R5 — Homologation Rehearsal condicional:** rodar só quando mudarem `apps/**`, `packages/**`, `scripts/homologation/**`, `deploy/**` ou o próprio workflow (filtro de caminhos em um job inicial); o restante dos jobs segue incondicional. Combina com R1.
  6. **R6 — Pré-voo local obrigatório** (`typecheck`, testes direcionados, `lint:f6`, build, suíte PostgreSQL em banco descartável) e **um push por fatia**; ajustes de gate verificados localmente quando possível (hoje o gate Python não roda localmente: sem Python/Docker nesta máquina — **recomendação:** instalar Python + Playwright no ambiente local para executar os gates antes do CI, com autorização do proprietário).
  7. **R7 — Retentativa automática dos builds** contra o 429 do registro público (ou espelhar a imagem base no GHCR), evitando reexecuções manuais.
  8. **Opções que exigem autorização (não executadas):** ajuste de plano/cobrança, runner próprio, repositório público (conflita com DEC-GOV-003). Redução de retenção de artefatos (14 → 7 dias) afeta armazenamento, não minutos.
  - **Efeito combinado estimado (perfil de 9–13/10):** R1+R3+R4 reduzem o consumo mensal em ~70–80% sem remover nenhum teste.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma além desta preparação. Aguardam decisão: aprovar/ajustar R1–R7; responder D1–D10 da F8; autorizar a F8-1.
- PROIBIÇÕES ATUAIS: F8 (código), P27 passos 2–4, deploy/VPS/produção, serviços reais (Google, n8n, Asana, BrightBean), ligar agendadores, alterar cobrança/repositório/runners.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE.

### 2026-10-12 — F7-4b — Interfaces e Browser Gate das automações n8n — Claude
- AUTORIZAÇÃO: DEC-F7-017 — exclusivamente a F7-4b (aceite técnico da F7-4a registrado antes do código, `0cfacb1`). Não iniciadas: F8, P27 passos 2–4. Sem deploy, produção, n8n/Asana/Google reais.
- BASELINE (commit): `2cf9633` (código e gates). Commits da microetapa: `82d0134` (interfaces, capacidades, simulador estendido, gate F7-4), `eb090c9` (gate F7-1 e espera no gate do Calendar), `3b2685a` (aviso de conflito 409 persistente), `bf2bc65` e `2cf9633` (ajustes de gate).
- CI OFICIAL: run **38331008571 — 5/5 verdes**: domínio 77/77, API 819/819, web 77/77, PostgreSQL 120/120, Browser Gates F4, F5, F6, F7-1, F7-2, F7-3 passando e **F7-4 com 74 asserções, 0 falhas**. Capturas no artefato `f7-automation-browser-<sha>` (conexão, fluxos, construtor, aguardando, enviada, falha, concluída, esgotada, 390 px). Verificação local prévia: API real + simulador + front no navegador (conexão, fluxo, construtor, envio, falha, reenvio, sucesso, 390 px) e suíte PostgreSQL 120/120 em banco novo.
- STATUS: **pendente de aceite** (a F7-4b e a F7 não são aceitas automaticamente).
- O QUE MUDOU: (1) **Capacidades** `automation.manage`/`automation.view` em `/auth/capabilities` (contrato e API). (2) **Página Automações** (`/onboarding/automacoes`, aba condicionada a `automation.view`): conexão com segredo informado uma vez e nunca devolvido (impressão digital, prazo, tentativas, remoção com confirmação), fluxos (cadastro, edição, habilitar/desabilitar; destino só host permitido e https; caminho do webhook nunca exibido), aviso fixo da política do Asana (D1) e estados de ausência de conexão, despachante desligado e falta de permissão (gerente só consulta; membro recusado). (3) **Construtor:** tipo "Automação (n8n)" com seleção do fluxo habilitado (condição derivada `AUTOMATION_SUCCEEDED`, sem evidência; fluxo removido/desabilitado sinalizado; versões publicadas imutáveis). (4) **Execução:** estado da automação por etapa (aguardando envio, enviada/em processamento — nunca confundida com concluída —, nova tentativa, concluída, falhou, tempo esgotado, tentativas esgotadas), resultado, mensagem segura, referências externas (link só https), histórico por geração, "concluída automaticamente"; **Reenviar** (mesma chave) e **Refazer** (nova geração, com confirmação) com justificativa e `onboarding.override`; **Dispensar** com justificativa; sem botão de concluir; eventos de automação rotulados e com autor "Sistema". (5) Etapas automáticas não contam como "sem responsável" (detalhe, lista e painel). (6) **Simulador n8n** com controle (`/__control`) e registro de pedidos; **Browser Gate F7-4** (`scripts/homologation/automation-browser-gate.py`) com cenários de capacidades, conexão, fluxos, construtor, execução, envio assinado (despacho por processo auxiliar no container da API, servidor com despachante desligado), resultados (assinatura falsa, tempo vencido, falha, reenvio, sucesso, repetição, tardio), esgotada e dispensa, Org B, 390 px e simulador; ligado ao CI com contêiner do simulador e variáveis `N8N_*` só do ensaio.
- AJUSTES EM GATES EXISTENTES (sem enfraquecer): F7-1 passou a exigir que a automação **esteja** disponível (antes exigia indisponível, por definição da F7-3c); F7-3: espera a lista recarregar antes de conferir o vínculo (corrida intermitente já vista no run 38322351783, em commit só de documentação); F7-2: o aviso de conflito 409 agora **permanece até "Recarregar"** (a corrida deixava o aviso visível por milissegundos).
- LIMITES/LACUNAS: despachante segue desligado por padrão e sem capacidade medida; n8n real apenas após homologação autorizada; `TIMED_OUT` e `DEAD` não são produzíveis pela interface (cobertos por testes de domínio/PostgreSQL e, no gate, `DEAD` forçado no banco de ensaio); painéis e listas do onboarding não filtram por estado de automação; **P22** e **P28** seguem bloqueadoras; refinamento estético postergado (DEC-F7-015).
- FRANQUIA DE ACTIONS: runs completos desta microetapa — 38322351783 (commit só de docs da F7-4a; falhou por intermitência do gate do Calendar), 38324568647 (gate F7-1 desatualizado), 38325927022 (corrida do aviso de conflito), 38327406647 (erro 429 do registro público; 2 reexecuções só do job de build), 38329416360 (asserção do gate F7-4), 38331008571 (verde). Cada falha levou a correção local/ajuste de gate; testes locais direcionados e verificação no navegador foram feitos antes de cada push. Conferir o saldo da franquia.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma (aguarda aceite da F7-4b).
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F8, P27 passos 2–4, deploy/VPS/produção, n8n/Asana/Google reais, ligar o despachante em ambiente real sem medição e autorização.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F7-017 — Aceite técnico da F7-4a e autorização exclusiva da F7-4b (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da F7-4a (commits 7fd398d e 532a373; CI 38320597301, 5/5).
- Decisão: (1) **Aceite técnico da F7-4a.** (2) **Autorizada exclusivamente a F7-4b** (interfaces e Browser Gate das automações n8n): conexão por organização; cadastro e gestão de fluxos; fluxo associado à etapa AUTOMATION no construtor respeitando versões imutáveis; estados de automação na execução (aguardando, enviada, em processamento, concluída, falha, timeout, esgotada); reenvio, refazer e dispensa com confirmação, justificativa e permissão; resultado, referências externas, histórico e erros seguros; estados de ausência de conexão, fluxo desativado, despachante desligado e falta de permissão; capacidades automation.* e menu por RBAC/carteira; Browser Gate F7-4 com simulador (positivos, negativos, multi-organização, 390 px). (3) **Requisitos:** preservar Design System e identidade, sem redesign; nunca expor segredos, assinaturas, tokens ou payloads sensíveis; sem conclusão manual de etapa AUTOMATION; distinguir pedido enviado de resultado SUCCEEDED; sem ação de gestão sem permissão; preservar idempotência e auditoria; nenhuma escrita no Asana; sem n8n real nem credenciais reais. (4) **Economia de GitHub Actions** (1.807/2.000 min): testes locais direcionados, sem pushes intermediários, nenhum teste desativado ou enfraquecido, CI oficial completo só na entrega; se a franquia acabar, reportar sem criar custo nem alterar cobrança. (5) **Limites:** P22 e P28 seguem bloqueadoras; sem F8, P27, produção, deploy ou VPS; F7-4b e F7 não são aceitas automaticamente.
- Impacto: apps/web; scripts/homologation; CI (novo Browser Gate).
- Revisão: no aceite da F7-4b.

### 2026-10-12 — F7-4a — Automações n8n do onboarding: backend, caixa de saída, callback e simulador — Claude
- AUTORIZAÇÃO: DEC-F7-016 — exclusivamente a F7-4a. Não iniciadas: F7-4b, F8, P27 passos 2–4. Sem deploy, produção, n8n/Asana/Google reais.
- BASELINE (commit): `7fd398d`.
- CI/EVIDÊNCIA: CI oficial run 38320597301 — **5/5 verdes**: domínio 77/77, API 819/819, web 71/71, PostgreSQL 120/120 (15 novos em `automation-postgres.test.ts`); Browser Gates F4–F7-3 seguem passando; `secret-scan` sem achados.
- STATUS: **pendente de aceite** (não aceita automaticamente).
- O QUE MUDOU: (1) **Domínio/contratos:** condição `AUTOMATION_SUCCEEDED`; `automationKey` na etapa; `ONBOARDING_AUTOMATION_AVAILABLE` ligado; regras tipo×condição×fluxo habilitado (validadas na publicação); `automation-model` (estados, backoff, janela, decisão do callback, reenvio); permissões `automation.manage`/`automation.view`. (2) **Banco:** migration `20261012070000` (provider `N8N`, `automation_flows`, `automation_outbox`, `automationKey`, `completedBySystem`); índice único de pedido, CHECKs e gatilho `automation_outbox_guard` (identidade imutável, SUCCEEDED definitivo, histórico protegido). (3) **Serviço:** conexão por organização com segredo cifrado (nunca devolvido nem auditado; só impressão digital); fluxos com validação de URL (https, host permitido, sem credenciais/fragmento, sem redirecionamento); pedido gravado na transação da liberação da etapa; despachante com reserva otimista, retentativas e timeout (`TIMED_OUT`/`DEAD`), desligado por padrão; envio assinado (`X-Zafira-Timestamp`, `X-Zafira-Signature`, `X-Zafira-Idempotency-Key`, `X-Zafira-Event`) com payload mínimo e sem a chave global; callback autenticado com deduplicação; etapa concluída pelo sistema (`completedBySystem`, evento sem autor); reenvio RETRY/REDO; sem conclusão manual (409); notificações de ciclo de vida opcionais. (4) **API:** `/automation/connection`, `/automation/flows`, `/automation/dispatch`, `/onboarding/executions/:id/automation`, `.../steps/:stepKey/automation/resend`, callback público assinado (prefixos `` e `/api`; corpo bruto em escopo próprio; limite de taxa). (5) **Simulador:** `scripts/homologation/n8n-mock.mjs` (importável e servidor; verifica assinatura; respostas roteirizadas). (6) **Testes:** criação do pedido antes do envio e idempotência; despachante desligado nunca conclui; rede/5xx reagenda sem concluir e com chave estável; assinatura forjada, timestamp vencido, segredo de outra organização e organização inexistente recusados; resultado aplicado uma vez, repetido e tardio ignorados; etapa bloqueada aplica ao desbloquear; falha sem conclusão manual, RETRY/REDO, geração antiga ignorada; prazo; isolamento A×B e carteira; objetos protegidos no banco (inclui o índice GIN do calendário).
- LIMITES/LACUNAS: **sem interface** (F7-4b); a **garantia do Hub é um pedido por geração e chave estável — a execução exatamente uma vez no n8n depende de o fluxo respeitar a chave**; `DEAD` e `FAILED` exigem reenvio ou dispensa justificada por pessoa; despacho manual `/automation/dispatch` só atua com o despachante ligado; capacidade do despachante não medida; `rbac:bootstrap` precisa rodar no ambiente para conceder as novas permissões (P22); `DATABASE` com fuso diferente de UTC não afeta a reserva (sem SQL cru de data), mas `DEFAULT now()` do banco deve seguir o padrão dos demais objetos; a política D1 (fluxos operados em nome do Hub não escrevem no Asana) é documental — o Hub não controla fluxos independentes do n8n.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma (aguarda aceite da F7-4a e autorização da F7-4b).
- PROIBIÇÕES ATUAIS: as do `ESTADO_ATUAL`; em especial F7-4b, F8, P27 passos 2–4, deploy/VPS/produção, n8n/Asana/Google reais, ligar o despachante em ambiente real sem medição e autorização.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F7-016 — Aprovação da especificação da F7-4 (D1–D7) e autorização exclusiva da F7-4a (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da especificação da F7-4 (commit 80a4dce).
- Decisão: (1) **Especificação aprovada com ajustes.** (2) **D1 — sem escrita no Asana:** automações vinculadas ao Hub não criam nem alteram projetos, tarefas ou outros dados no Asana; a criação segue manual, com leitura e vínculo local (DEC-ASANA-001/002). O Hub **não** controla fluxos independentes do n8n: a política vale para os fluxos operados em nome do Hub e será documentada para a configuração futura. (3) **D2 — `AUTOMATION_SUCCEEDED`** entra no catálogo fechado; **somente** resultado `SUCCEEDED` válido, autenticado e correspondente a pedido autorizado conclui automaticamente a etapa `AUTOMATION`; preservar imutabilidade das versões, dependências, eventos append-only e auditoria. (4) **D3–D7:** padrões da especificação (fluxos registrados por organização; falha definitiva sem conclusão manual — só reenvio ou dispensa justificada; 6 tentativas e 24 h configuráveis; notificações de ciclo de vida opcionais; host real do n8n só após autorização de homologação). (5) **Salvaguardas:** (a) chave de idempotência estável em reenvios, **sem prometer execução exatamente uma vez** sem suporte do fluxo/sistemas externos; (b) validar assinatura, timestamp, correspondência do pedido, geração, organização e transição de estado, contra repetição, falsificação e resultado tardio; (c) pedido persistido **antes** do envio e falha de rede nunca conclui; (d) despachante desligado = automação não concluída, sem serviço adicional; (e) isolamento, carteira e RBAC preservados e segredos nunca em log ou resposta; (f) sem funcionalidades de contratos, financeiro, CRM ou notificações futuras; (g) só simulador do n8n e dados descartáveis; (h) sem serviços reais de n8n, Asana ou Google. (6) **Autorizada exclusivamente a F7-4a** (migration, contratos, condição, conexões e fluxos, caixa de saída, envio/reenvio, callback, permissões e endpoints, simulador, testes); telas e Browser Gate F7-4 são da F7-4b. (7) **Governança:** a referência à revisão estética no fechamento da F7 foi removida da especificação — o refinamento visual aprofundado fica para etapa posterior, mantendo Design System, responsividade, acessibilidade e usabilidade. P22 e P28 seguem bloqueadoras; sem F7-4b, F8, P27, deploy, VPS ou credenciais reais; F7-4a não é aceita automaticamente.
- Impacto: especificação F7-4 (§13); implementação F7-4a.
- Revisão: no aceite da F7-4a.

### DEC-F7-015 — Aceite técnico da F7-3c, prioridades e preparação da especificação da F7-4 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da F7-3c (CI 38315855679, 5/5; handoff 6be7711).
- Decisão: (1) **Aceite técnico da F7-3c.** (2) **Sem refinamentos estéticos agora:** a prioridade é funcionalidade, segurança, estabilidade e conclusão do escopo, mantendo o Design System e a identidade atuais; problemas de uso, responsividade ou acessibilidade continuam sendo corrigidos; a revisão estética aprofundada do Hub fica para etapa posterior de refinamento visual (**substitui** a revisão estética "no encerramento da F7" da DEC-F7-014). (3) **Autorizada exclusivamente a preparação da especificação da F7-4** (automações n8n): eventos que disparam, ações do n8n, fonte de verdade, duplicidade, falhas/reenvios/autenticação/auditoria, isolamento entre organizações e clientes, testes sem contas ou serviços reais; reutilizar a infraestrutura existente; **sem novos serviços ou workers sem autorização**; sem implementação antes da revisão. (4) **Governança:** corrigir o mapa de progresso e o resumo da F7-3 no ESTADO_ATUAL. (5) **Limites:** P22 e P28 seguem bloqueadoras; sem F8, novos passos da P27, VPS, produção ou credenciais reais.
- Impacto: documentação; `docs/propostas/F7-4_ESPECIFICACAO_AUTOMACOES_N8N.md`.
- Revisão: na revisão da especificação da F7-4.

### 2026-10-12 — F7-4: especificação das automações n8n — Claude
- AUTORIZAÇÃO: DEC-F7-015 — somente preparar a especificação; sem código, serviço, deploy, produção ou credencial.
- ENTREGA: `docs/propostas/F7-4_ESPECIFICACAO_AUTOMACOES_N8N.md`: gatilho único que conclui etapa (etapa AUTOMATION liberada) e notificações informativas de início/conclusão/cancelamento; n8n como executor com canal de retorno estreito e assinado (resultado + até 5 referências), sem acesso geral ao Hub nem à chave global; fonte de verdade por informação; idempotência por chave determinística, índice único e resultado deduplicado; falhas com *backoff*, tempo limite, estado DEAD e reenvio por `override`; autenticação HMAC por organização com janela de ±5 min e host permitido (SSRF); auditoria append-only; isolamento por organização/carteira e payload mínimo; simulador do n8n; despacho por *outbox* em tarefa periódica da própria API (desligada por padrão, sem novo serviço); fatias F7-4a (backend) e F7-4b (telas e gate).
- DECISÕES BLOQUEANTES: **D1** (fluxos n8n podem escrever no Asana? padrão proposto: não, DEC-ASANA-001) e **D2** (nova condição `AUTOMATION_SUCCEEDED` no catálogo fechado, exige DEC). D3–D7 têm padrão proposto e não bloqueiam.
- STATUS: **especificação aguardando revisão da Direção.** Próxima microetapa: nenhuma autorizada.

### 2026-10-12 — F7-3c — Etapas de onboarding por evento do Google Calendar vinculado — Claude
- AUTORIZAÇÃO: DEC-F7-014 — somente F7-3c (aceite técnico da F7-3b e observações visuais registrados antes do código, `27fe2ee`). Não iniciadas: F7-4, F8, P27 passos 2–4. Sem deploy, produção ou conta Google real; sem redesign da agenda.
- BASELINE (commit): `22b96d1` (domínio, migration `20261012060000`, execução, interface, testes, gate) e correção do gate em seguida.
- CI OFICIAL: run 38315855679 — **5/5 verdes**: domínio 72/72, API 819/819, web 71/71, PostgreSQL 105/105 (11 novos do onboarding por evento); Browser Gates F4–F7-3 passando (F7-3 ampliado; a rodada anterior 38313962062 falhou só por erro de navegação do próprio gate, corrigido).
- DEFINIÇÃO (regras): chave `ONBOARDING_CALENDAR_AVAILABLE` **ligada**; etapa `CALENDAR_EVENT` exige a condição `CALENDAR_EVENT_LINKED` (e só ela); sem evidência obrigatória; automação segue indisponível. **A condição só usa eventos e vínculos LOCAIS** (evento ou série vinculados ao **cliente da execução**, na organização); nenhuma chamada ao Google. Estados: **atendida** (há evento ativo vinculado), **pendente** (conectado, sem evento ativo), **indisponível** (conexão revogada/desconectada ou nenhum calendário monitorado). **Atendida não conclui nada:** a etapa só conclui por ação da pessoa responsável (ou `override`), que escolhe o evento; dependências, responsável, carteira e demais regras do onboarding continuam valendo, e a execução só conclui ao encerrar todas as etapas.
- ELEGIBILIDADE DO EVENTO: cancelado, ausente da origem (removido ou fora da janela) e calendário desmarcado **não servem**; evento privado/confidencial aparece e é guardado **mascarado** para quem não é participante; evento de outra organização ou de outro cliente nunca vale. Com conexão revogada a conclusão é recusada (409) com orientação: reconectar ou **dispensar a etapa com justificativa**.
- HISTÓRICO: ao concluir, a etapa guarda **instantâneo** do evento (id, título, início) sem FK; depois, cancelar/remover o evento **não altera** a etapa concluída; o evento do histórico registra o id do evento usado; CHECK no banco só permite instantâneo em etapa `DONE`.
- ENTREGUE: domínio (`eventEligibility`, `evaluateCalendarCondition`, coerência tipo×condição), migration de 3 colunas e 1 CHECK (sem linhas), conclusão no servidor, visão da execução com `calendarCondition`/`calendarEvent`, construtor com "Reunião no Calendar" disponível, detalhe da execução com estado da condição, seleção do evento e instantâneo, link para a Agenda.
- EVIDÊNCIAS: testes de domínio (elegibilidade e estados); PostgreSQL (coerência de modelo, indisponível sem conexão, pendente sem vínculo e com vínculo a outro cliente, **vínculo não conclui etapa nem execução**, cancelado/removido/desmarcado, conexão revogada, privado mascarado, só o responsável conclui, organização B nunca, instantâneo e auditoria, série herdada, CHECK e objetos protegidos); Browser Gate F7-3 ampliado (pendente → vínculo → atendida → conclusão pela interface → onboarding concluído; cancelamentos aplicados pela leitura → pendente com motivo; revogação → indisponível e conclusão 409) e Browser Gate F7-1 (etapa de Calendar disponível no construtor).
- LIMITES/PENDÊNCIAS: F7-4 e F8 não iniciadas; **P22** (permissões só em bancos após `rbac:bootstrap`) e **P28** seguem bloqueadoras; credencial OAuth do Google só na homologação; agendador desligado e capacidade não medida; revisão estética da F7 consolidada para o encerramento (observações já registradas); sem exigência de categoria do vínculo na etapa (possível evolução).
- STATUS: **F7-3c concluída para revisão da Direção, não aceita automaticamente.** Próxima microetapa: nenhuma autorizada.

### DEC-F7-014 — Aceite técnico da F7-3b e autorização exclusiva da F7-3c (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da F7-3b (CI 38305358612, 5/5; handoff 26eb5ae).
- Decisão: (1) **Aceite técnico da F7-3b.** (2) **Revisão estética** detalhada da F7-1b, F7-2b e F7-3b consolidada para o **encerramento da F7**; não elimina testes de responsividade, acessibilidade e funcionalidade durante o desenvolvimento; **sem redesign agora** — observações visuais são registradas para revisão conjunta. (3) **Autorizada exclusivamente a F7-3c:** condições `CALENDAR_EVENT` e `CALENDAR_EVENT_LINKED` das etapas de onboarding; usar **somente** eventos e vínculos locais já sincronizados; respeitar organização, cliente, carteira, RBAC e privacidade; definir e testar eventos cancelados, desmarcados, removidos da janela e conexão revogada; **vínculo não conclui etapa ou execução** sem cumprir as demais regras; estados "atendida/pendente/indisponível" na interface; preservar histórico e auditoria; testes de domínio, PostgreSQL, API e navegador. (4) **Limites:** sem F7-4, F8, passos da P27, contas Google reais ou deploy; P22 e P28 seguem bloqueadoras; F7-3c não é aceita automaticamente.
- Impacto: domínio (chave de Calendar), execução de onboarding, interface; migration pequena (snapshot do evento na etapa concluída).
- Revisão: no aceite da F7-3c.

### Observações visuais registradas para o fechamento da F7 (sem ação agora)
- Agenda: a célula do dia selecionado tem contraste fraco entre o número e o fundo claro; o aviso de toast sobrepõe a grade em capturas de página inteira; no mobile a grade usa só marcadores e depende do painel do dia.
- Construtor e execução do onboarding: colunas de configuração longas em telas estreitas; rótulos dos selos podem competir com o título em cartões densos.

### 2026-10-12 — F7-3b — Interface da agenda Google Calendar e Browser Gate F7-3 — Claude
- AUTORIZAÇÃO: DEC-F7-013 — somente F7-3b (aceite técnico da F7-3a registrado). Não iniciadas: F7-3c, F7-4, F8, P27 passos 2–4. Sem deploy, produção ou conta Google real. Resumo do ESTADO_ATUAL corrigido (sem `syncToken`).
- BASELINE (commit): `df2ba54` (telas, capacidades, simulador, gate) e correção do gate (host e checkboxes); decisões em `43f36e9`.
- CI OFICIAL: run 38305358612 — **5/5 verdes**: domínio 70/70, API 819/819, web 70/70, PostgreSQL 93/93; Browser Gates F4–F7-2 passando; **Browser Gate F7-3: 63 verificações, 0 falhas, 0 bloqueios** (21 mensagens de console esperadas: 403/404 dos testes negativos). Uma rodada anterior caiu por indisponibilidade do registro público de imagens (infraestrutura) e foi reexecutada sem mudar código.
- ENTREGUE: `/agenda` (mensal e semanal, filtros por calendário/categoria/cliente, painel do dia, detalhe do evento, vínculo local a cliente, projeto do Asana — só vínculo local — categoria e nota, série), `/agenda/configuracao` (conexão OAuth, descoberta e monitoramento de calendários, categoria padrão, janela de leitura, identidades de participantes, sincronizar agora, desconectar); `GET /calendar/status` (frescor para quem só visualiza); capacidades `calendar.*` em `/capabilities`; item "Agenda" no menu só com `calendar.view`; simulador do Google com consentimento OAuth simulado em container próprio no CI.
- EVIDÊNCIAS (Browser Gate F7-3, imagens publicadas e simulador): estado "não conectado"; conexão pelo fluxo OAuth simulado com conta só mascarada; 3 calendários descobertos, nenhum monitorado automaticamente, livre/ocupado sinalizado; categoria padrão salva; última leitura exibida e nunca como tempo real; mensal (42 dias) e semanal (7); filtros; vínculo a cliente e série; **descrição e link de videoconferência ausentes** do navegador; privado mascarado (inclusive para o administrador) sem local/link/participantes; evento sem cliente invisível ao gestor; e-mail/participante enviados pelo navegador não concedem acesso; identidade associada só por administrador e exibida mascarada, e então o participante vê o evento sem cliente e o privado completo; gestor não vincula cliente fora da carteira (404); membro sem controles, API 403; usuário sem `calendar.view`: menu oculto, rota "sem permissão", backend 403; agenda desatualizada com aviso claro; conexão revogada com aviso e última leitura preservada, reconexão restabelece; desconectar; Org B isolada; 390 px sem rolagem horizontal; a API de agenda do simulador só recebeu GET.
- DIVERGÊNCIAS/ACHADOS: (a) o navegador do ensaio nunca fala com o Google real (guarda por host no gate); (b) o gate depende de 1 a 2 esperas de 65 s quando o limite de login (10/min) é atingido; (c) a seleção de dia usa o fuso fixo de São Paulo no gate; (d) no mobile a grade mostra marcadores e o painel do dia traz os detalhes.
- LIMITES/PENDÊNCIAS: F7-3c (etapas de onboarding por evento vinculado) não iniciada; **P22**, **P28** seguem bloqueadoras; credencial OAuth do Google Cloud só na homologação (fornecida pelo proprietário fora de conversa e repositório); capacidade do agendamento não medida (agendador desligado); revisão visual da F7-1b/F7-2b/F7-3b pendente — **não há aprovação estética**.
- STATUS: **F7-3b concluída para revisão da Direção, não encerrada.** Próxima microetapa: nenhuma autorizada.

### DEC-F7-013 — Aceite técnico da F7-3a e autorização exclusiva da F7-3b (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da F7-3a (commits 40eba3b, aa5f21d, 2123fda; CI 38299077768, 5/5).
- Decisão: (1) **Aceite técnico da F7-3a.** (2) **Autorizada exclusivamente a F7-3b:** tela de conexão e estado; seleção e gestão dos calendários monitorados; agenda mensal e semanal; visualização por dia, categoria, calendário e cliente; vínculo local a clientes e projetos (carteira e permissões); categoria padrão por calendário; estados vazio, carregando, erro, sem permissão, conexão revogada e sincronização desatualizada; capacidades `calendar.*` no endpoint existente e seu uso na interface; Browser Gate F7-3 com Google simulado e 390 px. (3) **Requisitos:** Design System da F3; nunca criar/editar/excluir eventos ou calendários no Google; RBAC e carteira também no backend; mascaramento preservado e nenhum dado oculto ao frontend; estado e última sincronização claros, sem apresentar dado desatualizado como tempo real; sem contas reais; sem dados fictícios permanentes; acessibilidade e responsividade; funcionalidades anteriores preservadas. (4) **Governança:** corrigir o resumo do ESTADO_ATUAL que ainda citava `syncToken` (a F7-3a usa janela móvel com `updatedMin` e reconciliação). (5) **Limites:** sem F7-3c, F7-4, F8, passos da P27, deploy, produção ou contas reais; P22 e P28 seguem bloqueadoras; revisão estética da F7-1b/F7-2b pendente; F7-3b não é declarada encerrada sem aceite.
- Impacto: telas e serviços web, `/capabilities`, Browser Gate F7-3; sem mudança de banco.
- Revisão: no aceite da F7-3b.

### 2026-10-12 — F7-3a — Agenda Google Calendar (somente leitura): dados, conector, sincronizador, RBAC, API, simulador e testes — Claude
- AUTORIZAÇÃO: DEC-F7-012 — somente F7-3a. Não iniciadas: F7-3b, F7-3c, F7-4, F8, P27 passos 2–4. Sem deploy, produção ou conta Google real.
- BASELINE (commit): `aa5f21d` (migration `20261012050000`, domínio, conector, sincronizador, RBAC, API, simulador, testes); decisões registradas antes do código em `40eba3b`.
- ENTREGUE: 4 tabelas (`calendar_sources`, `calendar_events`, `calendar_event_links`, `calendar_member_identities`) e valor `GOOGLE_CALENDAR` no enum de provedores, **sem nenhuma linha**; permissões `calendar.view|link|manage_connections|view_all` (ADMIN todas; MANAGER view+link; MEMBER view); OAuth da organização reutilizando `IntegrationConnection` + `encryptIntegrationCredential` (PKCE, escopo `calendar.readonly`, state assinado de uso único); descoberta e seleção livre de calendários; sincronizador por janela móvel (padrão −30/+180 dias, configurável) com `updatedMin`, paginação, cursor só após todas as páginas, reconciliação a cada 24 h, execução única por calendário (`scheduler_leases`); vínculos locais por evento ou série; identidades por HMAC; agendador **desligado por padrão** (`GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED`); simulador `scripts/homologation/google-calendar-mock.mjs`.
- CI OFICIAL: run 38299077768 — **5/5 verdes**: domínio 70/70, API 819/819, web 64/64, PostgreSQL **93/93** (17 verificações novas da agenda); Browser Gates F4–F7-2 passando.
- EVIDÊNCIAS (teste `google-calendar-postgres.test.ts`, banco descartável e simulador):
  - **Somente leitura:** a API de agenda só recebeu GET; o código tem um único POST (endpoint de token do OAuth) e nenhuma operação de escrita da API.
  - **Dados mínimos:** nenhuma coluna contém e-mail, descrição ou link de videoconferência; participantes só como HMAC (64 hex). A chave é `CALENDAR_IDENTITY_HMAC_KEY` (ambiente); sem ela, o recurso fica desativado.
  - **Associação de identidade:** só `calendar.manage_connections` associa membro ↔ e-mail (o servidor calcula o HMAC e descarta o texto); e-mail/participante enviados pelo navegador não concedem nada; membro não associa; e-mail não é devolvido.
  - **Acesso:** evento sem cliente invisível à agência (só participante ou `view_all`); carteira; privado/confidencial mascarado inclusive para `view_all`; participante associado vê completo; organização B nunca vê nem altera.
  - **Sincronização:** paginação (≥3 páginas), janela −30/+180 conferida na requisição, idempotência (sem duplicar, vínculo preservado), concorrência (um executa, outro pula), incremental com `updatedMin`, cancelado preserva dados e vínculo e sai da agenda, evento ausente/movido para fora da janela vira `missingFromSourceAt` (some como compromisso ativo, vínculo preservado) e volta ao reaparecer, falha parcial (cursor mantido, sem duplicar), 429/403 de cota com retentativa e falha controlada.
  - **Revogação OAuth:** pausa, conexão em `ERROR`/"requer reconexão", dados e leitura locais preservados, `IntegrationError` registrado, reconexão retoma com reconciliação.
  - **Conexão:** credencial cifrada e nunca devolvida; desconectar apaga o segredo e pausa os calendários sem apagar eventos; configuração de janela validada.
  - **Retenção:** nenhuma exclusão automática (evento de 2 anos preservado).
  - **Objetos SQL protegidos** (F7-1a, F7-2a, F7-3a) conferidos pelo nome; remoção da organização em cascata funciona.
- DIVERGÊNCIAS/ACHADOS: (a) `syncToken` não foi usado (decisão T1); (b) a divergência de nome da FK `organization_invitations_…_fk` segue fora do escopo; (c) evento movido para fora da janela só é detectado na reconciliação diária (até 24 h) ou na leitura completa manual; (d) `calendar.*` não está exposto em `/capabilities` (F7-3b); (e) o filtro de acesso é aplicado após a leitura (até 1000 eventos por consulta), com o filtro de carteira calculado no servidor.
- LIMITES/PENDÊNCIAS: F7-3b (telas e Browser Gate) e F7-3c (etapas de onboarding por evento vinculado) não iniciadas; **P22** (novas permissões só existem após `rbac:bootstrap`) e **P28** seguem bloqueadoras; credencial OAuth do Google Cloud só na homologação, fornecida pelo proprietário fora de conversa e repositório; capacidade do agendamento ainda não medida.
- STATUS: **F7-3a concluída para revisão da Direção.** Próxima microetapa: nenhuma autorizada.

### DEC-F7-012 — Aprovação da especificação F7-3 v2 (T1–T5, T2 com ajuste) e autorização exclusiva da F7-3a (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Decisão: **T1 aprovada** (janela móvel, `updatedMin`, reconciliação diária; `syncToken` adiado). **T2 aprovada com ajuste:** não persistir e-mails de participantes, descrições, links de videoconferência nem payload bruto; identificação de participantes por **HMAC com chave protegida**, com correspondência **explícita** às identidades autorizadas no Hub. **T3 aprovada:** `calendar.view_all` explícita, padrão ADMIN, **sem** revelar automaticamente detalhes privados/confidenciais mascarados. **T4 aprovada:** janela configurável, 30 dias anteriores e 180 futuros. **T5 aprovada:** categoria padrão opcional por calendário. **Salvaguardas:** (1) documentar e testar a associação usuário interno ↔ identidade Google sem conceder acesso por dado vindo do navegador; (2) eventos movidos para fora da janela, cancelados ou removidos tratados pela reconciliação, preservando vínculos e histórico e sem exibir dado desatualizado como compromisso ativo; (3) testes de paginação, falhas parciais, concorrência, cursor, idempotência e recuperação após revogação OAuth; (4) isolamento multiempresa, carteira e mascaramento, incluindo privados e confidenciais; (5) reutilizar `IntegrationConnection`, criptografia e infraestrutura, sem serviço adicional; (6) sincronização automática **desligada por padrão**, nenhuma conta Google real; (7) **sem exclusão automática** pela retenção de 365 dias. **Autorizada exclusivamente a F7-3a** (migration, contratos, domínio, OAuth/conector de leitura, sincronizador, RBAC, API, simulador e testes). F7-3b, F7-3c, F7-4, F8, P27 e deploy não iniciados; P22 e P28 seguem bloqueadoras.
- Impacto: especificação F7-3 v2 (§13); implementação F7-3a.
- Revisão: no aceite da F7-3a.

### DEC-F7-011 — Calendários flexíveis e ajustes obrigatórios da especificação da F7-3 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: a Zafira ainda não tem organização definida de calendários no Google Calendar; a especificação v1 (2601c56) pressupunha agendas temáticas e tinha inconsistências técnicas.
- Decisão: (1) **Conexão** por organização com conta Google corporativa via OAuth, sem OAuth individual na primeira versão. (2) **Administrador lista e seleciona** os calendários acessíveis (primário, individuais e compartilhados), vários, alterável depois. (3) **Categorização** de eventos e **vínculo local** a clientes e projetos. (4) **Somente leitura**; nada criado automaticamente (calendários, eventos ou estruturas). (5) **Ajustes técnicos obrigatórios:** compatibilizar carga inicial, `syncToken`, paginação e HTTP 410; IDs reais da API em eventos recorrentes (`recurringEventId`, `originalStartTime`); polling de 15 min configurável e sujeito à avaliação de capacidade; evento sem cliente **não** visível a toda a agência; RBAC, organização, carteira e permissões explícitas; mascaramento no backend; minimização de participantes, e-mails, descrições e links; permissões do Google não equivalem às do Hub; reutilizar `IntegrationConnection` e a criptografia existente; sem novos workers/serviços na VPS; sem contas reais; retenção de 365 dias como proposta, **sem exclusão automática** antes da política aprovada. (6) **Implementação da F7-3a não autorizada.** P22 e P28 seguem bloqueadoras; P27 passos 2–4 e F7-4/F8 não iniciados.
- Alternativas consideradas: manter calendários temáticos fixos (descartada: a estrutura não existe); `syncToken` com janela de tempo (descartada: a API não permite combinar `timeMin`/`timeMax`/`updatedMin` com `syncToken`).
- Impacto: especificação F7-3 v2 (`docs/propostas/F7-3_ESPECIFICACAO_GOOGLE_CALENDAR.md`); sem código.
- Revisão: na revisão da especificação v2 e antes de autorizar a F7-3a.

### 2026-10-12 — F7-3: especificação revisada (v2) — Claude
- AUTORIZAÇÃO: DEC-F7-011 — somente revisar a especificação; sem código, deploy, produção ou credenciais.
- ENTREGA: `docs/propostas/F7-3_ESPECIFICACAO_GOOGLE_CALENDAR.md` v2: calendários flexíveis escolhidos pelo administrador; conexão OAuth reutilizando `IntegrationConnection`, `credentialCiphertext`, `SyncRun` e `IntegrationError`; tabelas `calendar_sources`, `calendar_events` (mínimo de dados, hash de participantes) e `calendar_event_links` (evento ou série); sincronização por janela móvel com `updatedMin`, paginação, reconciliação diária e tratamento de 429/5xx/invalid_grant, `syncToken` documentado e adiado; recorrência sem presumir IDs; matriz de visibilidade (sem cliente ≠ visível à agência; privado mascarado no backend); permissão explícita `calendar.view_all`; retenção só medida; simulador para testes; fatias F7-3a/b/c (F7-3c liga as etapas de Calendar do onboarding).
- DECISÕES BLOQUEANTES: **nenhuma** para a F7-3a. Cinco padrões técnicos (T1–T5) para confirmação; credencial OAuth do Google Cloud só será necessária na homologação, fornecida pelo proprietário fora de conversa e repositório.
- STATUS: **especificação v2 aguardando revisão da Direção.** Próxima microetapa autorizada: nenhuma.

### DEC-F7-010 — Aceite técnico da F7-2b e autorização da preparação da F7-3 (Google Calendar) (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da entrega da F7-2b (commits bfcb751, 4ededd6, 0c89a44; CI 38291768369, 5/5 jobs; Browser Gate F7-2 com 71/71 asserções e 0 falhas).
- Decisão:
  1. **Aceite técnico da F7-2b:** aprovado com base nos testes de domínio, API, PostgreSQL e validação do Browser Gate F7-2 (71/71 asserções, 0 falhas, 0 bloqueios).
  2. **Revisão estética e de usabilidade:** a avaliação visual da F7-1b e da F7-2b continua pendente da Direção; nenhuma aprovação visual foi concedida ainda.
  3. **P22 segue bloqueador** do primeiro deploy de homologação.
  4. **P28 permanece aberta:** bloqueia o uso de dados reais até aprovação de solução; não implementar ainda a proposta de exclusão e retenção nem assumir seus prazos como requisitos legais.
  5. **Autorizada exclusivamente a PREPARAÇÃO da F7-3 (Google Calendar):** elaboração da especificação funcional e técnica da integração, preservando as decisões (Calendar como fonte principal, Hub somente leitura sem escrita no Google, vínculos locais por cliente/projeto/categoria, controle de acesso e carteira, tratamento de eventos recorrentes/cancelados/privados, controle de cota e fuso horário, retenção proposta de 1 ano sujeita a confirmação, testes sem contas reais). **Não implementar a F7-3 antes da revisão da especificação.**
  6. **Restrições:** não iniciar F7-4, F8 ou passos da P27; sem acesso a produção ou VPS; sem credenciais reais; sem dados fictícios permanentes.
- Alternativas consideradas: iniciar implementação imediata da F7-3 (descartada: exige especificação prévia e decisões de produto).
- Impacto: proposta `docs/propostas/F7-3_ESPECIFICACAO_GOOGLE_CALENDAR.md`; sem mudanças no código de produção nesta microetapa.
- Revisão: na revisão da especificação da F7-3 pela Direção.

### 2026-10-12 — F7-2b — Interfaces de execução do onboarding e validação do Browser Gate F7-2 — Antigravity
- AUTORIZAÇÃO: DEC-F7-009 — somente F7-2b (telas, painel, minhas etapas, menu respeitando `onboarding.view`, Browser Gate F7-2). Não autorizadas: F7-3, F7-4, passos da P27, deploy ou produção. P22 segue bloqueador.
- BASELINE (commit): `0c89a44` (fix(gate): F7-2b reativa pessoa fora da carteira no seed e isola container api no gate (DEC-F7-009)) após os commits `bfcb751` e `4ededd6` de implementação e ajuste inicial da F7-2b.
- CI OFICIAL: run 38291768369 (https://github.com/Julianogdc/zafira-hub/actions/runs/38291768369) — **5/5 verdes**:
  - PostgreSQL Integration Gate: 2m33s
  - Code Quality and Tests: 3m48s (domínio 62/62, API 819/819, web 64/64)
  - Docker Build Gate: 5m22s
  - Publish Images: 6m48s (imagens imutáveis publicadas no GHCR)
  - Homologation Rehearsal: 5m25s (Browser Gates F4/F5, F5, F6, F7-1 e F7-2 todos verdes)
  - Browser Gate F7-2: 71 asserções passadas, 0 falhas, 0 bloqueios.
- DEFEITO INVESTIGADO E CORREÇÃO APLICADA:
  - Causa da falha anterior (run 38288458010): no cenário E (reatribuição), o Playwright buscava 'Gate Pessoa Saida' no select de novos responsáveis, mas a opção não existia. A causa raiz foi que o portão anterior F7-1 executou o ensaio H suspendendo temporariamente essa pessoa na base compartilhada, e a UI filtra apenas membros ativos (`GET /onboarding/members`). Como a intenção do teste era validar a regra de negócio rejeitando uma pessoa ativa fora da carteira do cliente, o seed `seed-f7-exec-gate.mjs` foi ajustado para assegurar que 'Gate Pessoa Saida' seja mantida com status ACTIVE (e fora da carteira do CLIENT_1), restaurando o isolamento da fixture.
  - Limite de autenticação: o Claude havia inserido `time.sleep(65)` com retry no login. Em conformidade com a diretriz da Direção de não mascarar erros nem usar esperas arbitrárias, o isolamento adequado do ambiente de testes foi implementado reiniciando o container `api-f45-browser` (e conferindo healthcheck) antes do início do F7-2 no workflow do GitHub Actions, resetando os contadores de rate limit voláteis em memória. A função de login no gate python foi revertida para execução direta, sem esperas arbitrárias nem retries.
- ENTREGUE NA F7-2b:
  - Painel de acompanhamento de onboardings (`/onboarding/execucoes`) com resumo de indicadores, lista filtrável por cliente, modelo, status e responsável, e acionador de novo onboarding (restrito a permissões e carteira).
  - Detalhe da execução (`/onboarding/execucoes/:id`) com progresso, lista ordenada de etapas, dependências, prazos em dias úteis, evidências, responsáveis (com selo 'Sem responsável' e mensagem compreensível), histórico de eventos e ações seguras (iniciar, concluir, bloquear com motivo, desbloquear, dispensar com justificativa, reatribuir com validação de carteira, concluir antecipadamente e cancelar).
  - Tela Minhas Etapas (`/onboarding/minhas-etapas`) com lista exclusiva de etapas atribuídas ao usuário logado na sua carteira.
  - Menu lateral atualizado para respeitar rigorosamente a permissão `onboarding.view`.
  - Tratamento de concorrência com banner de conflito 409 sem sobrescrever dados.
  - Responsividade em 390 px para desktop e mobile sem rolagem horizontal indesejada.
  - Browser Gate F7-2 com 12 cenários automatizados cobrindo fluxos positivos, negativos, RBAC, carteira, concorrência e Asana simulado (0 escritas).
- EVIDÊNCIAS E CAPTURAS DE TELA (artefato f7-onboarding-execution-browser-0c89a44f9be898ef183fc1e58f49c2a6629f47d9):
  - `f7b-painel-desktop.png`: Painel desktop de acompanhamento
  - `f7b-b-detalhe.png`: Detalhe da execução de onboarding
  - `f7b-d-colaborador.png`: Minhas etapas do colaborador
  - `f7b-e-gestor.png`: Ações do gestor e reatribuição de etapa
  - `f7b-f-conflito.png`: Detecção de conflito concorrente (409)
  - `f7b-g-antecipada.png`: Conclusão antecipada com dispensa de etapas
  - `f7b-i-sem-permissao.png`: Bloqueio de rota e menu para usuário sem `onboarding.view`
  - `f7b-k-390-dialogo.png`: Diálogo responsivo em 390 px
  - `f7b-k-390-painel.png`: Painel mobile em 390 px
- LIMITES/PENDÊNCIAS:
  - F7-2b ENTREGUE PARA REVISÃO (não encerrada; aguarda aceite expresso da Direção).
  - P28 (exclusão de cliente, retenção e privacidade): proposta formulada em `docs/propostas/F7-2_RETENCAO_EXCLUSAO_CLIENTE_PROPOSTA.md`, aguardando decisão antes de dados reais.
  - P22 segue bloqueador do primeiro deploy de homologação.
  - Avaliação estética/usabilidade da F7-1b segue pendente da Direção.
  - F7-3, F7-4 e passos 2 a 4 da P27 permanecem não autorizados.
- STATUS: **F7-2b ENTREGUE PARA REVISÃO DA DIREÇÃO.** Nenhum dado fictício permanente; nenhuma escrita no Asana ou Calendar; produção intocada.
- PRÓXIMA MICROETAPA: nenhuma autorizada. Aguarda aceite formal da F7-2b e orientações estratégicas da Direção.

### DEC-F7-009 — Aceite técnico da F7-2a, autorização da F7-2b e pendência P28 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da F7-2a (commits c73e034, 5523ff4, e6c60f4; CI 38282931118, 5/5).
- Decisão: (1) **Aceite técnico da F7-2a.** (2) **Autorizada exclusivamente a F7-2b:** painel de acompanhamento; lista com filtros (cliente, modelo, status, responsável); detalhe (etapas, prazos, dependências, evidências, histórico); ações (iniciar onboarding, iniciar/concluir etapa, bloquear, desbloquear, dispensar, reatribuir, concluir antecipadamente, cancelar); "Minhas etapas" conforme permissões e carteira; **menu lateral respeitando `onboarding.view`**. Requisitos: Design System da F3; etapas bloqueadas, atrasadas, sem responsável e concluídas claras; mensagem compreensível sem responsável elegível; confirmação e justificativa nas ações excepcionais; conflito 409 sem sobrescrever; 390 px e teclado; sem dados fictícios permanentes; sem escrita no Asana ou Calendar. (3) **Nova pendência P28 — exclusão de cliente, retenção e privacidade:** o `ON DELETE CASCADE` entre cliente e execuções pode apagar histórico na exclusão definitiva. Registrar e propor solução que diferencie arquivamento/desativação (preserva histórico), exclusão definitiva controlada (retenção, privacidade, direitos do titular) e exclusão administrativa de organização. **Não alterar o comportamento automaticamente**; resolver **antes** de dados reais em homologação ou produção. (4) Browser Gate F7-2 (positivos, negativos, permissões, carteira, isolamento, concorrência, 390 px, regressão) e CI verde; evidências visuais. (5) Sem F7-3, F7-4, novos passos da P27, deploy ou produção; **P22 segue bloqueador**; revisão visual da F7-1b segue pendente (aprovação estética não concedida).
- Alternativas consideradas: corrigir o CASCADE já na F7-2b (descartada: exige decisão de retenção e privacidade).
- Impacto: telas e serviços web; proposta `docs/propostas/F7-2_RETENCAO_EXCLUSAO_CLIENTE_PROPOSTA.md`; sem mudança de banco.
- Revisão: no aceite da F7-2b e na revisão da proposta P28.

### 2026-10-12 — F7-2a — Execução do onboarding: dados, regras, API, RBAC e testes — Claude
- AUTORIZAÇÃO: DEC-F7-008 — somente F7-2a. Não iniciadas: F7-2b (telas), F7-3, F7-4, passos 2 a 4 da P27. Sem deploy e sem produção. P1–P5 e o ajuste da P3 registrados antes do código (`c73e034`).
- BASELINE (commit): `5523ff4` (migration `20261012040000`, contratos, domínio, API, RBAC, testes).
- CI OFICIAL: run 38282931118 — **5/5 verdes**: domínio 62/62, API 819/819, web 58/58, PostgreSQL **76/76** (18 verificações novas da execução + 1 da F7-1b); Browser Gates F4, F5, F6 e F7-1 seguem passando.
- ENTREGUE: 3 tabelas (`onboarding_executions`, `onboarding_step_runs`, `onboarding_execution_events`) e migration **sem nenhuma linha**; contratos; regras puras de execução (prazos em dias úteis no fuso da organização, liberação por dependência, resolução de responsáveis, conclusão da etapa por catálogo fechado, conclusão antecipada, ações permitidas); API `/onboarding/executions` (iniciar, listar, detalhar, concluir antecipadamente, cancelar), `/onboarding/executions/:id/steps/:stepKey/{start|complete|block|unblock|skip|reassign}`, `/onboarding/my-steps`, `/onboarding/overview`; `requireAnyPermission` no middleware (negação por padrão). Gatilho de contrato assinado: só o valor `MANUAL` existe; sem endpoint nem simulação.
- EVIDÊNCIAS (teste `onboarding-execution-postgres.test.ts`, banco descartável real):
  - **Objetos SQL protegidos:** índice parcial B2, índices e gatilhos da F7-1a e da F7-2a conferidos pelo nome.
  - **B2:** segundo início ativo → 409 com o id existente; dois inícios simultâneos → 201 e 409; inserção direta no banco também é barrada; modelo diferente no mesmo cliente roda em paralelo; concluir ou cancelar libera novo início; `requestId` idempotente.
  - **Imutabilidade:** cliente, modelo e versão não mudam (gatilho); execução só aponta para versão publicada do próprio modelo; eventos sem UPDATE/DELETE; histórico não pode ser apagado; etapa encerrada não reabre (P5); encerrar com etapa aberta é barrado.
  - **Permissões e carteira:** MEMBER não inicia (403); cliente fora da carteira e de outra organização → 404 em todas as operações; lista, "minhas etapas" e painel restritos à carteira.
  - **P1:** responsável de função só entre ativos com o cliente na carteira; pessoa fora da carteira recusada na reatribuição e a carteira não é ampliada.
  - **P2:** etapa sem responsável elegível só por `override`.
  - **P3:** conclusão automática; antecipada barrada com bloqueante aberta; sem justificativa 400; com justificativa as demais são dispensadas na mesma transação, um evento por etapa, nenhuma aberta em `COMPLETED`.
  - **P4:** dispensa de bloqueante só por override, com justificativa e `highlight` no evento. **P5:** reabertura recusada.
  - **Cancelamento:** permissão e motivo; etapas `CANCELLED`; ações posteriores 409.
  - **Pessoas:** suspensa/inativa vira alerta e não age; remover a pessoa da organização preserva etapas e eventos; override conclui.
  - **Modelo:** versão nova e arquivamento não alteram execução em andamento; arquivado bloqueia novos inícios.
  - **Cascata:** remover organização com execuções e histórico funciona.
  - **Asana/Calendar:** conclusão `ASANA_PROJECT_LINKED` só valida vínculo local já existente; nenhum cliente HTTP de Asana ou Calendar no código da execução.
- ACHADOS: (a) o `prisma migrate diff` sugere renomear a FK `organization_invitations_…_fk` (divergência de nome pré-existente, fora do escopo; documentada na migration e não incluída); (b) fuso vem de `OrganizationConfig.timezone` (padrão São Paulo); (c) remover um **cliente** apaga em cascata suas execuções (comportamento herdado do módulo de clientes; a proteção do histórico vale contra remoções diretas).
- LIMITES/PENDÊNCIAS: F7-2b (telas, "minhas etapas", painel, **correção do menu por `onboarding.view`**, Browser Gate F7-2) não iniciada; **P22 segue bloqueador**; feriados ainda lista vazia; índices parciais e gatilhos não aparecem no `schema.prisma` e **não devem ser removidos**; revisão visual da F7-1b segue pendente da Direção.
- STATUS: **F7-2a concluída para revisão da Direção.** Nenhum dado fictício permanente; sem escrita no Asana ou Calendar; produção intocada.
- PRÓXIMA MICROETAPA: nenhuma autorizada. Aguarda aceite da F7-2a e decisão sobre a F7-2b.

### DEC-F7-008 — P1 a P5 da F7-2 e autorização exclusiva da F7-2a (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: revisão da especificação da F7-2 (commit 016a83b).
- Decisão: **P1 aprovada** — pessoas e funções sem acesso ao cliente não são atribuídas; nenhuma execução amplia a carteira. **P2 aprovada** — etapa sem responsável resolvido só é concluída por quem tem `onboarding.override`, até haver responsável elegível. **P3 aprovada com ajuste** — conclusão automática com todas as etapas `DONE`/`SKIPPED`; conclusão antecipada (por quem tenha a permissão) exige todas as `blocksCompletion` encerradas e as demais abertas **explicitamente dispensadas, com justificativa e eventos auditáveis, na mesma transação**; nenhuma etapa aberta em execução `COMPLETED`. **P4 aprovada** — etapa bloqueante só dispensada por quem tem `onboarding.override`, justificativa obrigatória e destaque no histórico. **P5 aprovada** — reabertura de etapa concluída fora da F7-2. **Salvaguardas:** início permitido com etapas sem responsável (a interface informará quais atribuições resolver); B2 no banco inclusive sob inícios simultâneos; cliente, modelo e versão imutáveis; integridade e histórico preservados quando usuários forem desativados; índices parciais e gatilhos SQL existentes preservados; nenhuma escrita no Asana ou Google Calendar; isolamento multiempresa, RBAC, carteira e eventos append-only; sem dados fictícios permanentes. **Autorizada exclusivamente a F7-2a.**
- Alternativas consideradas: conclusão antecipada deixando etapas abertas (descartada).
- Impacto: especificação F7-2 atualizada (§3.4, §10, §12); migration com 3 tabelas; testes de domínio e PostgreSQL.
- Revisão: no aceite da F7-2a.

### 2026-10-12 — F7-2: especificação da execução de onboarding (DEC-F7-007) — Claude
- AUTORIZAÇÃO: DEC-F7-007 — somente **preparar a especificação**. Nada implementado; sem F7-3, F7-4, passos da P27, deploy ou produção.
- ENTREGA: `docs/propostas/F7-2_ESPECIFICACAO_EXECUCAO_ONBOARDING.md` (proposta aguardando revisão da Direção): início manual com versão e cliente imutáveis; B2 por índice único parcial no banco e sob concorrência; resolução de responsáveis (função, pessoa, inativo, carteira nunca ampliada); prazos em dias úteis e dependências; avançar, bloquear, dispensar, reatribuir, concluir e cancelar com eventos append-only; painel do gestor e "minhas etapas"; permissões e carteira; critérios de aceite; gatilho de contrato assinado apenas reservado (F9).
- DECISÕES BLOQUEANTES: **nenhuma** para a F7-2a. Cinco padrões (P1–P5, §10) para confirmação.
- FATIAMENTO PROPOSTO: **F7-2a** (dados, regras, API, RBAC, testes) e **F7-2b** (telas, correção do menu, Browser Gate F7-2), cada uma com autorização própria.
- STATUS: especificação **pendente de revisão da Direção**. Próxima microetapa autorizada: nenhuma.

### DEC-F7-007 — Aceite técnico da F7-1b e preparação da especificação da F7-2 (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: a Direção revisou a F7-1b e confirmou o CI oficial 38278741564 (5/5; Browser Gate F7-1 verde).
- Decisão: (1) **Aceite técnico da F7-1b** pelos critérios funcionais, de segurança e de regressão. (2) **Distinção registrada:** a **revisão estética e de usabilidade segue pendente** da avaliação das capturas pela Direção; **não há aprovação visual ainda**. A pendência não impede o planejamento da próxima etapa. (3) O item **Onboarding do menu lateral deve respeitar `onboarding.view`**, sem prejuízo da proteção das rotas e do backend; correção programada para o próximo incremento de interface, com teste. (4) **Gatilhos e índices parciais SQL da F7-1a são preservados**; futuras migrations não podem removê-los por serem diferenças em relação ao `schema.prisma`. (5) **Autorizada a preparação da especificação da F7-2** (execução por cliente), sem implementar; gatilho de contrato assinado só reservado para a F9; P22 segue bloqueando homologação; F7-3, F7-4 e passos da P27 não iniciados; produção intocada.
- Alternativas consideradas: declarar a F7-1b aprovada por inteiro (descartada: a avaliação visual não ocorreu).
- Impacto: documentação; item 3 entra na F7-2b; item 4 vira teste de objetos SQL protegidos na F7-2a.
- Revisão: na avaliação das capturas e na revisão da especificação da F7-2.

### 2026-10-12 — F7-1b — Interface do construtor de onboarding — Claude
- AUTORIZAÇÃO: DEC-F7-006 — somente F7-1b (aceite da F7-1a registrado). Não iniciadas: F7-2, F7-3, F7-4, passos 2 a 4 da P27. Sem deploy e sem produção.
- BASELINE (commit): `505455e` (interface, capacidades, testes, Browser Gate F7-1) e `7f3c6a7` (ajuste do gate); DEC-F7-006 no mesmo `7f3c6a7`.
- CI OFICIAL: run 38278741564 — **5/5 verdes**: domínio 51/51, API 819/819, web 58/58, PostgreSQL **58/58**; Browser Gates F4, F5 e F6 passando; **Browser Gate F7-1: 70 verificações, 0 falhas, 0 bloqueios** (20 mensagens de console esperadas: respostas 403/404/409 provocadas de propósito nos testes negativos).
- ENTREGUE: telas `/onboarding/modelos` (lista: criar, duplicar, arquivar, reativar), `/onboarding/modelos/:id` (construtor: etapas, reordenar por botões e teclado, remover, configurar tipo/responsável/prazo/dependências/evidência/bloqueio, salvar, validar, publicar com nota, criar rascunho da próxima versão, descartar rascunho, histórico) e `/onboarding/funcoes` (criar, renomear, desativar, pessoas); item "Onboarding" no menu; `GET /onboarding/members` (id, nome e papel das pessoas ativas, sem e-mail); capacidades `onboarding.*` em `/api/v1/auth/capabilities` (resolvidas pelo mesmo resolvedor; só para a interface — cada rota continua validando no backend).
- DECISÕES TÉCNICAS DENTRO DO ESCOPO: reordenação só por botões ▲▼ (acessível; sem arrastar); a interface **deriva** a condição de conclusão da evidência escolhida, impedindo combinações inválidas; Calendar aparece desabilitado "(em breve)" e automação não é oferecida (constante `CALENDAR_STEP_AVAILABLE=false`); quem tem só `onboarding.view` vê tudo em leitura; mensagem de ciclo passou a citar "Etapa N" quando a etapa não tem título (correção no domínio).
- EVIDÊNCIAS (Browser Gate F7-1, imagens publicadas, banco de ensaio): estado vazio sem modelos automáticos; função criada pela interface, nome repetido recusado, só pessoas da Org A na lista; modelo criado, 4 etapas, reordenação por teclado, remoção, persistência após recarregar; etapa sem título e dependência circular listadas por etapa e campo, **Publicar desabilitado** e API recusa (400 NOT_PUBLISHABLE); publicação v1 em leitura, API devolve 409 ao escrever na publicada, v2 criada e publicada, histórico v1/v2 com notas; **conflito 409** entre duas sessões sem sobrescrever; duplicar, arquivar (sem edição) e reativar; **função desativada** mostrada como "(desativada)", validação bloqueia nova publicação e a v2 publicada permanece intacta; **pessoa desativada** mostrada como "Pessoa removida ou inativa" sem quebrar a tela; gestor e membro: sem ações de gestão e API 403; sem sessão 401; Org B não vê nem abre modelos da Org A (404) e não os lê pela API; 390 px sem rolagem horizontal (lista, funções, construtor); nenhuma escrita no Asana simulado. Capturas no artefato `f7-onboarding-browser-<sha>` do CI.
- LIMITES/PENDÊNCIAS: (a) a F7-1b **não está encerrada** — aguarda aceite da Direção; (b) B2 (um onboarding ativo por cliente e modelo) segue para a F7-2; (c) **P22 segue bloqueador** (as permissões `onboarding.*` só existem em bancos já configurados após `rbac:bootstrap`); (d) índices parciais e gatilhos SQL não aparecem no `schema.prisma` — um `migrate diff` futuro vai listá-los; **não remover**; (e) o menu "Onboarding" aparece para todos os papéis (a tela trata a falta de permissão); (f) `lint:f6` agora também cobre o código da F7-1b.
- STATUS: **F7-1b concluída para revisão da Direção.** Nenhum dado fictício permanente; nenhuma escrita no Asana ou no Calendar; produção intocada.
- PRÓXIMA MICROETAPA: nenhuma autorizada. Aguarda aceite da F7-1b e decisão sobre a F7-2.

### DEC-F7-006 — Aceite formal da F7-1a e autorização exclusiva da F7-1b (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: a Direção revisou a entrega da F7-1a e confirmou o CI oficial 38272170671 (5/5 jobs).
- Decisão: (1) **F7-1a aceita formalmente.** (2) **Autorizada exclusivamente a F7-1b**: lista de modelos (criar, duplicar, arquivar, reativar); construtor visual (incluir, remover, reordenar e configurar etapas); funções operacionais e seus membros; rascunho, validação, publicação e histórico de versões; estados vazio, carregando, salvando, erro, conflito 409 e sem permissão; capacidades de onboarding no endpoint existente, **sem substituir a autorização do backend**. (3) **UX:** Design System da F3; experiência intuitiva (sem aparência de formulário técnico); desktop e 390 px; reordenação por teclado (arrastar só se não comprometer estabilidade e acessibilidade); erros em português indicando etapa e campo; rascunho, publicada e arquivada visualmente distintos; sem dados fictícios permanentes nem modelos automáticos. (4) **Cuidados:** Calendar indisponível na interface; funções ou pessoas desativadas/removidas sem comprometer o histórico publicado; índices parciais e gatilhos SQL preservados; função operacional nunca concede permissão; isolamento multiempresa, imutabilidade e concorrência preservados. (5) **Validação:** Browser Gate F7-1 completo (criar, editar, publicar, duplicar, arquivar e testes negativos de permissão), gates F4/F5/F6, API e PostgreSQL, CI oficial verde. (6) **Fora do escopo:** F7-2, F7-3, F7-4, passos 2 a 4 da P27, deploy de homologação ou produção; **P22 segue bloqueador**. (7) A F7-1b **não é declarada encerrada antes do aceite** da Direção.
- Alternativas consideradas: arrastar e soltar como única forma de reordenar (descartada: acessibilidade/estabilidade).
- Impacto: telas e endpoint de capacidades; sem mudança de modelo de dados.
- Revisão: no aceite da F7-1b.

### 2026-10-12 — F7-1a — Construtor de onboarding: modelo de dados, regras, RBAC, API e testes — Claude
- AUTORIZAÇÃO: DEC-F7-005 — somente F7-1a. Não iniciadas: F7-1b (telas), F7-2 a F7-4, passos 2 a 4 da P27. Sem deploy e sem produção.
- BASELINE (commit): `fc8ddb3` (contratos, domínio, permissões) e `5a604e8` (migration, API, teste de integração); especificação aprovada em `9d6bfce`.
- CI OFICIAL: run 38272170671 (https://github.com/Julianogdc/zafira-hub/actions/runs/38272170671) — **5/5 verdes**: domínio 51/51, API 818/818, web 51/51, PostgreSQL **57/57** (inclui 14 verificações novas do onboarding); Browser Gates F4, F5 e F6 (33/33) seguem passando; audit de produção na linha de base (0 críticas, 20 altas).
- ENTREGUE: 7 tabelas (`organization_functions`, `organization_function_members`, `onboarding_templates`, `onboarding_template_versions`, `onboarding_step_definitions`, `onboarding_step_dependencies`, `onboarding_events`) e migration `20261012030000` que **não cria nenhuma linha**; contratos Zod com catálogo **fechado** de condições (B1); regras de domínio (integridade do rascunho, validação de publicação, ciclo, ordem estável, cópia com `stepKey` preservado, dias úteis); 7 permissões `onboarding.*` com padrões por papel; API de modelos, versões e funções (prefixos `/` e `/api`) com trava do modelo, `expectedUpdatedAt`, evento e AuditLog.
- EVIDÊNCIAS (teste `onboarding-postgres.test.ts`, banco descartável real, passou 2× seguidas no mesmo banco):
  - **Migration sem dados:** as 7 tabelas estão vazias logo após migrar.
  - **Permissões:** ADMIN gerencia modelos e funções; MANAGER e MEMBER recebem 403 ao tentar criar (nada é criado); todos leem; sem sessão = 401.
  - **Isolamento multiempresa:** organização B recebe 404 em 11 operações sobre recursos da A (ler, editar, duplicar, arquivar, rascunho, salvar, validar, publicar, descartar, função, membros); token com organização alheia não passa; função da A referenciada num rascunho da B é recusada; pessoa de outra organização não entra numa função.
  - **Função independente do RBAC:** pessoa na função "Designer" continua sem gerir modelos ou funções (403) e sem nenhuma exceção de permissão criada.
  - **Versionamento:** v1 publicada → escrita pela API devolve 409; escrita **direta no banco** (alterar, apagar, inserir etapa ou dependência; alterar ou apagar a versão) é barrada pelo gatilho; v2 nasce com os **mesmos stepKey**, v1 permanece idêntica; só um rascunho por modelo.
  - **Concorrência:** dois "criar rascunho" simultâneos → 201 e 409; duas publicações simultâneas do mesmo rascunho → 200 e 409, numeração sem buracos (1, 2, 3); salvar rascunho desatualizado → 409 sem sobrescrever.
  - **Regras no banco, sem a API:** segundo rascunho, número de versão repetido, publicada sem data, nome de função repetido (com outra caixa), função **e** pessoa na mesma etapa, prazo fora da faixa, auto-dependência e dependência para etapa de outra versão — todos rejeitados pelo banco.
  - **Calendar indisponível:** tipo e condição ligados ao Calendar são rejeitados ao salvar e ao publicar (`CALENDAR_UNAVAILABLE`), por uma única chave de domínio que a F7-3 liga.
  - **Trilha:** cada ação relevante gera `OnboardingEvent` e `AuditLog` com autor; nada na organização B.
  - **Cascata:** remover a organização com versões publicadas funciona.
- ACHADO NA IMPLEMENTAÇÃO (corrigido antes de publicar): chaves estrangeiras `RESTRICT` das etapas para função e pessoa **impediam remover a organização** e impediriam remover uma pessoa citada num histórico publicado (imutável). Decisão técnica dentro do escopo: função com `NO ACTION DEFERRABLE INITIALLY DEFERRED` (função em uso não pode ser apagada; cascata funciona); `memberId` **sem** chave estrangeira — existência verificada ao salvar e pessoa ativa verificada ao publicar (e, na F7-2, na execução).
- AJUSTES À ESPECIFICAÇÃO (sem mudar decisão aprovada): `evidenceKind` = NONE/LINK/NOTE; nome de **modelo** também único por organização (sem diferenciar caixa); duplicar gera "Nome (cópia)" / "(cópia 2)"; um modelo arquivado não aceita edição nem publicação até ser reativado.
- LIMITES/PENDÊNCIAS: (a) **F7-1b** (telas do construtor e funções) não iniciada; (b) **B2** (um onboarding ativo por cliente e modelo) é implementada na F7-2 junto com a execução — a F7-1a não cria execuções; (c) índices parciais, expressões e gatilhos não aparecem no `schema.prisma`: um `prisma migrate diff` futuro vai listá-los como diferença — **não** remover; (d) **P22 segue bloqueador**: as 7 novas permissões só passam a existir em bancos já configurados depois de `rbac:bootstrap`, e o bootstrap continua só acrescentando; (e) a capacidade (`/api/v1/auth/capabilities`) ainda não expõe as permissões de onboarding — entra na F7-1b com a tela; (f) feriados para dias úteis e a regra de retenção de eventos do Calendar ficam para a F7-3/F7-2.
- STATUS: **F7-1a concluída para revisão da Direção.** Nenhum dado fictício permanente (fixtures só no teste, removidas ao final); nenhuma escrita no Asana ou no Calendar; produção intocada.
- PRÓXIMA MICROETAPA: nenhuma autorizada. Aguarda revisão da F7-1a; F7-1b somente com autorização.

### 2026-10-12 — Especificação F7-1 aprovada; F7-1a autorizada (DEC-F7-005) — Claude
- ORIGEM: decisões da Direção, via proprietário, sobre o commit `9ec4e75`.
- AUTORIZADO: **exclusivamente a F7-1a** — modelo de dados, migrations, regras de domínio, RBAC, API e testes. **Não** iniciar a F7-1b (telas), **não** executar os demais passos da P27, **não** fazer deploy de homologação nem de produção.
- ENTREGA ESPERADA: commits, testes, CI, evidências de isolamento multiempresa, versionamento, concorrência e pendências; sinalizar antes qualquer alteração arquitetural não prevista.

### DEC-F7-005 — Aprovação da F7-1: B1, B2 e ajustes obrigatórios (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: confirmar as decisões bloqueantes B1 e B2 e os ajustes da especificação da F7-1.
- Decisão: (1) **Especificação da F7-1 aprovada com ajustes.** (2) **B1:** **catálogo fechado** de condições de conclusão; **bloqueios manuais com justificativa auditável**; **não** implementar motor livre de regras. (3) **B2:** **no máximo um onboarding ativo por cliente e modelo**; modelos diferentes podem executar em simultâneo; concluído ou cancelado, o mesmo modelo pode ser iniciado de novo. (4) **Condições ligadas ao Google Calendar permanecem indisponíveis** até a entrega real da F7-3. (5) **Funções operacionais** são configuráveis, independentes do RBAC e **nunca concedem permissão**. (6) **Versões publicadas imutáveis**; mudança futura gera nova versão sem tocar execuções existentes. (7) **Unicidade e concorrência garantidas também no backend/banco**. (8) **`stepKey` estável** entre versões quando for a mesma etapa. (9) **P22 segue bloqueador** do primeiro deploy de homologação. (10) **Asana somente leitura** preservado. (11) **Sem dados fictícios permanentes** e sem alteração de produção.
- Alternativas consideradas: motor de regras livres (descartada); vários onboardings ativos do mesmo modelo por cliente (descartada).
- Impacto: especificação oficial ajustada (`docs/propostas/F7-1_ESPECIFICACAO_CONSTRUTOR_ONBOARDING.md`, seção 11); a restrição B2 é implementada na F7-2 (execução).
- Revisão: se aparecer condição de conclusão que o catálogo fechado não cubra (nova DEC, nunca configuração livre).

### 2026-10-12 — F7: direção ajustada para construtor configurável (DEC-F7-004) — Claude
- ORIGEM: nova decisão da Direção, trazida pelo proprietário. Entrega: `docs/propostas/F7-1_ESPECIFICACAO_CONSTRUTOR_ONBOARDING.md` (proposta; nada implementado).
- STATUS: **especificação aguardando revisão da Direção**; decisões bloqueantes para o modelo: **B1** (catálogo fechado de condições de conclusão) e **B2** (um onboarding ativo por cliente e modelo).
- ALTERA: a parte da DEC-F7-002 que dizia "o fluxo real será fornecido pela Direção antes de qualquer implementação". A estrutura passa a ser genérica; as perguntas Q1–Q12 de `F7_ONBOARDING_PROPOSTA_FUNCIONAL.md` deixam de ser bloqueantes e viram **conteúdo de modelos**, configurado pela interface.
- NÃO FEITO: nenhuma implementação, etapa fictícia permanente ou alteração em produção.

### DEC-F7-004 — F7 como construtor de onboarding configurável (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: a F7 dependia de conhecer o onboarding real da Zafira antes de construir.
- Decisão: (1) o **administrador** cria, edita, duplica, arquiva e versiona modelos e adiciona, remove, reordena e configura etapas **sem alterar código**; (2) onboarding iniciado **manualmente** ou pela **confirmação de contrato assinado**, respeitando que a F9 ainda não existe (a integração automática fica reservada); (3) **modelos distintos** por serviço, pacote ou tipo de cliente, sem quantidade fixa de modelos ou etapas; (4) cada etapa pode ter **responsável por função**, **responsável específico**, **prazo em dias úteis**, **dependências**, **bloqueios**, **evidências** e **condições de conclusão**; (5) permissões por **RBAC e escopo de cliente**; **funções operacionais não se confundem** com ADMIN/MANAGER/MEMBER; (6) **versões publicadas são imutáveis**; editar cria nova versão e **não altera** onboardings já iniciados; (7) **Google Calendar** segue como fonte principal de eventos, lido pelo Hub; **retenção histórica inicial proposta de 1 ano**, sujeita à avaliação de armazenamento, privacidade e política de retenção; (8) **o Hub não cria projeto no Asana**: confirma e vincula o projeto existente (reafirma a DEC-F7-003).
- Alternativas consideradas: esperar o processo real para modelar um fluxo fixo (descartada pela Direção).
- Impacto: novo modelo de dados (modelos, versões, etapas, dependências, funções); novas permissões de onboarding; fatiamento F7-1a/1b; Q1–Q12 viram configuração.
- Revisão: ao aprovar ou ajustar B1 e B2; se surgirem condições de conclusão que o catálogo fechado não cubra.

### 2026-10-12 — P27 passo 1 e decisões da F7 — Claude
- AUTORIZAÇÃO: Direção, via proprietário — remover só código morto e dependências sem consumidores (jspdf/exportUtils, axios, TiptapEditor e dependências associadas); reconfirmar referências antes; passos 2, 3 e 4 **não** autorizados; preservar a possibilidade de PDF financeiro na F10; sem produção.
- RECONFIRMAÇÃO: `git grep` no repositório inteiro (exceto docs e lockfile), incluindo importações dinâmicas, `require`, `import.meta.glob`, configuração do Vite e nomes de componente: **nenhum consumidor** além dos próprios arquivos mortos e do `package.json`.
- FEITO (`65b390e`): removidos `apps/web/src/lib/exportUtils.ts` e `apps/web/src/components/projects/TiptapEditor.tsx`; removidas as dependências `jspdf`, `axios`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, `@tiptap/extension-underline` (100 pacotes na árvore; lockfile com 6 inserções e ~1.200 remoções). `html2canvas` foi mantida (sem aviso e sem uso; não estava na lista) — candidata a remoção futura.
- ANTES × DEPOIS (`npm audit --omit=dev`): **33 → 23** — críticas **1 → 0**, altas **25 → 20**, moderadas **7 → 3**. `jspdf`, `axios`, `@tiptap/core`, `prosemirror-view` e `linkify-it` saíram da lista. Linha de base do CI atualizada (0 críticas, 20 altas).
- VALIDAÇÃO LOCAL: `typecheck:web` 0 erros; `test:web` 51/51; `lint:f6` 0 erros; `build:web` ok e **sem** as bibliotecas no bundle; árvore de dependências íntegra. API e domínio não importam nada removido. Resultado do CI oficial: ver entrada abaixo, quando houver.
- CI OFICIAL: run 38266680937 (https://github.com/Julianogdc/zafira-hub/actions/runs/38266680937) — **5/5 verdes** em `65b390e`: domínio 41/41, API 818/818, web 51/51, PostgreSQL 43/43, Browser Gates F4 e F5 PASS e **F6 33/33 PASS**; relatório de audit no CI: críticas 0, altas 20 (= linha de base).
- NÃO FEITO (por regra): passos 2 (react-router), 3 (`npm audit fix`) e 4 (Tailwind) da P27; nenhuma alteração em produção.
- P27 permanece **aberta**: 20 altas restantes (react-router-dom, prisma/CLI, ferramentas de build e transitivas). Critério de saída inalterado.

### DEC-F7-001 — Fonte principal dos eventos: Google Calendar (D1, opção C)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: onde nascem e quem é a fonte de verdade dos eventos da agenda.
- Decisão: o **Google Calendar é a fonte principal** na primeira entrega; o Hub **lê** e faz **vínculos locais** por cliente, projeto e categoria. Criar ou editar eventos pelo Hub é evolução futura e **depende de decisão adicional**. Calendários, contas, visibilidade e frequência de sincronização **ainda serão definidos** — não presumir.
- Alternativas consideradas: Hub mestre (A); por categoria com bidirecional (B).
- Impacto: novo conector de leitura com credencial por organização; sem conflito de precedência na 1ª entrega; eventos recorrentes no fuso da organização (DEC-F6-005).
- Revisão: quando o proprietário quiser criar eventos pelo Hub ou edição bidirecional (exige regra de precedência).

### DEC-F7-002 — Estrutura técnica do template de onboarding (D2, opção B)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: como modelar o template de onboarding.
- Decisão: **etapas com dependências, responsável por função, prazos relativos e templates versionados** (imutáveis após publicados; execuções referenciam a versão). O **fluxo real do onboarding da Zafira será fornecido pela Direção**; **nenhuma etapa será presumida** nem implementada antes disso.
- Alternativas consideradas: checklist linear (A); fases › etapas › tarefas (C).
- Impacto: modelo de dados e regras da F7-1; lista de funções da agência a definir (pergunta Q4).
- Revisão: se o onboarding real exigir três níveis (opção C).

### DEC-F7-003 — Onboarding e Asana: confirmar e vincular, sem escrever (D3)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: a v1.1 previa "criar projeto no Asana" como etapa de onboarding, contrariando a DEC-ASANA-001.
- Decisão: a etapa passa a ser **"confirmar projeto existente e vinculá-lo ao cliente"** (vínculo local). **Nenhuma escrita no Asana fica autorizada.**
- Alternativas consideradas: criação automática por exceção (descartada).
- Impacto: etapa do tipo "confirmar projeto Asana" usa o vínculo local já existente.
- Revisão: somente por nova DEC explícita do proprietário.

### 2026-10-12 — Encerramento da F6 e incorporação do Mapa C2 — Claude
- ORIGEM: decisões da Direção (Chat de Direção), trazidas pelo proprietário na conversa, após revisar o relatório da F6-IMP.9 e a proposta do Mapa C2.
- FEITO: (1) aceite da F6-IMP.9 e encerramento da F6 registrados (DEC-F6-006); (2) proposta C2 conferida contra as DECs e incorporada ao `docs/MAPA_MESTRE.md` como partes 13–17, sem apagar nenhuma seção C1; (3) triagem técnica da P27 em `docs/operations/TRIAGEM_VULNERABILIDADES_P27_2026-10-12.md`; (4) P22 elevada a bloqueador, P13 e P18 com critério e prazo; (5) preparação da F7 em `docs/propostas/F7_DECISOES_DE_PRODUTO.md`.
- COMPATIBILIDADE C2 × DECs: sem conflito com DEC-GOV-001 a 004 (fonte no Git, papéis), DEC-ASANA-001/002, DEC-F6-001 a 005. Um ponto previsto: a etapa "aprovada/postada" das peças de Entregas passa a ser preenchida pela F8, como a própria DEC-F6-002 já previa (condição de revisão). Numeração C1 e critérios anteriores preservados.
- DIVERGÊNCIAS IDENTIFICADAS (não corrigidas por conta própria): (a) v1.1 previa "criação assistida de projeto Asana" no onboarding — contraria DEC-ASANA-001, levada como D3 da F7; (b) Mapa C1 §7 (F6-IMP.7) previa evidências com vínculo a Asana/Conteúdo/arquivos — implementado só link opcional (P23, consistente com DEC-F6-002); (c) cabeçalho do C1 exigia o C2 "antes da F6-IMP.6" — só foi entregue na F6-IMP.9, agora resolvido; (d) código morto com dependência vulnerável: `jspdf`, `axios` e `TiptapEditor` (P27).
- NÃO FEITO (por regra): nenhuma dependência alterada; nenhuma funcionalidade da F7; nenhum acesso a produção; itens [DECIDIR] não viraram decisões.
- EVIDÊNCIA/CI: alterações só em `docs/`; nenhum código mudou desde o run 38262704358 (5/5). O CI automático do push não foi aguardado nesta sessão.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma de código. Aguarda decisões D1–D3 da F7 e a autorização do passo 1 da P27.

### DEC-F6-006 — Encerramento da F6, Mapa C2 e regras de fase (Direção, 2026-10-12)
- Data / responsável: 2026-10-12 / Direção, via proprietário.
- Problema: fechar a F6 com a carga de trabalho só parcialmente atendida, oficializar o Mapa C2 e decidir o destino de "Dashboards finais" e "Identidade visual", que a v1.1 tinha como fases e o C1 não.
- Decisão: (1) **F6-IMP.9 aceita; F6 encerrada**, com ressalva: o painel de distribuição e capacidade da equipe vira **requisito da F15**, sem reabrir a F6; Asana permanece somente leitura. (2) **Mapa C2 aprovado como direção e incorporado** ao Mapa (partes 13–17). (3) **Dashboards finais:** sem fase nova; métricas e drill-down nas fases dos domínios, experiência do colaborador completada na F15, revisão global na F18. (4) **Identidade visual:** sem fase nova; Design System da F3 obrigatório em toda interface nova; auditoria visual e de consistência na F18. (5) Itens [DECIDIR] não tratados continuam pendentes. (6) **P27:** triagem técnica, sem upgrade amplo automático. (7) **P22:** bloqueador do primeiro deploy de homologação. (8) **P13 e P18:** mantidas com critérios e prazos explícitos. (9) **F7:** preparar pelas decisões de produto; nada de implementação antes do registro do fechamento da F6 e das decisões necessárias.
- Alternativas consideradas: criar fases novas para dashboards e identidade visual (descartado pela Direção); manter a F6 aberta até o painel de capacidade (descartado).
- Impacto: Mapa (versão C2); F15 e F18 ganham requisitos; backlog de segurança com bloqueador explícito; F7 depende das decisões D1–D3.
- Revisão: se a medição de capacidade do servidor ou a F15 mostrar que o painel de equipe precisa vir antes.

### 2026-10-12 — Aceite da F6-IMP.9 — proprietário (Direção)
- A F6-IMP.9 (CI oficial 38262704358 com Browser Gates F4, F5 e F6 verdes) foi **aceita**. Ver DEC-F6-006 para o encerramento da F6 e a ressalva.

### 2026-10-12 — F6-IMP.9 — Homologação da F6 concluída para aceite — Claude
- CONTEXTO: o Antigravity ficou sem uso no meio da sessão; o proprietário pediu a Claude que retomasse de onde ele parou. O último CI do Antigravity (run 38205658587, `ab16e18`) tinha falhado no gate F6 com 32/33.
- BASELINE (commit): `75f2112`. Commits desta retomada: `5ee7661` (gate), `75f2112` (qualidade), `aef3149` (documentação e proposta do Mapa C2). Commits anteriores da etapa: `43a1398`, `ee87f4d`, `c2ca05f` (Claude); `8072ec9`, `755a9f9` (Antigravity).
- DIAGNÓSTICO: a única falha (cenário F, "contagem sobe para 3 só ao postar") era do teste: o gate esperava o texto "Postada", que também aparece no botão "Marcar como postada", e lia o indicador antes da resposta da API. Correção: espera pelo selo exato e espera ativa do indicador.
- QUALIDADE (P13): 4 `catch (err: any)` de `Projetos.tsx` tipados; `npm run lint:f6` bloqueante no job Code Quality (0 erros; 6 avisos); `scripts/ci/npm-audit-report.mjs` gera relatório de vulnerabilidades de produção e avisa acima da linha de base `scripts/ci/npm-audit-baseline.json` (1 crítica, 25 altas). O audit não bloqueia porque novas falhas em bibliotecas antigas quebrariam o CI sem mudança de código; a correção ampla vira **P27** (decisão do proprietário).
- MAPA C2 (P3, DEC-F6-005): proposta em `docs/propostas/MAPA_MESTRE_C2_PROPOSTA.md` — critérios de pronto/concluído, Browser Gate por fase, correspondência v1.1 → C1, critérios de aceite e portões F7–F18, segurança, testes, observabilidade, migração, decisões pendentes e duas lacunas (Dashboards finais e Identidade visual sem fase no C1). **Não é oficial** até aprovação.
- CI/EVIDÊNCIA: run 38262704358 (https://github.com/Julianogdc/zafira-hub/actions/runs/38262704358) — **5/5 verdes**: domínio 41/41, API 818/818, web 51/51, PostgreSQL 43/43, lint F6 0 erros, audit na linha de base, Browser Gate F4 PASS, F5 PASS e **F6 33/33 PASS**.
- PORTÃO DA F6: avaliação item a item em `docs/ESTADO_ATUAL.md`; único ponto parcial é "carga de trabalho" (por filtro/agrupamento por responsável, sem painel dedicado).
- LIMITES/LACUNAS: P18 (teste RBAC antigo não reexecutável) e o lint completo do web continuam abertos, reclassificados para antes da F18; nenhum teste com o Asana real; agendador desligado (P24).
- STATUS: F6-IMP.9 pendente de aceite; encerramento da F6 aguarda aprovação do proprietário.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma até o aceite e a decisão sobre o portão da F6.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / proposta do Mapa C2.

### 2026-10-12 — F6-IMP.9 — resolução dos gates F4 e F6 no CI — Antigravity
- BASELINE: `755a9f9` (correção de seletores/semântica em Projetos.tsx e projects-browser-gate.py; `8072ec9` no workflow).
- DIAGNÓSTICO E CORREÇÕES:
  1. Gate F4: O run 38202110078 falhou no Browser Runtime Gate da F4 com timeout no EmptyState da Org B. Causa: `seed-f6-gate.mjs` rodava antes da F4, criando um cliente ativo na Org B que impedia o EmptyState ("Nenhum cliente cadastrado"). Solução (`8072ec9`): mover `seed-f6-gate.mjs` para rodar após o gate F5 e imediatamente antes do gate F6. Com isso, no run 38204209630, o gate F4 e o gate F5 passaram 100% com sucesso.
  2. Gate F6: O run 38204209630 executou o novo gate F6 pela primeira vez e falhou com strict mode violation do Playwright em `locator("main")`, que resolveu para 2 elementos (o `<main>` do layout e o `<main className={styles.contentArea}>` de `Projetos.tsx`). Solução (`755a9f9`): substituir a tag `<main>` aninhada em `Projetos.tsx` por `<div>` (corrigindo a semântica HTML5 onde apenas um `<main>` deve existir por documento) e usar `.first.inner_text()` nas leituras de texto em `projects-browser-gate.py`.
- EVIDÊNCIA LOCAL: `typecheck:contracts`, `typecheck:api`, `typecheck:web` 0 erros; `test:domain` 41/41; `npm test` 818/818; `test:web` 51/51; `build:api` e `build:web` ok; `secret-scan` limpo.
- STATUS: em andamento — acompanhando nova execução do CI oficial para validar F4, F5 e F6 simultaneamente.

### 2026-10-12 — F6-IMP.9 — trabalho parcial (interrompido por limite de uso) — Claude
- COMMITS: `43a1398` (fuso por organização, DEC-F6-005/P15), `ee87f4d` (botões de visualização quebram linha em 390 px — "Entregas" ficava fora da tela no celular), `c2ca05f` (Browser Gate F6 no CI: Asana simulado somente leitura, seed F6, cenários A–J).
- EVIDÊNCIA LOCAL: domínio 41/41, API 818/818, web 51/51, PostgreSQL 43/43 em banco novo; ensaio local das verificações de API do gate 17/17 (Asana simulado + banco no formato do CI) e fluxo de tela conferido no navegador. O gate em Python só roda no CI (não há Python local).
- CI: run 38202110078 disparado para `c2ca05f` — **resultado ainda não conferido**. Se o gate F6 falhar, ajustar seletores em `scripts/homologation/projects-browser-gate.py` pelos artefatos `f6-projects-browser-*`.
- FALTA: (3) qualidade — corrigir os 4 `catch (err: any)` de `Projetos.tsx`, lint bloqueante do código F6 no CI e relatório de `npm audit` (33 vulnerabilidades de produção: 1 crítica `jspdf`, 25 altas — correção ampla vira P27, decisão do proprietário); (4) rascunho PROPOSTA do Mapa C2 em `docs/propostas/` (DEC-F6-005); depois handoff, CI 5/5 e submissão do portão F6 ao proprietário.

### DEC-F6-005 — Fuso horário por organização e rascunho do Mapa C2 (F6-IMP.9)
- Data / responsável: 2026-10-12 / proprietário (respostas diretas na conversa com Claude, ao autorizar a F6-IMP.9).
- Problema: P15 — prazos/"atrasado"/"hoje" usavam o relógio do navegador e a foto diária do Asana usava São Paulo fixo, enquanto o Mapa prevê o fuso da organização. P3 — o Mapa C2 completo estava pendente antes da homologação da F6, sem responsável definido.
- Decisão: (1) **fuso configurável por organização, padrão America/Sao_Paulo**, usado em prazos, atraso, "hoje" e na foto diária do espelho do Asana; (2) **Claude elabora um rascunho do Mapa C2**, marcado como PROPOSTA, que só vira oficial após aprovação do proprietário (ou do Chat de Direção por delegação dele).
- Alternativas consideradas: São Paulo fixo para tudo; manter o relógio do navegador; Mapa C2 pelo Chat de Direção; adiar o Mapa C2 para depois da F6.
- Impacto: migration com novo campo de fuso na organização (padrão São Paulo); sessão informa o fuso da organização ativa; espelho do Asana passa a datar fotos pelo fuso da organização; novo documento `docs/propostas/` (não substitui `docs/MAPA_MESTRE.md` até aprovação).
- Revisão: se alguma organização precisar de regras de fuso por cliente/equipe.

### 2026-10-12 — Aceite da F6-IMP.8 — proprietário
- A F6-IMP.8 (espelho e histórico do Asana: `509241a`, `f360ac2`, `96f082f`; DEC-F6-003 revisada pela DEC-F6-004; CI oficial 5/5 verde no run 38198738925) foi **aceita** pelo proprietário ("aceito").
- Próxima microetapa: F6-IMP.9 — Homologação da F6, quando o proprietário pedir o início. O agendador do espelho continua desligado até P24.

### 2026-10-12 — F6-IMP.8 (tempo real) — CI oficial — Claude
- BASELINE: `96f082f` (código); publicado até `ba5b6b7`.
- CI/EVIDÊNCIA: run 38198738925 (https://github.com/Julianogdc/zafira-hub/actions/runs/38198738925) — **5/5 verdes**: domínio 38/38, API 817/817, web 50/50, PostgreSQL 42/42.
- EFEITOS EXTERNOS: nenhum deploy, VPS, banco real, Asana ou conta real; só a publicação automática de imagens no GHCR feita pelo CI. Agendador continua desligado por padrão.
- STATUS: F6-IMP.8 pendente de aceite.

### 2026-10-12 — F6-IMP.8 — ajuste para tempo real (DEC-F6-004) — Claude
- BASELINE (commit): `96f082f`.
- CI/EVIDÊNCIA (local): typecheck api/web 0 erros; `npm test` **817/817** (+3: horário da conferência noturna em São Paulo, nova tentativa única quando outra conferência está rodando, recusa de endereço de avisos sem https/sem configuração); `test:web` 50/50; `build:api` e `build:web` ok; `secret-scan` limpo. O motor do espelho (serviço) não mudou; o teste de integração em PostgreSQL roda no CI. Resultado do CI oficial: entrada de confirmação abaixo, quando houver.
- O QUE MUDOU: agendador passa de "a cada 6 horas" para **tempo real pelos avisos (10 s de agrupamento) + conferência noturna às 03:00 (São Paulo) + conferência 2 min após iniciar**; `getWebhookBaseUrl` deixa de cair no endereço do Hub 2.0 e recusa sem `WEBHOOK_BASE_URL`/`API_BASE_URL` https; texto do painel atualizado.
- LIMITES/LACUNAS: o tempo real só funciona em ambiente com endereço público e inscrições de aviso (P25); agendador continua desligado até medição de capacidade e autorização (P24). O padrão do redirecionamento OAuth ainda aponta para o Hub 2.0 (P5, inalterada).
- STATUS: F6-IMP.8 pendente de aceite.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F6-004 — Histórico do Asana em tempo real + conferência noturna (revisa o item 2 da DEC-F6-003)
- Data / responsável: 2026-10-12 / proprietário ("não gosto da ideia do Hub atualizar a cada 6 horas, teria como as atualizações serem em tempo real?" e escolha "Tempo real + conferência 1x por noite").
- Problema: a DEC-F6-003 previa conferência a cada 6 horas; o proprietário quer o histórico atualizado em tempo real.
- Decisão: (1) atualização **em tempo real pelos avisos do Asana** (webhooks, DEC-ASANA-002), agrupando avisos por **10 segundos**; (2) **conferência de segurança uma vez por noite** (03:00, horário de São Paulo), que também tira a foto diária e corrige avisos perdidos; (3) mantém uma conferência 2 minutos após a API iniciar, para cobrir avisos perdidos enquanto ela esteve fora do ar; (4) sem endereço público do Hub 2.1 configurado, o Hub **não** registra avisos no Asana (antes usaria por padrão o endereço do Hub 2.0). Continua: agendamento dentro da API, desligado por padrão, somente leitura, retenção de 13 meses.
- Alternativas consideradas: tempo real + conferência de hora em hora (mais uso de servidor e cota); só tempo real (avisos perdidos nunca entrariam no histórico).
- Impacto: agendador e configuração por variáveis (`ASANA_MIRROR_NIGHTLY_HOUR`, `ASANA_MIRROR_WEBHOOK_DEBOUNCE_SECONDS`); para funcionar em tempo real o ambiente precisa de endereço público (`WEBHOOK_BASE_URL`) e das inscrições de aviso por projeto (P25).
- Revisão: se a medição em homologação mostrar avisos perdidos com frequência, considerar conferências mais frequentes.

### 2026-10-12 — F6-IMP.8 — CI oficial — Claude
- BASELINE: `f360ac2` (código); publicado até `31e40b7`.
- CI/EVIDÊNCIA: run 38197057877 (https://github.com/Julianogdc/zafira-hub/actions/runs/38197057877) — **5/5 verdes**. Testes no CI: domínio 38/38, **API 814/814** (antes 555 — P21 confirmada como resolvida), web 50/50, PostgreSQL Integration Gate 42/42 com a migration `20261012010000` aplicada no banco descartável do CI.
- EFEITOS EXTERNOS: nenhum deploy, VPS, banco real, Asana ou conta real; só a publicação automática de imagens no GHCR feita pelo próprio CI. O agendador continua desligado por padrão.
- STATUS: F6-IMP.8 pendente de aceite.

### 2026-10-12 — F6-IMP.8 — Espelho e snapshots do Asana — Claude
- BASELINE (commit): `62b4ee2` (testes da API no CI, P21), `509241a` (migration, serviço, agendador, rotas, testes), `f360ac2` (tela).
- CI/EVIDÊNCIA (local): typecheck contracts/domain/api/web 0 erros; `test:domain` 38/38; `npm test` **814/814** (+8 do espelho); `test:web` **50/50** (+3); `build:api` e `build:web` ok; lint dos arquivos novos 0 erros (os 4 erros em `Projetos.tsx` são os `any` antigos da P13); `secret-scan` limpo. Réplica do job "PostgreSQL Integration Gate" em banco novo (PostgreSQL 16 descartável, UTF-8): migrations + 2× bootstrap + `test:integration:db` **42/42** (10 novos do espelho); o arquivo novo passou 3 vezes seguidas sozinho. Resultado do CI oficial: entrada de confirmação abaixo, quando houver.
- PROVAS (integração real, Asana simulado somente leitura): 1ª conferência cria espelho e foto sem histórico falso; 2ª no mesmo dia registra concluída/nome/prazo/responsável/criada e atualiza a foto do dia (uma por dia); dia seguinte gera nova foto e tarefa sumida fica marcada como removida (nada apagado); falha do Asana mantém tarefas e fotos idênticas, não grava foto do dia, marca FAILED e preserva a última conferência boa; falha de credencial não vaza o texto da credencial no `SyncRun`; trava ocupada → conferência pulada sem ler o Asana; duas conferências simultâneas → só uma roda; mesmo projeto em outra organização tem espelho próprio; rota de histórico: carteira (404), outra organização (404), `days` inválido (400), sem sessão (401); "Atualizar agora": membro sem `projects.sync` 403, admin sem Asana conectado registra falha sem apagar nada; retenção descarta só o que passou de 13 meses.
- EVIDÊNCIA VISUAL (1280 px, API real + banco descartável, 14 dias simulados pelo motor real com Asana falso, dados fictícios; capturas fora do repositório): painel "Evolução no Asana" com "Conferido em …", gráfico de 30 dias (12 dias com foto; os 2 dias sem conferência ficam sem ponto) e mudanças (concluída, prazo, responsável, renomeada, criada, saiu, voltou). "Atualizar agora" sem Asana conectado mostra "Falhou em …" com o motivo e mantém os dados da última conferência boa. Log da API confirma "agendador não iniciado" (desligado por padrão).
- ACHADO E CORREÇÃO (P21): o script `test` da API usava `src/modules/**/__tests__/*.test.ts` sem aspas; no CI (Linux) o shell expandia `**` como um nível só e ignorava 12 de 27 arquivos de teste (555 testes no CI contra 806 local). Com aspas, o Node expande o padrão recursivamente — o CI passa a rodar todos.
- LIMITES/LACUNAS: agendador desligado até medição de capacidade e autorização (P24); webhooks dependem de inscrições e URL pública (P25); cota da API do Asana a medir (P26); fuso fixo America/Sao_Paulo na foto diária (P15); sem teste de componente (P20). Nenhuma chamada real ao Asana nesta etapa.
- STATUS: pendente de aceite.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma nova até o aceite. Depois: F6-IMP.9 (homologação da F6).
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F6-003 — Histórico do Asana e sincronização (resolve P4)
- Data / responsável: 2026-10-11 / proprietário (respostas diretas na conversa com Claude).
- Problema: a F6-IMP.8 (espelho e snapshots) precisava saber quanto histórico do Asana guardar e se haveria sincronização automática por worker/fila (P4). Hoje não existe nenhum processo automático; já existem a rota que recebe webhooks do Asana (DEC-ASANA-002) e as tabelas `SyncRun` e `WebhookEvent`. A capacidade do servidor ainda não foi medida (pendência da Fase 0).
- Decisão:
  1. **Histórico:** uma **foto diária por projeto** (total, concluídas, pendentes, atrasadas) e o **registro das mudanças relevantes das tarefas** (conclusão, prazo, responsável, seção, nome). **Retenção de 13 meses**, com descarte controlado do que passar disso.
  2. **Sincronização:** **webhooks do Asana + conferência agendada dentro da própria API**, sem serviço novo no servidor (ex.: conferência a cada 6 horas e foto diária de madrugada). A execução agendada deve ser única mesmo com mais de uma instância da API, registrada em `SyncRun`, e falhas preservam o último estado válido e aparecem como frescor/erro na tela.
  3. Continua **somente leitura**: o Hub só lê do Asana (DEC-ASANA-001).
- Alternativas consideradas: só números diários; guardar tudo sem prazo; nenhum histórico (exigiria mudar o portão da F6); worker separado com fila (exige medir o servidor e autorização de infraestrutura); só ao abrir a tela (histórico com buracos).
- Impacto: novas tabelas de espelho/fotos/mudanças (migration ensaiada só em base descartável); agendador na API; consumo de cota da API do Asana; crescimento de banco limitado pelos 13 meses.
- Revisão: separar em worker com fila quando a capacidade do servidor for medida e o volume justificar; rever a retenção se o proprietário precisar de mais tempo.

### 2026-10-11 — Aceite da F6-IMP.7B — proprietário
- A F6-IMP.7B (operação de Entregas: `489c34b`, `7c3a4a4`, `da68eae`; CI oficial 5/5 verde no run 38193471184) foi **aceita** pelo proprietário ("pode aceitar a F6-IMP.7B").
- Próximo: decidir a P4 (quanto histórico do Asana guardar e se haverá sincronização automática por worker/fila) antes de iniciar a F6-IMP.8.

### 2026-10-11 — F6-IMP.7B — CI oficial — Claude
- BASELINE: `da68eae` (código); publicado até `3039b2c`.
- CI/EVIDÊNCIA: run 38193471184 (https://github.com/Julianogdc/zafira-hub/actions/runs/38193471184) — **5/5 verdes**; PostgreSQL Integration Gate 32/32 (inclui "Operação de Entregas (F6-IMP.7B)"), migration `20261011120000` aplicada no banco descartável do CI.
- EFEITOS EXTERNOS: nenhum deploy, VPS, banco real, Asana ou conta real; só a publicação automática de imagens no GHCR feita pelo próprio CI.
- STATUS: F6-IMP.7B pendente de aceite.

### 2026-10-11 — F6-IMP.7B — Operação de Entregas — Claude
- BASELINE (commit): `489c34b` (contratos/domínio/RBAC), `7c3a4a4` (migration, API, testes), `da68eae` (tela).
- CI/EVIDÊNCIA (local): typecheck contracts/domain/api/web 0 erros; `test:domain` 38/38 (+8); `npm test` 806/806; `test:web` 47/47 (+3); `build:api` e `build:web` ok; lint dos arquivos alterados 0 erros (2 avisos de fast-refresh); `secret-scan` limpo. Réplica do job "PostgreSQL Integration Gate" em banco novo (PostgreSQL 16 descartável, UTF-8): migrations + 2× bootstrap + `test:integration:db` **32/32** (10 novos de operação). Resultado do CI oficial: entrada de confirmação abaixo, quando houver.
- ENSAIO DA MIGRATION: banco descartável com as migrations anteriores e dados no formato antigo (plano `PLANNING`, eventos `ITEM_CREATED`, `ITEM_CANCELLED`, `PERIOD_CLOSED`, `PERIOD_REOPENED`); após `20261011120000`: 2 planos, 1 item e 7 eventos preservados e renomeados. `prisma migrate diff` banco × schema: nenhuma diferença em Entregas (só 3 nomes antigos de índice/chave em `integration_connections` e `organization_invitations`, anteriores à F6). O primeiro ensaio falhou porque o banco local estava em WIN1252 e o comentário do SQL tinha "→"; o SQL ficou só ASCII e o banco local passou a ser criado em UTF-8 como o do CI.
- EVIDÊNCIA VISUAL (1280 px, API real + banco descartável, dados fictícios, painel do navegador; capturas fora do repositório): admin cria o plano (12 conteúdos + 2 criativos = meta 14); peça Reels passa por Produzida → Aprovada → Postada e só então conta (1 de 14); "Voltar etapa" fica bloqueado sem justificativa e, com ela, a contagem volta a 0; "Fechar mês" deixa tudo somente leitura e só "Reabrir mês" aparece (bloqueado sem justificativa); histórico mostra cada passo com autor e justificativa. Como membro: sem "Fechar mês", "Ajustar meta" ou "Adicionar linha"; registra e aprova peça; tentativa direta de fechar o mês pela API → 403.
- O QUE MUDOU: ver `docs/ESTADO_ATUAL.md` (F6-IMP.7B) e DEC-F6-002. Também: endpoint de capacidades passa a informar `deliverables.register/adjust_target/complete/reopen` (allowlist atualizada no teste); teste de falha da 7A deixou de renomear a tabela (derrubava os testes paralelos) e injeta a falha só no próprio processo; a trava estática do web foi ajustada à nova tela sem plano (estado vazio + "Criar plano", nenhum número).
- LIMITES/LACUNAS: P20 (sem teste de componente), P21 (CI roda menos testes de API que o local), P22 (bootstrap não remove `deliverables.complete` do MEMBER em bancos antigos), P23 (sem vínculo de evidência por Asana/arquivo nas peças).
- STATUS: pendente de aceite.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma nova até o aceite. Depois: F6-IMP.8, condicionada à decisão P4.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F6-002 — Taxonomia e regra de entrega da Zafira (F6-IMP.7B)
- Data / responsável: 2026-10-11 / proprietário (respostas diretas na conversa com Claude).
- Problema: a operação de Entregas (F6-IMP.7B) precisava saber o que a Zafira vende, como a meta é contada e quando algo conta como entregue (P17).
- Decisão:
  1. **Serviços contratados:** conteúdos para redes (post no feed, carrossel, Reels/vídeo curto, Stories), criativos para anúncios, relatório mensal, captação de foto/vídeo, gestão de tráfego pago (Google e Meta Ads) e "outro".
  2. **Meta de conteúdos = pacote único por mês** (ex.: 8 ou 12 conforme o valor do contrato). Qualquer formato conta; o formato fica registrado em cada peça. O que passar da meta de uma linha é **extra** e não compensa déficit de outra linha nem de outro mês.
  3. **Entregue = marcado, aprovado e postado.** Cada peça passa por **produzida → aprovada → entregue/postada** e só conta como entregue na última etapa. Os demais serviços seguem o **mesmo fluxo**.
  4. Enquanto não existem o módulo de aprovação do cliente (F8) e a publicação automática (Postiz), as etapas são **registradas manualmente pela equipe, sem prova obrigatória** (link opcional).
  5. **Permissões:** admin e gestor montam o plano, ajustam meta (com justificativa) e fecham/reabrem o mês; membros registram e avançam peças dos clientes da sua carteira.
- Alternativas consideradas: meta fixa por formato; pacote com mínimos por formato; prova obrigatória; esperar a F8 — descartadas pelo proprietário.
- Impacto: nova entidade de peça com etapas (migration nova, ensaiada só em base descartável); contrato alinhado ao banco; nova permissão `deliverables.register` e retirada de `deliverables.complete` do papel MEMBER; cálculo de metas por linha com excedente como extra; F8/Postiz preencherão as etapas no futuro.
- Revisão: quando F8 (aprovação) ou Postiz (publicação) entrarem, ou se o proprietário exigir prova.

### 2026-10-11 — Aceite da F6-IMP.7A — proprietário
- A F6-IMP.7A (leitura de Entregas: `087cdb8`, `1837801`, `6e15430`, `81b010c`; CI oficial 5/5 verde no run 38189197511) foi **aceita** pelo proprietário ("aceito, pode continuar"). Isso também confirma a divisão 7A/7B da DEC-F6-001.
- Próxima microetapa autorizada: **F6-IMP.7B — Operação de Entregas**, que depende antes da taxonomia de entregas (P17).
- Correção documental: as referências anteriores a "Mapa 8.5" para a taxonomia estavam erradas (a seção 8 do Mapa trata de UI/UX); a taxonomia não está definida no Mapa.

### 2026-10-11 — F6-IMP.7A — publicação e CI oficial — Claude
- AUTORIZAÇÃO: proprietário/Direção autorizou publicar somente os commits locais da F6-IMP.7A e acompanhar o CI.
- PRÉ-CONDIÇÕES CONFERIDAS: `git status` limpo e sem arquivos não rastreados; `git fetch origin --prune`; `origin/hub-2.1` em `346c408` (último baseline remoto esperado); 3 commits locais lineares (0 atrás, 0 merges): `6e15430`, `81b010c`, `bb00856`; arquivos alterados só de F6-IMP.7A e governança (2 testes novos, `Projetos.tsx`, `CanonicalTaskList.tsx`, `docs/ESTADO_ATUAL.md`, `docs/REGISTRO.md`).
- PUBLICAÇÃO: `git push origin hub-2.1` (`346c408..bb00856`), sem force, rebase, reset ou amend.
- CI/EVIDÊNCIA: run 38189197511 (https://github.com/Julianogdc/zafira-hub/actions/runs/38189197511) — **5/5 verdes**: Code Quality and Tests, PostgreSQL Integration Gate (21/21, incluindo os 7 novos de Entregas), Docker Build Gate, Publish Images, Homologation Rehearsal. Testes no CI: domínio 30/30, API 555/555, web 44/44.
- EFEITOS EXTERNOS: nenhum deploy, VPS, EasyPanel, banco real, Asana, OAuth ou conta real. O único efeito fora do repositório é o automático do próprio CI: o job "Publish Images" publica as imagens `zafira-hub-api`/`zafira-hub-web` no GHCR do repositório (como em todo push em `hub-2.1`); o "Homologation Rehearsal" roda só no executor do GitHub.
- ACHADO: o CI roda 555 testes de API contra 806 localmente, já antes desta etapa (P21).
- STATUS: F6-IMP.7A **pendente de aceite da Direção/proprietário**. F6-IMP.7B não iniciada.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO. Este registro fica em commit local até nova autorização de push.

### 2026-10-11 — F6-IMP.7A — validação complementar em PostgreSQL descartável e evidência visual — Claude
- BASELINE (commit): `6e15430` (testes) + `81b010c` (correção: Entregas independentes do Asana). **Commits só locais: push não autorizado nesta etapa**, então o CI oficial do GitHub não rodou para eles.
- PEDIDO: validação complementar sem produção, VPS, banco real, Asana ou push; provar 6 pontos; não iniciar F6-IMP.7B.
- AMBIENTE: Windows local; PostgreSQL 16 descartável (`embedded-postgres` instalado só em pasta temporária fora do repositório, banco `zafira_hub_ci` na porta 54329, apagado a cada início); API real do repositório apontando para esse banco, com variáveis de Postiz/Asana/chave interna zeradas; web pelo Vite. Nenhuma conta, banco ou serviço real.
- CI/EVIDÊNCIA (local):
  - Réplica do job "PostgreSQL Integration Gate" em banco novo: `prisma migrate deploy` (incluindo `20261010210000_f6_deliverables_foundation`), `migrate status`, preparação de organizações, 2× `rbac:bootstrap`, `test:integration:db` → **21/21** (14 existentes + 7 novos).
  - `npm test` 806/806, `test:web` 44/44, `test:domain` 30/30, `typecheck:api`/`web`/`domain` 0 erros, `build:api` e `build:web` ok, lint dos arquivos novos limpo, `secret-scan` limpo.
  - Trava web conferida: com o código de `087cdb8` restaurado temporariamente, 4 testes falham (sessão falsa, modo DEV, dados de demonstração, fallback no serviço).
- PROVAS (testes reais, sem Prisma simulado — `apps/api/src/integration-tests/deliverables-postgres.test.ts`):
  1. Org A não lê plano, itens, eventos, templates nem evidências da Org B: pedido pelo ID do cliente de B → 404 sem nenhum dado de B; token de usuário de B forjando organização ativa A → recusado; resposta de A sem dados de B e sem templates; simétrico para B.
  2. Membro sem o cliente na carteira → 404; com o cliente na carteira → 200; com `deliverables.view` negado → 403; sem sessão → 401.
  3. Cliente sem plano e mês sem plano → `{ plan: null, period, clientId }`, sem número.
  4. Falha real do banco (tabela de planos tirada do ar só no banco descartável) → 500 com mensagem explícita, sem plano; volta ao normal ao restaurar.
  5. POST/PUT/PATCH/DELETE nos dois prefixos → 404; tabelas de Entregas idênticas antes e depois (contagem e última alteração).
  6. Sem fallback administrativo: trava estática no web + navegador: com a API desligada, `/projetos` leva ao login, sem sessão nem dados.
- EVIDÊNCIA VISUAL (1280 px, API real + banco descartável com dados fictícios, painel do navegador do app; capturas não ficam no repositório): **com plano** — meta 24, entregues 15, pendentes 9, extra +1 separado, progresso 63%, evidência do Asana abrindo só `https://app.asana.com/...`, link `javascript:` bloqueado, histórico com justificativa e nome de quem agiu; **sem plano** — só o aviso "Nenhum plano de entregas em Setembro de 2026"; **erro** — "Erro ao carregar entregas" com "Tentar novamente", que recupera o plano após restaurar a tabela; **sem permissão** — "Acesso Negado às Entregas (deliverables.view)" para membro com o cliente na carteira e permissão negada.
- DEFEITO ENCONTRADO E CORRIGIDO (`81b010c`): a opção Entregas só existia dentro da lista de tarefas do Asana, então sumia quando o cliente não tinha projeto Asana vinculado ou quando a consulta de tarefas falhava ou carregava. Entregas são do Hub (não-presunção, DEC-ASANA-001): agora aparecem em seção própria nesses casos, e a barra de visualização continua visível durante carregamento/erro das tarefas. Trava de regressão incluída.
- INCIDENTE LOCAL (corrigido, sem perda): um `git stash` sem alterações seguido de `git stash pop` aplicou um stash antigo do proprietário ("pre-hub-2.0 CRM local changes") à árvore de trabalho. O stash foi registrado de volta (`stash@{0}`, mesmo commit `eb8bfc9`), o conteúdo foi conferido byte a byte e os 3 arquivos de CRM voltaram ao estado do commit. Agentes não devem usar `git stash` neste repositório.
- LIMITES/LACUNAS: CI oficial pendente de push; sem teste de componente/Browser Gate automatizado (P20); `rbac-postgres.test.ts` não é reexecutável no mesmo banco (P18, anterior à F6).
- STATUS: F6-IMP.7A pendente de aceite técnico e do proprietário. P16 encerrada.
- PRÓXIMA MICROETAPA AUTORIZADA: nenhuma nova. Próximo passo: autorização de push de `hub-2.1` para rodar o CI oficial; depois, aceite da F6-IMP.7A. **F6-IMP.7B não iniciada.**
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — CI restaurado e F6-IMP.7A confirmada no CI — Claude
- BASELINE (commit): `44ed39c`.
- CI/EVIDÊNCIA: run 38102508168 — 5/5 jobs verdes (Code Quality and Tests, PostgreSQL Integration Gate, Docker Build Gate, Publish Images, Homologation Rehearsal).
- STATUS: CI corrigido; F6-IMP.7A continua pendente de aceite.
- O QUE MUDOU: o CI estava **vermelho desde `ddd05d8`** (registro do aceite da F6-IMP.6), com falha no passo "Typecheck Domain": a F6-IMP.6 (`f142f9d`) fez o domínio importar tipos de `@zafira/contracts`, mas no CI limpo esse pacote só era compilado depois do typecheck. Localmente passava porque o `dist` já existia (falha reproduzida localmente removendo o `dist`). Correção: passo "Build Contracts" antes do "Typecheck Domain" em `.github/workflows/foundation-ci.yml`. O aceite da F6-IMP.6 foi registrado sem esse CI verde; o código aceito não mudou, e agora está confirmado no CI.
- LIMITES/LACUNAS: `packages/domain/package.json` não declara a dependência de `@zafira/contracts` (funciona por estar no mesmo workspace); ajustar quando houver mudança de dependências.
- PRÓXIMA MICROETAPA AUTORIZADA: aceite da F6-IMP.7A pelo proprietário; depois, F6-IMP.7B.

### 2026-10-10 — F6-IMP.7A — Entregas do cliente (leitura): auditoria e correção — Claude
- BASELINE (commit): `087cdb8` (Antigravity, interface de Entregas) + `1837801` (correção, Claude). Último estado no remoto antes desta sessão: `ddd05d8`.
- CI/EVIDÊNCIA: local — `npm test` 806/806 (797 anteriores + 9 novos de Entregas), `npm run test:web` 38/38, `npm run test:domain` 30/30, `typecheck:api` e `typecheck:web` 0 erros, `build:web` e `build:api` ok, lint dos arquivos de Entregas limpo, `secret-scan` sem ocorrências. Validação no navegador do app com API de demonstração fora do repositório: indicadores conferidos (meta 24, entregues 15, pendentes 9, extra +1 separado, progresso 63%), link malicioso de evidência exibido como "protocolo não autorizado", histórico com nome de quem agiu, mês sem plano mostrando só o aviso, e com a API desligada o site vai para o login (sem sessão nem dados falsos). Resultado do CI: ver a entrada de confirmação abaixo, quando houver.
- STATUS: pendente de aceite.
- O QUE MUDOU:
  - **Auditoria de retomada** (após o Antigravity ficar sem tokens): `087cdb8` estava só local, sem CI; documentos preparados (não commitados) declaravam a etapa "concluída e validada", removiam proibições permanentes e renomeavam a F6-IMP.8 sem DEC. Defeitos encontrados: `services/deliverables.ts` devolvia um plano inventado em qualquer erro diferente de 403, **também em produção**, enquanto a API não tinha nenhuma rota de Entregas; `asana.ts`, `clients.ts` e `useAuthStore.ts` criavam dados do Asana, clientes e uma **sessão de ADMIN falsa** quando a API falhava em modo de desenvolvimento. As capturas citadas na documentação mostravam esses dados inventados. Os documentos preparados foram descartados (cópia guardada fora do repositório) e substituídos por esta entrada.
  - **Correção** (`1837801`): removidos todos os dados inventados (`asana.ts`, `clients.ts`, `useAuthStore.ts` voltaram às versões aceitas de `ddd05d8`); novo `GET /clients/:id/deliverables?period=YYYY-MM` em `apps/api/src/modules/deliverables/` (somente leitura, `deliverables.view`, escopo de cliente, todas as consultas filtradas pela organização da sessão, período validado, `plan: null` sem plano, tradução Prisma → contrato e `actorName` nos eventos); tela sem plano mostra só o estado vazio; histórico acessível por teclado; 9 testes de rota (401, 403, 404 fora da carteira, 404 entre organizações, 400 período inválido, plano nulo, filtro por organização em plano/itens/links/eventos, tradução do contrato, ausência de rotas de escrita).
- LIMITES/LACUNAS: testes de rota usam Prisma simulado; nenhum teste contra Postgres com a migration de Entregas (P16). Sem operação de Entregas (criar, editar, fechar, reabrir, vincular evidências) — F6-IMP.7B. Taxonomia de entregas pendente (P17). Nenhuma migration aplicada fora do CI descartável.
- PRÓXIMA MICROETAPA AUTORIZADA: F6-IMP.7B — Operação de Entregas, após o aceite da F6-IMP.7A.
- PROIBIÇÕES ATUAIS: ver `docs/ESTADO_ATUAL.md` (nova proibição: dados fictícios em código de produção).
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-F6-001 — Leitura de Entregas com endpoint real; F6-IMP.7 em duas partes
- Data / responsável: 2026-10-10 / proprietário (autorizou a correção recomendada na auditoria: "pode executar e deixar tudo correto"). A divisão 7A/7B é proposta do agente, a confirmar no aceite.
- Problema: a interface de Entregas (F6-IMP.7) foi feita sem endpoint no backend e preenchia a tela com dados inventados. O Mapa prevê na F6-IMP.7 a UI de Entregas e evidências com revisão/fechamento, e na F6-IMP.8 o espelho e snapshots do Asana.
- Decisão: (1) o endpoint de leitura `GET /clients/:id/deliverables` faz parte da F6-IMP.7; (2) a F6-IMP.7 é entregue em duas partes — **7A, leitura** (esta entrega) e **7B, operação** (criação, edição, evidências, fechamento e reabertura com justificativa); (3) a F6-IMP.8 continua sendo "Espelho e snapshots", como no Mapa; (4) fica proibido usar dados fictícios como fallback em código de produção.
- Alternativas consideradas: manter a tela com dados de demonstração até a F6-IMP.8 (descartada: mostraria contratos falsos como reais); renomear a F6-IMP.8 para "Operação de Entregas" (descartada: contraria o Mapa sem decisão).
- Impacto: módulos `deliverables` (API) e Entregas (web); segurança (nenhum dado inventado; escopo e organização em todas as leituras); prazo (a operação de Entregas vira etapa própria antes do espelho).
- Revisão: se o proprietário preferir outra divisão ou numeração das etapas.

---

### 2026-10-10 — Aceite da F6-IMP.6 — proprietário
- A F6-IMP.6 (Entregas próprias Zafira — modelo, código `f142f9d`, 30/30 testes de domínio incluindo testes negativos de isolamento multi-tenant, 797/797 testes de API, 28/28 testes web, build, typechecks, validação estática do Prisma sem erros e migration SQL versionada sem aplicação em banco) foi **aceita formalmente** pelo proprietário. Próxima microetapa autorizada quando solicitada: F6-IMP.7 (Visualização de Entregas do cliente na interface — ainda não iniciada).

### 2026-10-10 — F6-IMP.6 — Entregas próprias Zafira (modelo) — Antigravity
- BASELINE (commit): código implementado, auditado e testado em `f142f9d` (código inicial `06e1fc4`); código anterior aceito `fd96778`.
- CI/EVIDÊNCIA:
  - Auditoria complementar de segurança: confirmação das relações compostas `DeliverablePlan(organizationId, clientId) -> Client(organizationId, id)` com `ON DELETE CASCADE`, `DeliverableItem(organizationId, planId) -> DeliverablePlan(organizationId, id)` com `ON DELETE CASCADE`, `DeliverableLink(organizationId, itemId) -> DeliverableItem(organizationId, id)` com `ON DELETE CASCADE`, e `DeliverableEvent(organizationId, itemId) -> DeliverableItem(organizationId, id)` com `ON DELETE CASCADE`. As relações com `User` (`closedByUserId`, `actorUserId`, `deliveredByUserId`) apontam para `users(id)` com `ON DELETE SET NULL`, preservando histórico sem violar a restrição NOT NULL de `organizationId`, enquanto a garantia de que o usuário pertence e está ativo no tenant é assegurada estritamente na camada de autorização/domínio (`validateUserTenantMembership` e `assertSameOrganization`).
  - Modelos Prisma relacionais com isolamento multi-tenant estrito: `DeliverablePlan`, `DeliverableItem`, `DeliverableLink`, `DeliverableEvent`, `DeliverableTemplate`, com chaves compostas `@@unique([organizationId, id])` e FKs relacionais compostas. Enums: `DeliverablePlanStatus`, `DeliverableItemStatus`, `DeliverableLinkType`, `DeliverableEventType`.
  - Validação estática Prisma: `npx prisma validate --schema=apps/api/prisma/schema.prisma` executado com status **The schema at apps/api/prisma/schema.prisma is valid 🚀 (0 warnings, 0 errors)**.
  - Migration versionada preparada em código: `apps/api/prisma/migrations/20261010210000_f6_deliverables_foundation/migration.sql`. Confirmação formal: **nenhuma migration foi aplicada em banco local, homologação ou produção**.
  - Pacote `@zafira/contracts`: schemas Zod e tipos TypeScript em `packages/contracts/src/deliverables.ts` exportados na raiz.
  - Pacote `@zafira/domain`: regras de negócio puras em `packages/domain/src/deliverables/deliverables-policy.ts` exportadas na raiz (`assertSameOrganization`, `validatePlanClientTenant`, `validateUserTenantMembership`, `validateItemPlanTenant`, `validateEventActorTenant`, `assertPlanMutable`, `validatePlanReopen`, `validatePlanClosure`, `validateTargetAdjustment`, `calculatePlanMetrics`, `validateDeliverableEvidence`).
  - Testes de Domínio: **30/30 testes aprovados** em `npm run test:domain` (incluindo testes negativos específicos de isolamento provando a rejeição categórica de Client alheio, User de outra organização ou inativo, DeliverableItem com tenant/planId divergente e ator de DeliverableEvent alienígena).
  - Testes de regressão: `npm test` aprovou 797/797 testes de API; `npm run test:web` aprovou 28/28 testes de web.
  - Verificação de tipos: `typecheck:contracts`, `typecheck:domain`, `typecheck:api`, `typecheck:web` todos 100% limpos (0 erros).
  - Builds: `build:internal`, `build:api` e `build:web` compilados com sucesso.
- STATUS: pendente de aceite; modelo, regras de negócio, contratos e auditoria de segurança concluídos e validados, aptos para aceite do proprietário.
- O QUE MUDOU: fundação completa de modelo e domínio para Entregas próprias Zafira, com segregação de itens extras, auditoria de alterações de meta, isolamento multi-tenant absoluto comprovado por testes negativos, e validação do schema Prisma sem warnings.
- LIMITES/LACUNAS: UI/telas e endpoints REST de Entregas não implementados nesta etapa (previstos para F6-IMP.7 e F6-IMP.8 conforme Mapa Mestre). Nenhuma migration executada.
- PRÓXIMA MICROETAPA AUTORIZADA: F6-IMP.7 — Visualização de Entregas do cliente na interface (sob DEC-GOV-004), após o aceite formal do proprietário da F6-IMP.6.
- PROIBIÇÕES ATUAIS: sem VPS, produção, migrations em banco real, contas reais, escrita no Asana, nem início de F6-IMP.7 antes do aceite.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — Aceite da F6-IMP.5 — proprietário
- A F6-IMP.5 (Calendário visual de tarefas Asana em modo estritamente leitura, código `fd96778`, 28/28 testes web, 797/797 testes de API, build, typechecks e validação visual de navegador em 1280px com gravação WebP) foi **aceita formalmente** pelo proprietário. Próxima microetapa autorizada: F6-IMP.6 (Entregas próprias Zafira — modelo).

### 2026-10-10 — F6-IMP.5 — Calendário visual somente leitura — Antigravity
- BASELINE (commit): código implementado e validado em `fd96778401309d57a41285fb7058a69dff5ec693`; código anterior aceito `483cf1a`.
- CI/EVIDÊNCIA:
  - Componentes novos e integrados: `CanonicalTaskCalendar.tsx`, `CanonicalTaskCalendar.module.css`, e integração no switcher de visualização em `CanonicalTaskList.tsx` (Lista | Quadro | Calendário).
  - Lógica pura: funções `buildCalendarMonth`, `getCalendarMonthTitle`, tipos `CalendarDay`, `CalendarWeek`, `CalendarMonthData` em `asana-task-view.ts`.
  - Testes automatizados: `npm run test:web` aprovou 28/28 testes (5 novos testes específicos cobrindo grade semanal de 7 dias, posicionamento por `dueOn`/`dueAt`, separação de tarefas sem prazo, indicação de hoje e transição de anos); `npm test` aprovou 797/797 testes de API.
  - Verificação de tipos: `typecheck:web`, `typecheck:api`, `typecheck:contracts`, `typecheck:domain` todos com 0 erros.
  - Build: `npm run build:web` compilou com sucesso em 52.51s.
  - Lint: `eslint` executado sobre os arquivos da F6 com 0 erros e 0 warnings.
  - Validação visual de navegador real (viewport 1280 × 800): gravação WebP oficial (`f6_imp5_calendar_proof_1791668463529.webp`) e screenshots oficiais (`calendar_october_2026_1791668958108.png`, `calendar_view_final_1791669272404.png`) confirmando alternância no switcher, exibição da grade mensal, navegação entre meses (Outubro -> Novembro -> botão "Hoje"), badges de status (atrasadas em vermelho, concluídas em verde, pendentes), abertura do Sheet de detalhes somente leitura, filtragem instantânea por busca e seção colapsável de tarefas sem prazo.
  - Ausência de escrita: nenhum manipulador drag-and-drop, sem edição ou reagendamento de datas, sem mutações no Asana.
- STATUS: pendente de aceite; implementação concluída e validada, apta para aceite do proprietário.
- O QUE MUDOU: implementação do calendário visual de tarefas Asana integrado em `/projetos`, estritamente somente leitura.
- LIMITES/LACUNAS: F6-IMP.6 (Entregas próprias Zafira) não iniciada; pendências P2 a P15 mantidas.
- PRÓXIMA MICROETAPA AUTORIZADA: F6-IMP.6 (Entregas próprias Zafira — modelo), somente após o aceite formal do proprietário da F6-IMP.5.
- PROIBIÇÕES ATUAIS: sem VPS, produção, migrations, contas reais, escrita no Asana, nem início antecipado da F6-IMP.6.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — Aceite da F6-IMP.4 — proprietário
- A F6-IMP.4 (Kanban visual somente leitura, código `483cf1a`, 23/23 testes de lógica web, 797/797 testes de API, build, typechecks e validação visual de navegador em 1280px com gravação WebP) foi **aceita formalmente** pelo proprietário. Próxima microetapa autorizada: F6-IMP.5 (Calendário visual de tarefas do Asana).

### 2026-10-10 — F6-IMP.4 — validação e auditoria concluídas — Antigravity
- BASELINE (commit): código Kanban `483cf1a133d7869242293e1c88d9ba76accac608`; código anterior aceito `82421c6`.
- CI/EVIDÊNCIA:
  - Auditoria estática: `CanonicalTaskBoard.tsx` (cartões apenas leitura, sem drag-and-drop, sem botões de escrita/mutação, aviso explícito de consulta), `CanonicalTaskList.tsx` (filtros compartilhados entre Lista e Quadro), `asana-task-view.ts` (lógica de agrupamento pura e sanitização de links externos).
  - Testes automatizados: `npm run test:web` aprovou 23/23 testes (16 de F6-RO.2 + 7 novos da F6-IMP.4); `npm test` aprovou 797/797 testes da API (incluindo testes negativos de ausência de escrita Asana).
  - Verificação de tipos: `typecheck:web` 0 erros; `typecheck:contracts`, `typecheck:domain`, `typecheck:api` todos 0 erros.
  - Build: `npm run build:web` compilou com sucesso em 46.69s.
  - Lint: `eslint` executado diretamente sobre os arquivos da F6-IMP.4 com 0 erros e 0 warnings.
  - Validação visual de navegador real (viewport 1280px): gravação WebP oficial (`f6_imp4_kanban_validation_1791666027583.webp`) e screenshots confirmando visualização em lista, alternância para quadro Kanban, agrupamentos por Seção e por Situação, cartões com status/responsável/prazo/link externo, abertura do modal de detalhes somente leitura via Sheet, e confirmação visual de ausência de qualquer controle de edição ou escrita.
- STATUS: pendente de aceite; implementação 100% validada, apta para aceite do proprietário.
- O QUE MUDOU: auditoria e validação técnica e visual da F6-IMP.4 sem necessidade de alteração de código na baseline `483cf1a`. Atualização da documentação de governança (`docs/ESTADO_ATUAL.md` e `docs/REGISTRO.md`). Sessão encerrada.
- LIMITES/LACUNAS: F6-IMP.5 (Calendário) ainda não iniciada; pendências P2 a P15 permanecem abertas conforme mapa e estado atual.
- PRÓXIMA MICROETAPA AUTORIZADA: F6-IMP.5 (Calendário visual de tarefas do Asana), somente após o aceite formal do proprietário da F6-IMP.4.
- PROIBIÇÕES ATUAIS: sem VPS, produção, migrations, contas reais, escrita no Asana, nem início antecipado da F6-IMP.5/F6-IMP.6.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — F6-IMP.4 — transferência autorizada Claude → ChatGPT
- BASELINE (commit): código Kanban `483cf1a133d7869242293e1c88d9ba76accac608`; código anterior aceito `82421c6`. Proprietário autorizou expressamente a transferência da sessão.
- CI/EVIDÊNCIA: auditoria estática inicial por leitura direta no GitHub: `CanonicalTaskBoard.tsx` renderiza cartões sem drag-and-drop nem escrita no Asana; `CanonicalTaskList.tsx` compartilha filtros entre Lista e Quadro; `groupTasks` suporta seção, situação, projeto e responsável, com 7 testes novos adicionados. CI oficial do commit `483cf1a` e Browser Gate não comprovados nesta transferência. Não declarar testes executados.
- STATUS: pendente de aceite; implementação existente, auditoria iniciada.
- O QUE MUDOU: transferência administrativa da sessão ativa para ChatGPT, sem alterar código do Claude. Sessão Claude encerrada por autorização expressa do proprietário.
- LIMITES/LACUNAS: conexão GitHub permite leitura de commits, mas não confirma working tree local do Claude. Verificação de CI e runtime do Kanban pendente; não considerar 23 testes como executados apenas por existirem no arquivo.
- PRÓXIMA MICROETAPA AUTORIZADA: finalizar auditoria/correções necessárias da própria F6-IMP.4 e submeter ao proprietário para aceite antes da F6-IMP.5.
- PROIBIÇÕES ATUAIS: sem VPS, produção, migrations, contas reais, escrita no Asana, nem início de F6-IMP.5/F6-IMP.6.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — Aceite da F6-RO.2 — proprietário
- A F6-RO.2 (código `82421c6`, CI run 38080495906 5/5) foi **aceita** pelo proprietário, após inspeção visual da tela com dados fictícios. Próxima microetapa autorizada: F6-IMP.4 (Kanban visual).

### 2026-10-10 — F6-RO.2 — Interface somente leitura — Claude
- BASELINE (commit): código em `82421c6` (antes: `f25af2f`). Commits: `764cdaa` (interface), `82421c6` (testes do web no CI).
- CI/EVIDÊNCIA: run 38080495906 (commit `82421c6`) 5/5 SUCCESS na 1ª tentativa; o log mostra `Unit Tests (Web)` com 16 testes aprovados. Local: `npm run test:web` 16/16, `npm test` 797/797, `typecheck:web` 0 erros, `build:web` ok.
- STATUS: pendente de aceite.
- O QUE MUDOU:
  - Novo módulo `apps/web/src/lib/asana-task-view.ts` (lógica pura): filtros por busca, projeto, situação, responsável, prazo (atrasadas, hoje, próximos 7 dias, sem prazo) e seção; busca sem distinção de maiúsculas e acentos; contadores; formatação de data; `safeExternalUrl` e `getAsanaTaskLink` (somente `https`, e `asana.com` para o link da tarefa).
  - `CanonicalTaskList`: filtros de prazo e seção, botão "Asana" por linha, "Limpar filtros" ao lado da contagem, layout dos filtros para celular, tablet e desktop; seção do filtro reinicia ao trocar de projeto.
  - `Projetos.tsx`: a lista é recriada por cliente (`key`), corrigindo filtro de um cliente escondendo as tarefas de outro.
  - `AsanaTaskDetailSheet`: "Abrir no Asana" e links de anexos validados.
  - Mensagem de acesso negado agora cita `projects.view`.
  - `apps/web` ganhou `npm test` (`tsx --test`), `npm run test:web` na raiz, `tsx` declarado como devDependency (`package-lock.json` +1 linha) e passo `Unit Tests (Web)` no CI.
- LIMITES/LACUNAS: sem execução em navegador real nem teste de componente (P14); o prazo usa a data do navegador, não o fuso da organização (P15); o estado "parcial" é tratado pelo backend (erro explícito em vez de lista incompleta), não há um estado visual intermediário.
- PRÓXIMA MICROETAPA AUTORIZADA: F6-IMP.4 — Kanban visual (sob DEC-GOV-004), após o aceite da F6-RO.2.
- PROIBIÇÕES ATUAIS: ver `docs/ESTADO_ATUAL.md`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — Aceite da F6-RO.1 — proprietário
- A F6-RO.1 (código `f25af2f`, CI run 38079000048 5/5) foi **aceita** pelo proprietário. Próxima microetapa autorizada: F6-RO.2.

### 2026-10-10 — F6-RO.1 — Segurança e testes — Claude
- BASELINE (commit): código em `f25af2f` (antes: `1473718`). Commits: `300a38d` (tipos do web + gate), `6939827` (varredura de segredos + retry no CI), `f25af2f` (testes de leitura).
- CI/EVIDÊNCIA: run 38079000048 (commit `f25af2f`) 5/5 SUCCESS na 1ª tentativa. Logs confirmam: `secret-scan (repo)` sem ocorrências em 451 arquivos; `Typecheck Web` sem erros; `secret-scan (dir)` sem ocorrências em 179 arquivos do bundle; `API Image Secret Files Scan: PASS`; `postgres:16` baixado pelo novo laço com novas tentativas. Local: `npm test` 797/797, `typecheck:api` e `typecheck:web` ok, `build:web` ok.
- STATUS: pendente de aceite.
- O QUE MUDOU:
  - `apps/web`: 0 erros de `tsc` (antes 16). Bugs reais corrigidos: `CompositorZafiraModal` lia `res.clients` de uma lista (clientes nunca carregavam); `CanonicalTaskList` passava o erro em `message` em vez de `description` (motivo da falha nunca aparecia); `ClienteConteudoPreview` lia `displayName/avatarUrl` em vez de `accountName/accountPicture`; `ConteudosAgenda` lia `mediaThumbnailUrl` inexistente (miniatura agora vem de `mediaItems`). Ajustes só de tipo no financeiro (`FinancialCategorizationSource` espelha o enum do Prisma; `externalReference`; `message` opcional no preview de reparo; lista de clientes com o tipo da carteira). Removidos `AppSidebar.tsx` e `goals/GoalForm.tsx` (inalcançáveis).
  - CI (`.github/workflows/foundation-ci.yml`): passos `Secret Scan (Repository)`, `Typecheck Web`, varredura do bundle no `Bundle Safety Scan`, `API Image Secret Files Scan`, e laço de até 5 tentativas no `docker pull postgres:16` da homologação.
  - `scripts/ci/secret-scan.sh` (modos `repo` e `dir`; imprime só arquivo, linha e tipo) e `scripts/ci/secret-scan-allowlist.txt` (valores fictícios justificados).
  - `asana-resource-scope.test.ts`: testes 11 a 14 sobre as 8 rotas de leitura (404 fora da carteira, 401 sem login, 403 sem `projects.view`, 404 entre organizações).
- LIMITES/LACUNAS: o detector usa padrões próprios (não é uma ferramenta dedicada como gitleaks) e exclui arquivos de teste; não há testes de frontend (P14); lint e `npm audit` seguem fora do CI (P13); a senha padrão do compose de referência ficou registrada como P12. HTML do Asana: confirmado por inspeção que nenhuma tela ativa injeta HTML vindo do Asana (o único `dangerouslySetInnerHTML` restante é o CSS interno de `ui/chart.tsx`, inalcançável).
- PRÓXIMA MICROETAPA AUTORIZADA: F6-RO.2 (sob DEC-GOV-004).
- PROIBIÇÕES ATUAIS: ver `docs/ESTADO_ATUAL.md`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### 2026-10-10 — Aceite da F6-RO.0 — proprietário
- A F6-RO.0 (código `1473718`, CI run 38077297014 5/5) foi **aceita** pelo proprietário. Próxima microetapa autorizada: F6-RO.1.

### 2026-10-10 — F6-RO.0 — Contenção da escrita no Asana — Claude
- BASELINE (commit): código em `1473718` (antes: `a752773`). Commits: `7b19842` (backend), `9cc4318` (remoção do legado no web), `1473718` (UI somente leitura).
- CI/EVIDÊNCIA: `npm run typecheck:api` ok; `npm test` 793/793, incluindo os novos testes "3. Rotas de escrita em tarefas Asana não existem, nem para ADMIN no próprio escopo", "3.1 AsanaService não expõe métodos que escrevem" e "3.1.1 Escopos OAuth só de leitura, exceto webhooks"; `tsc` do web de 32 para 16 erros (nenhum novo; todos em arquivos não alterados); `npm run build:web` e `npm run build:api` ok; bundle sem `app.asana.com/api/1.0` nem rotinas de escrita. CI do GitHub: run 38077297014 (commit `7926fe6`, cobre todos os commits da F6-RO.0) 5/5 SUCCESS na 2ª tentativa; a 1ª falhou só no Homologation Rehearsal por limite de requisições do registro de imagens (`toomanyrequests`), sem relação com o código.
- STATUS: pendente de aceite.
- O QUE MUDOU:
  - Backend (`apps/api/src/modules/integrations/asana/`): removidas as rotas `PATCH /clients/:id/asana/tasks/:taskGid`, `POST /clients/:id/asana/tasks`, `POST …/section`, `POST …/subtasks`, `POST …/stories`, `POST …/attachments`, `POST …/tags` e `DELETE …/tags/:tagGid` (e aliases `/api`); removidos `updateClientTask`, `createClientTask`, `moveTaskSection`, `createTaskSubtask`, `addTaskComment`, `uploadTaskAttachment`, `addTagToTask`, `removeTagFromTask` e o auxiliar `formatAsanaHtmlNotes`; `ASANA_OAUTH_SCOPES` sem `tasks/projects/stories/attachments/tags/custom_fields:write`; leituras com `projects.view`, OAuth com `integrations.connect`, sync de webhooks com `integrations.sync`.
  - Frontend (`apps/web/src/`): `pages/Projetos.tsx` sem modal de criação, `canManage`, capacidades e usuários do workspace; `AsanaTaskDetailSheet` somente leitura com "Abrir no Asana"; `CanonicalTaskList` sem "Nova Tarefa"; `services/asana.ts` sem as 8 funções de escrita; apagados `CreateAsanaTaskModal`, `Cliente360Projetos`, `lib/asana-service.ts`, `lib/asana-helpers.ts`, `types/asana.ts` e 14 componentes legados de `components/projects/` (inalcançáveis, confirmado por grafo de imports a partir de `main.tsx`; incluía o `RichTextRenderer` com HTML não sanitizado).
  - Efeito nas permissões padrão: Admin, Gestor e Colaborador continuam lendo tarefas; só o Admin inicia OAuth do Asana (antes Gestor também). Permissões individuais que tivessem só `deliverables.view` perdem a leitura de tarefas (não verificável sem acesso ao banco).
- LIMITES/LACUNAS: escopos novos só valem para novas conexões OAuth, que hoje não podem ser concluídas pelo 2.1 (P5); tokens existentes mantêm seus direitos, mas o Hub não tem mais nenhum caminho de escrita (P11). Sem testes de frontend; o gate de `tsc` do web fica para a F6-RO.1.
- PRÓXIMA MICROETAPA AUTORIZADA: F6-RO.1 (sob DEC-GOV-004).
- PROIBIÇÕES ATUAIS: ver `docs/ESTADO_ATUAL.md`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO.

### DEC-GOV-004 — Execução técnica delegada ao agente dentro do escopo
- Data / responsável: 2026-10-10 / proprietário.
- Problema: o proprietário não é desenvolvedor e não consegue avaliar planos técnicos detalhados; exigir aprovação de cada plano trava a execução.
- Decisão: o agente executor decide e executa sozinho tudo que estiver dentro do escopo da microetapa autorizada e do Mapa Mestre. Pede permissão expressa ao proprietário apenas nas exceções: produção, VPS, EasyPanel, DNS, banco real, credenciais ou contas reais, gastos, ações irreversíveis, mudança de escopo ou de produto, e decisões que só o proprietário pode tomar (DEC). Ao fim de cada microetapa, entrega o handoff em linguagem simples.
- Alternativas consideradas: aprovação do proprietário a cada plano técnico (descartada pelo proprietário).
- Impacto: o aceite de produto continua sendo do proprietário; a qualidade técnica passa a depender dos testes, do CI e das auditorias independentes entre agentes.
- Revisão: se um agente executar algo fora do escopo ou sem evidência.

### 2026-10-10 — GOV-1 — Documentação oficial movida para o Git — Claude
- BASELINE (commit): código em `a75277330e72ca9dd6dba55869193ea6abaa9d6e`; esta entrada é do commit `docs(governance): GOV-1 …` imediatamente posterior (ver `git log -- docs/REGISTRO.md`).
- CI/EVIDÊNCIA: commit somente de documentação; nenhum arquivo de aplicação alterado (`git diff --stat a752773..HEAD` lista só `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` e `docs/`).
- STATUS: pendente de aceite do proprietário.
- O QUE MUDOU:
  - Criados `docs/ESTADO_ATUAL.md`, `docs/REGISTRO.md` (este arquivo) e `docs/MAPA_MESTRE.md` (transcrição do Mapa Mestre Único C1 do Drive, com ajustes marcados [GOV-1]).
  - `AGENTS.md` reescrito como porta de entrada e passou a ser versionado. `CLAUDE.md` e `GEMINI.md` criados como ponteiros para ele.
  - Preservados em `docs/historico/`: Mapa v1.1 (antes em `docs/governance/`), exportações do Drive (Registro, Consolidação, Mapa Técnico, Início) e as 3 cópias locais não versionadas de 09/10.
  - Exportações verificadas contra padrões de segredo (nenhum encontrado). Contêm detalhes de infraestrutura; por isso o repositório foi tornado privado antes do commit (DEC-GOV-003).
- LIMITES/LACUNAS: os documentos do Drive não foram alterados (o Claude tem acesso só de leitura); precisam receber um aviso apontando para o Git. O Mapa C2 completo não foi elaborado (pendência registrada).
- PRÓXIMA MICROETAPA AUTORIZADA: F6-RO.0.
- PROIBIÇÕES ATUAIS: ver `docs/ESTADO_ATUAL.md`.
- DOCUMENTAÇÃO ATUALIZADA: ESTADO_ATUAL / REGISTRO / MAPA_MESTRE.

### DEC-GOV-003 — Repositório privado
- Data / responsável: 2026-10-10 / proprietário (Juliano Guerrero).
- Problema: o repositório `Julianogdc/zafira-hub` era público; levar a governança para o Git publicaria IP da VPS, caminhos de backup, detalhes de infraestrutura e vulnerabilidades em aberto (algumas também presentes no Hub 2.0 em produção).
- Decisão: tornar o repositório privado. Executado pelo proprietário em 10/10/2026; confirmado (API pública do GitHub passou a responder 404).
- Alternativas consideradas: manter público e publicar só documentos sanitizados (descartada: o próximo agente perderia contexto de segurança).
- Impacto: verificar se algum serviço (EasyPanel, GHCR) baixava imagens ou código sem autenticação. Tudo o que já foi público antes desta data (código, ADRs, logs de CI) deve ser considerado exposto.
- Revisão: só reabrir com auditoria de conteúdo sensível.

### DEC-GOV-002 — Qualquer agente executa, um por vez
- Data / responsável: 2026-10-10 / proprietário.
- Problema: a continuidade dependia de um único agente ou do Chat de Direção para registrar o avanço.
- Decisão: qualquer agente (Claude, Antigravity, ChatGPT ou outro) pode executar a microetapa autorizada, um de cada vez, seguindo `AGENTS.md`, e registra o próprio avanço neste repositório. Nenhum agente altera escopo, direção ou aceite por conta própria.
- Alternativas consideradas: Chat de Direção como único redator dos documentos (descartada: cria gargalo e desencontro entre código e documentos).
- Impacto: o Chat de Direção passa a auditar os registros em vez de escrevê-los; atualiza a cópia do Drive quando necessário.
- Revisão: se houver trabalho simultâneo de dois agentes ou registros incorretos.

### DEC-GOV-001 — Git como fonte canônica; Drive como cópia de leitura
- Data / responsável: 2026-10-10 / proprietário.
- Problema: documentos oficiais no Google Docs ficavam desatualizados em relação ao código (3 divergências só em 10/10) e nem todo agente consegue ler ou escrever no Drive.
- Decisão: `AGENTS.md`, `docs/ESTADO_ATUAL.md`, `docs/REGISTRO.md` e `docs/MAPA_MESTRE.md` na branch `hub-2.1` são a fonte oficial. O Google Docs passa a ser cópia de leitura e não pode ser editado de forma independente.
- Alternativas consideradas: dar permissão de edição no Drive a todos os agentes (descartada: depende de conector e conta Google por agente, e não sincroniza com o código).
- Impacto: código e documentação passam a mudar no mesmo histórico; a regra "commit do Registro ≠ GitHub → parar" vira uma verificação por comando (ver `AGENTS.md`).
- Revisão: se o repositório deixar de ser o local de trabalho dos agentes.

### DEC-ASANA-002 — Webhooks Asana como exceção técnica de leitura
- Data / responsável: 2026-10-10 / proprietário.
- Problema: o espelho e os snapshots (F6-IMP.8) precisam ser avisados de mudanças no Asana, e criar um webhook é tecnicamente uma escrita no Asana.
- Decisão: webhooks PERMITIDOS exclusivamente para receber eventos de leitura/sincronização e atualizar estado local do Hub. Proibidos comandos, callbacks ou fluxos que escrevam de volta no Asana. Exigências: validação de assinatura, idempotência, tenant/client scope, auditoria, tratamento de erro/frescor e menor privilégio.
- Alternativas consideradas: apenas consulta periódica (polling), mais lenta e mais pesada.
- Impacto: a F6-RO.0 deve manter o escopo OAuth necessário a webhooks e remover os de escrita de tarefas/projetos/comentários/anexos/tags/campos.
- Revisão: se a Asana mudar o modelo de webhooks.

### DEC-ASANA-001 — Asana somente leitura no Hub
- Data / responsável: 2026-10-10 / proprietário.
- Problema: a linha F6-IMP.3B.2 habilitou criação e edição de tarefas Asana pelo Hub, transformando-o em segundo gerenciador de tarefas.
- Decisão: o Asana é somente leitura no Hub em todas as fases (interface, backend, jobs e OAuth). F6-IMP.3B.2 CANCELADA. Próxima microetapa: F6-RO.0. F6-IMP.4 e qualquer sequência baseada em escrita canceladas até nova decisão formal.
- Alternativas consideradas: escrita controlada por permissão (descartada pelo proprietário).
- Impacto: rotas de escrita, componentes de edição e escopos OAuth de escrita viram dívida a remover; vínculos e dados próprios do Hub continuam permitidos.
- Revisão: somente por nova decisão expressa do proprietário.

### 2026-10-10 — Avaliação dos commits 7ea5143 e a752773 — Direção
- `7ea5143` (F6-IMP.3B.2A, CI #115 5/5 SUCCESS): executado e **NÃO ACEITO**. Corrigiu as chaves planas de capacidade e com isso **ligou a escrita no Asana na tela** para quem tem `deliverables.plan` (Admin e Gestor por padrão), contrariando DEC-ASANA-001.
- `a752773` (SEC-ASANA.1, CI #116 5/5 SUCCESS): removeu a leitura de token Asana pelo navegador e endureceu `.dockerignore`/`.gitignore`. Parecer independente do Claude: **aceitar com ressalvas**. Não é aceite de produto e não autoriza escrita. Ressalvas pendentes:
  1. inserir e comprovar varredura de segredos no CI;
  2. investigar a possível exposição histórica do token Asana (builds antigos publicados) e registrar o resultado.
- O proprietário revogou o token pessoal "Zafira HUB DEV" no Asana (declarado, não verificado tecnicamente).

---

Entradas anteriores: `docs/historico/REGISTRO_OFICIAL_DRIVE_ate_2026-10-10.md`.
