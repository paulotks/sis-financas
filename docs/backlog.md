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

## Depois (na fila, ainda sem spec)

| # | Melhoria | Tam. | Base | O que já se sabe |
|---|---|---|---|---|
| 11 | Recorrentes: juntar nomes parecidos e tirar falsos positivos | M | não | Uma cobrança mudou de descrição e apareceu "atrasada". Falsos positivos: compras repetidas no mesmo lugar e Pix para pessoas. Mexe só em `recorrentes.ts` (função pura). Cuidado: a `chave` guarda a decisão do Paulo em `recorrencias`; mudar a forma da chave perde as decisões |
| 6 | Regra põe tag (custo de um evento, sem mudar a categoria) | M | migração | `lancamentos.tags` já existe; falta em `regras` e o que fazer ao apagar a regra |
| 10 | Cartão pela competência da fatura, não pela data da parcela | G | não | Dados existem: a maioria dos lançamentos de cartão já tem `fatura_id`. Muda os totais de **todos** os meses e o orçamento: conversar antes. Junto com a fase 3 (faturas e parcelas futuras) |
| 8 | Contatos: nome → categoria por direção | G | migração | Só se o 7 não bastar |
| 16 | Bens: nome cortado na tela | P | não | Lista em `.bens li` (`styles.css`): a coluna do nome divide espaço com 130px do valor. Não conferido na tela |
| 18 | Orçamento: sugerir pela média de 3 meses | P | não | Menos urgente: o orçamento já foi definido |
| 19 | Resumo: % categorizada do mês | P | não | O "gasto real" já existe: `saidas` exclui transferências. Falta só a % |

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
