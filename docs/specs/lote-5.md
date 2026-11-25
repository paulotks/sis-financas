# Lote 5: recorrentes certas (FEITO em 2026-11-24)

Item 11 do [backlog](../backlog.md), ampliado e dividido em 36 a 40. Decidido com o Paulo em 2026-11-24 (entrevista). Metas (33) fica para o
lote 6 e os gráficos D, F e J (34) depois: o teto "renda − meta" desconta as recorrentes, então elas precisam estar certas antes.

**Por quê:** as recorrentes entram no "pode gastar por dia" e no "já comprometido". Conferido na base: o problema principal não é falso positivo
(o Paulo já os ignorou), e sim cobrança que **falta** e cobrança que **já foi paga com outro nome** e continua descontada.

| O que acontecia | Causa |
|---|---|
| Confirmada aparece "atrasada", mas já foi cobrada | O lojista mudou a descrição |
| Conta fixa todo mês que não aparece | O banco escreve "Pagamento com Pix X" num mês e "Pagamento de conta X" no outro |
| Duas ou três cobranças do mesmo lugar, só uma na lista | Uma linha por descrição |
| Conta fixa some por causa de um mês pulado ou aumento grande | Intervalos rígidos e tolerância de 25% |
| Assinatura cancelada conta até 45 dias | Não havia como dizer "cancelei" |

Em worktree (sem `.env`), com cópia da base: tem migração e muda os números do alarme.

## Decisões (2026-11-24)

- **Uma linha por cobrança**, e a decisão vale para a cobrança (nome + valor), não para o nome. As decisões já gravadas continuam valendo para o
  nome todo. `chaveDe` não muda: nenhuma decisão se perde.
- **Juntar nomes é só automático**, e a linha mostra "antes: X". Sem botão de juntar.
- **Quatro estados:** sugestão, confirmada, ignorada ("não é recorrente") e **cancelada** ("cancelei"). Cancelada e ignorada não contam no alarme.
- **Sugestão conta no alarme** até ser ignorada: errar para o lado da cautela. A tela diz isso.
- **Confirmada nunca some** da lista por causa do filtro de falso positivo.
- **Cobrou depois de cancelada:** depois do dia da marcação (a do próprio dia já estava lá quando a pessoa cancelou), cobrança da mesma série ou de nome e valor parecidos, que não seja de
  outra recorrente viva. Aviso no topo do Resumo (mês atual) e em Recorrentes; some 45 dias depois da cobrança ou ao reativar. A cobrança em si é
  gasto normal. Sem "já vi" e sem campo de data.
- **O MCP só propõe.** A proposta não muda número nenhum até o Paulo aceitar em Recorrentes. O Cowork já gravou sem pedir confirmação; a trava
  precisa estar fora do modelo.

## Detecção (`api/src/recorrentes.ts`, função pura)

1. **Nome:** a `chave` sem o começo que é forma de pagamento ("pagamento de conta", "pagamento com pix", "pix enviado"…), sem "S.A."/"Ltda" no fim e
   sem espaços. Se sobrar vazio, vale a chave.
2. **Série:** em cada nome, cada cobrança continua a série de valor mais próximo (até 60%) cuja última foi há 24 a 37 dias. Se a cobrança de
   valor mais próximo ainda vem dentro do prazo, a compra avulsa de dias antes não toma o lugar dela. Sem série compatível, começa outra.
3. **Emenda:** uma série continua outra que parou se o nome é o mesmo, ou se um contém o outro (6 letras ou mais) na mesma conta. Mesma régua de
   valor; primeiro tenta o mês seguinte, depois um mês pulado (54 a 68 dias).
4. **Vale** com 3 cobranças ou mais, metade dos intervalos de um mês, e 2 de cada 3 cobranças daqueles nomes (desde o começo da série) em séries
   mensais. Este último corte é o que tira compras repetidas no mesmo lugar; não se aplica ao que está confirmado ou cancelado.
5. **Identidade** (`chave` + `valor_chave`): a da última cobrança que não está pendente, porque a pendente pode voltar com outra descrição. A decisão
   acha a série por um valor que ela **já teve**, então aumento de preço não a perde. Limite conhecido: duas cobranças do mesmo lugar que já
   tiveram o mesmo valor dividem a decisão.
6. Parcela, transferência, ignorado e futuro continuam fora. Parada = 45 dias sem cobrar. Parada só aparece se a decisão for daquela cobrança, ou
   se não houver outra série viva com o mesmo nome.

## Itens

| # | O quê | Onde |
|---|---|---|
| 36 | Detecção nova | `recorrentes.ts` |
| 37 | Decisão por cobrança, estado cancelada e proposta | migração de `recorrencias`; `GET`/`PUT /api/recorrentes` (com `valor`), `POST /api/recorrentes/propostas` |
| 38 | Cobrou depois de cancelada | `recorrentes.ts`, `GET /api/ritmo`, `Alarme.tsx` |
| 39 | Tela: uma linha por cobrança, Cancelei/Reativar, propostas do Claude, "antes: X" | `pages/Recorrentes.tsx` |
| 40 | MCP: `propor_recorrente` no lugar de `decidir_recorrente`; aviso em `ritmo_do_mes` | `mcp.ts` |

No alarme, recorrente **atrasada do mês passado** também desconta do "por dia": antes ela sumia da conta na virada do mês.

**Descoberto ao implementar**

- A decisão antiga (nome todo) vale pelo nome sem a forma de pagamento: confirmar o boleto confirma também o Pix para o mesmo lugar.
- A data da decisão só muda quando a decisão muda. Se contasse da primeira, uma cobrança anterior ao cancelamento viraria aviso falso.
- Ensaio na cópia: Resumo idêntico em todos os meses, PF e PJ; toda confirmada continua na lista; nenhuma compra repetida entre as sugestões, nem
  rodando a detecção como se fosse um mês anterior.

## Testes

- Função pura: troca de nome, forma de pagamento diferente, duas cobranças no mesmo lugar, mês pulado, aumento grande, compra frequente fora,
  confirmada fora do corte, decisão antiga valendo para o nome todo, decisão por cobrança.
- API: decisão por cobrança, 404 para cobrança que não existe, proposta não muda número, aceitar e recusar, cancelada fora do alarme, aviso.
- Migração: as decisões antigas continuam.
- MCP: lista de ferramentas; propor não grava decisão.
- **Na cópia da base (fora do Git):** toda confirmada continua na lista.
