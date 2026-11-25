# Validação dos dados (2026-11-24, reconferida em 2026-11-25)

Origem: os números do app (Resumo, Orçamento, Alarme, Análises, Recorrentes, Patrimônio) recalculados por fora, sobre uma cópia da base real, só leitura.
Complementa a revisão de arquitetura do [backlog](backlog.md) (itens 41 a 62), que não usou dados reais. **Para consolidar com ela**: os achados têm
código `V`, não número de backlog, e nada aqui foi implementado.

Mesma regra dos outros docs: **sem nomes de pessoas, saldos, valores, contagens ou datas de lançamentos**. "Cartão A" e "Cartão B" são bancos que não
aparecem nos arquivos versionados; a chave está no `CLAUDE.local.md`. As linhas citadas são do commit `b992749`.

## Conclusão

**Os cálculos estão certos. O problema é o dado que os cartões mandam** (faltando, adiantado ou atrasado), e ninguém é avisado. O mês aberto é o que mais
sofre: o gasto mostrado costuma ficar abaixo do real (V3 é a exceção: infla).

Consequência para a ordem do trabalho: avisar que falta dado (V1 e V2) vale mais que refinar qualquer conta. O resto só melhora um número que já chega incompleto.

## O que foi conferido e está certo (não mexer)

| Conferência | Resultado |
|---|---|
| Entradas, saídas e categorias, PF e PJ, todos os meses | API igual ao recálculo independente |
| Valor, sinal e data de cada lançamento contra `bruto` | Iguais, inclusive em moeda estrangeira |
| Duplicados | Nenhum que pese |
| Transferência PJ → PF | As duas pernas batem em todos os meses |
| Saldo das contas | Fecha com a soma dos lançamentos (no Mercado Pago, conta + cofrinhos) |
| Nubank, Mercado Pago e Cartão A, faturas recentes | Fecham, menos os casos de V2 |
| Projeção do mês, testada em meses fechados | Errou menos de 15% na média, mas com poucos meses de teste |
| Alarme do mês atual | Projeção, renda esperada, por dia e nível iguais ao recálculo |

## Achados

Evidência: **[dado]** = conferido duas vezes na base real; **[indício]** = forte, falta um fato futuro; **[código]** = lido no código, sem caso real hoje.

| # | Prioridade | Tam. | Base | Achado | Evidência | Liga com |
|---|---|---|---|---|---|---|
| V1 | alta | M | não | Gasto que o cartão já conta no limite e o app ainda não viu | [dado] Cartão A e Nubank | 52, 60 |
| V2 | alta | M | não | Fatura com lançamento faltando, e fatura inteira que não veio | [dado] Cartão A, Mercado Pago, Nubank | 52, 45 |
| V3 | média | M | regrava datas | Parcela pendente do Mercado Pago vem um mês adiantada | [dado] a data; [indício] a correção | 10, 12 |
| V4 | média | P | regrava categorias | Crédito de adiar compra (Cartão A) abate o gasto como se fosse estorno | [indício] | 10 |
| V5 | média | M | não | "Já comprometido" sem as parcelas futuras do Cartão A | [dado] | 33 |
| V6 | média | P | não | "Fecha em" parece o resultado do mês, mas é a distância da renda esperada | [dado] | 33 |
| V7 | média | P | não | A projeção divide por dias que ainda não têm dado | [dado] | 55 |
| V8 | baixa | P | não | Mês inicial automático pode mudar sozinho | [código] | 33 |
| V9 | baixa | P | não | Acumulado do Alarme e de Análises usam janelas diferentes | [código] | 55, 57 |
| V10 | baixa | P | não | "Renda" no gráfico é tudo o que entrou | [código] | 55, 56 |
| V11 | baixa | P | não | Recorrente já lançada com data futura pode descontar duas vezes | [código] | 55 |
| V12 | baixa | P | não | "Normal" zero ou estranho em categoria com muito reembolso | [dado] | 55, 57 |
| V13 | baixa | P | não | A prévia da regra não conta o Pix no crédito | [dado] | 46, 54 |
| V14 | baixa | P | não | Fuso: pode fechar a pendência sem converter | [dado] | 58 |
| V15 | baixa | P | não | Patrimônio é posição líquida parcial, e a tela não diz | [dado] | 50, 62 |

### V1. Gasto que ainda não apareceu

`contas.saldo_centavos` do cartão é o limite usado, e o banco o atualiza **antes** de mandar o lançamento. Em dois cartões o limite subiu sem lançamento novo.

> falta = limite usado − soma de (−valor) dos lançamentos do cartão **sem** `fatura_id`, sem `REMOVIDO` e sem a categoria Pagamento de fatura

Testado: dá zero no Mercado Pago, quase zero no Cartão B e positivo onde o dado falta mesmo. Cuidados:
- o pagamento da última fatura chega sem `fatura_id`: sem excluí-lo, o resultado não faz sentido;
- fatura fechada e ainda não paga também ocupa limite: somar ao visto (não havia caso para testar);
- o Cartão A não manda parcela futura (V5): descontar as parcelas projetadas, senão aparecem como compra sumida;
- uma compra parcelada pesa no limite inteira e no mês só a 1ª parcela. É **teto** do que falta no mês, não o valor: a tela deve dizer "até".

**Sugestão:** aviso por cartão em Contas, e no Alarme do mês aberto ("até R$ X ainda não apareceram"). Não somar em `saidas`: é aviso, não lançamento.

### V2. Fatura × soma dos lançamentos

> diferença = `faturas.total_centavos` − soma de (−valor) por `fatura_id`, sem `REMOVIDO` e sem a categoria Pagamento de fatura

Testado em todas as faturas. Três tipos de falta real:
- uma parcela fixa do Mercado Pago ausente em várias faturas seguidas;
- as últimas parcelas de uma compra antecipada no Nubank;
- no Cartão A, uma fatura **inteira**: há o pagamento na conta, mas não a linha em `faturas` nem as compras. Ela fica no meio da série, então não é a paginação do item 52.

Os lançamentos que faltam **não estão em nenhum backup** de `data/`: o banco não mandou, não foi a `removerSumidos` (item 45).

Falsos positivos a tratar: a primeira fatura da janela de 365 dias (compras de antes); o Cartão B, cujo total carrega a fatura anterior; crédito ou estorno fora da
fatura. Tolerar centavos.

**Sugestão:** aviso em Contas por fatura que não fecha, e "pagamento de fatura sem fatura correspondente" para pegar a que não veio. O efeito no mês é de
gasto **subestimado**: pode deixar verde um mês que não é. Na base real, nenhum mudou de cor.

### V3. Parcela pendente do Mercado Pago

`PENDING` futura vem no último dia do mês (meia-noite local, `T03:00Z`). A `POSTED` vem no dia 05, menos a 1ª, que vem na data da compra. Resultado: o mês aberto
conta **duas parcelas** da mesma compra, e toda a fila de Já comprometido fica um mês adiantada.

**Antes de corrigir:** depois do próximo dia 05, conferir se a `POSTED` substitui a `PENDING` (a chave pode mudar, item 12). **Sugestão:** no máximo uma
parcela por compra (`purchaseDate` + total de parcelas) por mês; a excedente vai para o mês seguinte. Serve para qualquer banco. Não entrar no item 10 (competência) só por isso.

### V4. Adiar compra (Cartão A)

O crédito tem o valor exato de uma compra anterior, e no mesmo período há IOF de parcelamento. Parece adiar a compra para a próxima fatura, não devolver o dinheiro.
Hoje ele cai em categoria de gasto e abate o mês.

**Antes:** ver a próxima fatura. Se a compra voltar, são três pernas (compra, crédito, nova cobrança) e o crédito deve sair do resumo **junto com a nova cobrança**,
nunca sozinho (regra do par, `CLAUDE.md`). Candidato a `INTERNOS` em `categorizar.ts`.

### V5. Já comprometido incompleto

`server.ts:438-441` só soma o que já está lançado no futuro. O Cartão A não manda parcelas futuras, mas a última diz "n de N". O rótulo "Parcelas (certas)"
(`Analises.tsx:311`) e a frase "certos em parcelas" prometem demais.

**Sugestão:** projetar as que faltam a partir da última parcela vista, **só** quando a compra não tem parcela futura lançada, e marcar como previstas. Também
alimenta a conta de V1. Outro detalhe do cartão: a 2ª parcela costuma vir com a data da compra (some na janela, mas desloca gasto entre meses; é o item 10).

### V6. "Fecha em"

`RitmoLateral.tsx:16` e `Alarme.tsx:81` mostram renda esperada − projeção. Mês fechado compara com a renda **recebida** (`server.ts:386-387`). Com renda extra, o
mês pode aparecer "fechando" negativo e ficar verde ao fechar. A régua está como a spec do lote 3 decidiu; o que engana é o texto.

**Sugestão:** "Contra a renda esperada: −X". Resolver junto com Metas (33), que muda o teto.

### V7. Projeção com dia sem dado

`ritmo.ts:56` divide o gasto pelo dia do calendário (`server.ts:352-357`), mas o dado do banco é de horas ou um dia antes. Puxa a projeção um pouco para baixo, na
mesma direção de V1. O mesmo atraso deixa plano o fim da curva dia a dia (`Analises.tsx:182`): parece dia sem gasto.

**Sugestão:** usar o último dia com dado do banco (o app já mostra "dados do banco de…"), na regra de três e no fim da curva.

### V8 a V15 (baixas)

- **V8** `ritmo.ts:42-48`: o início é o primeiro mês com renda ≥ metade da mediana dos 3 últimos. Um mês perto da linha entra ou sai sozinho quando a mediana
  anda, e muda o acumulado sem aviso. O comentário fala em conta não conectada, mas também pega renda que era mesmo menor. Contornado na base real: o mês inicial
  foi fixado em Análises. Sugestão: dizer na tela quando o automático mudou.
- **V9** `ritmo.ts:6` (6 meses, usado em `server.ts:365`) e `server.ts:398` (12): iguais enquanto houver poucos meses fechados; depois as duas telas divergem. Dizer o
  período nas duas ou usar uma janela só.
- **V10** `Analises.tsx:107` e `111`: a série "Renda" é `entradas` (inclui entrada sem categoria). `totaisPorMes` já devolve `renda` separada.
- **V11** `server.ts:351`: a cobrança já lançada com data futura no mês entra em `saidas`, e o detector só vê até hoje e a desconta de novo em "por dia".
- **V12** `server.ts:373` e `432`: `Math.max(0, mediana)` dá normal zero quando há reembolso em meses anteriores, e a categoria encabeça "Quem estourou" dentro do
  orçado. Sugestão: sem normal quando for zero. Vale também para categoria com entrada e saída misturadas, que pode ficar **negativa** num mês (as telas suportam).
- **V13** `categorizar.ts:161` (`contarParecidos`) não passa por `pixNoCredito`, e `reaplicarRegras` (238) passa: a gravação mudou mais lançamentos que a prévia anunciou.
  O resultado está certo; só a contagem diverge. O `total_previsto` do MCP compara prévia com prévia, então não protege disso. Sugestão: prévia = aplicar numa
  transação e desfazer.
- **V14** `date` vem em UTC, mas só parte das linhas tem hora: as que são só data (`T00:00Z`) iriam para o dia anterior se convertidas. Trocar o dia afeta poucas
  linhas e quase nada do gasto do mês. **Recomendação: não converter** e fechar a pendência em `CLAUDE.md:94`, no 58 e no fim do backlog.
- **V15** O que está fora do Open Finance só entra se estiver em `bens`. Nome sugerido na tela: "posição nos bancos conectados". As reservas do item 62 não foram
  conferidas nesta validação.

## Investigado e descartado (não refazer)

| Suspeita | Por que não é problema |
|---|---|
| Dinheiro saindo dos cofrinhos do Mercado Pago sem aparecer | Falso alarme. "Reservado − retirado" pelo extrato não serve: os pares param de fechar a partir de certo mês. O que vale é conta + cofrinhos pelo fluxo externo; os rendimentos mensais batem com esse total e seriam bem menores que o normal se houvesse dinheiro a mais. O valor manual em `bens` está certo |
| Compra parcelada com parcela sumida | Diferença de centavos entre parcelas |
| Fatura do Nubank que não fecha por um estorno | O estorno está na base, fora da fatura |
| Grupos de lançamentos iguais | Horários diferentes: compras repetidas de verdade |
| Renda sem categoria dentro da janela analisada | Zero |

## Decisões já tomadas com o Paulo (2026-11-25)

- Pix com outra pessoa **não** é "entre contas próprias": a regra passou para uma categoria de gasto nos dois sentidos (o que volta abate). Aplicada na base real, com backup.
- O mês inicial da análise foi fixado em Análises (V8).
- Categorias a revisar estão com ele, fora do repositório.

## Ordem sugerida para a consolidação

1. **41 e 42** (base segura), antes de tudo.
2. **V1 e V2**, juntos: mesma tela, mesmas duas consultas, sem migração. Precisam de teste com dado sintético (cada falso positivo acima é um caso).
3. **V6, V7 e V13**: textos e contas pequenas. **V14**: só fechar a pendência.
4. **V5**, que melhora V1.
5. **V3 e V4**, depois de conferir a próxima virada de fatura. Regravam dado da base real: worktree com cópia.
6. **V8 a V12 e V15** junto com o lote 6 ou com o item 55, que mexe nos mesmos arquivos.

**Repetir a validação** sempre que mudar totais: rodar as consultas de V1 e V2 sobre um `VACUUM INTO` da base e comparar com a API por GET. Não importar `server.ts` nem
`db.ts` no script: eles migram e gravam.

## Limites

Nada antes da janela de 365 dias; cartões sem Open Finance; poucos dias em `saldos_diarios` (item 60). Gráficos revisados pelo texto da página e pelo código, sem captura de tela.
