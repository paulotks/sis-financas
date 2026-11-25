# Backlog de melhorias

Origem: revisão de 2026-11-24, conferida no código e na base no mesmo dia.
**Este arquivo é o guia do que fazer e em que ordem.**

Regra destes docs: o repositório é público, então **sem nomes de pessoas, saldos, valores, contagens ou datas de lançamentos**. Só padrões.

Tamanho: **P** pequeno, **M** médio, **G** grande. **Base** = muda o banco de dados (migração) ou regrava categorias da base real:
fazer em worktree com cópia da base (ver "Fluxo de trabalho" no `CLAUDE.md`).

## Lote 1: FEITO (2026-11-24)

Spec: [specs/lote-1.md](specs/lote-1.md). Rápido e sem migração. Ordem sugerida: 14, 3, 15, 20, 1, 13, 17.

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 1 | Erro do MCP mostra a URL tentada e o código | P | não | feito (2026-11-24) |
| 3 | Barra lateral mostra "Última: nunca" | P | não | feito (2026-11-24) |
| 13 | Categorias e regras: criar regra na tela, apagar e mesclar categoria | M | não | feito (2026-11-24) |
| 14 | Painel Regras: categoria visível, sem rolagem horizontal | P | não | feito (2026-11-24) |
| 15 | Mostrar "dados do banco de…" | P | não | feito (2026-11-24) |
| 17 | Traduzir as categorias da Pluggy | P | regrava categorias | feito (2026-11-24) |
| 20 | Alerta de cartão acima de 80% do limite | P | não | feito (2026-11-24) |

## Lote 2: FEITO (2026-11-24, números corretos)

Spec: [specs/lote-2.md](specs/lote-2.md). A ordem importa: 7 → 5 → 4 → 2. As decisões D1 a D3 foram tomadas em 2026-11-24 (no topo da spec).

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 7 | Regra só de entrada ou só de saída, e por conta | M | migração | feito (2026-11-24) |
| 5 | Reembolso em conta abate a categoria; rendimento vira Renda | P | regrava categorias | feito (2026-11-24) |
| 4 | Pix no crédito do Nubank contado em dobro: vale a cobrança no cartão | M | regrava categorias | feito (2026-11-24) |
| 2 | Estorno: correção à mão com um clique | M | não | feito (2026-11-24) |

## Lote 3: FEITO (2026-11-24, o alarme da renda)

Spec: [specs/lote-3.md](specs/lote-3.md). Tem migração: worktree com cópia da base.

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 21 | Investimentos fora do resumo (não é gasto) | P | migração | feito (2026-11-24) |
| 22 | Renda esperada no Orçamento | M | não | feito (2026-11-24) |
| 23 | Ritmo do mês: projeção, teto, por dia, acumulado | M | não | feito (2026-11-24) |
| 24 | Alarme no topo do Resumo e linha fixa no menu | M | não | feito (2026-11-24) |
| 25 | Topo do Orçamento contra a renda | P | não | feito (2026-11-24) |
| 26 | MCP em dia com o sistema | M | não | feito (2026-11-24) |

## Lote 4: FEITO (2026-11-24, página Análises)

Spec: [specs/lote-4.md](specs/lote-4.md).

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 27 | A. Renda × orçado × gasto por mês | M | não | feito (2026-11-24) |
| 28 | B. Gasto acumulado dia a dia | M | não | feito (2026-11-24) |
| 29 | C. Guardado por mês e acumulado | P | não | feito (2026-11-24) |
| 30 | E. Quem estourou: categoria contra média, mês passado ou orçado | M | não | feito (2026-11-24) |
| 31 | G. Próximos meses já comprometidos | M | não | feito (2026-11-24) |
| 32 | Mês inicial da análise editável, e MCP | P | migração | feito (2026-11-24) |

## Lote 5: FEITO (2026-11-24, recorrentes certas)

Spec: [specs/lote-5.md](specs/lote-5.md). É o item 11, ampliado. Tem migração.

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 36 | Detecção: troca de nome, forma de pagamento, várias cobranças no mesmo lugar, mês pulado, falso positivo | M | não | feito (2026-11-24) |
| 37 | Decisão por cobrança, estado cancelada e proposta | M | migração | feito (2026-11-24) |
| 38 | Aviso de cobrança depois de cancelada | P | não | feito (2026-11-24) |
| 39 | Tela: uma linha por cobrança, Cancelei/Reativar, propostas do Claude | P | não | feito (2026-11-24) |
| 40 | MCP só propõe decisão de recorrente | P | não | feito (2026-11-24) |

## Depois (na fila, ainda sem spec)

| # | Melhoria | Tam. | Base | O que já se sabe |
|---|---|---|---|---|
| 6 | Regra põe tag (custo de um evento, sem mudar a categoria) | M | migração | `lancamentos.tags` já existe; falta em `regras` e o que fazer ao apagar a regra |
| 10 | Cartão pela competência da fatura, não pela data da parcela | G | não | Dados existem: a maioria dos lançamentos de cartão já tem `fatura_id`. Muda os totais de **todos** os meses e o orçamento: conversar antes. Junto com a fase 3 (faturas e parcelas futuras) |
| 8 | Contatos: nome → categoria por direção | G | migração | Só se o 7 não bastar |
| 16 | Bens: nome cortado na tela | P | não | Lista em `.bens li` (`styles.css`): a coluna do nome divide espaço com 130px do valor. Não conferido na tela |
| 18 | Orçamento: sugerir pela média de 3 meses | P | não | Menos urgente: o orçamento já foi definido |
| 19 | Resumo: % categorizada do mês | P | não | O "gasto real" já existe: `saidas` exclui transferências. Falta só a % |
| 33 | (**lote 6**, combinado em 2026-11-24) Metas: tela própria (guardar, reserva, quitar dívida), nada fixo no código. O teto do alarme passa a ser renda − meta | G | migração | Pedido na entrevista de 2026-11-24, para o futuro. Aportes em Investimentos e as linhas de `bens` são candidatos a medir o progresso |
| 34 | Análises D, F e J: cada R$ 100 da renda, mapa de calor categoria × mês, patrimônio e dívida no tempo | M | não | O J precisa de mais dias em `saldos_diarios` |
| 35 | Notificação do Windows quando o mês virar vermelho | P | não | Só se o alarme na tela não bastar |

## Fechados ou só acompanhar

| # | Item | Situação |
|---|---|---|
| 9 | Cartões não conectados | Resolvido: categoria própria criada em 2026-11-24. Lançar a fatura à mão fica na fase 5 do `CLAUDE.md` |
| 12 | Dedupe quando PENDING vira POSTED | Só acompanhar |

Fora desta revisão: atualizar `zod` 4 e `@fastify/static` 10; conferir se lançamento depois das 21h cai no dia seguinte.

## Como usar

- Um item por commit. Ao terminar, troque o status aqui por `feito (AAAA-MM-DD)` **no mesmo commit**.
- O que a implementação descobrir de diferente corrige a spec, não fica só no chat.
- Um lote só começa com o anterior no `main`.
