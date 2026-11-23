# CLAUDE.md — sis-financas

Sistema financeiro **pessoal** do Paulo, alimentado por **Open Finance via Pluggy (Meu Pluggy)**.
Roda só no PC dele (Windows, "vegapunk"). Repositório **privado**: github.com/paulotks/sis-financas
(conta pessoal; **nunca** na org Liberdade-Medica).

Responda em **português**. Explique decisões em linguagem simples, sem jargão desnecessário.

## Comandos

```powershell
npm install        # na raiz (workspaces api + web)
npm run dev        # API :3333 + front :5173 (proxy /api -> 3333)
npm run typecheck  # tsc nos dois workspaces — rodar antes de todo commit
npm test           # sincronização e API contra uma Pluggy falsa (base temporária)
npm run build      # compila api/dist e web/dist
npm start          # produção local: tudo em http://127.0.0.1:3333
```

Node **22.13+** (usa `node:sqlite`, sem dependência nativa).

## Estrutura

```
api/src/
  env.ts          carrega ../.env (process.loadEnvFile); porta, DB_PATH, PLUGGY_API_URL
  db.ts           SQLite + MIGRACOES (controle por PRAGMA user_version) + helpers
  pluggy.ts       cliente Pluggy: /auth (apiKey em cache ~110 min), /connect_token, items, accounts, bills, investments, /v2/transactions
  sync.ts         item -> contas -> lançamentos -> faturas -> investimentos (relê 365 dias; remove duplicados dos últimos 60)
  categorizar.ts  regras do Paulo > mapa de categorias Pluggy > sem categoria
  server.ts       rotas Fastify + zod; serve web/dist se existir
web/src/
  lib/api.ts            tipos + chamadas + formatação (BRL, datas, meses)
  lib/pluggyConnect.ts  carrega o widget Pluggy Connect sob demanda
  pages/                Resumo, Lancamentos, Contas, Categorias, Conexoes
  styles.css            tema escuro (variáveis CSS); sem framework de CSS
```

## Regras de segurança (não negociáveis)

- `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` ficam **só** no `.env` da raiz (no `.gitignore`). Nunca no front, em log, em commit ou no chat. Não leia nem exiba os valores.
- O navegador só recebe o Connect Token (vale 30 min), criado em `POST /api/pluggy/connect-token`.
- A API escuta **só em 127.0.0.1**. O hook `onRequest` recusa POST/PATCH/DELETE de origem fora de localhost:5173/3333. Também recusa qualquer pedido com `Host` de fora (DNS rebinding). Não afrouxe.
- `data/` (a base) e `.env` nunca vão para o Git. Antes de commitar, confira o `git status`.
- Validar toda entrada com zod; SQL sempre com parâmetros (`?`), nunca concatenando valor.

## Convenções de dados

- Dinheiro em **centavos** (INTEGER). Saída é **negativa**. O sinal vem do `type` da Pluggy (`DEBIT` = saída), não do sinal de `amount`, que varia por banco/cartão.
- Datas em `AAAA-MM-DD` (texto). Mês = `AAAA-MM`.
- Nomes de tabelas, colunas, rotas e variáveis em português (`lancamentos`, `valor_centavos`, `/api/contas`).
- **Migrações:** só acrescente um novo item ao fim de `MIGRACOES` em `db.ts`. Nunca edite uma migração que já existe — a base do Paulo já rodou.
- `lancamentos.id` = id da transação na Pluggy (chave do dedupe). A sincronização **atualiza** dados do banco mas **preserva** o que é do usuário: `descricao`, categoria com `categoria_manual = 1`, `notas`, `tags`, `ignorado`.
- Categoria: regra (texto *contido* na `descricao_original`, sem diferenciar maiúsculas) > categoria da Pluggy mapeada em `MAPA_PLUGGY` > `NULL` (pendente). Edição manual nunca é sobrescrita.
- Grupo `transferencia` (Transferência entre contas, Pagamento de fatura) fica **fora do resumo**, para não contar o mesmo gasto duas vezes.
- Contas têm `pessoa` PF/PJ. Inter Empresas = PJ (TRKS Studio, empresa do Paulo) e não entra no orçamento da casa. O resumo filtra por pessoa.

## Pluggy — o que já se sabe

- Conector **MeuPluggy** (gratuito para o titular, até 5 conexões). Bancos conectados: Inter Empresas (PJ), Mercado Pago, Caixa, Nubank, PicPay.
- `POST /connect_token`: `clientUserId` vai **dentro de `options`**; `itemId` na raiz só para reconectar.
- Transações: usar **`GET /v2/transactions`** (cursor; `next` é a query string pronta, `?accountId=...&after=...`: anexar ao caminho, nunca mandar inteira em `after`). O `/transactions` v1 é removido em **31/12/2026**.
- A Pluggy cria lançamentos com **data passada** e parcelas com **data futura** (`PENDING`), e ao fechar a fatura pode **apagar e recriar** um lançamento com outro id. Por isso a sincronização relê a janela toda e `removerSumidos` (`sync.ts`) tira o antigo, passando a edição do usuário para o substituto. Editado sem substituto vira `status = 'REMOVIDO'`: fica na lista e **não soma** (toda consulta de totais precisa excluir).
- `date` vem em UTC (a documentação manda converter para GMT-3). Hoje usamos só a parte da data: conferir com dados reais se lançamento feito depois das 21h cai no dia seguinte.
- Itens do MeuPluggy **não** aceitam refresh pela API; a Pluggy atualiza 1x/dia. Nem o widget (`updateItem`) atualiza o item proxy: reautorizar banco = refazer no meu.pluggy.ai (atualiza sozinho a cada 24h). Limite gratuito: 5 conexões ativas do mesmo titular (a tela Conexões mostra n/5). Widget fixado em v2.7.0.
- Faturas (`/bills`) e investimentos (`/investments`) podem não existir para alguns bancos: tratar `ErroPluggy` e seguir.
- Cofrinhos do Mercado Pago não aparecem como conta; se vierem, é por `/investments`. Ainda não confirmado com dados reais.
- O ambiente de nuvem do Claude (Cowork) **não alcança** api.pluggy.ai. Teste real só no PC do Paulo. Para testes automatizados, use um servidor falso via `PLUGGY_API_URL`.
- Cartões **fora** do Open Finance (Bradescard, C&A Pay, Pefisa, Midway) precisarão de lançamento manual (próxima fase).

## Ferramentas MCP do projeto (usar sempre que necessário)

Configuradas em `.mcp.json` (escopo do projeto). Na primeira vez que abrir a pasta, o Claude Code pede para aprovar os dois servidores.

- **`pluggy-docs`** (`https://mcp.pluggy.ai/mcp`): documentação oficial e atual da Pluggy (API, Connect widget, changelog, receitas).
  **Consulte antes** de escrever ou mudar qualquer código que fale com a Pluggy: endpoints, campos, paginação, widget, erros, conector MeuPluggy.
  Não confie em memória nem em snippet antigo; a Pluggy muda rápido. Exemplos que já quebraram: a URL do widget no snippet oficial dava 404, e `/transactions` v1 sai do ar em 31/12/2026.
  Este MCP **não** acessa os dados bancários do Paulo; só a documentação.
- **`context7`** (`https://mcp.context7.com/mcp`): documentação atualizada de bibliotecas e frameworks.
  **Consulte antes** de usar ou atualizar APIs de Fastify, `@fastify/static`, zod, `node:sqlite`, React, React Router, TanStack Query, Vite e TypeScript, sobretudo ao subir de versão major ou quando houver dúvida de sintaxe.
  Fluxo: resolver o ID da biblioteca e depois buscar a documentação do tópico específico.

Se um dos dois estiver fora do ar, diga isso ao Paulo e siga com a documentação oficial na web. Não invente API.

## Sistema antigo (não mexer daqui)

- `C:\Users\paulo\Claude\financeiro\` (Python + `financeiro.db` + painel). Continua em uso até o novo cobrir tudo.
- Tem ~200 regras de categoria e o catálogo de assinaturas. Plano: importar **só regras e assinaturas** para cá, por um script opcional e explícito. O histórico de lançamentos fica lá.
- Este projeto nunca escreve na `financeiro.db`.

## Próximas fases

1. ~~Conectar bancos e sincronizar; lançamentos editáveis; categorias e regras; resumo do mês~~ (feito em 2026-11-23)
2. Orçamento mensal (planejado × realizado)
3. Faturas e parcelas futuras (projeção)
4. Assinaturas recorrentes
5. Lançamentos manuais (cartões sem Open Finance, dinheiro)
6. Importar regras e assinaturas do sistema antigo

O Paulo não gostou do front antigo por **navegação** e **pouca edição na tela**. Priorize editar direto na tabela/cartão e o menu lateral simples.

## Fluxo de trabalho

- Antes de commitar: `npm run typecheck`, `npm test` e `npm run build` sem erro.
- **Mudou o front? Valide no navegador com o MCP `chrome-devtools`** antes de commitar (os testes automáticos não cobrem a tela):
  1. `npm run dev` (se as portas 5173/3333 já estiverem ocupadas, o servidor já roda: só use-o; o Vite recarrega sozinho).
  2. `navigate_page` na rota alterada, `take_snapshot` e `take_screenshot` (tela cheia).
  3. `list_console_messages`: nenhum erro ou aviso novo.
  4. Estados difíceis de provocar (limite, erro, lista cheia): simule a resposta da API com `initScript` no `navigate_page` (sobrescrevendo `fetch`), sem tocar na base nem na Pluggy.
  5. Confira com `evaluate_script` o que importa (texto, botão desabilitado, links) e diga ao Paulo o que foi visto.
  Nunca dispare ações que gravam (Sincronizar, Conectar banco, salvar) contra a base real só para testar.
- Commits pequenos, mensagem em português.
- Decisões e andamento ficam no Obsidian do Paulo: `01 Projetos/Integração Open Finance (Pluggy).md` (vault em `C:\Users\paulo\OneDrive\Documentos\Obsidian Vault`). Registre lá o que for decidido.
