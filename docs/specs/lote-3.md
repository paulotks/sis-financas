# Lote 3: o alarme da renda

Itens 21 a 26 do [backlog](../backlog.md). Decidido com o Paulo em 2026-11-24 (entrevista). A página Análises é o [lote 4](lote-4.md).

**Por quê:** o Orçamento compara gasto com plano, e ninguém compara plano com renda. Um orçamento quase do tamanho da renda parece
"em dia" e não guarda nada, e uma renda extra esconde o estouro. O sistema precisa mostrar, sem o usuário procurar, que o mês vai estourar a renda.

Em worktree (sem `.env`), com cópia da base: tem migração e muda o total dos meses com lançamento em Investimentos.

## Decisões (2026-11-24)

- **Guardado = renda − gasto.** Não dá para medir pelo cofrinho: no extrato ele vem em par e soma zero.
- **Investimentos sai do resumo** (grupo `transferencia`): investir não é gasto, resgatar não é renda. Em troca, sai da tabela do Orçamento.
- **Renda esperada** é a régua, por categoria de renda, editada no Orçamento. Sem nada digitado: mediana da renda dos 3 últimos meses fechados.
  Digitado em uma categoria, vale a soma do que foi digitado.
- **Renda extra** = o que entrou acima da esperada. Não alivia o alarme do mês aberto; no mês fechado conta na sobra, com a nota "sem a renda extra seriam…".
- **Teto** = renda esperada (sem ela, o orçado). Meta de guardar **não** entra agora nem fixa no código: será uma tela própria (backlog, 33).
  Quando existir, teto = renda − meta.
- **Cores**, pela projeção: verde = dentro do orçado; amarelo = passou do orçado e cabe na renda; vermelho = passou da renda. Sem renda
  conhecida, o máximo é amarelo.
  Mês fechado: vermelho = gastou mais do que entrou.
- **Tom** direto, com comparações contra os próprios números ("custou mais de um mês de renda"). Sem sermão e sem nada da internet.
- **Só PF.** Resumo PJ continua com os 3 cards. Gasto pela data da compra, como hoje. Renda conta no mês em que caiu.
- **O MCP acompanha o sistema sempre**: tela ou dado novo entra no MCP no mesmo lote.

## Contas (`api/src/ritmo.ts`, funções puras)

- **Meses analisados:** a partir do primeiro mês com renda categorizada de pelo menos **metade** da mediana dos 3 últimos fechados. Antes disso a
  renda está incompleta (conta ainda não conectada) e o prejuízo seria falso. Editável no lote 4.
- **Projeção** (a partir do dia 5), média de dois métodos, mostrada como faixa:
  1. regra de três: gasto até hoje ÷ dias × dias do mês;
  2. gasto até hoje + mediana do que saiu **depois deste dia** nos 3 últimos meses fechados (sem histórico, só o 1).

  Nunca menor que o que já está lançado no mês (parcelas com data futura). Testado em três meses passados: cada método sozinho errou de 12% a
  26%, a média dos dois uns 10%. O 1 exagera quando caem as contas fixas; o 2 esconde mês fora do padrão. Dois métodos mais elaborados
  (separar fixo de variável) não foram melhores.
- **Ensaio na cópia (2026-11-24):** Resumo idêntico em todos os meses, PF e PJ, menos onde havia lançamento em Investimentos (só ele saiu da conta).
- **Pode gastar por dia** = (teto − já lançado no mês − recorrentes previstas até o fim do mês, menos as ignoradas) ÷ dias que faltam, contando hoje.
  Ao lado, o que a projeção supõe por dia até o fim. Comparar com a média do mês até hoje exagera: ela inclui as contas fixas já pagas.
- **Acumulado:** renda − gasto dos até 6 últimos meses fechados e analisados.
- **Acima do normal:** 3 categorias que mais passaram da própria mediana dos 3 meses anteriores, menos as que estão dentro do orçado.

## Itens

| # | O quê | Onde |
|---|---|---|
| 21 | Investimentos fora do resumo | migração: `UPDATE categorias SET grupo = 'transferencia' WHERE nome = 'Investimentos'` |
| 22 | Renda esperada no Orçamento | `GET /api/orcamento` devolve `renda` (planejado, sugerido, recebido); `linhas` nunca traz planejado de categoria de renda. Usa a tabela `orcamentos`, sem coluna nova |
| 23 | `GET /api/ritmo?mes=` | `ritmo.ts` + consultas com `BASE_RESUMO`/`GASTO`: o total tem que bater com o Resumo |
| 24 | Topo do Resumo (PF) e linha fixa no menu | `components/Alarme.tsx`, `components/RitmoLateral.tsx`. O menu mostra sempre o mês atual; o Resumo, o mês escolhido |
| 25 | Topo do Orçamento | renda esperada, planejado (% da renda), gasto, sobra planejada (vermelha se o plano não cabe na renda) |
| 26 | MCP em dia | nova `ritmo_do_mes`; `orcamento` com a renda; `definir_orcamento` aceita renda; `lancamentos` com tipo de conta e estornos; nova `compras_do_estorno`; `estado` com a data dos dados do banco; `CONVENCOES` |

## Testes

- Funções puras: mediana, projeção (antes do dia 5, sem histórico, piso do já lançado), nível, início da análise, renda esperada.
- `GET /api/ritmo`: gasto e entradas iguais aos do Resumo; mês aberto, fechado e futuro; recorrente ignorada não desconta; PJ e oculta fora.
- Orçamento: planejado de renda não entra no planejado de gasto; a soma continua igual ao Resumo.
- Migração: Investimentos muda de grupo e não entra em entradas nem saídas.
- MCP: lista de ferramentas e saída em reais.
