# Armazenamento de arquivos S3-compatível (HM-2)

> DEC-HML-003. Referência técnica do driver. **Não autoriza criar bucket, credencial nem contratar serviço.** Fornecedor preferencial: Cloudflare R2; a escolha definitiva é do proprietário. O driver é agnóstico: R2, AWS S3, MinIO e similares mudam só a configuração.

## Seleção do driver
| Ambiente | Padrão | Observação |
|---|---|---|
| Desenvolvimento e testes | `local` (diretório temporário ou `FILE_STORAGE_LOCAL_DIR`) | exclusivo para dev e testes |
| Produção e homologação (`NODE_ENV=production`) | **nenhum**: `local` é recusado | exige `FILE_STORAGE_DRIVER=s3` com a configuração abaixo; sem ela a API responde "armazenamento não configurado" (503) |

## Variáveis de ambiente (nenhuma é lida de arquivo nem do banco)
| Variável | Obrigatória | Descrição |
|---|---|---|
| `FILE_STORAGE_DRIVER` | sim | `s3` |
| `FILE_STORAGE_S3_BUCKET` | sim | nome do bucket **privado** |
| `FILE_STORAGE_S3_ACCESS_KEY_ID` | sim | identificador da credencial (segredo de ambiente) |
| `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | sim | segredo da credencial (**nunca** em repositório, log ou conversa) |
| `FILE_STORAGE_S3_ENDPOINT` | para R2 e similares | `https://<id-da-conta>.r2.cloudflarestorage.com`; somente `https` (ver abaixo) |
| `FILE_STORAGE_S3_REGION` | não | padrão `auto` (R2); para AWS, a região real |
| `FILE_STORAGE_S3_PREFIX` | não | prefixo por ambiente (ex.: `homologacao/`) |
| `FILE_STORAGE_S3_FORCE_PATH_STYLE` | não | com endpoint próprio o padrão é estilo de caminho; `false` desliga |
| `FILE_STORAGE_S3_ALLOW_INSECURE` | só testes | `true` permite `http` **fora de produção** (emulador local); em produção a API recusa |

## Garantias
- **Bucket privado:** nenhum URL público ou pré-assinado é emitido; todo acesso passa pela API (sessão, carteira ou link de aprovação).
- **Isolamento por organização:** chaves `org/<organizacao>/sha256/<hash>` (validadas por expressão regular antes de qualquer chamada).
- **Integridade SHA-256:** a gravação recusa bytes cujo hash não bata com a chave; a leitura recalcula o hash e **não devolve** conteúdo divergente (`StorageIntegrityError`). O hash também vai como metadado `sha256`.
- **Idempotência e imutabilidade:** `HEAD` antes de `PUT`; mesma chave = mesmos bytes; sem exclusão.
- **Erros:** objeto inexistente na leitura é `ENOENT` (igual ao driver local); falha de credencial, rede ou permissão **nunca** vira "não existe".
- **Compatibilidade com R2:** o cliente não envia nem valida checksums opcionais (`WHEN_REQUIRED`), evitando os cabeçalhos CRC32/`aws-chunked` que algumas implementações S3-compatíveis recusam.

## Credencial recomendada (para quando o proprietário criar o bucket)
Escopo mínimo no bucket do ambiente: `GetObject`, `PutObject` e `HeadObject` (e `ListBucket` se o fornecedor exigir para `HEAD`). **Sem `DeleteObject`**: o histórico não é apagado. Uma credencial e um bucket (ou prefixo) por ambiente; homologação e produção nunca compartilham.

## Testes
- Unitários (`apps/api/src/modules/content/__tests__/file-storage-s3.test.ts`) contra um emulador S3 local em processo: ida e volta, idempotência, integridade, chave inválida, isolamento, prefixo, erros, configuração e proteção de produção.
- Integração PostgreSQL (`apps/api/src/integration-tests/storage-s3-postgres.test.ts`): upload, dimensões, prévia, mídia pública de aprovação, decisão do cliente, envio da mídia pela publicação e objeto adulterado.
- Nenhum teste usa serviço externo real. **O driver não foi exercitado contra o Cloudflare R2 real**: isso só ocorre depois de o proprietário criar bucket e credencial, em teste controlado.
