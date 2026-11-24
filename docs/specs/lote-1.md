# Lote 1: correções rápidas (A INICIAR)

Itens 1, 3, 13, 14, 15, 17 e 20 do [backlog](../backlog.md). Nenhum muda a estrutura do banco. As linhas citadas são de 2026-11-24.

## Antes de começar

- Confirmar que o `main` já tem o commit "App de uso diário em http://meu-financeiro.localhost" e a pasta `docs/` (em 2026-11-24 estavam na
  branch `feat/endereco-local`). Worktree criado do `main` sem isso não vê estas specs.
- Sem migração, dá para trabalhar na pasta principal. `npm run build` ali só depois do merge no `main`.
- **Exceção, item 17:** `server.ts` chama `reaplicarRegras()` a cada início, e o `npm run dev` reinicia a cada salvamento. Editar o mapa
  com o dev ligado regrava categorias na base real, inclusive com o mapa pela metade. Fazer em worktree com cópia da base.
- Itens de tela (3, 13, 14, 15, 20): validar com o `chrome-devtools` (roteiro no `CLAUDE.md`), em 1280px e abaixo de 980px.

## 14. Painel Regras sem rolagem e com a categoria visível

- **Causa (lida no CSS):** `.tabela { min-width: 640px }` dentro de `.painel { overflow-x: auto }` (`styles.css:76-77`). O painel Regras é a
  coluna estreita de `.duas-colunas`, então a tabela rola e a coluna da categoria, que **já existe**, fica fora da vista.
- **Fazer:** mesmo conserto de `.patrimonio details .tabela { min-width: 0 }`, valendo para a tabela de regras; `overflow-wrap: anywhere` no
  texto da regra. No painel Categorias, deixar `.linha-form` quebrar linha e o campo encolher.
- **Aceite:** sem barra horizontal nos dois painéis; categoria de cada regra visível; tabelas das outras telas iguais.

## 3. Barra lateral "Última: nunca"

- **Causa (confirmada em 2026-11-24, com a resposta atrasada e com erro, nas 7 rotas):** a consulta de conexões fica em `App.tsx` e vale
  para todas as rotas; `quando(null)` devolve "nunca", então aparece enquanto carrega ou se a chamada falha. Reproduz atrasando
  `/api/conexoes` com `initScript`.
- **Fazer:** enquanto carrega ou em erro, mostrar "…"; "nunca" só quando a API respondeu e não há sincronização.
- **Aceite:** com a resposta atrasada, nenhuma rota mostra "nunca".

## 15. "Dados do banco de…"

- **O que já existe:** `conexoes.atualizado_pluggy` (o `lastUpdatedAt` do item) é gravado a cada sync e `GET /api/conexoes` já devolve (`c.*`).
  Falta só o campo no tipo `Conexao` (`web/src/lib/api.ts`) e a tela. Conferido no `pluggy-docs` (2026-11-24): `lastUpdatedAt` é a data da última
  sincronização do item com o banco. O item do Meu Pluggy só espelha o item original, que atualiza a cada 24 h, então a data é a dos dados.
  Sem data (nulo): mostrar "sem data", sem destaque.
- **Fazer:** coluna "Dados do banco de" em Conexões; na barra lateral, a data **mais antiga** entre as conexões, com o `title` listando
  banco e data de cada uma. Destacar quando passar de 48 h (o Meu Pluggy atualiza 1x por dia).
- **Fora:** botão para pedir atualização ao banco. O item do Meu Pluggy não aceita (ver `CLAUDE.md`).
- **Aceite:** um banco atrasado é visível sem abrir a tela Conexões.

## 20. Alerta de cartão acima de 80% do limite

- **Onde:** `CartaoConta` em `Contas.tsx:83`. O percentual já é calculado e as classes `.barra.perto` e `.barra.estourou` já existem.
- **Cuidado:** com `limite_disponivel_centavos` nulo, a conta atual dá 100% de uso. Sem esse dado, não mostrar percentual nem alerta.
- **Fazer:** a partir de 80%, barra em `perto` e o texto "X% do limite usado"; a partir de 100%, `estourou`. Não depender só da cor.
- **Aceite:** simular com `initScript` 79%, 80%, 100% e disponível nulo.

## 1. Erro do MCP diz o que tentou

- **Onde:** `chamar()` em `mcp.ts:78-94`. A porta 80 já está certa; falta a mensagem.
- **Fazer:** na falha de rede, incluir a URL base e `cause.code` (ou `cause.message`); na resposta HTTP com erro, incluir o status.
  Manter a frase "não está rodando", que o teste espera.
- **Cuidado no teste:** ele usa a porta 1, que o `fetch` bloqueia ("bad port") e não traz `code`. Por isso o `?? cause.message`.
- **Teste:** ampliar "MCP: só as ferramentas combinadas…" para exigir a URL na mensagem.
- **Depois:** reiniciar o Claude Desktop.

## 13. Categorias e regras na própria tela

Três partes, um commit cada.

**13a. Criar regra na tela.** Formulário no painel Regras: texto + `SelectCategoria` + prévia. Reusar `GET /api/regras/previa`, que já devolve
`total`, `pendentes` e `exemplos` (o tipo em `api.ts` só tem os dois primeiros). Seguir a lógica de prévia de `OferecerRegra.tsx`, sem a
exigência de o texto estar num lançamento específico. `POST /api/regras` **troca a categoria** se o texto já existe: avisar antes
("já existe, hoje vai para X").

**13b. Apagar categoria vazia.** `DELETE /api/categorias/:id`.
- Recusar (409) se houver lançamento, regra ou orçamento. Não confiar no banco: `regras` e `orcamentos` têm `ON DELETE CASCADE`, então
  apagar direto levaria as regras e o orçamento junto, em silêncio.
- Recusar também os nomes usados em `MAPA_PLUGGY` e `INTERNOS`: o código acha a categoria pelo **nome**, e sem ela o mapa passa a devolver
  "sem categoria". Vale o mesmo para renomear (`PATCH` já permite hoje; a tela não oferece).
- Chamar `limparCacheCategorias()`. Botão ✕ no chip com confirmação, só em categoria sem uso (devolver `usos` em `GET /api/categorias`).
- Caso real: as 4 categorias criadas por engano (ids 22 a 25) têm zero lançamentos, regras e orçamento. Quem apaga é o Paulo, pela tela.

**13c. Mesclar categoria.** `POST /api/categorias/:id/mesclar { destino }`, numa transação: move lançamentos (sem mexer em
`categoria_manual`) e regras, depois apaga a origem. Mesmas recusas de nome do 13b.
- Só entre categorias do mesmo tipo (gasto com gasto, renda com renda, transferência com transferência), senão muda os totais do mês.
- Orçamento: a chave é `(categoria_id, mes)`. Padrão proposto: fica o do destino, e a confirmação avisa que o da origem será perdido.
- Fazer por último. Se o 13b resolver o dia a dia, pode ir para "Depois".

**Não** criar ferramenta de apagar ou mesclar no MCP ("sem apagar" é regra, e o teste confere a lista).
**Testes:** apagar vazia funciona; em uso dá 409 e nada some; nome do mapa dá 409; mesclar preserva a edição manual e o total do mês.

## 17. Traduzir as categorias da Pluggy

- **Situação:** 296 pendentes PF. Cerca de 70 saem só com o mapa; 170 são Pix ou transferência (nada a traduzir) e 50 são "Services", genérico.
- **Fazer:** novos termos em `MAPA_PLUGGY` (`categorizar.ts`). Proposta, que o Paulo confirma antes de aplicar:

| Pluggy | Pendentes | Categoria proposta |
|---|---|---|
| Houseware | 14 | Compras |
| Bookstore | 14 | Compras (ou Educação) |
| Office supplies | 11 | Compras |
| Tax on financial operations | 9 | Impostos e taxas |
| Food and drinks | 8 | Alimentação fora (ou Mercado) |
| Accomodation (grafia da Pluggy) | 4 | Lazer |
| Automotive | 3 | Transporte |
| Kids and toys | 2 | Compras (ou Família) |
| Account fees | 2 | Impostos e taxas |
| Lottery, Gambling | 2 | Lazer |
| Cinema, theater and concerts | 1 | Lazer |

- **Não mapear** `Transfer - PIX`, `Transfers` nem `Transfer - Internal`. Os 26 pendentes de `Transfer - Internal` são todos a perna
  "Valor adicionado" do Pix no crédito (item 4): tirar uma perna só distorce o mês. `Services`, `Insurance` e `Entrepreneurial activities`
  ficam pendentes.
- **Colisões:** vale o primeiro termo *contido*. Conferir a lista completa de categorias no MCP `pluggy-docs` e pôr os casos no teste
  "categorias da Pluggy caem no lugar certo".
- **Rótulo:** o que continuar pendente aparece em inglês ("? Transfer - PIX"). Pequeno dicionário no front só para os que sobram.
- **Aceitar em lote: não fazer.** O mapa já aplica sozinho; depois dele não sobra sugestão para aceitar.
- **Efeito esperado:** reclassifica meses passados. O total de gasto do mês não muda, exceto por crédito em cartão que ganhar categoria e
  passar a abater. Comparar o Resumo antes e depois na cópia da base e mostrar ao Paulo; backup em `data/` antes do merge.

## Pronto quando

`npm run typecheck`, `npm test` e `npm run build` sem erro; telas vistas no navegador; `npm run app:reiniciar`; status trocado no
[backlog](../backlog.md); linha no Log da nota do projeto no Obsidian.
