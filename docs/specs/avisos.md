# Fatia 6: avisos de dado que falta

Itens 71, 67, 70 e 69 do [backlog](../backlog.md), nesta ordem. Origem: V1, V2 e V5 da [validação](../validacao-dados.md).

**Por quê:** os cálculos estão certos, mas o dado dos cartões chega faltando ou atrasado e ninguém é avisado.
**Regra de todos:** é aviso. **Nada aqui soma** em gasto, projeção, nível, orçamento ou patrimônio, e nenhuma categoria muda. O que falta não é inventado.
Código em `api/src/faltas.ts`. Sem migração: fechamento da fatura e data da compra saem de `bruto`.

## 71. Parcelas previstas

Há cartão que só manda a parcela quando ela cai; a última diz "n de N". `parcelasPrevistas` projeta as que faltam.

- **Mesma compra** = conta + N + dia da compra (`purchaseDate` em GMT-3, com 1 dia de folga) + valor (folga de N centavos: a 1ª parcela leva o resto da
  divisão). A hora não serve (há banco que manda a hora real só na 1ª parcela) nem a descrição (muda quando o lançamento é confirmado). Sem `purchaseDate`, não projeta.
- Duas compras iguais no mesmo dia viram uma só: prevê a menos, nunca a mais.
- Só se a compra **não tem parcela com data futura**: se tem, o banco manda as futuras.
- **Mês** da próxima = o seguinte ao da última vista, ou mês da compra + número da parcela, o que for maior (há banco em que a 2ª vem com a data da compra).
- Só meses **depois do atual**. A que deveria ter chegado até este mês não é prevista: se o limite a conta, aparece no 69.
- Compra sem parcela há mais de 3 meses: não projeta (o banco parou de mandar, ou foi antecipada ou cancelada).
- Em Análises e no Alarme de mês futuro, só conta se a última parcela vista conta no Resumo. Série à parte: "previstas", nunca junto das lançadas.

## 67. Total que carrega a fatura anterior (Cartão B)

Peça `totalDaFatura` no adaptador: tira do total o que veio da fatura anterior, que o banco manda como lançamentos da própria fatura (o total anterior e o
pagamento dele). Peça nova: **não vale para banco nulo**.

## 70. Fatura que não fecha e fatura que não veio

> diferença = total traduzido (67) − soma de (−valor) dos lançamentos da fatura, sem `REMOVIDO` e sem a categoria Pagamento de fatura

Ignorado entra: continua na fatura. Tolerância de R$ 1. Só por cartão, em Contas e no MCP.

Não é falta:
- fatura que ainda não venceu (os lançamentos podem estar chegando) ou vencida há mais de um ano;
- fatura que abriu antes do primeiro lançamento do cartão: as compras são de antes do que temos. Abertura = fechamento da anterior; a primeira nunca é conferida.
  Sem a data de fechamento, 10 dias antes do vencimento;
- diferença igual a um crédito do cartão: positiva, com o crédito dentro da fatura (o banco o usou no pagamento da anterior); negativa, com o crédito fora dela;
- total nulo.

Faturas seguidas com a mesma diferença viram um aviso só: costuma ser uma parcela que o banco não manda.

**Fatura que não veio:** pagamento recebido no cartão há mais de 10 dias, sem vencimento a até 16 dias dele (numa série mensal completa sempre há) e sem fatura com
aquele total. Nada antes da primeira fatura conhecida nem em cartão sem faturas. Só o lado do cartão: o da conta não diz de que cartão é.

As faltas das frentes 64 a 66 **não são exceções**: são o motivo do aviso. Exceção de verdade, só o total do 67.

## 69. Gasto que o limite já conta

> falta = limite usado − lançamentos sem fatura − fatura fechada e não paga − parcelas previstas (71)

- Lançamentos sem fatura: também os de uma fatura que ainda não veio, se são depois do último fechamento. Sem `REMOVIDO` e sem Pagamento de fatura.
- Fatura fechada e não paga = total da última (como o banco mandou) − pagamentos lançados depois do fechamento, no mínimo 0. Não usa `payments` da fatura:
  a documentação diz que são os da anterior e, nos dados, são os da própria, às vezes com estorno junto.
- Só com o saldo lido na última sincronização (`contas.atualizado_em` ≥ `inicio`); senão, nulo ("não dá para saber").
- Negativa ou até R$ 1 = 0. É **teto** ("até"): a compra parcelada pesa inteira no limite e só uma parcela no mês.
- Em Contas, por cartão; no Alarme, só mês aberto, PF, sem conta oculta; no MCP.

## Testes

Cada linha de "não é falta" e cada condição de 71 e 69, com dado sintético. Na cópia da base (fora do Git): Resumo, Orçamento, Alarme e Análises de todos os meses
iguais, fora os campos novos; e cada aviso conferido contra a lista de faltas reais e falsos positivos da validação.
