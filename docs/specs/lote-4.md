# Lote 4: página Análises

Itens 27 a 32 do [backlog](../backlog.md). Decidido com o Paulo em 2026-11-24. Só começa com o [lote 3](lote-3.md) no `main`.

- **Biblioteca:** Recharts 3 (SVG, aceita React 19, usa as variáveis de cor do tema). Consultar o `context7` antes de usar.
- **Só PF**, com os mesmos totais do Resumo (`BASE_RESUMO`/`GASTO`). Meses futuros só aparecem no G. Antes do mês inicial, nada.
- **Mês inicial editável** nesta página: tabela `config (chave, valor)` (migração). Vazio = o cálculo automático do lote 3.
- Todo gráfico com versão em tabela, valor ao passar o mouse e legenda que não depende só da cor. Nada fixo nas categorias de ninguém.

| # | Gráfico | Detalhe |
|---|---|---|
| 27 | **A.** Renda × orçado × gasto por mês | Barras de renda e gasto, linha do orçado. Mês sem orçamento: linha pontilhada com o de hoje, identificada como "referência" |
| 28 | **B.** Gasto acumulado dia a dia | Mês escolhido contra o mês passado, com as linhas do orçado e da renda esperada: onde a curva fura |
| 29 | **C.** Guardado por mês e acumulado | Barras acima e abaixo de zero, e o acumulado em gráfico separado (nunca dois eixos). Sem meta por enquanto |
| 30 | **E.** Quem estourou | Categoria contra: média dos 3 meses (padrão), mês passado ou orçado. Ordem: maior estouro em reais. No topo, os 3 maiores em frase. A barra abre os lançamentos |
| 31 | **G.** Já comprometido | 12 meses à frente: parcelas em cor cheia (certas), recorrentes em cor clara (prováveis), contra a renda esperada. Link "revisar recorrentes" |
| 32 | Mês inicial editável + MCP | Séries novas também no MCP (o MCP acompanha o sistema) |

**Fora deste lote (backlog):** D (cada R$ 100 da renda), F (mapa de calor), J (patrimônio e dívida, quando houver histórico).
