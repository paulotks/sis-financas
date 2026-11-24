# Lote 2: números corretos (FEITO em 2026-11-24)

Itens 7, 5, 4 e 2 do [backlog](../backlog.md), **nesta ordem**. Conferido na base em 2026-11-24, só leitura.

7, 5 e 4 em worktree (sem `.env`), com cópia da base (`VACUUM INTO`) e backup em `data/` antes do merge: o 7 tem migração, e o 5 e o 4 regravam
categorias ou mudam totais de meses passados. Para esses três, comparar o Resumo de todos os meses antes e depois e mostrar ao Paulo.
O 2 só lê e edita pela tela.

## Decisões do Paulo (2026-11-24)

- **D1 (item 5):** rendimento de conta (o "Rendimentos" diário) **vira Renda**.
- **D2 (item 4):** no Pix no crédito, o gasto é a **cobrança no cartão**, com a tarifa junto.
- **D3 (item 2):** **não** corrigir estorno automaticamente; criar uma forma de **facilitar a correção à mão**.

## 7. Regra com direção e conta (M, migração)

- **Por que primeiro:** uma regra por texto pega entrada e saída. Hoje é raro uma regra pegar os dois sentidos, mas com o item 5 a entrada dela
  passaria a abater o gasto da categoria.
- **Banco:** `regras` ganha `sentido` (`saida`, `entrada` ou nulo = os dois) e `conta_id` (nulo = todas). O `UNIQUE (padrao)` atual impede a
  mesma regra com sentidos diferentes, e o SQLite não remove `UNIQUE` de tabela: **recriar a tabela** na migração, mantendo os ids
  (`lancamentos.regra_id` aponta para eles, sem chave estrangeira). Novo índice único por expressão:
  `(padrao COLLATE NOCASE, COALESCE(sentido,''), COALESCE(conta_id,''))`. Sem o `COALESCE`, o SQLite trata nulos como diferentes e deixaria
  criar duas regras iguais "para tudo". Pelo mesmo motivo, a busca em `POST /api/regras` usa `IS ?`, não `= ?`.
- **Código:** `sugerirCategoria` passa a receber valor e conta. Chamadores: `sync.ts` (`salvarTransacoes`), `reaplicarRegras` e os testes.
  `contarParecidos` e a prévia precisam do mesmo filtro, senão a prévia não bate com o aplicado (há teste para isso).
- **Desempate:** prioridade, depois o texto mais longo, depois a mais específica (com conta, com sentido). Trocado ao implementar: a tela sugere
  o sentido em toda regra nova, então com a específica na frente uma regra nova e curta passaria por cima de toda regra antiga mais longa.
- **API e MCP:** `POST /api/regras` procura a regra existente por texto + sentido + conta. `previa_regra` e `criar_regra` ganham os dois campos
  opcionais; `total_previsto` e `substituir` **não afrouxam**. Atualizar `CONVENCOES`.
- **Tela:** escolha "entrada / saída / os dois" no formulário do 13a e no `OferecerRegra` (sugerir o sentido do lançamento corrigido; o sentido
  oposto não é oferecido). Regra por conta só se cria pelo MCP; a lista de regras mostra sentido e conta.
- **MCP:** mesmo texto com alcance que se cruza (ex.: já existe a regra geral e vem uma só de saída) também exige `substituir`.
- **Ensaio na cópia (2026-11-24):** versão 4 → 5, regras idênticas, nenhum lançamento mudou, Resumo idêntico em todos os meses.
- **Testes:** repetir o mesmo texto sem sentido troca a regra em vez de duplicar; mesmo texto com sentidos diferentes convive; regra de saída não toca entrada; regra por conta não toca outra; regras antigas
  continuam iguais depois da migração; prévia = aplicado.

## 5. Reembolso em conta abate a categoria (P no código)

- **Hoje:** só crédito em **cartão** com categoria de gasto abate (`GASTO` em `server.ts:208`). Entrada em conta com categoria de gasto conta
  como Entrada.
- **Armadilha:** quase todas as entradas em conta PF com categoria de gasto são **Investimentos** (rendimentos diários e correção
  monetária). Poucas são reembolsos de verdade, e parte destes está no grupo financeiro (Cartões não conectados). Filtrar por grupo, portanto, erra para um dos lados.
- **Fazer (D1):** em `MAPA_PLUGGY`, `proceeds interests` → Renda. Depois, em `GASTO`, tirar a exigência `ct.tipo = 'CREDIT'`
  (a condição `cat.grupo <> 'renda'` continua, e sem categoria segue sem abater). O rendimento continua como Entrada, como hoje.
  O teste "categorias da Pluggy caem no lugar certo" espera Investimentos: mudar de propósito.
- **Efeito:** entradas e saídas caem no mesmo valor; o resultado do mês não muda. `GASTO` vale também para PJ.
- **Atualizar junto:** texto do rodapé do Resumo, `CONVENCOES` em `mcp.ts`, "Totais do mês" no `CLAUDE.md`, teste do orçamento e Resumo.
- **Ensaio na cópia (2026-11-24):** os rendimentos viraram Renda; entradas e saídas caíram no mesmo valor em cada mês afetado e nenhum resultado de
  mês mudou. Uma categoria pode ficar **negativa** no mês em que o reembolso cai (gasto num mês, reembolso no outro): é o esperado.

## 4. Pix no crédito do Nubank (M)

Três pernas: **(1)** "Valor adicionado…" entra na conta (+X), **(2)** o Pix sai da conta (−X), **(3)** a cobrança no cartão (−X mais tarifa).

- **Problema hoje:** (2) e (3) contam como gasto e (1) como entrada. Entradas e saídas ficam infladas; o resultado do mês está certo.
  O impacto é pequeno.
- **Achados na base:**
  - (1) e (2) casam **exatamente** (mesma conta, mesmo dia, mesmo valor) em todas as operações.
  - (3) só tem o texto "Pagamento de pix" nas operações mais antigas. Nas recentes, vem com o **nome da pessoa**.
  - **O horário identifica as três pernas em todas** (achado ao implementar; a versão anterior desta spec casava por dia). No `bruto`,
    `date` (ou `creditCardMetadata.purchaseDate`, quando existe) tem hora: (2) fica a menos de 1 s de (1), e o segundo candidato de mesmo
    valor só aparece mais de 22 min depois. (3) quase sempre vem segundos depois, às vezes minutos; o candidato errado mais próximo está a mais de 1 h.
    Casar por dia errava com duas operações de mesmo valor no dia e partiria uma operação na meia-noite UTC.
  - Tarifa de poucos por cento a mais de 10% (as maiores são parceladas).
  - Às vezes (3) traz o nome mas não tem categoria própria, e (2) tem: sem herdar, o gasto viraria "Sem categoria".
  - Pode acontecer de (2) **já** estar fora do resumo por uma regra do Paulo (transferência).
  - Como (3) traz o nome da pessoa, uma **regra por nome pega (2) e (3)** e o gasto dobra na categoria. O problema
    cresce a cada regra por pessoa.
- **Fazer (D2):** saem do resumo (1) e (2), o par exato, e fica (3). A tarifa e as parcelas entram naturalmente, no mês de cada uma.
  Quando (3) não tem categoria própria (regra ou mapa), herda a que (2) teria; as parcelas seguintes também (mesma `purchaseDate`).
  Descartado: ficar com (2) e tirar (3), porque a tarifa sumiria.
- **Regras:**
  - Só tirar o par se existe a (3), no cartão visível do mesmo banco e da mesma pessoa; senão o gasto some.
  - (2) ou (3) já em transferência: não mexer na operação. Assim este item **nunca muda o resultado de um mês**, só tira o inchaço.
  - (1) ou (2) editada à mão, ou qualquer uma ignorada: não mexer na operação. (3) editada à mão só fica como está, e o par sai mesmo assim:
    categorizar a cobrança é o uso normal, e com a regra anterior ("qualquer perna") cada correção traria o gasto em dobro de volta.
  - Vale **acima** das regras do Paulo para essas pernas (hoje regra vence movimento interno).
  - Precisa de várias linhas ao mesmo tempo: não cabe em `sugerirCategoria`. Fica **dentro** de `reaplicarRegras` (calcula as trocas antes de
    comparar com o gravado; um passo depois dele faria as pernas irem e voltarem e inflaria o "recategorizados"), e `sincronizar` passa a
    chamar `reaplicarRegras` no fim. O que (3) herda é a categoria que (2) *teria*, não a gravada: depois da 1ª vez a gravada é transferência.
- **Atualizar junto:** "fica de fora de propósito" no `CLAUDE.md`, em `CONVENCOES` e no comentário de `INTERNOS`.
- **Ensaio na cópia (2026-11-24):** todas as operações resolvidas, menos a que já estava em transferência (como acima); entradas e saídas caíram no
  mesmo valor, nenhum resultado mudou, cobranças sem categoria herdaram a do Pix, nenhuma edição manual mudou.
- **Testes:** os três formatos de (3), parcelada, sem (3), duas operações de mesmo valor no mesmo dia, perna manual, (2) já em transferência, rodar duas vezes.

## 2. Estorno: correção à mão com um clique (M, sem migração)

- **Hoje:** o estorno categorizado abate, mas na categoria que a Pluggy deu a ele, que pode não ser a da compra.
- **Por que não automático (D3):** só uma parte dos créditos em cartão fora de transferência tem exatamente uma compra de mesmo valor no mesmo
  cartão (120 dias antes). O resto é estorno parcial, vários candidatos, ou não é estorno (desconto de
  antecipação, juros projetados, crédito do emissor). Quem decide é o Paulo; o sistema só mostra os candidatos.
- **Achar:** filtro "Só estornos" em Lançamentos (na API, `estornos=1`): crédito em cartão, fora do grupo transferência, sem ignorado nem
  REMOVIDO. Combina com "Todos os meses".
- **Corrigir:** na linha do crédito, botão "De qual compra?", que abre até 5 candidatas (data, descrição, valor, categoria). Clicar usa a
  categoria da compra pelo `PATCH /api/lancamentos/:id` que já existe (vira edição manual, então regra nenhuma desfaz).
- **Candidatas:** `GET /api/lancamentos/:id/compras`: mesmo cartão, saída, até 120 dias antes, valor **maior ou igual** ao do crédito (cobre
  estorno parcial). Ordem: valor igual, depois palavras da descrição em comum, depois a mais recente. Compra sem categoria aparece, mas sem
  o botão de usar.
- **Cuidado:** hoje toda troca de categoria abre o `OferecerRegra`. Neste caminho **não** abrir: regra com o texto do estorno pegaria estornos
  de outras compras.
- **Testes:** só o mesmo cartão e dentro do prazo; valor igual vem primeiro; parcial aparece; lançamento que não é crédito em cartão dá 400.
- **Fazer depois do item 17**, que muda a categoria de várias compras. O MCP não ganha ferramenta nova.

## Pronto quando

O mesmo do [lote 1](lote-1.md), mais: migração ensaiada na cópia (versão e integridade conferidas), Resumo antes × depois mostrado ao Paulo e
backup da base real em `data/`.
