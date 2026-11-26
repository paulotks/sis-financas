# Lote 7: Contas do mês

Itens 79, 80 e 81 do [backlog](../backlog.md), fatias 12, 13 e 14, nesta ordem. Decidido com o Paulo em 2026-11-26 (entrevista).

**Por quê:** o Paulo organizava o mês numa planilha: uma lista com tudo que sai da conta (contas da casa, assinaturas, a fatura de cada cartão,
parcelas), cada uma com um valor e uma marca de "pago". Em cima, renda −
contas = o que sobra. O app já sabe quase tudo isso (recorrentes, faturas, renda esperada, metas), só que espalhado e pela data da compra.
Esta página é **outra forma de olhar o que já existe**: pelo dinheiro que sai, no mês em que sai.

**Regra de todas as fatias:** é só leitura, como os [avisos](avisos.md). **Nada aqui soma** em Resumo, Orçamento, alarme, Análises, metas ou
patrimônio, e nenhuma categoria muda. A única ação que mexe em total é Confirmar/Ignorar uma sugestão de recorrente, que é a mesma decisão da
página Recorrentes (já mexe no alarme hoje).

## Decisões (2026-11-26)

- **Página "Contas do mês"** no menu, logo depois de Orçamento, com abas **Mês** e **Ano**. A página Recorrentes continua como está. **Só PF**,
  sem conta oculta.
- **Uma linha = um compromisso que sai da conta**: boleto, Pix, débito, a fatura do cartão. O cartão é **uma linha só** (a fatura), não as compras.
  O que é pago no cartão (assinatura, parcela, gasolina) fica dentro da fatura e aparece ao abrir a linha. Teto de gasto (gasolina, mercado) é
  assunto do Orçamento: não vira linha. Gasto do dia a dia no débito também não.
- **Mês da linha** = o mês em que o dinheiro sai: o vencimento da fatura, a cobrança da recorrente.
- **Três fontes:** recorrentes (confirmadas + sugestões), faturas dos cartões conectados, contas cadastradas à mão (fatia 13).
- **Lista corrida** pelo dia (o que vence primeiro no topo), os pagos esmaecidos no fim. Sem grupos.
- **Valor esperado:** recorrente = o da última cobrança (o mesmo da página Recorrentes e do alarme: um número só). Fatura fechada = o total do
  banco. Fatura não fechada = estimativa (abaixo). Depois de paga, a linha mostra o valor e o dia reais.
- **Pago é automático**, pelo lançamento que o banco manda. "Marcar como pago" à mão só existe na conta à mão: recorrente e fatura passam sempre
  por conta conectada.
- **Atrasada** só quando os dados do banco já cobrem o dia: vencimento < `ultimoDiaComDado`. A mesma regra passa a valer na página Recorrentes.
- **Topo:** renda esperada (a régua do alarme) e quanto já entrou; total das contas, quanto já foi pago e quanto falta; o "por mês" das metas;
  **Livre depois das contas** = renda esperada − contas − metas (nulo sem renda esperada). O nome é outro de propósito, com a dica "pelo
  vencimento: não é o mesmo número do Resumo nem a sobra do Orçamento". Sem lista de rendas.
- **MCP:** lê as abas; cria e edita conta à mão e a marca como paga. **Não apaga** e **não** confirma nem ignora sugestão (o MCP nunca chama
  `PUT /api/recorrentes`; `propor_recorrente` continua).
- Nome interno **`compromissos`** (arquivo, tabela, rota): `contas` já é a tabela das contas bancárias e `/api/contas` a rota delas.

## Fatia 12 (item 79): aba Mês com o que já existe

Sem migração. Código em `api/src/compromissos.ts` (consultas e funções puras), rota em `server.ts`, tipos em `tipos.ts`, página
`web/src/pages/ContasDoMes.tsx`.

**Detector de recorrentes** (`recorrentes.ts`): devolve também, por recorrente, `conta_id`, `cartao` (a conta da última cobrança é `CREDIT`) e
as cobranças da série (`id`, `data`, `valor`, já com as de data futura). `situacao` passa a receber o último dia com dado: atrasada =
`proxima` < ele. **`chaveDe` e `nomeDe` não mudam** (exportar `nomeDe` para reuso não é mudar). O alarme não usa `situacao`: nenhum total muda.

**Linha de recorrente** (não cartão; confirmada ou sugestão, nunca ignorada). Uma função só monta o mês M, e a aba Ano (fatia 14) chama a mesma:
- **Paga** se a série tem cobrança com data em M **até hoje** (mais de uma: soma). Mostra o valor e o dia reais. Vale em qualquer mês e
  qualquer status de hoje (a cancelada em setembro aparece paga em agosto).
- **Mês que passou:** só o que cobrou. O que deixou de cobrar não aparece ali: se ainda deve, aparece no mês atual.
- **Mês atual e futuros**, sem cobrança paga em M:
  - cobrança com data futura em M (agendada): a pagar, com o dia e o valor dela;
  - senão, aparece se cobra de novo (`deveCobrar`) e `a_lancar` ≤ M (a atrasada do mês passado continua aparecendo, como no alarme). Dia
    esperado = o dia da última cobrança, limitado ao fim do mês;
  - **confirmada parada** (45 dias sem cobrar), só no mês atual: atrasada, com a dica "parou de cobrar? Se cancelou, marque Cancelei em
    Recorrentes". Conta confirmada sem pagamento nunca some calada. Nos meses futuros não se projeta, como no alarme. Sugestão parada não aparece.
- Sugestão leva o selo "sugestão" e os botões Confirmar / Ignorar, os mesmos de Recorrentes (`PUT /api/recorrentes`).

**Linha de fatura** (cartão PF conectado):
- A fatura que vence em M (`faturas.vencimento`). Valor = o total traduzido pelo adaptador (`totalDaFatura`, o mesmo do aviso 70).
  Conferir na cópia da base com o Cartão B da [validação](../validacao-dados.md) se é isso que o banco cobra.
- **Ciclo:** fecha em `billClosingDate` (ou vencimento − 10 dias, como nos avisos). Os ciclos futuros repetem o dia de `contas.vencimento`. Um
  lançamento ou uma parcela prevista cai no primeiro ciclo cujo fechamento é ≥ a data dele; com `fatura_id`, vale a fatura dele.
- **Pago** = soma dos lançamentos no cartão com a categoria Pagamento de fatura, positivos, até hoje, depois do fechamento dela e até o
  fechamento da seguinte. **Conferir primeiro** na cópia da base se todo cartão PF tem essa perna no lado do cartão (o que é pago por débito
  automático passa por `internos` no adaptador): sem ela, a fatura ficaria atrasada para sempre. Estados: **paga** (soma ≥ total − R$ 1), **parcial** ("paga R$ X de R$ Y", que vale também para quem pagou só o mínimo),
  **a pagar** / **atrasada** (vencimento < último dia com dado). Parcial vencida leva também o selo de atrasada.
- **Sem a fatura** (não fechou, total nulo, mês futuro): **estimada** = o maior entre a média dos totais das 3 últimas faturas do cartão e o
  **já comprometido** do ciclo (lançamentos dele + parcelas previstas + recorrentes do cartão que ainda cobram). Leva o selo "estimada".
- **Abrir a linha:** recorrentes do cartão, parcelas (n/N, lançadas e previstas), "outras compras" (o resto), link para os Lançamentos do cartão.

**Quem paga o quê:** a fatura usa só o lado do cartão do Pagamento de fatura. Recorrentes (e a conta à mão, fatia 13) nunca veem transferência.
As fontes não disputam lançamento.

**Rota:** `GET /api/compromissos?mes=AAAA-MM` (padrão: o atual), com as linhas e o topo. Dinheiro em centavos, como no resto da API.

**MCP:** `compromissos_do_mes` (lê), saída campo a campo e em reais. Os nomes das ferramentas também evitam "conta": a ferramenta `contas`
já é a das contas bancárias, e o Claude do Desktop escolhe pelo nome. Em `CONVENCOES`: a lente de caixa (pelo vencimento; a fatura já contém as compras
do cartão, então não somar com o Resumo), o que é estimado e o que é certo.

**Testes:** cada fonte e cada estado (recorrente paga, agendada com data futura (não conta como paga), prevista, atrasada, confirmada parada
no mês atual, sugestão; ignorada, sugestão parada e de cartão fora; cancelada só nos meses em que cobrou; mês passado só com o que cobrou; fatura paga,
parcial, a pagar, atrasada, estimada pela média e pelo comprometido); PJ e conta oculta fora; atrasada pelo último dia com dado. Lista de
ferramentas do MCP. Cópia da base: Resumo, Orçamento, alarme e Análises iguais entre `main` e a branch; em Recorrentes, só a `situacao` muda.

## Fatia 13 (item 80): conta cadastrada à mão

Para o que o detector não pega: conta cujo nome muda com a forma de pagamento (boleto × Pix), com menos de 3 cobranças, com valor que pula
demais, parcela de empréstimo (o detector tira parcela de propósito), cartão fora do Open Finance, e o que é pago fora de conta conectada.
Em worktree com cópia da base: tem migração.

**Dados (migração nova, no fim de `MIGRACOES`):**
- `compromissos`: `nome`, `valor_centavos` (o esperado), `dia` (1 a 31; 31 = o último do mês), `texto` (para achar o pagamento; opcional),
  `inicio` (`AAAA-MM`), `fim` (`AAAA-MM`, opcional; "em N parcelas" na tela grava `fim` = início + N − 1), `criado_em`.
- `compromissos_pagos` (`compromisso_id`, `mes`, `valor_centavos`): a marca "pago" feita à mão, para quando o pagamento não passa por conta
  conectada. `ON DELETE CASCADE`. Tabelas novas: nenhuma existente muda.

**Como acha o pagamento:**
- Candidatos: saída de conta **PF que não é cartão**, sem conta oculta, com os filtros de `NO_RESUMO` (sem transferência, ignorado ou
  `REMOVIDO`), com data no mês e até hoje. É o que impede contar de novo o que já está na fatura.
- Casa quando `nomeDe(chaveDe(descricao_original))` **contém** `texto`, normalizado do mesmo jeito (sem acento, número, símbolo e espaço).
  `texto` com pelo menos 3 letras depois de normalizado.
- Duas contas, ou dois candidatos, com o mesmo texto no mês (mesmo recebedor no mesmo dia): cada conta fica com o de **valor mais próximo** do
  esperado. Um lançamento paga uma conta só.
- **Vincular pagamento:** a linha abre os candidatos do mês; escolher um grava em `texto` o nome normalizado dele (dá para encurtar). **Não cria
  regra de categoria.** Nenhum vínculo por id é guardado: a busca é refeita a cada leitura, então a Pluggy apagar e recriar o lançamento não
  quebra nada.
- Marca à mão vale quando nada casou. Se depois casar, vale o lançamento.

**Prioridade sobre a recorrente:** a conta à mão escolhe primeiro. A recorrente cuja cobrança do mês foi pega por uma conta à mão some daquele
mês, e a que tem a última cobrança pega some de todos (na página Recorrentes nada muda).

**Na tela:** "+ Adicionar conta" na aba Mês; editar direto na linha (nome, valor, dia, texto, até quando); apagar; "Vincular pagamento";
"Marcar como pago" / desfazer. Aparece de `inicio` a `fim`.

**Rotas:** `POST /api/compromissos/manuais`, `PATCH` e `DELETE /api/compromissos/manuais/:id`, `PUT /api/compromissos/manuais/:id/pago`
(`mes`, `pago`). Tudo validado com zod.

**MCP:** `definir_compromisso` (cria ou edita) e `marcar_compromisso_pago` (marca ou desfaz). Sem apagar. `CONVENCOES`: o que é a conta à mão e que o
texto não é regra de categoria.

**Testes:** casamento (texto normalizado, boleto × Pix do mesmo recebedor, cartão fora, transferência, ignorado e removido fora, desempate pelo
valor, um lançamento numa conta só); vigência e parcelas; marca à mão (e o lançamento que vence ela); prioridade sobre a recorrente; apagar
leva as marcas. **Totais iguais com e sem contas à mão:** Resumo, Orçamento, ritmo, Análises e patrimônio. MCP: lista de ferramentas e o que ele
não pode (apagar).

## Fatia 14 (item 81): aba Ano

Grade só de leitura: as linhas (recorrente, fatura, conta à mão) × os 12 meses do ano, com seletor de ano.
- **A coluna de um mês é a aba Mês daquele mês, pela mesma função**: as duas abas nunca discordam. As regras de mês passado, atual e futuro
  são as da fatia 12 (e da 13, para a conta à mão).
- Na grade: o passado com o valor real, o futuro em cor mais clara. A recorrente que ainda cobra se repete pelo valor de hoje, de `a_lancar`
  em diante: a mesma conta do "já comprometido" de Análises. A conta à mão que passou sem pagamento nem marca aparece "não paga".
- **Rodapé por mês:** total; renda (a que entrou nos meses que passaram, a esperada no atual e nos futuros); metas; livre.
- **Rota:** `GET /api/compromissos/ano?ano=AAAA`. **MCP:** `compromissos_do_ano` (lê).
- **Testes:** cada coluna igual à aba Mês do mesmo mês; passado real, futuro previsto, vigência da conta à mão, recorrente cancelada no meio do
  ano, ano sem dado.

## Limites conhecidos

- O valor esperado da recorrente é o da última cobrança: na água e na luz, antes de pagar, ele pode ficar longe do que vem.
- A estimativa de fatura não sabe das compras que você ainda vai fazer: depois do fechamento, vale o total do banco.
- O pagamento de um cartão conectado lançado sem a categoria Pagamento de fatura conta como gasto e pode virar recorrente: é categoria errada,
  e se corrige na categoria.
- Conta paga no cartão não se cadastra à mão: ela já está na fatura.

## Depois (fora deste lote)

- Detector que junta nomes que mudam com a forma de pagamento.
- Criar a conta à mão a partir de um lançamento.
- Grupos ou rótulos nas linhas.
- Lista de rendas.
