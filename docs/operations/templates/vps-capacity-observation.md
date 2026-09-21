# Template de Observação de Capacidade da VPS (7 Dias)

Este template deve ser preenchido durante a janela de observação operacional da VPS para subsidiar o aceite formal da capacidade e a definição da topologia física de homologação (Seção 4.6 do Mapa Mestre).

## Registro de Amostras

| # | Data/Hora (ISO) | RAM Total | RAM Usada | RAM Disponível | Swap Usada | Disco / (%) | Evento Relevante | Container Mais Pesado | CPU % (Pico) | Observação Operacional |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 2026-09-21T09:00:00-03:00 | 8 GB | - | - | - | - | Horário Normal (Manhã) | - | - | Início do expediente |
| 2 | 2026-09-21T14:30:00-03:00 | 8 GB | - | - | - | - | Pico / Postiz Ativo | - | - | Publicação de posts / CRM |
| 3 | 2026-09-21T21:00:00-03:00 | 8 GB | - | - | - | - | Idle / Noturno | - | - | Tráfego reduzido |
| 4 | 2026-09-22T09:00:00-03:00 | 8 GB | - | - | - | - | Horário Normal | - | - | Operação padrão |
| 5 | 2026-09-22T15:00:00-03:00 | 8 GB | - | - | - | - | Publicação Postiz | - | - | Integração Meta ativa |
| 6 | 2026-09-22T22:00:00-03:00 | 8 GB | - | - | - | - | Idle | - | - | - |
| 7 | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

### Tipos de Eventos Relevantes:
- **Horário Normal:** Operação diária padrão de usuários e CRM.
- **Pico:** Alta carga simultânea de requisições ou relatórios.
- **Publicação Postiz:** Disparo agendado de mídias para redes sociais.
- **Backup:** Rotina periódica de dump do PostgreSQL.
- **Idle:** Período noturno ou fins de semana com baixo consumo.

---

## Consolidação e Parecer de Capacidade

- **Menor RAM Disponível Observada:** `___ GB`
- **Maior Uso de Swap Observado:** `___ GB`
- **Pico Máximo de CPU Observado:** `___ %`
- **Impacto Estimado da Homologação (API 512MB + Web 128MB + DB 256MB):** `~0.9 GB RAM`
- **Margem de Segurança Restante Pós-Homologação:** `___ GB RAM`
- **Veredito:** `[ ] Capacidade Aprovada para Homologação` / `[ ] Upgrade de VPS Necessário Antes do Deploy`
