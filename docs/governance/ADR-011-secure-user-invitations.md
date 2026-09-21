# ADR-011: Convite Seguro, Token de Uso Único e Ativação de Usuários

## Status
Aprovado

## Contexto
O Zafira Hub 2.1 adota a separação estrita entre identidade global do usuário (`User`) e sua participação associada a uma organização específica (`OrganizationMember`), conforme estabelecido na ADR-010.
Na etapa 11C1, foi introduzido o endpoint administrativo para criar convites (`POST /api/v1/users/invite`), deixando o usuário e o vínculo com status `INVITED`. No entanto, o fluxo de aceitação e credenciamento ainda necessitava de um mecanismo seguro de emissão de tokens, validação, definição de credenciais e ativação de uso único.

## Decisões

1. **Token Criptograficamente Seguro:**
   - O token bruto é um segredo bearer gerado com entropia de 32 bytes aleatórios criptográficos (`node:crypto.randomBytes(32)`), codificado em formato `base64url`.
   - O token bruto é retornado exatamente uma vez na resposta da criação/reemissão do convite para posterior envio.

2. **Armazenamento Seguro (Somente Hash SHA-256):**
   - O banco de dados PostgreSQL nunca armazena o token bruto.
   - Apenas o hash SHA-256 hexadecimal do token (`createHash('sha256').update(token).digest('hex')`) é persistido na tabela `organization_invitations` com restrição de unicidade (`tokenHash UNIQUE`).
   - O algoritmo Argon2id permanece de uso exclusivo para o hash de senhas de usuários (`User.passwordHash`).

3. **Validade e Expiração:**
   - O tempo de vida padrão do convite é de 7 dias (`INVITATION_TTL_DAYS = 7`).
   - Requisições de inspeção ou aceitação após a data de expiração são rejeitadas com erro `410 INVITATION_EXPIRED`.

4. **Uso Único e Atomicidade (Race-Safe):**
   - O convite só pode ser aceito uma única vez.
   - A operação de aceitação é executada em uma transação atômica do PostgreSQL com atualizações condicionais (`acceptedAt IS NULL`, `OrganizationMember.status = INVITED`). Tentativas simultâneas ou subsequentes falham com `409 INVITATION_ALREADY_ACCEPTED`.

5. **Reemissão e Rotação:**
   - Administradores com permissão `users.invite` podem reemitir o convite para um membro `INVITED` via `POST /api/v1/users/:membershipId/invitation`.
   - A rotação substitui o `tokenHash` e renova o prazo de expiração, invalidando imediatamente o token emitido anteriormente.

6. **Diferenciação de Fluxo por Estado da Identidade Global:**
   - **Novo Usuário (`User.status === 'INVITED'`):** A definição de senha é obrigatória no momento do aceite. A senha é hashed com Argon2id, o status global transiciona de `INVITED` para `ACTIVE`, e a `OrganizationMember` passa para `ACTIVE`.
   - **Usuário Já Ativo (`User.status === 'ACTIVE'`):** O usuário já possui credenciais ativas. O envio de senha no aceite é explicitamente proibido (`400 PASSWORD_NOT_ALLOWED_FOR_EXISTING_USER`), evitando que o fluxo de convite seja explorado como redefinição de senha sem controle. O status do usuário e sua senha são preservados inalterados, e apenas a `OrganizationMember` vinculada é ativada.
   - **Usuário Inativo Globalmente (`User.status === 'INACTIVE'`):** O convite é bloqueado com `409 USER_GLOBALLY_INACTIVE`.

7. **Isolamento de Tenant e Integridade Referencial:**
   - A tabela `organization_invitations` possui chave única composta `(organizationId, organizationMemberId)` e restrições de chave estrangeira com exclusão em cascata (`ON DELETE CASCADE`), garantindo que a exclusão de um membro ou organização limpe automaticamente seus convites pendentes.

8. **Auditoria e Proteção de Segredos:**
   - Os eventos de emissão (`user.invitation_issued`), reemissão (`user.invitation_reissued`) e aceite (`user.invitation_accepted`) são registrados de forma atômica no `AuditLog`.
   - É estritamente proibido incluir tokens brutos ou hashes em logs, auditorias, metadados ou mensagens de erro.

9. **Transporte de Notificações Desacoplado:**
   - O transporte de e-mails/notificações (SMTP, n8n, etc.) permanece como responsabilidade desacoplada e posterior.

## Consequências
- Os links de convite e ativação são protegidos contra falsificação, vazamento de banco de dados e ataques de concorrência.
- A integridade da política multiempresa e a separação entre identidade e participação são integralmente preservadas.
