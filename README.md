# CRM Hagious

Central de relacionamento e operação contábil (Contábil, Fiscal, DP e Atendimento).

**Tecnologias:** Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Supabase (PostgreSQL, autenticação, regras de acesso por linha) · Zod · Vitest.

## Situação das etapas

| Etapa | Conteúdo | Situação |
|---|---|---|
| 1. Base | Banco, login, perfis, permissões, auditoria | Pronto e testado no Supabase (São Paulo) |
| 2. Clientes | Cadastro, contatos, serviços, responsáveis, histórico | Pronto e testado no Supabase (São Paulo) |
| 3. Operação | Tickets, SLA, encaminhamentos, alertas | Pronto e testado no Supabase (banco e telas) |
| 3. Operação | Controle de documentos | Não iniciado |
| 4. Integrações | WhatsApp oficial (Cloud API), lembretes, escalonamento | Não iniciado |
| 5. Gestão | Dashboard e validação final | Não iniciado |

## Perfis de acesso

| Perfil | Pode |
|---|---|
| Administrador | Tudo, inclusive criar contas (tela Equipe) |
| Gestor | Ver e editar todos os clientes; ver histórico de alterações |
| Colaborador | Ver só clientes do seu departamento (por serviço contratado) ou sob sua responsabilidade; manter contatos desses clientes |
| Colaborador do Atendimento | Ver todos os clientes (necessário para atender o WhatsApp) |

As regras ficam no banco (Row Level Security), então valem mesmo que alguém tente acessar a API diretamente.
O cadastro público está desativado: só administradores criam contas.

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

## Testes

```powershell
npm test          # validações (CNPJ, telefones, formulários) — não precisa de banco
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
scripts/create-admin.mjs cria o primeiro administrador
tests/                   testes automáticos
```
