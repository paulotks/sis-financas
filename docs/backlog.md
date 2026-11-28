# Backlog de melhorias

Origem: revisão de 2026-11-24, conferida no código e na base no mesmo dia.
**Este arquivo é o guia do que fazer e em que ordem.**

Regra destes docs: o repositório é público, então **sem nomes de pessoas, saldos, valores, contagens ou datas de lançamentos**. Só padrões.

Tamanho: **P** pequeno, **M** médio, **G** grande. **Base** = muda o banco de dados (migração) ou regrava categorias da base real:
fazer em worktree com cópia da base (ver "Fluxo de trabalho" no `CLAUDE.md`).

## Ordem e fatias: o que vem agora

Cada **fatia** é uma branch com itens que mexem nos mesmos arquivos ou dependem um do outro: feitos, testados e validados juntos, um commit por item, na ordem escrita.
Uma fatia só começa com as de que depende já no `main`. O detalhe de cada item está nas seções abaixo.

| Fatia | Itens, na ordem | Por que juntos | Base | Depende de |
|---|---|---|---|---|
| **1. Base segura** (feita em 2026-11-25) | 41 → 42 → 51 → 44 | Tudo em `db.ts` e no início do `server.ts`. O 44 é uma migração simples: estreia a cópia automática do 42 | migração: worktree | nada |
| **2. Rápidas** (feita em 2026-11-25) | 43, 53, 72 | Linhas isoladas; cabem entre quaisquer outras | não | nada |
| **3. Sincronização confiável** (feita em 2026-11-25) | 52 → 48 → 45 | `sync.ts` e `pluggy.ts`. O 52 é pré-requisito do 69 | não | 1 |
| **4. Cofrinhos e patrimônio** (feita em 2026-11-25) | 50 → 62 → 77, com a conferência do extrato da caixinha (64) | Mesma tela. Zerar a linha manual (62) usa o que o 50 decidir | migração: worktree | 3 |
| **5. Camada de adaptadores** (feita em 2026-11-25) | 63 passo 1 → 63 passo 2, com 68 | Uma estrutura só. O passo 1 não pode mudar nenhum número | migração: worktree | 1 e 3 |
| **6. Avisos de dado que falta** (feita em 2026-11-25) | 71 → 67 → 70 → 69 | Spec: [specs/avisos.md](specs/avisos.md). Mesmas consultas e mesma tela. O 69 desconta as parcelas que o 71 projeta; o 70 usa o total traduzido pelo 67 e as exceções de 64 a 66 | não | 3 e 5 |
| **7. Regras e busca** (feita em 2026-11-25) | 46 → 47 → 74 → 54 | Rotas de regras e `categorizar.ts`. O 74 separa cálculo de gravação, e o 54 chama a mesma função | não | 5 (mesmo arquivo) |
| **8. Frentes que esperam a fatura** | 65 (V3, com o 12) e 66 (V4), uma branch por banco | As duas regravam dado e precisam da próxima virada de fatura | regrava: worktree com cópia | 5, e a virada |
| **9. Totais, Alarme e Análises** (feita em 2026-11-25) | 55 → 73 → 76 → 57 → 49 | O 55 tira os totais do `server.ts`; os outros mexem nesses mesmos trechos | não | 6 |
| **10. Metas (lote 6)** (feita em 2026-11-25) | 33 | Spec: [specs/lote-6.md](specs/lote-6.md). Revê o texto do 72 | migração | 1 e 9 |
| **11. Formato único e horários** (feita em 2026-11-25) | 56 → 58 | Tocam API, tela e MCP inteiros: por último, para não conflitar | migração (58): worktree | 10 |
| **12. Contas do mês: aba Mês** (feita em 2026-11-26) | 79 | Spec: [specs/lote-7.md](specs/lote-7.md). Junta recorrentes, faturas, renda esperada e metas numa página nova. Muda só a `situacao` das recorrentes (atrasada pelo último dia com dado) | não | 11 |
| **13. Contas do mês: conta à mão** (feita em 2026-11-26) | 80 | Entra na mesma regra de quem paga qual linha, que nasce no 79 | migração: worktree | 12 |
| **14. Contas do mês: aba Ano** (feita em 2026-11-26) | 81 | Reaproveita o cálculo das fatias 12 e 13 | não | 13 |
| **15. Tipo de loja** (feita em 2026-11-27) | 82 | Um item só: migração, sync, Lançamentos e MCP | migração: worktree | 14 |

- **Por que esta ordem:** primeiro não perder dado (1), depois ler certo (3 a 5), depois avisar o que falta (6). Refinar conta (9) só vale com o dado completo.
- **Esperam um fato:** V3 e V4 (virada da fatura).
- **Em toda fatia:** typecheck, testes e build; tela nova também no navegador e no MCP (4 e 6). Se puder mudar totais (5, 6, 8 e 9), repetir as consultas da [validação](validacao-dados.md) numa cópia da base.
- **Fora das fatias:** 75 (feito), 59 a 61 (só acompanhar) e a seção "Depois".

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

## Lote 6: FEITO (2026-11-25, Metas)

Spec: [specs/lote-6.md](specs/lote-6.md). Tem migração.

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 33 | Metas: tela própria (guardar, juntar, quitar dívida), nada fixo no código. Teto do alarme = renda − o que as metas pedem | G | migração | feito (2026-11-25) |

## Lote 7: Contas do mês (em andamento)

Spec: [specs/lote-7.md](specs/lote-7.md). Página nova, só leitura: o mês pelo dinheiro que sai (pelo vencimento), não pela compra. Nada soma em total.

| # | Melhoria | Tam. | Base | Status |
|---|---|---|---|---|
| 79 | Aba Mês: recorrentes + faturas, pago automático, fatura parcial e estimada, atrasada pelo último dia com dado (também em Recorrentes), topo com renda e metas, MCP lê. Como ficou: a fatura vale pelo total do banco (decidido com o Paulo: o traduzido não bate quando a anterior não foi paga), e a não paga com a seguinte fechada "foi para a fatura seguinte"; peça nova `fechamentoAbreOSeguinte` no adaptador. Na cópia, Resumo, Orçamento, alarme, Análises e metas iguais ao `main` em todos os meses | M | não | feito (2026-11-26) |
| 80 | Conta cadastrada à mão: texto para achar o pagamento, vincular, marcar como paga, prioridade sobre a recorrente, MCP cria e edita. Como ficou: o texto passa pela mesma normalização do nome do lançamento; disputa pelo valor mais próximo, um lançamento por conta, empate sempre com o mesmo dono (decidido com o Paulo: duas contas com o mesmo texto podem trocar qual aparece paga no mês de um pagamento só); a recorrente que perdeu a última cobrança não se projeta mais, e o passado dela fica. Migração 14 (tabelas `compromissos` e `compromissos_pagos`). Na cópia, sem conta à mão, todas as respostas iguais ao `main`; com elas, só a aba Mês muda | M | migração | feito (2026-11-26) |
| 81 | Aba Ano: grade linhas × 12 meses, passado real e futuro previsto, MCP lê. Como ficou: cada coluna é a aba Mês daquele mês, pela mesma função (as recorrentes e o histórico são lidos uma vez para o ano). Rodapé: o mês que passou pelo que saiu e pela renda que entrou, do atual em diante pelo esperado; a fatura que foi para a seguinte só pelo que foi pago dela. Na cópia, a aba Mês e as outras respostas iguais ao `main` e as 12 colunas iguais à aba Mês | M | não | feito (2026-11-26) |

## Item 82: tipo de loja (MCC): FEITO (2026-11-27)

O cartão manda em `creditCardMetadata` o MCC (`payeeMCC`, ramo da loja pela ISO 18245), o final do cartão (`cardNumber`) e a data e hora
da compra (`transactionDateTime`; na parcela, a da compra original, igual a `purchaseDate`). Conta nunca tem. O MCC traduzido ajuda a
lembrar o que foi uma compra de nome genérico (marketplace, intermediador de pagamento) e a acertar a categoria.

- `lancamentos.mcc` (migração 16, preenchida do `bruto`; o sync grava). Nome em português em `api/src/mcc.ts` (tabela fixa; fora dela, só o número).
- Final do cartão e hora da compra são lidos do `bruto` na consulta, sem coluna. A hora sai em Brasília (UTC−3); meia-noite em UTC ou em
  Brasília = o banco não mandou a hora, e sai só a data.
- Lançamentos: na linha de baixo da descrição (tipo de loja, final do cartão, hora; a data só quando difere, como na parcela). MCP:
  `mcc`, `tipo_de_loja`, `cartao_final` e `compra_em` em todo lançamento; `tipos_de_loja` em `pendentes_agrupados`.
- Não entra em categoria nem em total (conferido: as respostas da API iguais antes e depois, todos os meses, PF e PJ).

## Antes do lote 6: base segura (revisão de arquitetura e banco)

Origem: revisão de 2026-11-24, só no código e em base temporária com dados sintéticos (nada da base real). Sem spec: o que se sabe está na tabela.
As linhas citadas são do commit `b992749`. **[testado]** = reproduzido. **41 e 42 antes de qualquer migração**; a ordem completa está em "Ordem e fatias".

| # | Melhoria | Tam. | Base | O que já se sabe | Status |
|---|---|---|---|---|---|
| 41 | Migração que recria tabela não pode apagar em cascata | P | não, mas mexe em `db.ts`: worktree | `migrar()` (`db.ts:219-232`) roda com `foreign_keys` ligado: recriar `contas` com `DROP TABLE` apaga lançamentos e faturas, sem erro [testado]. Em `categorias` com uso, a migração falha e o app não sobe [testado]. Nada foi perdido até hoje. Correção: desligar `foreign_keys` **antes** do `BEGIN`, rodar `foreign_key_check` e religar (dentro da migração não adianta [testado]). Com teste | feito (2026-11-25) |
| 42 | Cópia automática da base | M | não, mas mexe em `db.ts`: worktree | Hoje só manual (`README.md:94`), e `migrar()` roda a cada início (`server.ts:14`). `VACUUM INTO` antes de migração pendente e cópia periódica. Copiar só o `.db` sem o `-wal` perde o mais recente. A Pluggy não devolve edições, regras, orçamento, decisões, bens, `saldos_diarios` nem o que passou de 365 dias. O `.env` precisa de cópia à parte: a Pluggy mostra o segredo uma vez só. Decidido em 2026-11-25: pasta em `COPIAS_DIR` (`.env`), padrão `copias/` ao lado da base; 14 diárias e 14 de antes de migração, contadas à parte. Sem a cópia, não migra; a diária que falha só vai para o log. Restaurar e guardar o `.env`: `README.md` | feito (2026-11-25) |
| 43 | Alarme lento com histórico grande | P | não | `recorrentes.ts:107` roda em toda tela (menu). Uma linha: checar `entre(dias(u.data, c.data), MES)` antes do `some`. Mesma saída; com dado sintético de 3 anos, de 19 s para 1,4 s [testado] | feito (2026-11-25) |
| 44 | Índices em `lancamentos(categoria_id)` e `lancamentos(regra_id)` | P | migração | `/api/categorias` e `/api/regras` contam usos linha a linha (`server.ts:552-554`, `619`). Com dado sintético, `/api/regras` vai de 2,8 s para 1 ms [testado]. Só `CREATE INDEX`, sem recriar tabela. Antes da fase 6 (importar regras) | feito (2026-11-25) |
| 45 | Sincronização respeita o status do banco | M | não | `sync.ts:175-193` ignora `OUTDATED` e `PARTIAL_SUCCESS`: com lista parcial em `OUTDATED`, apaga lançamento sem erro (volta quando a lista vier completa) [testado]. 0 contas com contas na base deve gravar `erro` (`sync.ts:233`). `Conexoes.tsx:9-11` não avisa `PARTIAL_SUCCESS`. **Antes:** conferir no PC que status o MeuPluggy manda, senão a limpeza de sumidos pode nunca mais rodar. Em 2026-11-25 todas as conexões vieram com status preenchido e de sucesso, e sem `statusDetail`. Feito pela documentação: só apaga com `UPDATED` + `SUCCESS`, ou sucesso parcial em que `statusDetail` diz que os lançamentos (e o cartão, se for) vieram; nos outros casos só acrescenta. O substituto que chega com a limpeza parada ainda herda a edição depois. Nenhum caso de falha visto: quando aparecer, conferir se o MeuPluggy manda o `statusDetail` (sem ele, a limpeza fica parada enquanto durar o parcial) | feito (2026-11-25) |
| 46 | Regra repetida com acento corrige a existente | P | não | O `NOCASE` do SQLite só vale sem acento (`server.ts:633`, `db.ts:193`): o mesmo texto em outra caixa cria uma segunda regra e vale a antiga [testado]. Comparar em JS, como `categorizar.ts:139`; aí sai o contorno de `mcp.ts:446`. Conferir se a base já tem regras repetidas assim. Como ficou: `regraIgual`, em `categorizar.ts`; saiu também o contorno da tela Categorias. Na cópia, nenhuma regra repetida assim. O índice único continua `NOCASE` (só pega a mais sem acento) | feito (2026-11-25) |
| 47 | Busca acha texto com acento em outra caixa | P | não | O `LIKE` de `server.ts:165` tem o mesmo limite [testado], e `_` e `%` viram coringa. Função de minúsculas no SQLite. Como ficou: função em `db.ts`, com `instr` no lugar do `LIKE`. Nunca em índice, `CHECK` ou gatilho (outro programa não abriria a base). Depois, a pedido do Paulo, passou a ignorar também o acento (`simplificar`); as regras continuam diferenciando | feito (2026-11-25) |
| 48 | Tipo desconhecido da Pluggy não vira entrada | P | não | `sync.ts:79`: o que não é `DEBIT` fica positivo [testado]. Recusar tipo diferente de `DEBIT`/`CREDIT`. A resposta da Pluggy não é validada (`pluggy.ts:33`). Sem caso real (validação de 2026-11-25): só proteção. Valor ilegível também é recusado. Só o lançamento estranho fica de fora, com aviso em `conexoes.erro`: os outros entram, e o que já estava na base não muda nem é tido como sumido | feito (2026-11-25) |
| 49 | Rodapé de Lançamentos bate com o Resumo | P | não | `Lancamentos.tsx:72-78` soma por sinal: inclui transferências e conta estorno como entrada [testado]. Decidido em 2026-11-25 (o Paulo pediu o mais fácil de entender): a regra do Resumo, com os nomes escritos ("Entradas" e "Gastos"), para o mês sem filtro dar o mesmo número nas duas telas; o que a lista tem de transferência aparece à parte, como "fora do resumo", para não parecer que sumiu. Como ficou: `GET /api/lancamentos/totais`, com os mesmos filtros da lista e o mesmo SQL do Resumo: soma o filtro inteiro (a lista para em 2000, o rodapé não) e se atualiza a cada edição. No MCP, `soma` em `lancamentos`. Na cópia, igual ao Resumo em todos os meses, PF e PJ | feito (2026-11-25) |
| 50 | Apagar um bem não muda o passado | P | não | `server.ts:541` e `patrimonio.ts:38`: apagar dívida quitada altera o patrimônio de dias anteriores [testado]. Zerar já preserva. Decidido em 2026-11-25: ter "quitado", sem migração. Valor 0 = quitado ou vendido: o ✓ da linha zera e a leva para uma lista recolhida; só de lá dá para apagar de vez, com o aviso (para linha criada por engano) | feito (2026-11-25) |
| 51 | Travas de uma linha na base | P | não, mas mexe em `db.ts`: worktree | `BEGIN IMMEDIATE` (`db.ts:235`; com dev e app juntos dá "database is locked" na hora); recusar base mais nova que o código (`db.ts:221`); `reaplicarRegras()` do início em transação (`server.ts:15`; hoje é lenta) [testado]. Sem transação, também pode parar no meio. `migrar()` também abre com `IMMEDIATE` e relê a versão dentro: dois processos subindo juntos não repetem a migração | feito (2026-11-25) |
| 52 | Sincronização não perde nem esconde dado | P | não | Saldo nulo apaga o último conhecido (`sync.ts:52`) [testado]; erro 429 ou 500 em faturas e investimentos é engolido (`sync.ts:211`, `230`); só a primeira página deles é lida (`pluggy.ts:114-117`). Feito também para limite, total de fatura e investimento. `contas.atualizado_em` só anda quando o saldo vem: o 69 compara com o `inicio` da última sincronização (o `ultimo_sync` é gravado no fim, sempre depois). Falha em faturas ou investimentos não interrompe os lançamentos: vai para `conexoes.erro`. Banco sem o produto responde lista vazia (conferido em 2026-11-25): só o 404 passa calado | feito (2026-11-25) |
| 53 | Categoria fixa não muda de grupo | P | não | A API só protege o nome (`server.ts:577`) [testado]. Nenhuma tela usa hoje | feito (2026-11-25) |
| 54 | Pix no crédito se ajusta ao editar | P | não | Ignorar a cobrança só corrige entradas e saídas no próximo sync (`server.ts:197`); o resultado do mês não muda [testado]. Frente 64. Como ficou: `PATCH /api/lancamentos` reaplica as regras quando vem categoria ou ignorar, na mesma transação, e devolve em `tambem_mudaram` os outros que mudaram (a tela os atualiza sem recarregar a lista; o MCP repassa). Ocultar o cartão ou trocar a pessoa da conta também ajusta: o gasto sumia até a sincronização. Desfazer a edição à mão volta à categoria automática na hora, e não só no próximo sync | feito (2026-11-25) |
| 55 | Tirar totais e recorrentes de `server.ts` | M | não | Importar o arquivo já migra, reaplica regras e abre a porta (14, 15, 662). Um corte só: totais (224-299) e recorrentes (466-491) em arquivo próprio, junto com o "normal" da categoria, hoje repetido (373 e 432). **Não** dividir as rotas. Como ficou: `api/src/totais.ts`, que se importa sem migrar nem abrir porta (só abre a base); `server.ts` ficou com as rotas. Na cópia, todas as respostas de todos os meses saíram idênticas | feito (2026-11-25) |
| 56 | Um só formato das respostas para API, tela e MCP | M | não | Hoje são três (`server.ts`, `web/src/lib/api.ts:3-212`, `any` no `mcp.ts`): campo renomeado some sem erro de tipo. A API exporta os tipos; tela e MCP usam `import type` (some na compilação: o MCP segue sem `env.ts` e `db.ts`). Como ficou: `api/src/tipos.ts`, só tipos e só de arquivos sem base (a tela o confere com o tsc dela, que não conhece `node:sqlite`). Cada rota declara o que devolve; a tela reexporta em `lib/api.ts` (as páginas não mudaram) e o MCP ficou sem nenhum `any`. Campo renomeado em `tipos.ts` dá erro na rota, na tela e no MCP [testado]. Limite: linha do SQL entra por cast, então um `SELECT` renomeado ainda passa calado. Os tipos da tela eram só parte do que a API manda: entraram os campos que o MCP lia; nenhum lido sem existir. O bundle da tela saiu idêntico e o `mcp.js` não importa nada novo. Mudança de comportamento: o PATCH de conta sem nada para mudar devolve a conta (era `{ ok: true }`) | feito (2026-11-25) |
| 57 | Regras repetidas: juntar ao mexer em cada uma | P cada | não | Grupos (`db.ts:50`, `server.ts:566`, `mcp.ts:476`, `api.ts:6` e `347`); ignorado/REMOVIDO não soma (`server.ts:158`, `161`, `228`, `Lancamentos.tsx:73` e `207`, `Resumo.tsx:135`); estorno (`server.ts:159-163`, `Lancamentos.tsx:207`); planejado total (`server.ts:295`, `Orcamento.tsx:20`, `mcp.ts:244`); tipo do grupo (`server.ts:596`, `Categorias.tsx:115`); dono do investimento (`patrimonio.ts:13`, `mcp.ts:396-399`); limite de 2000 (`server.ts:169`, `mcp.ts:49`). Como ficou: a regra fica na API e a tela só lê. Lançamento vem com `soma` e `estorno` (`SOMA` e `ESTORNO` em `totais.ts`, os mesmos do filtro e do Resumo); orçamento, com `planejado` e `gasto`; categoria, com `tipo`. Grupos em `grupos.ts` para API e MCP; a tela tem os nomes deles e o resto sai dali (tipos únicos são o 56; o `CHECK` de `db.ts` é migração e não muda). O MCP descobre o corte pela própria lista. Dono do investimento já tinha sido resolvido no 62. Na cópia, nenhum número mudou | feito (2026-11-25) |
| 58 | Horários: UTC em uns campos, local em outros | P | migração (só converte horários) | `db.ts:24` e `247`, `sync.ts:89`. Só os horários gravados pelo app; a `date` do banco é o 75. Como ficou: tudo local, como o `DEFAULT` das colunas (`datetime('now','localtime')`), que não muda sem recriar tabela. Só `agora()` gravava UTC (`conexoes.ultimo_sync`, `sincronizacoes.inicio` e `fim`, `atualizado_em` de `contas` e `investimentos`); agora grava local com milissegundos: sem eles, duas sincronizações no mesmo segundo faziam o saldo velho parecer novo no aviso do 69 [testado]. A migração 13 converte o que já estava gravado, porque misturado a comparação de texto erra no mesmo dia (`'T' > ' '`). Fica em UTC só `atualizado_pluggy`, que vem do banco. A tela lê os dois; o MCP manda `agora` local e a convenção diz qual é qual. Na cópia: nenhum horário do app com `T` ou `Z`, as respostas da API iguais às do app em uso (com os horários convertidos) e os mesmos horários nas telas | feito (2026-11-25) |
| 62 | Cofrinhos e caixinhas no patrimônio (`bankData.reservedBalances`) | M | migração (coluna em `contas`) | `GET /accounts` já traz as reservas de Mercado Pago e Nubank (conferido em 2026-11-25, só leitura), **fora** do `balance` e de `/investments`. **Antes:** conferir se `identification` se mantém depois de a Pluggy atualizar o item (`lastUpdatedAt`); se mudar, cada sync criaria linhas novas. Gravar em `investimentos` (patrimônio, tela Contas e MCP já leem), com id = conta + `identification`, saldo = soma das faixas e nome padrão quando vier sem nome. Sumiu da lista: saldo 0, sem apagar a linha. Campo `null` = o banco não informou: manter o último. Não mostrar na tela as zeradas. Zerar (não apagar, ver 50) a linha manual de `bens` no mesmo dia, senão soma em dobro. O gráfico salta nesse dia: o passado não foi registrado. Os pares +X/−X do extrato não mudam. Corrigir "Cofrinhos" no `CLAUDE.md`. Com teste. Frentes 64 e 65. **Como ficou:** (a) pedido do Paulo: o app pergunta, por conta, se ele usa cofrinho ou caixinha ali (`contas.usa_reservas`), e nada soma nem entra na foto do dia sem o sim; um banco pode informar uma sobra de centavos. Assim o total não muda sozinho e a linha manual é zerada na hora do sim. (b) "`null` = manter o último" valia demais: a lista só vem com `hasReservedBalance: true`, então `false` zera; só o resto mantém. (c) O identificador não trava: se mudar, a linha antiga zera e a nova traz o valor (com teste); só sobrariam linhas zeradas. Conferido em 2026-11-25, depois de a Pluggy atualizar: no Mercado Pago se manteve. (d) A reserva segue a pessoa e o "ocultar" da conta, e a foto do dia deixa de guardar o que parou de somar no mesmo dia (valia também para investimento resgatado) | feito (2026-11-25) |

## Adaptadores por banco: uma frente por banco

Pedido do Paulo em 2026-11-25. Padrão **Adapter** (adaptador): cada banco tem uma peça que traduz o que ele manda para o formato do sistema. O conjunto é uma
camada anticorrupção (*Anti-Corruption Layer*): fora dela, o código não precisa saber de que banco veio o dado. Regras:

- O adaptador **traduz** o que veio (data, sinal, parcela, nome, par interno, reserva, total da fatura). **Nunca inventa** o que o banco não mandou: falta vira aviso (69 e 70).
- `bruto` continua como o banco mandou, para poder conferir e refazer.
- Só entra peculiaridade com caso real. Banco desconhecido ou sem peculiaridade usa o adaptador padrão, que não muda nada.
- Cartão A, Cartão B e o banco PJ não têm nome nem código nestes docs (a chave está no `CLAUDE.local.md`). **No código dos adaptadores podem ter** (decidido pelo Paulo em 2026-11-25).

| # | Melhoria | Tam. | Base | O que já se sabe | Status |
|---|---|---|---|---|---|
| 63 | Camada de adaptadores | G | migração (coluna nova em `conexoes`) | Spec: [specs/adaptadores.md](specs/adaptadores.md). **Reconhecer o banco:** todos chegam como MeuPluggy e a base não guarda nada que os diferencie (`sync.ts:44-69`). O código vem no começo de `bankData.transferNumber` das contas `BANK`; o cartão não tem e herda o da conexão (conferido em 2026-11-25: toda conexão tem um código só). Guardar em `conexoes`, porque `reaplicarRegras` e os avisos rodam fora do sync. **Forma:** um mapa código → objeto pequeno, com funções puras e opcionais, sem classes. A tradução recebe a **lista** da conta (V3 precisa ver todas as parcelas) e vale uma vez, na entrada (logo depois de `sync.ts:189`), antes de `salvarTransacoes` e `removerSumidos`: os dois comparam datas. **Passo 1, sem mudar número:** levar `pixNoCredito` (`categorizar.ts:206`) e `INTERNOS` (`categorizar.ts:106-109`) para trás da camada; provar com os testes e com antes/depois numa cópia da base. **Passo 2:** cada `INTERNOS` só no seu banco (hoje vale para todos: muda comportamento). **Decidido (2026-11-25):** nome e código do banco podem aparecer no código público. **Como ficou:** (a) `internos` e `trocas` em `adaptadores.ts`, código em `conexoes.banco`. (b) Banco nulo (ainda não se sabe) vale tudo, como antes: as regras são reaplicadas na subida, antes da primeira sincronização, e sem isso os totais mudariam. (c) Códigos diferentes na mesma conexão não decidem (a documentação da Pluggy cita grupos assim). (d) A tradução da lista e a do total da fatura entram com o primeiro caso (65 a 67). Na cópia, categorias, Resumo, Orçamento, Alarme e Análises de todos os meses saíram iguais, também recalculando do zero | feito (2026-11-25) |
| 64 | Frente Nubank | M | regrava categorias | Já existe: Pix no crédito (54). Entra: caixinha sem nome (62). Exceções do 70: as últimas parcelas de compra antecipada não vêm. Extrato da caixinha conferido em 2026-11-25: guardar não aparece com nome nenhum, e só há candidatas a retirada, entradas "Transferência Recebida" sem pagador (`operationType` `OUTROS`), que podem ser outra coisa. Sem como distinguir, não entra em `internos`; quem reconhecer marca à mão | a fazer |
| 65 | Frente Mercado Pago | M | regrava datas e categorias | Já existe: cofrinhos e débito automático em `internos`. Entra: reservas com nome (62) e **V3**, a parcela `PENDING` futura vem um mês adiantada (o mês aberto conta duas parcelas da mesma compra e Já comprometido fica adiantado). Correção: no máximo uma parcela por compra (`purchaseDate` + total) por mês; a excedente vai para o seguinte. **Antes:** na próxima virada, conferir se a `POSTED` substitui a `PENDING` (item 12). O sync relê 365 dias, então a data se corrige sem migração, mas passa a diferir do `bruto`: avisar quem repetir a validação. Exceção do 70: uma parcela fixa ausente em faturas seguidas. Não misturar com o 10 | V3 espera a próxima virada de fatura |
| 66 | Frente Cartão A | M | regrava categorias | **V4:** o crédito de adiar compra abate o gasto como se fosse estorno. Se a compra voltar na próxima fatura, são três pernas e o crédito só sai do resumo **junto com a nova cobrança**. **V5:** não manda parcela futura (71). A 2ª parcela costuma vir com a data da compra (item 10). Exceções do 69: descontar as parcelas projetadas. Exceções do 70: uma fatura inteira não veio, só o pagamento | V4 espera a próxima fatura |
| 67 | Frente Cartão B | P | não | Só o total da fatura, que carrega a fatura anterior: traduzir, senão o 70 dá falso alarme. No 69 dá quase zero: serve de controle. Como ficou: peça `totalDaFatura`, que só o 70 usa; nada é gravado. Achado: item 78 | feito (2026-11-25) |
| 68 | Frente banco PJ | P | não | Nenhuma peculiaridade conhecida; a transferência PJ → PF bate. Fica no padrão. Abrir quando aparecer caso real. Conferido em 2026-11-25: nenhuma peça casa com lançamento dele e todo Pix da PJ tem a perna na PF | conferido (2026-11-25) |

## Achados da validação dos dados

Origem: [validacao-dados.md](validacao-dados.md), de outra revisão, com dados reais. O **V** é o código de lá, onde estão as contas e os falsos positivos.
Os cálculos estão certos; o que falha é o dado que os cartões mandam, e ninguém é avisado. Linhas de código citadas lá conferidas em 2026-11-25 (V6 a V13); os **[dado]** não foram refeitos.

| # | Melhoria | Tam. | Base | O que já se sabe | Status |
|---|---|---|---|---|---|
| 69 | (V1) Aviso de gasto que o cartão já conta no limite e o app não viu | M | não | Limite usado − lançamentos sem fatura. Em Contas, por cartão, e no Alarme ("até R$ X"). É teto e **não soma** em `saidas`. Depois do 52: com o saldo nulo preservado, comparar só com saldo lido na última sincronização, senão o aviso usa limite velho. Como ficou ([specs/avisos.md](specs/avisos.md)): em Contas, no Alarme do mês aberto e no MCP. A parcela que deveria ter vindo até este mês não é descontada: está no limite e não apareceu. Fatura fechada e não paga conta como vista. Cartão B e Mercado Pago deram zero na cópia | feito (2026-11-25) |
| 70 | (V2) Aviso de fatura que não fecha e de fatura que não veio | M | não | Total da fatura − soma por `fatura_id`; e pagamento sem fatura correspondente. Uma detecção só, com as exceções vindas dos adaptadores (63). Junto com o 69: mesma tela. Cada falso positivo de lá vira teste com dado sintético. Como ficou ([specs/avisos.md](specs/avisos.md)): exceção de verdade é só o total do 67; as faltas de 64 a 66 são o motivo do aviso e aparecem. Seguidas com a mesma diferença viram uma linha. Na cópia saíram as três faltas reais da validação e nenhum dos falsos positivos | feito (2026-11-25) |
| 71 | (V5) Já comprometido com as parcelas que o banco não manda | M | não | `server.ts:438-441` só soma o já lançado. Projetar a partir da última parcela vista, só quando a compra não tem parcela futura, e marcar como prevista: "Parcelas (certas)" (`Analises.tsx:311`) promete demais. Alimenta o 69. Spec: [specs/avisos.md](specs/avisos.md). Como ficou: série à parte (lançadas, previstas, recorrentes) em Análises, no Alarme de mês futuro e no MCP; nenhum total mudou na cópia | feito (2026-11-25) |
| 72 | (V6) "Fecha em" diz que é contra a renda esperada | P | não | Só texto: `RitmoLateral.tsx:16`, `Alarme.tsx:81`. Rever com Metas (33), que muda o teto | feito (2026-11-25) |
| 73 | (V7) Projeção não divide por dia sem dado | P | não | `ritmo.ts:56` e `server.ts:352-357` usam o dia do calendário. Usar o último dia com dado do banco, também no fim da curva (`Analises.tsx:182`). Como ficou: `ultimoDiaComDado` (`totais.ts`) = a atualização mais antiga entre os bancos PF visíveis (`atualizado_pluggy`, no dia local), porque antes dela todos já entregaram. Banco 48 h atrás do mais novo não segura os outros. O dia do último lançamento não serve: conta parada pareceria sem dado. Só a projeção e o fim da curva mudam; o "por dia" continua contando de hoje. Sem dado no mês, sem projeção. Na cópia só o mês aberto mudou, e o nível não | feito (2026-11-25) |
| 74 | (V13) Prévia da regra conta o Pix no crédito | P | não | `contarParecidos` (`categorizar.ts:161`) não passa por `pixNoCredito`; o `total_previsto` do MCP compara prévia com prévia e não pega isso. Melhor separar, em `reaplicarRegras`, o cálculo da gravação e usar o cálculo na prévia: aplicar e desfazer faria um GET travar a base. Como ficou: `calcular` (`categorizar.ts`) só calcula; `reaplicarRegras` grava e `previaDaRegra` compara com o gravado, então `total` é o mesmo número que a gravação devolve, também quando outra regra disputa. Passou a depender da categoria (uma de transferência desfaz o Pix no crédito): opcional na API, porque a tela mostra a prévia antes da escolha, e obrigatória no MCP. `parecidos` guarda o número antigo (quantos têm o texto). A ordem das regras saiu do SQL para o JS, com desempate por id. Na cópia: categorias iguais, também do zero, e a prévia igual à gravação em todos os casos tentados (textos das regras e dos Pix no crédito, três sentidos, categorias de gasto, renda e transferência) | feito (2026-11-25) |
| 75 | (V14) Fechar a dúvida do fuso dos lançamentos | P | não | Recomendação da validação: **não converter** `date` (parte das linhas não tem hora e iria para o dia anterior). O Paulo aceitou: `CLAUDE.md` e notas acertados | feito (2026-11-25) |
| 76 | (V8 a V12) Ajustes de Alarme e Análises | P cada | não | V8 avisar quando o mês inicial automático mudar (`ritmo.ts:42-48`). V9 mesma janela no acumulado (`ritmo.ts:6`, `server.ts:398`). V10 "Renda" do gráfico é tudo o que entrou (`Analises.tsx:107`). V11 recorrente já lançada no futuro desconta duas vezes (`server.ts:351`). V12 sem "normal" quando ele é zero (`server.ts:373`, `432`). Com o 55, que mexe nos mesmos trechos. Como ficou: **V8** nada é gravado: o início automático é recalculado como era no mês passado e, se for outro, avisa em Análises, no Alarme e no MCP durante o mês (a mediana só anda na virada). **V9** 12 meses fechados nas duas telas, pela mesma função (eram 6 no alarme e 11 no gráfico). **V10** o nome virou "Entrou", e não a série `renda`: a sobra sai de tudo o que entrou, como no Resumo. **V11** a cobrança com data futura continua a série (`a_lancar`, em `recorrentes.ts`) e sai do "por dia" e também do "já comprometido", que tinha o mesmo defeito. **V12** normal zero ou negativo vira nulo: a categoria sai da ordem de "Quem estourou" e do Alarme, e aparece embaixo com o gasto. Na cópia mudaram só os normais zerados e uma linha de "acima do normal" de um mês fechado | feito (2026-11-25) |
| 77 | (V15) Patrimônio diz que é a posição nos bancos conectados | P | não | Só texto. Depois do 62, que põe os cofrinhos e caixinhas. Em Contas, no Resumo e na ferramenta do MCP | feito (2026-11-25) |
| 78 | Total da fatura anterior do Cartão B não é gasto | P | regrava categorias | Achado em 2026-11-25, no 67: o banco manda o "total da fatura anterior" (−) e o pagamento dele (+) como lançamentos do cartão, sem categoria que os tire do resumo. Na base do Paulo, regras dele já tiram os dois; quem instala do zero vê gasto e entrada a mais. Entra em `internos` do banco, as duas pernas juntas, mas sem valer para banco nulo (hoje `internosDe(null)` vale tudo) | a fazer |

**O que 41 a 62 já resolvem destes achados** ("liga com", na validação, quer dizer assunto vizinho, não correção):

| Achado | 41 a 62 resolvem? | Por quê |
|---|---|---|
| V1 | não | 52 e 60 cuidam do saldo e da foto; nenhum compara limite com lançamentos. O 52 é pré-requisito |
| V2 | não | A fatura que falta está no meio da série e o banco não mandou: não é página (52) nem `removerSumidos` (45) |
| V3 | não | Vai para a frente 65; acompanhar o 12 |
| V4, V5 | não | Vão para 66 e 71 |
| V6, V7, V8, V10, V11 | não | 55 e 56 mudam o lugar e os tipos, não a conta |
| V9, V12 | em parte | 55 junta o "normal" (V12) num lugar só; a correção ainda é à parte |
| V13 | não | 46 e 54 são vizinhos: regra com acento e quando reaplicar |
| V14 | não | 58 trata dos horários gravados pelo app; V14 é a `date` do banco |
| V15 | em parte | 62 inclui as reservas; falta o texto |

No sentido contrário, a validação **reduz a pressa do 48** (sinal igual ao `bruto` em todos os lançamentos: é só proteção) e mostra que o 45 não causou as faltas encontradas.

## Depois (na fila, ainda sem spec)

| # | Melhoria | Tam. | Base | O que já se sabe |
|---|---|---|---|---|
| 6 | Regra põe tag (custo de um evento, sem mudar a categoria) | M | migração | `lancamentos.tags` já existe; falta em `regras` e o que fazer ao apagar a regra |
| 10 | Cartão pela competência da fatura, não pela data da parcela | G | não | Dados existem: a maioria dos lançamentos de cartão já tem `fatura_id`. Muda os totais de **todos** os meses e o orçamento: conversar antes. Junto com a fase 3 (faturas e parcelas futuras) |
| 8 | Contatos: nome → categoria por direção | G | migração | Só se o 7 não bastar |
| 16 | Bens: nome cortado na tela | P | não | Lista em `.bens li` (`styles.css`): a coluna do nome divide espaço com 130px do valor. Não conferido na tela |
| 18 | Orçamento: sugerir pela média de 3 meses | P | não | Menos urgente: o orçamento já foi definido |
| 19 | Resumo: % categorizada do mês | P | não | O "gasto real" já existe: `saidas` exclui transferências. Falta só a % |
| 34 | Análises D, F e J: cada R$ 100 da renda, mapa de calor categoria × mês, patrimônio e dívida no tempo | M | não | O J precisa de mais dias em `saldos_diarios` |
| 35 | Notificação do Windows quando o mês virar vermelho | P | não | Só se o alarme na tela não bastar |
| 83 | MCC sugere categoria (pendente sem regra nem categoria da Pluggy) | M | não | O 82 já grava o `mcc`. O MCC é do lojista: marketplace e intermediador de pagamento enganam; seria sugestão, nunca acima de regra |

## Fechados ou só acompanhar

| # | Item | Situação |
|---|---|---|
| 9 | Cartões não conectados | Resolvido: categoria própria criada em 2026-11-24. Lançar a fatura à mão fica na fase 5 do `CLAUDE.md` |
| 12 | Dedupe quando PENDING vira POSTED | Conferir na próxima virada: o V3 (65) depende disto |
| 59 | Reconectar banco pode repetir contas | Só acompanhar: problema 1 em "Problemas conhecidos" do `README.md`. Se criar "remover conexão", arquivar em vez de `DELETE`: a cascata (`db.ts:29`, `56`) leva o histórico |
| 60 | Foto do patrimônio só em dia com sincronização ou mudança em bens | Só acompanhar: o sync é manual (`sync.ts:255`), e dia sem foto não volta. Pesa no J do item 34 |
| 61 | Fim do `/transactions` v1 da Pluggy | Nada quebra: só usamos `/v2/transactions` (`pluggy.ts:122`, `127`). Desde 2026-11-23 a Pluggy recusa parâmetro desconhecido em GET: os que enviamos estão na documentação (conferido em 2026-11-25) |

Fora desta revisão: atualizar `zod` 4 e `@fastify/static` 10.

## Como usar

- Um item por commit. Ao terminar, troque o status aqui por `feito (AAAA-MM-DD)` **no mesmo commit**.
- O que a implementação descobrir de diferente corrige a spec, não fica só no chat.
- Um lote só começa com o anterior no `main`.
