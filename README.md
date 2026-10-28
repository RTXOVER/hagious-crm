# CRM Hagious

Central de relacionamento e operação contábil (Contábil, Fiscal, DP e Atendimento).

📘 **[Manual de uso e instalação](docs/MANUAL.md)**: como usar cada tela, perfis, segurança e como ligar o servidor.

**Tecnologias:** Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Supabase (PostgreSQL, autenticação, regras de acesso por linha) · Zod · Vitest.

## Situação das etapas

| Etapa | Conteúdo | Situação |
|---|---|---|
| 1. Base | Banco, login, perfis, permissões, auditoria | Pronto e testado no Supabase (São Paulo) |
| 2. Clientes | Cadastro, contatos, serviços, responsáveis, histórico | Pronto e testado no Supabase (São Paulo) |
| 3. Operação | Tickets, SLA, encaminhamentos, alertas | Pronto e testado no Supabase (banco e telas) |
| 3. Operação | Documentos: exigências, pendências, lembretes (5/2/0 dias), relatório crítico | Pronto e testado no Supabase (banco e telas); envio ao cliente pelo WhatsApp na Etapa 4 |
| 4. Integrações | Central de Conversas: WhatsApp oficial (coexistência) e e-mail (IMAP/SMTP) | E-mail pronto e testado com caixa real de teste; WhatsApp pronto e testado em modo de demonstração — **depende da configuração única da Hagious na Meta** (ver abaixo) |
| 5. Gestão | Sucesso do cliente (contatos proativos, recorrência, lembretes) e Indicadores gerenciais com filtros e links para os registros | Pronto e testado no Supabase (banco e telas) |

## Perfis de acesso

| Perfil | Pode |
|---|---|
| Administrador | Tudo, inclusive criar contas (tela Equipe) |
| Gestor | Ver e editar todos os clientes; ver histórico de alterações |
| Colaborador | Ver só clientes do seu departamento (por serviço contratado) ou sob sua responsabilidade; manter contatos desses clientes |
| Colaborador do Atendimento | Ver todos os clientes (necessário para atender o WhatsApp) |

As regras ficam no banco (Row Level Security), então valem mesmo que alguém tente acessar a API diretamente.
O cadastro público está desativado: só administradores criam contas.

## Segurança

| Camada | Proteção |
|---|---|
| Banco | Regras de acesso por linha em todas as tabelas; visitante sem login não tem nenhum acesso; funções só para quem precisa; ninguém além do servidor esvazia tabelas |
| Login | Mensagem genérica (não revela se o e-mail existe); bloqueio de 15 min após 5 senhas erradas seguidas na conta ou 20 erros do mesmo endereço; aviso aos administradores |
| Senhas | Mínimo 10 caracteres com letra e número; recusa senhas previsíveis ("senha", "hagious", sequências) e partes do nome/e-mail; troca exige a senha atual |
| Sessão | Cookies httpOnly (scripts não leem o token), SameSite e Secure com HTTPS; encerra após 8 h sem uso |
| Páginas | Política de conteúdo (CSP) com nonce por resposta; sem abrir dentro de outros sites; cabeçalhos anti-sniffing e de isolamento; HSTS com HTTPS |
| Integrações | Webhook do WhatsApp com assinatura HMAC; senha do e-mail criptografada (AES-256-GCM); servidor de e-mail não pode apontar para o próprio computador |
| Registros | Tentativas de login guardadas 30 dias com hash (sem e-mail ou IP em texto) |

**Senha esquecida:** o administrador gera senha nova para a equipe na tela **Equipe**. Se o próprio administrador esquecer,
rode no terminal do servidor: `npm run reset-password -- "email@empresa.com"` (a senha provisória aparece só ali).

**Para uso pela equipe** rode em modo de produção (`npm run build` e `npm run start -- -H 0.0.0.0`), nunca `npm run dev`
na rede: o modo de desenvolvimento mostra detalhes internos.

## Como rodar

Pré-requisitos: Node.js 20.9+ e um banco Supabase (opção A ou B).

### Opção A — Supabase na nuvem (recomendado para começar)

1. Crie uma conta em https://supabase.com e um projeto chamado `hagious-crm-dev`, região **South America (São Paulo)**.
2. Em *Project Settings → API Keys*, copie a **Project URL**, a chave pública (**anon** ou **publishable**) e a chave secreta (**service_role** ou **secret**).
3. Na pasta do projeto, copie `.env.example` para `.env.local` e cole os três valores. Não compartilhe esse arquivo.
4. Aplique o banco: no painel do Supabase, abra *SQL Editor*, cole o conteúdo de
   `supabase/migrations/20261026000001_base_clientes.sql` e clique em *Run*.
5. Em *Authentication → Sign In / Providers*, desative **Allow new users to sign up**.

### Opção B — Supabase local (Docker)

Requer o WSL instalado (PowerShell como administrador: `wsl --install`, depois reiniciar) e o Docker Desktop aberto.

```powershell
npx supabase start          # sobe o banco local e aplica as migrações
npx supabase status -o env  # mostra URL e chaves para o .env.local
```

### Aplicar migrações (estrutura do banco)

As migrações ficam em `supabase/migrations/`. Para aplicá-las pelo terminal:

1. No painel do Supabase, clique em **Connect** → aba **Connection String** → **Session pooler** e copie o endereço (`postgresql://postgres.xxxx:[YOUR-PASSWORD]@...pooler.supabase.com:5432/postgres`).
2. Troque `[YOUR-PASSWORD]` pela senha do banco definida na criação do projeto e cole no `.env.local` como `SUPABASE_DB_URL=...`.
3. Rode `npm run db:migrate` (ou `npm run db:migrate -- --status` para só consultar).

Cada migração roda uma única vez e por inteiro (se falhar, nada dela fica aplicado).

### Depois (as duas opções)

```powershell
npm install
npm run create-admin -- "seu.email@hagious.com.br" "Seu Nome"   # mostra uma senha provisória
npm run dev                                                    # abre em http://localhost:3000
```

## Conversas (WhatsApp e e-mail)

Tela **Conversas**: mensagens dos canais conectados, com ações por mensagem (salvar no cliente, abrir ticket,
marcar documento como recebido). Canais em **Conversas → Canais** (somente administradores conectam).

- **E-mail**: IMAP/SMTP. A senha é digitada na tela e fica criptografada (AES-256-GCM, chave `CHANNEL_SECRET_KEY` no servidor).
- **WhatsApp**: API oficial da Meta com coexistência (o número continua no app WhatsApp Business). Para ativar o botão
  "Conectar WhatsApp", configure uma vez no servidor: `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_ES_CONFIG_ID`
  (e opcionalmente `META_GRAPH_VERSION`). Requer a Hagious como Tech Provider na Meta e o webhook
  `https://<domínio>/api/webhooks/whatsapp` (endereço público com HTTPS) usando `WHATSAPP_VERIFY_TOKEN`.
  Limitações da Meta nesse modo: sem grupos; texto livre só até 24h após a última mensagem do cliente.
- **Modo de demonstração**: simula mensagens chegando, com o mesmo processamento do canal real.

## Sucesso do cliente

Tela **Sucesso do cliente**: ações proativas por cliente — contato de acompanhamento, reunião de saúde financeira,
alerta tributário preventivo e ação consultiva — com objetivo, data prevista, responsável, histórico e resultado.

- Ações recorrentes (a cada 3, 6 ou 12 meses): ao registrar como realizada, a próxima já é programada.
- Realizar exige o resultado; cancelar e reagendar exigem o motivo. Tudo fica no histórico da ação.
- Lembretes internos (a cada hora, no expediente): no dia previsto e uma vez quando atrasa.
- "Sem acompanhamento": cliente ativo sem ação realizada há mais de N dias (padrão 90, **a confirmar pela gestão**
  em Prazos e lembretes).
- Quem pode alterar: o responsável, quem programou, o Atendimento e a gestão. Reabrir ação encerrada: só a gestão.

## Indicadores

Tela **Indicadores**, com filtros de período, departamento e responsável. Cada número abre a lista de origem
com os mesmos filtros, e a tela explica como cada número é calculado ("Como cada número é calculado").

| Indicador | Como é calculado |
|---|---|
| Abertos agora / perto de vencer / atrasados | Situação atual, mesmas regras dos alertas (aguardando cliente não conta como atraso) |
| Abertos no período | Tickets criados no período |
| Prazo de resolução cumprido | Concluídos no período até o prazo ÷ concluídos no período (cancelados não entram) |
| 1ª resposta no prazo | Respondidos no período até o prazo de 1ª resposta ÷ respondidos no período |
| Tempo médio de 1ª resposta / resolução | Média em horário útil (expediente e feriados); a resolução desconta "aguardando cliente" |
| Cumprimento por departamento e por tipo | Mesma regra, separada por departamento ou tipo de solicitação |
| Volume por departamento / responsável | Tickets abertos no período (responsável atual) |
| Documentos pendentes, atrasados, clientes críticos | Situação atual |
| Contatos proativos | Previstos e realizados no período, atrasados e clientes sem acompanhamento |

Os números respeitam as permissões: cada pessoa soma apenas o que já pode ver.

## Critérios de aceite (validação final)

| Critério | Como foi verificado |
|---|---|
| Cada perfil vê só o que deve | Testes de permissão no banco (`test:db`) e percurso pelas telas com 5 perfis |
| Ticket com responsável, prazo em horário útil, alerta e encaminhamento registrado | Testes do banco (PGlite) e de tela |
| Documentos com lembretes em 5/2/0 dias e relatório crítico | Testes do banco e de tela |
| Mensagem de WhatsApp/e-mail ligada ao cliente, salva, vira ticket ou baixa documento | Testes de tela (WhatsApp em demonstração; e-mail com caixa real de teste) |
| Contato proativo programado, lembrado, realizado com resultado e repetido | Testes do banco e de tela |
| Indicadores com definição clara, filtros e acesso aos registros de origem | Testes automáticos de cálculo e de tela |
| Tudo auditado | Histórico de alterações (audit_log) nas tabelas principais |

**Dependências externas pendentes:** configuração única da Hagious na Meta (WhatsApp real), endereço público com HTTPS
e modelos de mensagem aprovados para lembretes ao cliente pelo WhatsApp. **Valores a confirmar pela gestão:**
expediente, prazos padrão de 1ª resposta e de "Solicitação geral", alerta de 25%, feriados municipais, tipos de
documento sugeridos e o prazo de "sem acompanhamento" (90 dias).

## Testes

```powershell
npm test          # validações, prazos, documentos, canais e cálculos dos indicadores — não precisa de banco
npm run test:db   # permissões no banco — use SOMENTE em banco de desenvolvimento
npm run typecheck
npm run lint
npm run build
```

`test:db` cria usuários, um cliente e tickets marcados como fictícios e apaga tudo ao final
(inclusive avisos e registros de histórico gerados por eles).

## Estrutura

```
supabase/migrations/     estrutura do banco e regras de acesso
src/proxy.ts             renova a sessão e redireciona quem não entrou
src/lib/auth.ts          sessão e verificação de perfil no servidor
src/lib/validation/      validação de CNPJ, telefone e formulários
src/app/(app)/clientes/  módulo de clientes
src/app/(app)/equipe/    gestão de contas (admin)
src/app/(app)/sucesso/   sucesso do cliente
src/app/(app)/indicadores/ indicadores gerenciais
src/lib/indicators.ts    regras de cálculo dos indicadores
scripts/create-admin.mjs cria o primeiro administrador
scripts/reset-password.mjs senha provisória para uma conta (uso no servidor)
src/lib/security/        bloqueio de tentativas, cabeçalhos/CSP, proteção de conexões
tests/                   testes automáticos
```
