# Lote 7: Contas do mês

Itens 79, 80 e 81 do [backlog](../backlog.md), fatias 12, 13 e 14, nesta ordem. Decidido com o Paulo em 2026-11-26 (entrevista).

**Por quê:** o Paulo organizava o mês numa planilha: uma lista com tudo que sai da conta (contas da casa, assinaturas, a fatura de cada cartão,
parcelas), cada uma com um valor e uma marca de "pago". Em cima, renda −
contas = o que sobra. O app já sabe quase tudo isso (recorrentes, faturas, renda esperada, metas), só que espalhado e pela data da compra.
Esta página é **outra forma de olhar o que já existe**: pelo dinheiro que sai, no mês em que sai.

**Regra de todas as fatias:** é uma lente, como os [avisos](avisos.md). **Nada aqui soma** em Resumo, Orçamento, alarme, Análises, metas ou
patrimônio, e nenhuma categoria nem lançamento muda. A única ação que mexe em total é Confirmar/Ignorar uma sugestão de recorrente, que é a
mesma decisão da página Recorrentes (já mexe no alarme hoje). A conta à mão (fatia 13) grava só nas tabelas dela e só muda esta página.

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
  - senão, aparece se cobra de novo (`deveCobrar`) e `a_lancar` ≤ M (a atrasada do mês passado continua aparecendo, como no alarme, com a data
    dela). Dia esperado = o dia da última cobrança, limitado ao fim do mês;
  - **confirmada parada** (45 dias sem cobrar), só no mês atual: atrasada, com a dica "parou de cobrar? Se cancelou, marque Cancelei em
    Recorrentes". Conta confirmada sem pagamento nunca some calada. Nos meses futuros não se projeta, como no alarme. Sugestão parada não aparece.
- Sugestão leva o selo "sugestão" e os botões Confirmar / Ignorar, os mesmos de Recorrentes (`PUT /api/recorrentes`).
- **Série que trocou de meio de pagamento** (o detector junta cobranças de contas diferentes com o mesmo nome; achado da revisão): o passado vale
  cobrança a cobrança, e a feita no cartão fica na fatura; o que vem segue a conta da última cobrança. A mesma cobrança nunca aparece duas vezes.

**Linha de fatura** (cartão PF conectado):
- A fatura que vence em M (`faturas.vencimento`). Valor = **o total do banco**, que é o que ele cobra (decidido em 2026-11-26, depois da conferência
  abaixo). O total traduzido (`totalDaFatura`) fica só no aviso 70: no Cartão B da [validação](../validacao-dados.md) ele só bate com a cobrança quando a
  anterior foi paga; quando não foi, o banco cobra o total, com o que ficou da anterior e os juros, e o traduzido daria só a parte nova.
- **Ciclo:** fecha em `billClosingDate` (ou vencimento − 10 dias, como nos avisos). O mês sem fatura do banco (os futuros, e o que o banco não
  mandou) repete o dia de `contas.vencimento` e a distância entre vencimento e fechamento da última fatura que trouxe a data (`contas.fechamento` vem
  vazio, e a distância real varia de uns 5 a uns 11 dias por banco). Um lançamento ou uma parcela prevista cai no primeiro ciclo cujo fechamento é ≥ a
  data dele; com `fatura_id` de fatura conhecida, vale a fatura dele.
  - **O dia do fechamento** é do próprio ciclo, menos no banco com a peça `fechamentoAbreOSeguinte` do adaptador (Nubank e Cartão A): lá o que tem a
    data do fechamento é da fatura seguinte, e é nesse dia que eles datam as parcelas futuras (conferido nos lançamentos ligados a fatura).
  - **Fatura fechada** de um cartão que liga os lançamentos à fatura tem só os ligados: o total do banco bate com eles, e o lançamento sem ligação
    daquele período não é dela. Parcela prevista e recorrente do cartão que ainda vem só entram em fatura sem o total do banco.
- **Pago** = soma dos lançamentos no cartão com a categoria Pagamento de fatura, positivos, até hoje, depois do fechamento dela e até o
  fechamento da seguinte (pela data, não pelo `fatura_id`: há banco que liga o pagamento à fatura seguinte). **Conferido em 2026-11-26:** todo
  cartão PF tem essa perna no lado do cartão, também o pago por débito automático (vem pelos `internos`). Estados (`situacao`): **paga** (soma ≥
  total − R$ 1), **a_pagar** / **atrasada** (vencimento < último dia com dado) e **nao_paga**: não paga, ou paga em parte, com a fatura seguinte já
  fechada, porque o saldo foi para ela e está no total que o banco cobra lá ("não paga: foi para a fatura de <mês>"). Parcial = `pago` > 0 sem estar
  paga ("paga R$ X de R$ Y", que vale também para quem pagou só o mínimo); parcial vencida leva também o selo de atrasada.
  - Falta igual (com folga de 5 centavos) a um crédito do cartão na mesma janela não é falta: o banco descontou do pagamento um estorno que chegou
    depois do fechamento (o mesmo caso do aviso 70). Exige algum pagamento.
  - Paga mostra o total do banco, não a soma: há banco que manda duas pernas no cartão para um pagamento só. No topo, o pago a mais não vira crédito.
- **Sem o total do banco:** com pagamento na janela, **paga pelo valor pago** ("o banco não mandou a fatura"); sem pagamento, no mês atual e nos
  futuros, **estimada** = o maior entre a média dos totais das 3 últimas faturas do cartão e o **já comprometido** do ciclo (lançamentos dele +
  parcelas previstas + recorrentes do cartão que ainda cobram); leva o selo "estimada". **Mês que passou nunca tem estimativa**: sem pagamento, não
  aparece.
- Fatura que fechou antes do primeiro lançamento do cartão só aparece se o pagamento foi achado: sem lançamentos daquele período, não dá para saber.
- Achados da revisão (2026-11-26):
  - Fatura do banco a até 15 dias do vencimento esperado é a daquele ciclo: o vencimento empurrado para o começo do mês seguinte não cria uma
    fatura inventada no mês dele.
  - Os ciclos começam na primeira fatura ou no primeiro lançamento, o que vier antes: cartão sem nenhuma fatura do banco ainda mostra o mês
    passado que foi pago.
  - A média das 3 últimas só vale se a última fatura do banco é dos 2 meses anteriores ao atual: cartão parado não fica com fatura estimada
    para sempre. Estimada de valor zero não vira linha.
  - Saldo credor (total negativo) é "nada a pagar", com valor zero: não abate as outras contas.
  - Fatura do banco sem o total conta como aberta: recebe o que não tem ligação, as parcelas previstas e as recorrentes que ainda vêm.
- **Abrir a linha:** recorrentes do cartão (lançadas e a vir), parcelas (n/N, lançadas e previstas), "outras compras" (o resto, com os créditos
  abatidos), link para os Lançamentos do cartão no mês que tem a maior parte do ciclo.

**Quem paga o quê:** a fatura usa só o lado do cartão do Pagamento de fatura. Recorrentes (e a conta à mão, fatia 13) nunca veem transferência.
A fatura não disputa lançamento com as outras; entre a conta à mão e a recorrente, a conta à mão escolhe primeiro (fatia 13).

**Rota:** `GET /api/compromissos?mes=AAAA-MM` (padrão: o atual), com as linhas e o topo. Dinheiro em centavos, como no resto da API. Topo: a linha
paga conta inteira no pago; falta = o que não foi pago de cada linha (no mês que passou, a tela diz "não pago").

**MCP:** `compromissos_do_mes` (lê), saída campo a campo e em reais. Os nomes das ferramentas também evitam "conta": a ferramenta `contas`
já é a das contas bancárias, e o Claude do Desktop escolhe pelo nome. Em `CONVENCOES`: a lente de caixa (pelo vencimento; a fatura já contém as compras
do cartão, então não somar com o Resumo), o que é estimado e o que é certo.

**Testes:** cada fonte e cada estado (recorrente paga, agendada com data futura (não conta como paga), prevista, atrasada, confirmada parada
no mês atual, sugestão; ignorada, sugestão parada e de cartão fora; cancelada só nos meses em que cobrou; mês passado só com o que cobrou; fatura paga,
parcial, a pagar, atrasada, estimada pela média e pelo comprometido); PJ e conta oculta fora; atrasada pelo último dia com dado. Lista de
ferramentas do MCP. Descobertos ao implementar: foi para a seguinte (inteira e em parte), crédito descontado do pagamento, duas pernas de
pagamento, mês passado sem a fatura do banco (com e sem pagamento), fatura de antes do primeiro lançamento, dia do fechamento nos dois tipos de
banco, fatura fechada só com os ligados, e o que abre na linha. Da revisão: vencimento empurrado para o mês seguinte, cartão sem faturas,
cartão parado, saldo credor, total nulo, série que trocou de meio de pagamento e a lista de recorrentes pela API com o último dia com dado. Cópia da base: Resumo, Orçamento, alarme e Análises iguais entre `main` e a branch; em Recorrentes, só a `situacao` muda.

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
- Casa quando `nomeDe(chaveDe(descricao_original))` **contém** `texto`. O `texto` passa pela **mesma** `nomeDe(chaveDe())` ao ser gravado (sem
  acento, número, símbolo, espaço nem a forma de pagamento: "Pagamento de conta X S.A." digitado vira `x`) e precisa de pelo menos 3 letras
  depois disso. A tela mostra o texto como ficou gravado.
- Disputa (duas contas, ou dois candidatos): todos os pares conta × lançamento que casam, da menor diferença entre o valor e o esperado para a
  maior; cada conta fica com um lançamento e **um lançamento paga uma conta só**. Empate: a conta mais antiga, depois a data e o id do
  lançamento, para a mesma leitura dar sempre o mesmo dono.
- **Vincular pagamento:** a linha abre os candidatos do mês (`GET /api/compromissos/manuais/:id/candidatos?mes=`), do valor mais perto do
  esperado ao mais longe, com "já paga X" no que outra conta à mão levou; escolher um grava em `texto` o nome normalizado dele (dá para
  encurtar: quando o nome muda com a forma de pagamento, só o trecho comum pega as duas). **Não cria regra de categoria.** Nenhum vínculo por
  id é guardado: a busca é refeita a cada leitura, então a Pluggy apagar e recriar o lançamento não quebra nada.
- Marca à mão vale quando nada casou. Se depois casar, vale o lançamento. A marca guarda o esperado do dia em que foi feita.
- **Paga** pelo lançamento: o valor e o dia reais. Sem pagamento nem marca: atrasada quando os dados do banco já cobrem o dia (também nos meses
  que passaram, com "Marcar como pago" à mão), senão a pagar.

**Prioridade sobre a recorrente:** a conta à mão escolhe primeiro. A cobrança que uma conta à mão pegou sai da recorrente: naquele mês a
recorrente mostra só as cobranças que sobraram (pagas; com nenhuma, não aparece) e não se projeta. A que tem a última cobrança (até hoje)
pega não aparece mais a pagar em mês nenhum: nem a prevista, nem a já lançada com data futura, nem a parada. O mês que passou continua com a
cobrança que a conta à mão não pegou (por exemplo, de antes do início dela): é dinheiro que saiu. Na página Recorrentes nada muda.

**Na tela:** "+ Adicionar conta" na aba Mês; editar direto na linha (nome, valor, dia, texto, até quando); apagar; "Vincular pagamento";
"Marcar como pago" / desfazer. Aparece de `inicio` a `fim`.

**Rotas:** `POST /api/compromissos/manuais`, `PATCH` e `DELETE /api/compromissos/manuais/:id`, `PUT /api/compromissos/manuais/:id/pago`
(`mes`, `pago`; mês fora de início a fim é recusado) e `GET /api/compromissos/manuais/:id/candidatos?mes=`. Tudo validado com zod. Criar e
editar aceitam `parcelas` no lugar de `fim` (a API grava `fim` = início + N − 1: a tela e o MCP não fazem a conta); sem `inicio`, o mês atual
(a tela manda o mês que está nela).

**MCP:** `definir_compromisso` (cria ou edita) e `marcar_compromisso_pago` (marca ou desfaz). Sem apagar. `CONVENCOES`: o que é a conta à mão e que o
texto não é regra de categoria.

**Testes:** casamento (texto normalizado, boleto × Pix do mesmo recebedor, cartão fora, transferência, ignorado e removido fora, desempate pelo
valor, um lançamento numa conta só); vigência e parcelas; marca à mão (e o lançamento que vence ela); prioridade sobre a recorrente; apagar
leva as marcas. **Totais iguais com e sem contas à mão:** Resumo, Orçamento, ritmo, Análises e patrimônio. MCP: lista de ferramentas e o que ele
não pode (apagar). Descobertos ao implementar: empate sempre com o mesmo dono, lançamento com data futura não paga, dia 31 em mês curto,
atrasada pelo último dia com dado, a última cobrança pega também tira a agendada e a parada, e o mês anterior ao início fica com a
recorrente. Na cópia da base: sem conta à mão, todas as respostas iguais ao `main` (a aba Mês também); com elas, só a aba Mês muda.

**Conferido em 2026-11-26 (só leitura, na cópia):** no caso que motivou a fatia (duas contas do mesmo recebedor, cujo nome muda entre o
boleto e o Pix), um texto curto comum aos dois nomes pega só elas nas saídas de conta PF, e nada no lançamento diz de qual das duas é cada
pagamento. **Decidido com o Paulo:** as duas contas ficam com o mesmo texto; no mês com um pagamento só, ele vai para a de esperado mais
próximo, e qual delas aparece paga pode trocar de um mês para outro (o número de contas pagas no mês fica certo).

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
- **Como ficou (2026-11-26):**
  - Uma linha da grade = a mesma recorrente (pela decisão: `chave` + valor), a mesma fatura (pelo cartão) ou a mesma conta à mão, na ordem do
    dia do mês em que sai. A célula traz a linha da aba Mês inteira; o cartão com duas faturas no mesmo mês tem as duas na célula.
  - Pago em cor cheia; o que ainda vai sair, mais claro (≈ = fatura estimada). A célula diz o mesmo que a aba Mês: no mês que passou, só a
    atrasada sem nada pago vira "não paga"; a paga em parte mostra o valor com "paga X de Y" na dica, e a que os dados do banco ainda não cobrem
    continua "a pagar". A fatura que foi para a seguinte mostra o que foi pago dela (ou "não paga"). O cabeçalho de cada mês abre a aba Mês
    dele, onde ficam as ações.
  - **Rodapé:** contas = no mês que passou, o pago da aba Mês (o que saiu); do atual em diante, o total, menos o resto da fatura que foi para a
    seguinte (está no total dela). Renda = a que entrou no mês que passou; a esperada do atual em diante. **Livre = renda − contas − metas do
    próprio rodapé**: no mês que passou não é o livre da aba Mês (que usa a renda esperada e o total). Sem total do ano: somaria de novo a
    fatura que foi para a seguinte.
  - O ano lê as recorrentes e o histórico da renda uma vez e passa para a função do mês (o detector é o que pesa): o ano sai em ~0,3 s na cópia.

## Limites conhecidos

- O valor esperado da recorrente é o da última cobrança: na água e na luz, antes de pagar, ele pode ficar longe do que vem.
- A estimativa de fatura não sabe das compras que você ainda vai fazer: depois do fechamento, vale o total do banco. A média das 3 últimas usa o
  total do banco, então uma fatura que carregou a anterior puxa a estimativa para cima.
- Na fatura que foi para a seguinte, o mesmo dinheiro aparece no mês dela (não pago) e no total da seguinte. A aba Ano (fatia 14) precisa somar o
  passado pelo que foi pago, senão conta duas vezes.
- A perna do pagamento no cartão pode chegar dias depois do pagamento: até ela chegar, a fatura paga no vencimento aparece atrasada.
- Sem o total do banco, duas pernas de pagamento dobram o valor pago. Num mês com uma cobrança paga e outra agendada da mesma recorrente, vale
  só a paga. Os dois casos são raros e ficam como estão.
- O pagamento de um cartão conectado lançado sem a categoria Pagamento de fatura conta como gasto e pode virar recorrente: é categoria errada,
  e se corrige na categoria.
- Conta paga no cartão não se cadastra à mão: ela já está na fatura.
- Duas contas à mão com o mesmo texto e esperados parecidos: no mês com um pagamento só, qual delas aparece paga é decidido pelo valor (decidido
  com o Paulo, fatia 13).
- A conta à mão leva a última cobrança da recorrente só se já valia no mês dela. Cadastrada com início depois desse mês, a recorrente
  continua prevista nos meses seguintes, ao lado dela: comece a conta à mão no mês da última cobrança.
- "Vincular pagamento" grava o nome inteiro do lançamento: se o nome muda com a forma de pagamento, encurte o texto à mão.
- O pagamento de um cartão fora do Open Finance que veio com a categoria Pagamento de fatura é transferência e não é candidato: troque a
  categoria (Cartões não conectados) ou marque à mão.
- O texto casa por "contém", com 3 letras ou mais, sem limite de diferença de valor: texto curto pode pegar o pagamento de outro recebedor.
- Lançamento cujo nome é só a forma de pagamento (Pix com o recebedor só em números) vira `pixenviado` ao vincular, e esse texto casa com
  todos os Pix assim no mês; o valor mais próximo decide. A marca que fica escondida quando um lançamento casa volta a valer se ele deixar de
  casar.

## Depois (fora deste lote)

- Detector que junta nomes que mudam com a forma de pagamento.
- Criar a conta à mão a partir de um lançamento.
- Grupos ou rótulos nas linhas.
- Lista de rendas.
