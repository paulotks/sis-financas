# CLAUDE.md — sis-financas

Sistema financeiro **pessoal** do Paulo, alimentado por **Open Finance via Pluggy (Meu Pluggy)**.
Roda só no PC dele (Windows). Repositório **público**, compartilhado com amigos: github.com/paulotks/sis-financas
Contexto pessoal (bancos, PC, pastas, notas) fica em `CLAUDE.local.md`, fora do Git: nunca copie de lá para arquivo versionado.

Responda em **português**. Explique decisões em linguagem simples, sem jargão desnecessário.

## Comandos

```powershell
npm install        # na raiz (workspaces api + web)
npm run dev        # API :3333 + front :5173 (proxy /api -> 3333)
npm run typecheck  # tsc nos dois workspaces — rodar antes de todo commit
npm test           # sincronização e API contra uma Pluggy falsa (base temporária)
npm run build      # compila api/dist e web/dist
npm start          # produção local: tudo em http://127.0.0.1:3333
npm run app:parar | app:iniciar | app:reiniciar   # o app de uso diário (tarefa do Windows, inicia no logon)
```

**O app de uso diário roda sempre**, em http://meu-financeiro.localhost (porta 80; tarefa agendada `sis-financas`, `app-windows.ps1`), usando `dist`:
- Para usar `npm run dev` (3333/5173): `npm run app:parar` antes e `npm run app:iniciar` no fim. As portas não brigam, mas os dois gravam na mesma base. Com o app parado, o MCP do Claude Desktop fica fora do ar (ele fala com a porta 80).
- `dist` é o que está em uso e `migrar()` roda a cada início na base real: **build na pasta principal só a partir do `main`**; branch com migração, só em worktree (ver Fluxo de trabalho).
- Depois de um build: `npm run app:reiniciar`. Mudou `mcp.ts`: reiniciar também o Claude Desktop.

Node **22.13+** (usa `node:sqlite`, sem dependência nativa).

## Estrutura

```
api/src/
  env.ts          carrega ../.env (process.loadEnvFile); porta, DB_PATH, PLUGGY_API_URL
  db.ts           SQLite + MIGRACOES (controle por PRAGMA user_version) + cópias automáticas + helpers
  pluggy.ts       cliente Pluggy: /auth (apiKey em cache ~110 min), /connect_token, items, accounts, bills, investments, /v2/transactions
  sync.ts         item -> contas -> lançamentos -> faturas -> investimentos (relê 365 dias; remove duplicados dos últimos 60)
  categorizar.ts  regras do Paulo > mapa de categorias Pluggy > sem categoria
  recorrentes.ts  detecta cobranças mensais e aplica as decisões (função pura)
  ritmo.ts        o alarme: projeção do mês, renda esperada, nível (funções puras; as consultas ficam em server.ts)
  patrimonio.ts   soma das posições e foto diária dos saldos
  server.ts       rotas Fastify + zod; serve web/dist se existir
  mcp.ts          MCP para o Claude Desktop: ferramentas sobre a API (mcp-stdio.ts é só a entrada)
web/src/
  lib/api.ts            tipos + chamadas + formatação (BRL, datas, meses)
  lib/pluggyConnect.ts  carrega o widget Pluggy Connect sob demanda
  components/           SeletorMes, SelectCategoria, CampoDinheiro, Patrimonio, LinhaPatrimonio, SelectSentido, OferecerRegra (corrigiu a categoria -> cria regra com um clique), ComprasDoEstorno, Alarme (topo do Resumo PF), RitmoLateral (menu, sempre o mês atual), Grafico (moldura dos gráficos: legenda, tabela, dica e cores por assunto)
  pages/                Resumo, Lancamentos, Orcamento, Analises (Recharts 3, carregada sob demanda), Recorrentes, Contas (com patrimônio), Categorias, Conexoes
  styles.css            tema escuro (variáveis CSS); sem framework de CSS
```

## Regras de segurança (não negociáveis)

- `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` ficam **só** no `.env` da raiz (no `.gitignore`). Nunca no front, em log, em commit ou no chat. Não leia nem exiba os valores.
- O navegador só recebe o Connect Token (vale 30 min), criado em `POST /api/pluggy/connect-token`.
- A API escuta **só em 127.0.0.1**. O hook `onRequest` recusa POST/PATCH/DELETE de origem que não seja `localhost`, `127.0.0.1` ou `meu-financeiro.localhost`, na 5173 ou na porta da API. Também recusa qualquer pedido com `Host` de fora (DNS rebinding). Não afrouxe: nome novo aqui só se terminar em `.localhost` (reservado, ninguém registra).
- `data/` (a base), `.env` e `CLAUDE.local.md` nunca vão para o Git. Antes de commitar, confira o `git status`.
- O repositório é público: nada de nome de pessoa, saldo, valor, extrato, contagem ou data de lançamento real, em arquivo nenhum nem em mensagem de commit.
- Validar toda entrada com zod; SQL sempre com parâmetros (`?`), nunca concatenando valor.

## MCP do app (`api/src/mcp.ts`)

- Só repassa pedidos para a API em 127.0.0.1. **Não importe `env.ts` nem `db.ts` nele**: o processo não pode ter as credenciais da Pluggy nem abrir a base. Nada de `console.log` (a saída padrão é o protocolo).
- Saída campo a campo, nunca a linha inteira: número da conta e `bruto` não saem. Dinheiro em **reais** só nessa borda.
- Sem conectar banco, apagar, trocar PF/PJ, bens ou marcar lançamento como ignorado: muda os totais e fica só na tela (o teste confere a lista de ferramentas). PF é o padrão.
- Recorrente: o MCP só **propõe** (`propor_recorrente`, coluna `proposta`); nada muda até o Paulo aceitar na tela. Nunca ligue o MCP ao `PUT /api/recorrentes`.
- `criar_regra` exige o `total_previsto` da prévia e não troca regra existente sem `substituir`. Não afrouxe: uma regra recategoriza o histórico inteiro, e o Cowork gravou sem pedir confirmação (não conte com ela como trava).
- **O MCP acompanha o sistema sempre**: tela ou dado novo entra no MCP no mesmo lote (menos o que está proibido acima). Mudou uma convenção de dados? Atualize também `CONVENCOES` em `mcp.ts` (é o que o Claude do Desktop sabe).
- SDK `@modelcontextprotocol/sdk` 1.x; a v2 exige zod 4 (migrar os dois juntos).

## Convenções de dados

- Dinheiro em **centavos** (INTEGER). Saída é **negativa**. O sinal vem do `type` da Pluggy (`DEBIT` = saída), não do sinal de `amount`, que varia por banco/cartão. Outro `type` ou valor ilegível: o lançamento é recusado (o que já estava na base fica) e vai para `conexoes.erro`.
- Datas em `AAAA-MM-DD` (texto). Mês = `AAAA-MM`.
- Nomes de tabelas, colunas, rotas e variáveis em português (`lancamentos`, `valor_centavos`, `/api/contas`).
- **Migrações:** só acrescente um novo item ao fim de `MIGRACOES` em `db.ts`. Nunca edite uma migração que já existe — a base do Paulo já rodou. `migrar()` desliga `foreign_keys` antes do `BEGIN` (senão o `DROP TABLE` de quem recria tabela apaga em cascata) e confere com `foreign_key_check`: migração que deixa órfão é desfeita e o app não sobe. Por isso, **dentro de migração não há cascata**: apague os filhos à mão. Base mais nova que o código é recusada: depois de migrar, o `dist` antigo não sobe (para voltar, restaure a cópia, ver README).
- **Cópias da base** (`copiar` em `db.ts`): uma por dia e uma antes de migração pendente, 14 de cada, em `COPIAS_DIR` (`.env`; padrão `copias/` ao lado da base). Sem a cópia, não migra. Teste e worktree têm que apontar para outra pasta (sem `.env` já apontam): na mesma pasta, girariam as cópias de verdade.
- `lancamentos.id` = id da transação na Pluggy (chave do dedupe). A sincronização **atualiza** dados do banco mas **preserva** o que é do usuário: `descricao`, categoria com `categoria_manual = 1`, `notas`, `tags`, `ignorado`.
- Categoria: regra (texto *contido* na `descricao_original`, sem diferenciar maiúsculas) > movimento interno (`INTERNOS`) > categoria da Pluggy mapeada em `MAPA_PLUGGY` > `NULL` (pendente). Edição manual nunca é sobrescrita. A API reaplica tudo ao subir. Regra é sempre por texto *contido* (nunca igualdade), com `sentido` (saída/entrada) e `conta_id` opcionais (nulo = vale para tudo); repetir texto + sentido + conta troca a categoria da regra. Desempate: prioridade > texto mais longo > com conta > com sentido.
- `NOMES_FIXOS` (nomes usados em `MAPA_PLUGGY` e `INTERNOS`): o código acha a categoria pelo nome, então a API recusa apagar, renomear, mudar de grupo ou mesclar (409). Apagar só categoria sem uso: `regras` e `orcamentos` têm `ON DELETE CASCADE`.
- Movimento interno vem em **par** (+X e −X) e a Pluggy dá categoria diferente a cada perna (cofrinho do MP, débito automático de fatura). Só tirar do resumo quando as **duas** pernas saem juntas: tirar uma só distorce o mês. Pix no crédito do Nubank tem **três** pernas (`pixNoCredito`, casadas pelo horário): o gasto é a cobrança no cartão, que herda a categoria do Pix se não tiver a própria; as duas da conta saem do resumo, acima das regras. Nunca muda o resultado do mês.
- Fora do trial a Pluggy pode mandar `category: null`; o sync guarda a última categoria conhecida.
- Grupo `transferencia` (Transferência entre contas, Pagamento de fatura, Investimentos) fica **fora do resumo**: não é gasto nem renda. Guardado = entradas − saídas.
- **Totais do mês:** Resumo e orçamento usam o mesmo SQL (`BASE_RESUMO` e `GASTO` em `server.ts`). Entrada (em conta ou cartão) com categoria de gasto é **estorno ou reembolso e abate** a categoria; sem categoria não abate (pode ser renda ou fatura paga). Rendimento de conta (`proceeds interests`) é Renda.
- **Orçamento** (`orcamentos`): só PF; o valor vale do mês em diante até a próxima linha da mesma categoria; 0 = sem orçamento.
- **Renda esperada**: linha de `orcamentos` numa categoria do grupo `renda` (nunca soma no planejado de gasto); sem nenhuma, mediana dos 3 últimos meses fechados. É a régua do alarme (`GET /api/ritmo`, só PF): renda extra não alivia o mês aberto. Meses antes do primeiro com renda completa (`inicioDaAnalise`, ou o escolhido em Análises: `config.inicio_analise`) não têm veredito. Contas e decisões em `docs/specs/lote-3.md`. Meta de guardar ainda não existe e **não** entra fixa no código.
- **Patrimônio** (`patrimonio.ts`): contas + investimentos + `bens` (linhas manuais; negativo = dívida) − cartões. O saldo do cartão no Open Finance é o **limite usado** (já com parcelas futuras): nunca somar `faturas` junto. Investimento resgatado vira `status = TOTAL_WITHDRAWAL` (não some da Pluggy). A evolução vem de `saldos_diarios`: uma foto por item a cada sincronização, porque o saldo é sobrescrito. Saldo, limite e total de fatura que vêm nulos mantêm o último; `contas.atualizado_em` diz quando o saldo foi lido.
- **Recorrentes** (`recorrentes.ts`, contas em `docs/specs/lote-5.md`): detecção refeita a cada leitura, uma linha por cobrança; `recorrencias` guarda só a decisão por `chave` (descrição original sem acento, número e símbolo: **não mude `chaveDe` nem `nomeDe`**, perde ou troca de alcance as decisões) + um valor que a cobrança já teve (0 = o nome todo, decisões antigas). Ignorada = não é recorrente; cancelada = acabou (avisa se cobrar de novo). Sugestão conta no alarme.
- Contas têm `pessoa` PF/PJ. Conta PJ não entra no orçamento da casa. O resumo filtra por pessoa.

## Pluggy — o que já se sabe

- Conector **MeuPluggy** (gratuito para o titular, até 5 conexões).
- `POST /connect_token`: `clientUserId` vai **dentro de `options`**; `itemId` na raiz só para reconectar.
- Transações: usar **`GET /v2/transactions`** (cursor; `next` é a query string pronta, `?accountId=...&after=...`: anexar ao caminho, nunca mandar inteira em `after`). O `/transactions` v1 é removido em **31/12/2026**.
- A Pluggy cria lançamentos com **data passada** e parcelas com **data futura** (`PENDING`), e ao fechar a fatura pode **apagar e recriar** um lançamento com outro id. Por isso a sincronização relê a janela toda e `removerSumidos` (`sync.ts`) tira o antigo, passando a edição do usuário para o substituto. Só roda com a lista completa (`listaCompleta`: `UPDATED` + `SUCCESS`, ou parcial com `transactions` e, no cartão, `creditCards` atualizados no `statusDetail`); fora disso a sincronização só acrescenta. Editado sem substituto vira `status = 'REMOVIDO'`: fica na lista e **não soma** (toda consulta de totais precisa excluir).
- `date` vem em UTC (a documentação manda converter para GMT-3), mas parte das linhas só tem a data (`T00:00Z`) e iria para o dia anterior. Usamos só a parte da data e **não convertemos** (decidido em 2026-11-25; o efeito nos totais é desprezível).
- Itens do MeuPluggy **não** aceitam refresh pela API; a Pluggy atualiza 1x/dia. Nem o widget (`updateItem`) atualiza o item proxy: reautorizar banco = refazer no meu.pluggy.ai (atualiza sozinho a cada 24h). Limite gratuito: 5 conexões ativas do mesmo titular (a tela Conexões mostra n/5). Widget fixado em v2.7.0.
- Banco sem faturas (`/bills`) ou investimentos (`/investments`) responde lista vazia, não erro (conferido em 2026-11-25). Só o 404 passa calado; outra falha não interrompe a sincronização, mas fica em `conexoes.erro` (400 é pedido nosso recusado: não esconder). `/accounts`, `/bills` e `/investments` são por página: ler com `todas()`.
- Cofrinhos do Mercado Pago não aparecem como conta nem em `/investments` (vazio em todos os bancos testados até 2026-11-23). No extrato vêm em par (+X/−X). Até virem, entram como linha manual em `bens`.
- O ambiente de nuvem do Claude (Cowork) **não alcança** api.pluggy.ai. Teste real só no PC do Paulo. Para testes automatizados, use um servidor falso via `PLUGGY_API_URL`.
- Cartões **fora** do Open Finance precisarão de lançamento manual (próxima fase).

## Ferramentas MCP do projeto (usar sempre que necessário)

Configuradas em `.mcp.json` (escopo do projeto). Na primeira vez que abrir a pasta, o Claude Code pede para aprovar os dois servidores.

- **`pluggy-docs`** (`https://mcp.pluggy.ai/mcp`): documentação oficial e atual da Pluggy (API, Connect widget, changelog, receitas).
  **Consulte antes** de escrever ou mudar qualquer código que fale com a Pluggy: endpoints, campos, paginação, widget, erros, conector MeuPluggy.
  Não confie em memória nem em snippet antigo; a Pluggy muda rápido. Exemplos que já quebraram: a URL do widget no snippet oficial dava 404, e `/transactions` v1 sai do ar em 31/12/2026.
  Este MCP **não** acessa os dados bancários do Paulo; só a documentação.
- **`context7`** (`https://mcp.context7.com/mcp`): documentação atualizada de bibliotecas e frameworks.
  **Consulte antes** de usar ou atualizar APIs de Fastify, `@fastify/static`, zod, `node:sqlite`, React, React Router, TanStack Query, Recharts, Vite e TypeScript, sobretudo ao subir de versão major ou quando houver dúvida de sintaxe.
  Fluxo: resolver o ID da biblioteca e depois buscar a documentação do tópico específico.

Se um dos dois estiver fora do ar, diga isso ao Paulo e siga com a documentação oficial na web. Não invente API.

## Sistema antigo (não mexer daqui)

- Python + `financeiro.db` + painel (caminho em `CLAUDE.local.md`). Continua em uso até o novo cobrir tudo.
- Tem as regras de categoria e o catálogo de assinaturas. Plano: importar **só regras e assinaturas** para cá, por um script opcional e explícito. O histórico de lançamentos fica lá.
- Este projeto nunca escreve na `financeiro.db`.

## Próximas fases

**Em andamento: melhorias do [`docs/backlog.md`](docs/backlog.md)** (lotes 1 a 5 feitos; o que vem agora está em "Ordem e fatias"; Metas ainda não tem spec), com specs em `docs/specs/`. Leia a spec do lote antes de implementar e atualize o status no mesmo commit. Nos `docs/`, só padrões (ver Regras de segurança).

1. ~~Conectar bancos e sincronizar; lançamentos editáveis; categorias e regras; resumo do mês~~ (feito em 2026-11-23)
2. ~~Orçamento mensal (planejado × realizado)~~ (feito em 2026-11-23)
3. Faturas e parcelas futuras (projeção)
4. ~~Assinaturas recorrentes~~ (feito em 2026-11-23, com patrimônio líquido e Resumo novo)
5. Lançamentos manuais (cartões sem Open Finance, dinheiro)
6. Importar regras e assinaturas do sistema antigo

O Paulo não gostou do front antigo por **navegação** e **pouca edição na tela**. Priorize editar direto na tabela/cartão e o menu lateral simples.

## Fluxo de trabalho

- Antes de commitar: `npm run typecheck`, `npm test` e `npm run build` sem erro.
- **Mudou o front? Valide no navegador com o MCP `chrome-devtools`** antes de commitar (os testes automáticos não cobrem a tela):
  1. `npm run app:parar` e `npm run dev` (se a 5173 já estiver ocupada, o dev já roda: só use-o; o Vite recarrega sozinho). No fim, `npm run app:iniciar`.
     **Vai mexer em `db.ts`?** O `npm run dev` é `tsx watch` sobre a base real: salvar uma migração a aplica na hora, e ela não pode mais ser editada. Trabalhe num worktree (sem `.env`), com uma cópia da base (`VACUUM INTO`) e `npm run build` + `PORT=3344 npm start`; antes do merge, backup em `data/`.
  2. `navigate_page` na rota alterada, `take_snapshot` e `take_screenshot` (tela cheia).
  3. `list_console_messages`: nenhum erro ou aviso novo.
  4. Estados difíceis de provocar (limite, erro, lista cheia): simule a resposta da API com `initScript` no `navigate_page` (sobrescrevendo `fetch`), sem tocar na base nem na Pluggy.
  5. Confira com `evaluate_script` o que importa (texto, botão desabilitado, links) e diga ao Paulo o que foi visto.
  Nunca dispare ações que gravam (Sincronizar, Conectar banco, salvar) contra a base real só para testar.
- Commits pequenos, mensagem em português.
- Decisões e andamento ficam no Obsidian do Paulo (nota e vault em `CLAUDE.local.md`). Registre lá o que for decidido.
