# Lote 4: página Análises (FEITO em 2026-11-24)

Itens 27 a 32 do [backlog](../backlog.md). Decidido com o Paulo em 2026-11-24. Só começa com o [lote 3](lote-3.md) no `main`.

- **Biblioteca:** Recharts 3 (SVG, aceita React 19, usa as variáveis de cor do tema). Consultar o `context7` antes de usar.
- **Só PF**, com os mesmos totais do Resumo (`BASE_RESUMO`/`GASTO`). Meses futuros só aparecem no G. Antes do mês inicial, nada.
- **Mês inicial editável** nesta página: tabela `config (chave, valor)` (migração). Vazio = o cálculo automático do lote 3. Vale também para o
  alarme. Não pode ser no futuro.
- **Onde:** `GET /api/analises?mes=` e `PUT /api/analises/inicio` (`server.ts`); `pages/Analises.tsx` e `components/Grafico.tsx` (moldura, legenda,
  tabela, dica, cores). A página carrega sob demanda: a biblioteca não pesa nas outras telas. MCP: `analises` e `definir_inicio_da_analise`.
- **Cores por assunto**, iguais em todos: renda azul, gasto laranja (validados para daltonismo e contraste no painel escuro), orçado na cor do texto.
- Todo gráfico com versão em tabela, valor ao passar o mouse e legenda que não depende só da cor. Nada fixo nas categorias de ninguém.

| # | Gráfico | Detalhe |
|---|---|---|
| 27 | **A.** Entrou × orçado × gasto por mês | Barras do que entrou (item 76: renda e entradas sem categoria) e do gasto, linha do orçado. Mês sem orçamento: linha pontilhada com o de hoje, identificada como "referência" |
| 28 | **B.** Gasto acumulado dia a dia | Mês escolhido contra o mês passado, com as linhas do orçado e da renda esperada: onde a curva fura |
| 29 | **C.** Guardado por mês e acumulado | Barras acima e abaixo de zero, e o acumulado em gráfico separado (nunca dois eixos). Sem meta por enquanto |
| 30 | **E.** Quem estourou | Categoria contra: média dos 3 meses (padrão), mês passado ou orçado. Ordem: maior estouro em reais. No topo, os 3 maiores em frase. A barra abre os lançamentos |
| 31 | **G.** Já comprometido | 12 meses à frente: parcelas em cor cheia (certas), recorrentes em cor clara (prováveis), contra a renda esperada. Link "revisar recorrentes" |
| 32 | Mês inicial editável + MCP | Séries novas também no MCP (o MCP acompanha o sistema) |

**Decidido ao implementar**

- O mês em andamento aparece apagado no A e fica **fora** do C: a sobra dele engana (a renda entra no começo, o gasto vem depois).
- O "normal" do E é a **mediana** dos 3 meses, a mesma do alarme, e não a média: um mês fora do padrão não muda a régua. Zero ou negativa = sem normal.
- Categoria dentro do próprio orçado aparece na lista do E, mas não entra na frase dos culpados (mesma regra do alarme).
- Recorrente no G é o valor da última cobrança, repetido nos 12 meses: é provável, não certo.

**Fora deste lote (backlog):** D (cada R$ 100 da renda), F (mapa de calor), J (patrimônio e dívida, quando houver histórico).
