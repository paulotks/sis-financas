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
| **1. Base segura** | 41 → 42 → 51 → 44 | Tudo em `db.ts` e no início do `server.ts`. O 44 é uma migração simples: estreia a cópia automática do 42 | migração: worktree | nada |
| **2. Rápidas** | 43, 53, 72 | Linhas isoladas; cabem entre quaisquer outras | não | nada |
| **3. Sincronização confiável** | 52 → 48 → 45 | `sync.ts` e `pluggy.ts`. O 52 é pré-requisito do 69 | não | 1 |
| **4. Cofrinhos e patrimônio** | 50 → 62 → 77, com a conferência do extrato da caixinha (64) | Mesma tela. Zerar a linha manual (62) usa o que o 50 decidir | não | 3, e o identificador conferido |
| **5. Camada de adaptadores** | 63 passo 1 → 63 passo 2, com 68 | Uma estrutura só. O passo 1 não pode mudar nenhum número | migração: worktree | 1 e 3 |
| **6. Avisos de dado que falta** | 71 → 67 → 70 → 69 | Mesmas consultas e mesma tela. O 69 desconta as parcelas que o 71 projeta; o 70 usa o total traduzido pelo 67 e as exceções de 64 a 66 | não | 3 e 5 |
| **7. Regras e busca** | 46 → 47 → 74 → 54 | Rotas de regras e `categorizar.ts`. O 74 separa cálculo de gravação, e o 54 chama a mesma função | não | 5 (mesmo arquivo) |
| **8. Frentes que esperam a fatura** | 65 (V3, com o 12) e 66 (V4), uma branch por banco | As duas regravam dado e precisam da próxima virada de fatura | regrava: worktree com cópia | 5, e a virada |
| **9. Totais, Alarme e Análises** | 55 → 73 → 76 → 57 → 49 | O 55 tira os totais do `server.ts`; os outros mexem nesses mesmos trechos | não | 6 |
| **10. Metas (lote 6)** | 33 | Precisa de spec. Revê o texto do 72 | migração | 1 e 9 |
| **11. Formato único e horários** | 56 → 58 | Tocam API, tela e MCP inteiros: por último, para não conflitar | não | 10 |

- **Por que esta ordem:** primeiro não perder dado (1), depois ler certo (3 a 5), depois avisar o que falta (6). Refinar conta (9) só vale com o dado completo.
- **Pode adiantar:** a 2 a qualquer momento; a 4 antes da 5, porque o 62 vale para qualquer banco e não precisa dos adaptadores.
- **Esperam uma decisão do Paulo:** 49 (regra ou rótulo), 50 (avisar ou "quitado").
- **Esperam um fato:** 62 (identificador depois de a Pluggy atualizar), V3 e V4 (virada da fatura), 45 (ver um status de falha de verdade).
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

## Antes do lote 6: base segura (revisão de arquitetura e banco)

Origem: revisão de 2026-11-24, só no código e em base temporária com dados sintéticos (nada da base real). Sem spec: o que se sabe está na tabela.
As linhas citadas são do commit `b992749`. **[testado]** = reproduzido. **41 e 42 antes de qualquer migração**; a ordem completa está em "Ordem e fatias".

| # | Melhoria | Tam. | Base | O que já se sabe | Status |
|---|---|---|---|---|---|
| 41 | Migração que recria tabela não pode apagar em cascata | P | não, mas mexe em `db.ts`: worktree | `migrar()` (`db.ts:219-232`) roda com `foreign_keys` ligado: recriar `contas` com `DROP TABLE` apaga lançamentos e faturas, sem erro [testado]. Em `categorias` com uso, a migração falha e o app não sobe [testado]. Nada foi perdido até hoje. Correção: desligar `foreign_keys` **antes** do `BEGIN`, rodar `foreign_key_check` e religar (dentro da migração não adianta [testado]). Com teste | feito (2026-11-25) |
| 42 | Cópia automática da base | M | não, mas mexe em `db.ts`: worktree | Hoje só manual (`README.md:94`), e `migrar()` roda a cada início (`server.ts:14`). `VACUUM INTO` antes de migração pendente e cópia periódica. Copiar só o `.db` sem o `-wal` perde o mais recente. A Pluggy não devolve edições, regras, orçamento, decisões, bens, `saldos_diarios` nem o que passou de 365 dias. O `.env` precisa de cópia à parte: a Pluggy mostra o segredo uma vez só. Decidido em 2026-11-25: pasta em `COPIAS_DIR` (`.env`), padrão `copias/` ao lado da base; 14 diárias e 14 de antes de migração, contadas à parte. Sem a cópia, não migra; a diária que falha só vai para o log. Restaurar e guardar o `.env`: `README.md` | feito (2026-11-25) |
| 43 | Alarme lento com histórico grande | P | não | `recorrentes.ts:107` roda em toda tela (menu). Uma linha: checar `entre(dias(u.data, c.data), MES)` antes do `some`. Mesma saída; com dado sintético de 3 anos, de 19 s para 1,4 s [testado] | a fazer |
| 44 | Índices em `lancamentos(categoria_id)` e `lancamentos(regra_id)` | P | migração | `/api/categorias` e `/api/regras` contam usos linha a linha (`server.ts:552-554`, `619`). Com dado sintético, `/api/regras` vai de 2,8 s para 1 ms [testado]. Só `CREATE INDEX`, sem recriar tabela. Antes da fase 6 (importar regras) | a fazer |
| 45 | Sincronização respeita o status do banco | M | não | `sync.ts:175-193` ignora `OUTDATED` e `PARTIAL_SUCCESS`: com lista parcial em `OUTDATED`, apaga lançamento sem erro (volta quando a lista vier completa) [testado]. 0 contas com contas na base deve gravar `erro` (`sync.ts:233`). `Conexoes.tsx:9-11` não avisa `PARTIAL_SUCCESS`. **Antes:** conferir no PC que status o MeuPluggy manda, senão a limpeza de sumidos pode nunca mais rodar. Em 2026-11-25 todas as conexões vieram com status preenchido e de sucesso; falta ver um caso de falha | a fazer |
| 46 | Regra repetida com acento corrige a existente | P | não | O `NOCASE` do SQLite só vale sem acento (`server.ts:633`, `db.ts:193`): o mesmo texto em outra caixa cria uma segunda regra e vale a antiga [testado]. Comparar em JS, como `categorizar.ts:139`; aí sai o contorno de `mcp.ts:446`. Conferir se a base já tem regras repetidas assim | a fazer |
| 47 | Busca acha texto com acento em outra caixa | P | não | O `LIKE` de `server.ts:165` tem o mesmo limite [testado], e `_` e `%` viram coringa. Função de minúsculas no SQLite | a fazer |
| 48 | Tipo desconhecido da Pluggy não vira entrada | P | não | `sync.ts:79`: o que não é `DEBIT` fica positivo [testado]. Recusar tipo diferente de `DEBIT`/`CREDIT`. A resposta da Pluggy não é validada (`pluggy.ts:33`). Sem caso real (validação de 2026-11-25): só proteção | a fazer |
| 49 | Rodapé de Lançamentos bate com o Resumo | P | não | `Lancamentos.tsx:72-78` soma por sinal: inclui transferências e conta estorno como entrada [testado]. Decidir: usar a regra do Resumo ou mudar o rótulo | a fazer |
| 50 | Apagar um bem não muda o passado | P | não | `server.ts:541` e `patrimonio.ts:38`: apagar dívida quitada altera o patrimônio de dias anteriores [testado]. Zerar já preserva. Decidir: só avisar na tela ou ter "quitado" | a fazer |
| 51 | Travas de uma linha na base | P | não, mas mexe em `db.ts`: worktree | `BEGIN IMMEDIATE` (`db.ts:235`; com dev e app juntos dá "database is locked" na hora); recusar base mais nova que o código (`db.ts:221`); `reaplicarRegras()` do início em transação (`server.ts:15`; hoje é lenta) [testado]. Sem transação, também pode parar no meio | a fazer |
| 52 | Sincronização não perde nem esconde dado | P | não | Saldo nulo apaga o último conhecido (`sync.ts:52`) [testado]; erro 429 ou 500 em faturas e investimentos é engolido (`sync.ts:211`, `230`); só a primeira página deles é lida (`pluggy.ts:114-117`) | a fazer |
| 53 | Categoria fixa não muda de grupo | P | não | A API só protege o nome (`server.ts:577`) [testado]. Nenhuma tela usa hoje | a fazer |
| 54 | Pix no crédito se ajusta ao editar | P | não | Ignorar a cobrança só corrige entradas e saídas no próximo sync (`server.ts:197`); o resultado do mês não muda [testado]. Frente 64 | a fazer |
| 55 | Tirar totais e recorrentes de `server.ts` | M | não | Importar o arquivo já migra, reaplica regras e abre a porta (14, 15, 662). Um corte só: totais (224-299) e recorrentes (466-491) em arquivo próprio, junto com o "normal" da categoria, hoje repetido (373 e 432). **Não** dividir as rotas. Fazer com o lote 6 | a fazer |
| 56 | Um só formato das respostas para API, tela e MCP | M | não | Hoje são três (`server.ts`, `web/src/lib/api.ts:3-212`, `any` no `mcp.ts`): campo renomeado some sem erro de tipo. A API exporta os tipos; tela e MCP usam `import type` (some na compilação: o MCP segue sem `env.ts` e `db.ts`) | a fazer |
| 57 | Regras repetidas: juntar ao mexer em cada uma | P cada | não | Grupos (`db.ts:50`, `server.ts:566`, `mcp.ts:476`, `api.ts:6` e `347`); ignorado/REMOVIDO não soma (`server.ts:158`, `161`, `228`, `Lancamentos.tsx:73` e `207`, `Resumo.tsx:135`); estorno (`server.ts:159-163`, `Lancamentos.tsx:207`); planejado total (`server.ts:295`, `Orcamento.tsx:20`, `mcp.ts:244`); tipo do grupo (`server.ts:596`, `Categorias.tsx:115`); dono do investimento (`patrimonio.ts:13`, `mcp.ts:396-399`); limite de 2000 (`server.ts:169`, `mcp.ts:49`) | a fazer |
| 58 | Horários: UTC em uns campos, local em outros | P | não | `db.ts:24` e `247`, `sync.ts:89`. Só os horários gravados pelo app; a `date` do banco é o 75 | a fazer |
| 62 | Cofrinhos e caixinhas no patrimônio (`bankData.reservedBalances`) | M | não (sem migração) | `GET /accounts` já traz as reservas de Mercado Pago e Nubank (conferido em 2026-11-25, só leitura), **fora** do `balance` e de `/investments`. **Antes:** conferir se `identification` se mantém depois de a Pluggy atualizar o item (`lastUpdatedAt`); se mudar, cada sync criaria linhas novas. Gravar em `investimentos` (patrimônio, tela Contas e MCP já leem), com id = conta + `identification`, saldo = soma das faixas e nome padrão quando vier sem nome. Sumiu da lista: saldo 0, sem apagar a linha. Campo `null` = o banco não informou: manter o último. Não mostrar na tela as zeradas. Zerar (não apagar, ver 50) a linha manual de `bens` no mesmo dia, senão soma em dobro. O gráfico salta nesse dia: o passado não foi registrado. Os pares +X/−X do extrato não mudam. Corrigir "Cofrinhos" no `CLAUDE.md`. Com teste. Frentes 64 e 65 | espera conferir o identificador |

## Adaptadores por banco: uma frente por banco

Pedido do Paulo em 2026-11-25. Padrão **Adapter** (adaptador): cada banco tem uma peça que traduz o que ele manda para o formato do sistema. O conjunto é uma
camada anticorrupção (*Anti-Corruption Layer*): fora dela, o código não precisa saber de que banco veio o dado. Regras:

- O adaptador **traduz** o que veio (data, sinal, parcela, nome, par interno, reserva, total da fatura). **Nunca inventa** o que o banco não mandou: falta vira aviso (69 e 70).
- `bruto` continua como o banco mandou, para poder conferir e refazer.
- Só entra peculiaridade com caso real. Banco desconhecido ou sem peculiaridade usa o adaptador padrão, que não muda nada.
- Cartão A, Cartão B e o banco PJ não têm nome nem código nestes docs (a chave está no `CLAUDE.local.md`). **No código dos adaptadores podem ter** (decidido pelo Paulo em 2026-11-25).

| # | Melhoria | Tam. | Base | O que já se sabe | Status |
|---|---|---|---|---|---|
| 63 | Camada de adaptadores | G | migração (coluna nova em `conexoes`) | Depois de 41 e 42; escrever spec antes. **Reconhecer o banco:** todos chegam como MeuPluggy e a base não guarda nada que os diferencie (`sync.ts:44-69`). O código vem no começo de `bankData.transferNumber` das contas `BANK`; o cartão não tem e herda o da conexão (conferido em 2026-11-25: toda conexão tem um código só). Guardar em `conexoes`, porque `reaplicarRegras` e os avisos rodam fora do sync. **Forma:** um mapa código → objeto pequeno, com funções puras e opcionais, sem classes. A tradução recebe a **lista** da conta (V3 precisa ver todas as parcelas) e vale uma vez, na entrada (logo depois de `sync.ts:189`), antes de `salvarTransacoes` e `removerSumidos`: os dois comparam datas. **Passo 1, sem mudar número:** levar `pixNoCredito` (`categorizar.ts:206`) e `INTERNOS` (`categorizar.ts:106-109`) para trás da camada; provar com os testes e com antes/depois numa cópia da base. **Passo 2:** cada `INTERNOS` só no seu banco (hoje vale para todos: muda comportamento). **Decidido (2026-11-25):** nome e código do banco podem aparecer no código público | a fazer |
| 64 | Frente Nubank | M | regrava categorias | Já existe: Pix no crédito (54). Entra: caixinha sem nome (62). Exceções do 70: as últimas parcelas de compra antecipada não vêm. **Conferir:** como guardar e tirar da caixinha aparece no extrato. `INTERNOS` não cobre; se as duas pernas não saem do resumo, pode estar contando como gasto ou renda | a fazer |
| 65 | Frente Mercado Pago | M | regrava datas e categorias | Já existe: cofrinhos e débito automático em `INTERNOS`. Entra: reservas com nome (62) e **V3**, a parcela `PENDING` futura vem um mês adiantada (o mês aberto conta duas parcelas da mesma compra e Já comprometido fica adiantado). Correção: no máximo uma parcela por compra (`purchaseDate` + total) por mês; a excedente vai para o seguinte. **Antes:** na próxima virada, conferir se a `POSTED` substitui a `PENDING` (item 12). O sync relê 365 dias, então a data se corrige sem migração, mas passa a diferir do `bruto`: avisar quem repetir a validação. Exceção do 70: uma parcela fixa ausente em faturas seguidas. Não misturar com o 10 | V3 espera a próxima virada de fatura |
| 66 | Frente Cartão A | M | regrava categorias | **V4:** o crédito de adiar compra abate o gasto como se fosse estorno. Se a compra voltar na próxima fatura, são três pernas e o crédito só sai do resumo **junto com a nova cobrança**. **V5:** não manda parcela futura (71). A 2ª parcela costuma vir com a data da compra (item 10). Exceções do 69: descontar as parcelas projetadas. Exceções do 70: uma fatura inteira não veio, só o pagamento | V4 espera a próxima fatura |
| 67 | Frente Cartão B | P | não | Só o total da fatura, que carrega a fatura anterior: traduzir, senão o 70 dá falso alarme. No 69 dá quase zero: serve de controle | a fazer |
| 68 | Frente banco PJ | P | não | Nenhuma peculiaridade conhecida; a transferência PJ → PF bate. Fica no padrão. Abrir quando aparecer caso real | só conferir |

## Achados da validação dos dados

Origem: [validacao-dados.md](validacao-dados.md), de outra revisão, com dados reais. O **V** é o código de lá, onde estão as contas e os falsos positivos.
Os cálculos estão certos; o que falha é o dado que os cartões mandam, e ninguém é avisado. Linhas de código citadas lá conferidas em 2026-11-25 (V6 a V13); os **[dado]** não foram refeitos.

| # | Melhoria | Tam. | Base | O que já se sabe | Status |
|---|---|---|---|---|---|
| 69 | (V1) Aviso de gasto que o cartão já conta no limite e o app não viu | M | não | Limite usado − lançamentos sem fatura. Em Contas, por cartão, e no Alarme ("até R$ X"). É teto e **não soma** em `saidas`. Depois do 52: com o saldo nulo preservado, comparar só com saldo lido na última sincronização, senão o aviso usa limite velho | a fazer |
| 70 | (V2) Aviso de fatura que não fecha e de fatura que não veio | M | não | Total da fatura − soma por `fatura_id`; e pagamento sem fatura correspondente. Uma detecção só, com as exceções vindas dos adaptadores (63). Junto com o 69: mesma tela. Cada falso positivo de lá vira teste com dado sintético | a fazer |
| 71 | (V5) Já comprometido com as parcelas que o banco não manda | M | não | `server.ts:438-441` só soma o já lançado. Projetar a partir da última parcela vista, só quando a compra não tem parcela futura, e marcar como prevista: "Parcelas (certas)" (`Analises.tsx:311`) promete demais. Alimenta o 69 | a fazer |
| 72 | (V6) "Fecha em" diz que é contra a renda esperada | P | não | Só texto: `RitmoLateral.tsx:16`, `Alarme.tsx:81`. Rever com Metas (33), que muda o teto | a fazer |
| 73 | (V7) Projeção não divide por dia sem dado | P | não | `ritmo.ts:56` e `server.ts:352-357` usam o dia do calendário. Usar o último dia com dado do banco, também no fim da curva (`Analises.tsx:182`) | a fazer |
| 74 | (V13) Prévia da regra conta o Pix no crédito | P | não | `contarParecidos` (`categorizar.ts:161`) não passa por `pixNoCredito`; o `total_previsto` do MCP compara prévia com prévia e não pega isso. Melhor separar, em `reaplicarRegras`, o cálculo da gravação e usar o cálculo na prévia: aplicar e desfazer faria um GET travar a base | a fazer |
| 75 | (V14) Fechar a dúvida do fuso dos lançamentos | P | não | Recomendação da validação: **não converter** `date` (parte das linhas não tem hora e iria para o dia anterior). O Paulo aceitou: `CLAUDE.md` e notas acertados | feito (2026-11-25) |
| 76 | (V8 a V12) Ajustes de Alarme e Análises | P cada | não | V8 avisar quando o mês inicial automático mudar (`ritmo.ts:42-48`). V9 mesma janela no acumulado (`ritmo.ts:6`, `server.ts:398`). V10 "Renda" do gráfico é tudo o que entrou (`Analises.tsx:107`). V11 recorrente já lançada no futuro desconta duas vezes (`server.ts:351`). V12 sem "normal" quando ele é zero (`server.ts:373`, `432`). Com o 55, que mexe nos mesmos trechos | a fazer |
| 77 | (V15) Patrimônio diz que é a posição nos bancos conectados | P | não | Só texto. Depois do 62, que põe os cofrinhos e caixinhas | a fazer |

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
| 33 | (**lote 6**, combinado em 2026-11-24) Metas: tela própria (guardar, reserva, quitar dívida), nada fixo no código. O teto do alarme passa a ser renda − meta | G | migração | Pedido na entrevista de 2026-11-24, para o futuro. Aportes em Investimentos e as linhas de `bens` são candidatos a medir o progresso. Tem migração: 41 e 42 antes |
| 34 | Análises D, F e J: cada R$ 100 da renda, mapa de calor categoria × mês, patrimônio e dívida no tempo | M | não | O J precisa de mais dias em `saldos_diarios` |
| 35 | Notificação do Windows quando o mês virar vermelho | P | não | Só se o alarme na tela não bastar |

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
