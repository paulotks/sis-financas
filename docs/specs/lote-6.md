# Lote 6: Metas

Item 33 do [backlog](../backlog.md), fatia 10. Decidido com o Paulo em 2026-11-25 (entrevista). Continua o [lote 3](lote-3.md), que deixou o
teto pronto para isto: "quando existir, teto = renda − meta".

**Por quê:** o alarme diz se o gasto cabe na renda, e não se sobra para o que se quer guardar. Um orçamento quase do tamanho da renda fica
verde e nunca junta nada.

Em worktree (sem `.env`), com cópia da base: tem migração. Sem nenhuma meta, **nenhum número do app muda**.

## Decisões (2026-11-25)

- **Três tipos**, sem valor fixo no código:
  - `guardar`: um valor por mês que tem de sobrar. Sem alvo nem conta ligada.
  - `juntar`: um alvo, medido pelo saldo de **uma** posição do patrimônio (conta, investimento, cofrinho, linha de bens).
  - `quitar`: uma dívida, medida pelo saldo negativo de uma posição (cartão, cheque especial, linha negativa de bens).
- **Por mês** é digitado. O app **sugere** o valor pelo prazo, mas nada muda sozinho. Vale do mês escolhido em diante até a próxima mudança, como o
  orçamento: os meses antes dele não mudam (editar olhando um mês passado muda dele em diante, de propósito).
- **Teto = renda esperada − soma do "por mês"** das metas no mês. Sem renda conhecida, o teto continua o orçado: meta não se desconta dele.
- **Cores:** amarelo = passou do orçado **ou não sobra para as metas**; vermelho continua só para gastar mais do que entra. Verde passa a
  garantir que a meta cabe. Mês fechado: a conta é contra o que entrou.
- **Dívida:** acompanha; o "por mês" é opcional. A parcela de empréstimo já é gasto do mês: descontá-la também do teto contaria duas vezes.
  Em branco, a meta não mexe no teto. O valor serve para o que sai da sobra (amortização extra, fatura atrasada).
- **Progresso não é o guardado do mês.** O mês se mede por entradas − saídas (lote 3); o alvo, pelo saldo da posição ligada. Pôr no cofrinho
  sem sobrar no mês anda a meta e não muda o veredito do mês: são duas perguntas.
- **MCP lê, cria e edita** (nome, alvo, prazo, por mês), como `definir_orcamento`. Encerrar, apagar e ligar a uma posição, só na tela.
- **Só PF.**

## Dados (migração 12)

- `metas`: `nome`, `tipo`, `alvo_centavos` (juntar = quanto; quitar = quanto a dívida era), `prazo` (`AAAA-MM`, opcional), `origem` + `ref_id`
  (a posição, mesmo par de `saldos_diarios`; sem FK, são três tabelas) e `encerrada_em`.
- `metas_mensais` (`meta_id`, `mes`, `valor_centavos`): igual a `orcamentos`. 0 = não pede nada dali em diante.
- Posição que some do patrimônio (conta oculta ou PJ, cofrinho sem o Sim, resgatado): a meta fica **sem medida** (nulo, nunca zero). Apagar a
  linha de bens desliga a meta, porque o id pode ser reaproveitado.
- Uma posição mede **uma** meta em andamento: duas contariam o mesmo dinheiro.
- **Encerrar** (✓) põe 0 do mês atual em diante, tira o que estava marcado para depois e guarda o passado. Reabrir não devolve o "por mês".
  **Apagar** muda o veredito dos meses passados: só entre as encerradas, para engano.

## Contas (`api/src/metas.ts`)

- **Falta:** juntar = alvo − saldo; quitar = a dívida de hoje. Nunca negativa.
- **Chega em:** falta ÷ por mês, arredondado para cima, contando do mês **seguinte** (o saldo de hoje já tem o que entrou neste). Acima de 100
  anos = não chega.
- **Precisa de:** falta ÷ meses até o prazo, contados do mesmo jeito. Prazo no mês atual = tudo agora; prazo que passou = nulo, e a tela diz.
- **Andou por mês:** quanto a posição andou de verdade, por 30 dias, desde a foto mais antiga dos últimos 90 (`saldos_diarios`). Só com 28 dias
  de histórico. É o que diz quando a dívida acaba se o "por mês" está em branco.
- **Falta para as metas** (`falta_metas`, no ritmo): gasto (projeção no mês aberto) − (renda − metas), nunca negativo.
- Limite conhecido: no cartão, a dívida é o limite usado, que inclui as parcelas futuras. Se o banco trocar o identificador de um cofrinho, a
  linha antiga zera e a meta precisa ser religada.

## Onde aparece

| Onde | O quê |
|---|---|
| `GET/POST /api/metas`, `PATCH/DELETE /api/metas/:id` | `por_mes` vale de `mes` (padrão: o atual) em diante |
| `GET /api/ritmo` | `metas`, `falta_metas`; `teto` e `nivel` mudam com meta |
| Alarme e menu | limite vira "a renda menos as metas" (revê o 72); marca no medidor; o "por dia" desconta; mês fechado diz se deu |
| Orçamento | a sobra planejada cobre as metas? |
| Análises | linha das metas no "Guardado por mês" (revê o C do lote 4); limite no dia a dia |
| Página Metas (menu) | tudo editável no cartão da meta |
| MCP | `metas` (lê), `definir_meta` (cria ou edita); `ritmo_do_mes`, `orcamento` e `analises` com as metas; `CONVENCOES` |

## Testes

- Puras: `nivelDo` com meta, chega/precisa (arredondamento, prazo no mês, vencido, absurdo).
- API: sem meta, ritmo, orçamento e análises iguais; teto e nível com meta; vigência (mês fechado anterior não muda); encerrar, reabrir, apagar;
  posição oculta, de PJ, repetida, do sinal errado, bem apagado; juntar, quitar e o ritmo real pelas fotos.
- MCP: lista de ferramentas, reais, criar e editar, e o que ele não pode (encerrar, apagar, ligar).
- Cópia da base: todas as respostas iguais entre `main` e a branch sem meta, fora os campos novos.
