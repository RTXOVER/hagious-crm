# Manual do CRM Hagious

Guia de uso do sistema para a equipe da Hagious (Contábil, Fiscal, DP e Atendimento) e de instalação para quem
cuida do servidor.

**Sumário**

1. [O que é o sistema](#1-o-que-é-o-sistema)
2. [Primeiro acesso](#2-primeiro-acesso)
3. [Perfis e o que cada um vê](#3-perfis-e-o-que-cada-um-vê)
4. [Painel](#4-painel)
5. [Clientes](#5-clientes)
6. [Tickets (solicitações)](#6-tickets-solicitações)
7. [Documentos](#7-documentos)
8. [Conversas (WhatsApp e e-mail)](#8-conversas-whatsapp-e-e-mail)
9. [Sucesso do cliente](#9-sucesso-do-cliente)
10. [Indicadores](#10-indicadores)
11. [Avisos](#11-avisos)
12. [Gestão: Equipe e Prazos e lembretes](#12-gestão-equipe-e-prazos-e-lembretes)
13. [Configurações pessoais](#13-configurações-pessoais)
14. [Segurança: o que saber](#14-segurança-o-que-saber)
15. [Perguntas frequentes](#15-perguntas-frequentes)
16. [Instalação e operação do servidor](#16-instalação-e-operação-do-servidor)

---

## 1. O que é o sistema

O CRM Hagious reúne em um só lugar:

- o **cadastro dos clientes** (dados, contatos, serviços contratados e responsáveis);
- as **solicitações dos clientes** (tickets), com responsável e prazo contado em horário útil;
- a **cobrança preventiva de documentos**, com lembretes automáticos antes do vencimento;
- as **conversas** de WhatsApp e e-mail, ligadas ao cliente certo;
- o **sucesso do cliente**: contatos periódicos, reuniões e alertas proativos;
- **indicadores** para a gestão acompanhar prazos, volume e relacionamento.

Toda alteração importante fica registrada com autor e horário.

## 2. Primeiro acesso

1. O administrador cria a sua conta na tela **Equipe** e entrega uma **senha provisória**.
2. Abra o endereço do sistema no navegador (ex.: `http://192.168.100.131:3000` na rede do escritório).
3. Entre com seu e-mail e a senha provisória.
4. Vá em **Configurações → Conta** e troque a senha.

Regras da senha: no mínimo 10 caracteres, com letras e números. O sistema recusa senhas previsíveis
(como "senha", "hagious", "123456") e senhas que contenham seu nome ou e-mail.

> Não existe cadastro aberto: só o administrador cria contas.

## 3. Perfis e o que cada um vê

| Perfil | O que vê e faz |
|---|---|
| **Administrador** | Tudo, inclusive criar e desativar contas (Equipe) e conectar canais de WhatsApp/e-mail |
| **Gestor** | Todos os clientes, tickets e documentos; histórico de alterações; regras de prazos e lembretes; indicadores de toda a equipe |
| **Colaborador** (Contábil, Fiscal, DP) | Só os clientes do seu departamento (por serviço contratado) ou sob sua responsabilidade |
| **Colaborador do Atendimento** | Todos os clientes (precisa deles para atender o WhatsApp e o e-mail) |

As permissões ficam no banco de dados: mesmo quem tentar acessar por fora da tela não vê o que não deve.

## 4. Painel

É a tela inicial. Mostra, para os clientes que você pode ver:

- **Tickets**: abertos, em risco (perto do vencimento), atrasados, sem responsável e o percentual de prazo cumprido nos últimos 30 dias;
- **Documentos**: pendentes, que vencem em 7 dias, atrasados e clientes em situação crítica;
- **Sucesso do cliente**: contatos atrasados, próximos 7 dias e clientes sem acompanhamento;
- **Clientes**: ativos, novos, contatos com WhatsApp autorizado e cadastros completos;
- **Precisa de atenção**: clientes com cadastro incompleto (sem serviço, sem responsável, sem contato principal...).

Clique em qualquer número para abrir a lista correspondente. O botão **Indicadores** leva à visão gerencial completa.

## 5. Clientes

### Cadastrar (gestão)
**Clientes → Novo cliente** abre um passo a passo em 4 etapas:

1. **Empresa**: digite o CNPJ. O sistema busca razão social, nome fantasia e endereço automaticamente na Receita
   (BrasilAPI). Aceita o novo CNPJ com letras.
2. **Contato principal**: nome, cargo, e-mail e WhatsApp. Marque a **autorização de WhatsApp** só se o cliente
   concordou em receber mensagens.
3. **Serviços**: quais departamentos atendem o cliente (Contábil, Fiscal, DP).
4. **Responsáveis**: a pessoa responsável em cada departamento.

### Página do cliente
Reúne tudo sobre o cliente:

- **Tickets** do cliente (abertos primeiro) e botão **Novo ticket**;
- **Sucesso do cliente**: último acompanhamento, ações programadas e as últimas realizadas;
- **Documentos**: exigências recorrentes e pendências;
- **Mensagens e conversas**: mensagens salvas e conversas de WhatsApp/e-mail ligadas ao cliente;
- **Dados cadastrais**, **Contatos**, **Serviços contratados** e **Responsáveis internos**;
- **Histórico de alterações** (gestão).

A gestão pode **suspender** ou **encerrar** um cliente. Cliente suspenso ou encerrado não recebe lembretes automáticos.

## 6. Tickets (solicitações)

Todo pedido de cliente vira um ticket, com **responsável** e **prazo**.

### Abrir
**Tickets → Novo ticket**: escolha o cliente, o tipo de solicitação (que define o departamento e o prazo),
a origem (WhatsApp, telefone, e-mail...), a prioridade e descreva o pedido. O sistema mostra o prazo antes de salvar.

### Prazos (SLA)
- O prazo conta só em **horário útil** (expediente configurado, de segunda a sexta, sem feriados).
- Há um prazo de **1ª resposta** e um prazo de **resolução**.
- Quando falta pouco (ponto de alerta), o ticket fica **em risco** e o responsável é avisado.
- Se vencer, fica **atrasado** e a gestão é avisada.
- Em **aguardando cliente**, o prazo fica pausado.

### Situações
Aberto → Em andamento → (Aguardando cliente) → Concluído. Concluir exige descrever a solução; cancelar exige motivo.
Ticket concluído só é alterado pela gestão.

### Encaminhar
Quando o pedido é de outro departamento, use **Encaminhar**: escolha o departamento (e a pessoa, se souber) e
informe o motivo. Fica tudo no histórico.

### Visões da lista
Abertos, Meus, Em risco, Atrasados, Sem responsável, Encerrados e Todos. Filtre por departamento, responsável
ou busque pelo número (#12) ou título.

## 7. Documentos

Cobrança preventiva do que o cliente precisa entregar (extratos, notas, folha...).

### Exigências (o que se repete)
Na página do cliente, seção **Documentos → Adicionar exigência**: escolha o documento, a frequência (mensal,
trimestral, semestral, anual) e o dia do vencimento. As pendências são criadas sozinhas, com antecedência.

### Pendência avulsa
**Documentos → Nova pendência** para um pedido pontual (ex.: contrato social atualizado).

### Lembretes
O sistema lembra a equipe **5 dias antes, 2 dias antes e no dia** do vencimento (configurável pela gestão), sempre
no expediente. Documento vencido entra no **relatório crítico** e a gestão é avisada.

### Registrar o recebimento
Clique em **Recebido** na lista ou abra a pendência. Também dá para **dispensar** ou marcar como **não exigível**
(com motivo). Os lembretes param na hora.

## 8. Conversas (WhatsApp e e-mail)

Uma caixa de entrada única para as mensagens dos clientes.

- **Todas / WhatsApp**: conversas em formato de chat. Conversas de e-mail aparecem com fundo azul e as de WhatsApp com
  fundo verde.
- **E-mail**: layout próprio, com pastas:
  - **Importantes**: tudo que interessa ao escritório;
  - **Clientes**: remetentes ligados a um cliente cadastrado;
  - **Empresas**: domínios de empresas (fornecedores, parceiros);
  - **Pessoas**: endereços pessoais (Gmail, Hotmail...);
  - **Separados**: propagandas, newsletters e mensagens automáticas, que ficam fora do caminho. Se algo for
    separado por engano, use **Não é promoção** e o sistema lembra daquele remetente;
  - **Arquivados**.

### O que dá para fazer com uma mensagem
Passe o mouse (ou toque) na mensagem e abra o menu:

- **Salvar no cliente**: guarda a mensagem na página do cliente, com uma observação;
- **Abrir ticket**: cria um ticket já com o texto e o cliente da conversa;
- **Marcar documento como recebido**: dá baixa numa pendência do cliente.

Conversa de número ou e-mail desconhecido pode ser **ligada a um cliente** pelo botão no topo da conversa.

### Conectar os canais (administrador)
**Conversas → Canais**:

- **E-mail**: informe o provedor, o endereço e a senha. No Gmail e no Yahoo use uma *senha de app*. A senha fica
  criptografada.
- **WhatsApp**: usa a API oficial da Meta no modo **coexistência** (o número continua funcionando no app WhatsApp
  Business). Precisa de uma configuração única da Hagious na Meta (veja a seção 16). Limitações da Meta: não há
  grupos, e texto livre só pode ser enviado até 24 horas depois da última mensagem do cliente.
- **Demonstração**: cria canais de teste que simulam mensagens chegando.

## 9. Sucesso do cliente

Contatos **proativos**, antes de o cliente precisar pedir.

### Programar uma ação
**Sucesso do cliente → Programar ação** (ou pela página do cliente):

1. escolha o cliente;
2. o tipo: **contato de acompanhamento**, **reunião de saúde financeira**, **alerta tributário preventivo**,
   **ação consultiva** ou outra;
3. o objetivo, a data prevista, o responsável;
4. se repete: uma vez, a cada 3 meses, a cada 6 meses ou uma vez por ano.

### Acompanhar
- O responsável recebe um aviso **no dia** e outro **se a data passar**.
- **Reagendar** exige o motivo.
- **Registrar como realizada** exige o resultado (o que foi conversado ou combinado). Se a ação se repete, a
  próxima já fica programada automaticamente.
- **Cancelar** exige o motivo. Só a gestão reabre uma ação encerrada.
- Comentários e todo o histórico ficam na própria ação.

### Clientes sem acompanhamento
A visão **Sem acompanhamento** lista os clientes ativos sem nenhuma ação realizada há mais de 90 dias
(prazo ajustável pela gestão), com botão para programar.

## 10. Indicadores

Visão gerencial, com filtros de **período** (7, 30, 90 dias, este mês, mês anterior, este ano ou datas
personalizadas), **departamento** e **responsável**.

| Indicador | Como é calculado |
|---|---|
| Abertos agora / perto de vencer / atrasados | Situação neste momento, com as mesmas regras dos alertas |
| Abertos no período | Tickets criados no período |
| Prazo de resolução cumprido | Concluídos no período dentro do prazo ÷ concluídos no período |
| 1ª resposta no prazo | Respondidos no período dentro do prazo de 1ª resposta ÷ respondidos |
| Tempos médios | Em horário útil; a resolução desconta o tempo aguardando o cliente |
| Por departamento / tipo / responsável | As mesmas regras, separadas |
| Documentos | Pendentes, atrasados e clientes críticos (situação atual) |
| Contatos proativos | Previstos e realizados no período, atrasados e clientes sem acompanhamento |

Clique em qualquer número para ver os registros que ele conta, já filtrados. Cada pessoa vê apenas os números dos
clientes a que tem acesso. O quadro **Como cada número é calculado**, no fim da tela, repete estas regras.

## 11. Avisos

O sino no topo mostra os avisos não lidos: tickets atribuídos, em risco ou atrasados, menções, documentos a cobrar,
ações de sucesso do cliente e alertas de segurança (para administradores).

## 12. Gestão: Equipe e Prazos e lembretes

### Equipe (administrador)
- **Nova conta**: nome, e-mail, perfil e departamento. A senha provisória aparece uma única vez.
- **Gerar nova senha** para quem esqueceu.
- **Desativar** quem saiu da empresa. A pessoa perde o acesso na hora, e o histórico dela é mantido.

### Prazos e lembretes (gestão)
- **Expediente** e **feriados**: inclua os feriados municipais e estaduais da cidade da Hagious;
- **Tipos de solicitação e prazos** dos tickets;
- **Lembretes de documentos** e **catálogo de documentos**;
- **Sucesso do cliente**: depois de quantos dias o cliente aparece como "sem acompanhamento".

> Valores marcados como **a confirmar** foram preenchidos só para o sistema funcionar e precisam ser revisados pela
> gestão. Ao salvar, a marcação some.

## 13. Configurações pessoais

**Configurações**:

- **Conta**: nome e troca de senha (pede a senha atual);
- **Visual**: tema claro/escuro e tamanho da letra;
- **Idioma e região**: formato de data e hora, fuso horário e moeda.

## 14. Segurança: o que saber

- **Senha errada 5 vezes seguidas** bloqueia a conta por 15 minutos, mesmo que a 6ª esteja certa. Os
  administradores recebem um aviso. Se não foi você, avise a gestão.
- **8 horas sem uso** encerram a sessão automaticamente. É só entrar de novo.
- Use **Sair** ao terminar em computador compartilhado.
- Nunca compartilhe sua senha. Cada pessoa tem a própria conta, e tudo fica registrado com o autor.
- A mensagem de login é sempre "E-mail ou senha incorretos", sem dizer qual dos dois está errado. Se não conseguir
  entrar, digite o e-mail à mão: o preenchimento automático do navegador pode trazer outro endereço.

## 15. Perguntas frequentes

**Não consigo entrar.** Confira o e-mail letra por letra (digite à mão). Se aparecer "Muitas tentativas",
espere o tempo indicado. Esqueceu a senha? Peça ao administrador para gerar uma nova em **Equipe**.

**O administrador esqueceu a própria senha.** No computador do servidor, na pasta do projeto, rode
`npm run reset-password -- "email@empresa.com"`. A senha provisória aparece só ali.

**Não vejo um cliente.** Colaboradores veem só os clientes do seu departamento ou sob sua responsabilidade. Peça à
gestão para incluir o serviço ou definir você como responsável.

**O prazo do ticket parece errado.** O prazo conta só no expediente, em dias úteis, sem feriados. Confira os
feriados em **Prazos e lembretes**.

**Por que um e-mail foi para Separados?** Ele tinha sinais de envio em massa (link de descadastro, lista,
remetente automático). Use **Não é promoção** para corrigir.

**O sistema abre em outro computador?** Sim, na mesma rede, pelo endereço do servidor (veja a seção 16). De fora do
escritório, só depois de publicar o sistema na internet.

---

## 16. Instalação e operação do servidor

Esta parte é para quem cuida do computador ou servidor onde o sistema roda.

### Requisitos
- **Node.js 20.9 ou mais novo**.
- Um projeto no **Supabase** (banco de dados na nuvem), de preferência na região *South America (São Paulo)*.

### Configuração (uma vez)
1. Baixe o projeto: `git clone <endereço do repositório>` e entre na pasta.
2. Instale as dependências: `npm install`.
3. Copie `.env.example` para `.env.local` e preencha os valores. **Nunca envie o `.env.local` para o GitHub**:
   ele já está ignorado pelo git.

   | Variável | Onde obter |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys |
   | `SUPABASE_SERVICE_ROLE_KEY` | Mesma tela (chave secreta). Nunca compartilhe |
   | `SUPABASE_DB_URL` | Supabase → Connect → Session pooler (troque `[YOUR-PASSWORD]` pela senha do banco) |
   | `CHANNEL_SECRET_KEY` | Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `WHATSAPP_VERIFY_TOKEN` | Texto aleatório longo, gerado do mesmo jeito |
   | `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_ES_CONFIG_ID` | Opcional, só para o WhatsApp real (Meta for Developers) |

4. Crie a estrutura do banco: `npm run db:migrate`.
5. Crie o primeiro administrador: `npm run create-admin -- "email@empresa.com" "Nome Completo"`. A senha
   provisória aparece no terminal.
6. No Supabase, em *Authentication → Sign In / Providers*, desative **Allow new users to sign up**.

### Ligar o servidor para a equipe (rede do escritório)
```
npm run build
npm run start -- -H 0.0.0.0
```
A equipe acessa por `http://<IP-do-computador>:3000`. Para descobrir o IP no Windows, rode `ipconfig` e veja o
"Endereço IPv4".

- Use sempre o **modo de produção** acima. `npm run dev` é só para desenvolvimento e mostra detalhes internos.
- O computador precisa ficar ligado, sem entrar em suspensão.
- Na primeira vez, o Windows pode perguntar sobre o "Node.js": permita em **redes privadas**.
- Depois de atualizar o código (`git pull`), rode `npm run build` de novo e reinicie o servidor.
- Para desligar, feche o terminal do servidor ou pressione `Ctrl+C` nele.

### Publicar na internet (recomendado para uso diário)
Publicar numa hospedagem com **HTTPS** (por exemplo a Vercel) permite acesso de qualquer lugar, deixa o tráfego
criptografado e é necessário para o WhatsApp real. Basta cadastrar as mesmas variáveis do `.env.local` no painel da
hospedagem.

### WhatsApp oficial (uma vez)
1. A Hagious se torna **Tech Provider** na Meta e cria um app com *Embedded Signup*.
2. Configure `META_APP_ID`, `META_APP_SECRET` e `WHATSAPP_ES_CONFIG_ID`.
3. Aponte o webhook do app para `https://<seu-domínio>/api/webhooks/whatsapp`, usando o `WHATSAPP_VERIFY_TOKEN`.
4. Em **Conversas → Canais**, clique em **Conectar WhatsApp**.

### Rotinas automáticas (no banco)
| Rotina | Quando |
|---|---|
| Prazos dos tickets (risco e atraso) | A cada 5 minutos |
| Lembretes de documentos | A cada hora, no expediente |
| Lembretes de sucesso do cliente | A cada hora, no expediente |
| Limpeza do registro de tentativas de login | Diariamente (guarda 30 dias) |

### Testes
```
npm test          # regras e cálculos (não usa o banco)
npm run test:db   # permissões no banco — SOMENTE em banco de desenvolvimento
npm run typecheck
npm run lint
```

### Comandos úteis
| Comando | Para quê |
|---|---|
| `npm run db:migrate` | Aplica as atualizações do banco (cada uma roda uma única vez) |
| `npm run db:migrate -- --status` | Só mostra o que já foi aplicado |
| `npm run create-admin -- "email" "Nome"` | Cria o primeiro administrador |
| `npm run reset-password -- "email"` | Senha provisória para uma conta |
