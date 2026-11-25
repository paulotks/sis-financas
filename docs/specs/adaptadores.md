# Fatia 5: camada de adaptadores (FEITA em 2026-11-25)

Item 63 do [backlog](../backlog.md) (passos 1 e 2), com a conferência do 68. Decidido com o Paulo em 2026-11-25: uma frente por banco, e nome e
código do banco podem aparecer no código público.

**Por quê:** o que é peculiar de um banco está espalhado pelo código e vale para todos. As próximas frentes (64 a 67) e as exceções dos avisos (69 e 70)
precisam de um lugar por banco, e o texto que num banco é movimento interno pode ser gasto de verdade em outro.

## Forma

`api/src/adaptadores.ts`: um mapa do código COMPE para um objeto pequeno, sem classes, com peças opcionais. Não importa `db.ts`: recebe pronto o que
precisa. Banco sem peculiaridade não tem entrada no mapa, e isso é o adaptador padrão.

| Peça | O que faz | Quem tem hoje |
|---|---|---|
| `internos` | descrição de movimento interno → nome da categoria | Mercado Pago (323): cofrinhos e débito automático de fatura |
| `trocas` | olha várias linhas juntas e devolve as categorias que mudam, acima das regras | Nubank (260): Pix no crédito |
| `totalDaFatura` (item 67) | tira do total da fatura o que ela carrega da anterior; só compara, não grava | o banco do Cartão B |

**Fica de fora até ter caso:** a tradução da lista da conta (65 e 66). Quando vier, entra em `sincronizarItem`, com
a lista inteira da conta em mãos, antes de `salvarTransacoes` e `removerSumidos` (os dois comparam datas). `bruto` continua como o banco mandou.

## Passo 1: mover, sem mudar número (sem migração)

`INTERNOS` e `pixNoCredito` saem de `categorizar.ts` e viram peças dos adaptadores. Todos ainda valem para todos os bancos.
`NOMES_FIXOS` continua com os nomes usados em `internos`.

## Passo 2: cada peça só no seu banco (migração)

**Reconhecer.** Coluna `conexoes.banco` (código COMPE, texto). Vem do começo de `bankData.transferNumber` das contas `BANK`
(`<compe>/<agência>/<conta>`, na documentação da Pluggy); o cartão não tem e herda o da conexão. Fica em `conexoes` porque `reaplicarRegras` roda fora da sincronização.
- Só vale com as três partes: há exemplo na documentação sem o código (`0001/12345-0`), e aí o começo é a agência.
- Não veio, ou vieram códigos diferentes na mesma conexão (a documentação cita grupos financeiros assim): fica o que já estava.

**Usar.** O código da conexão chega a `sugerirCategoria` e às `trocas`.

| `banco` | O que vale |
|---|---|
| código no mapa | só as peças dele |
| código fora do mapa | nenhuma: é o padrão |
| nulo (ainda não se sabe) | todas, como antes |

O nulo é o que impede a mudança de números na subida: o app migra e reaplica as regras **antes** da primeira sincronização, com a coluna vazia. Também cobre a conexão
só de cartão, que nunca terá código. Vale só para as peças que já existiam para todos: peça nova (tradução, exceção) exige o código.

**Efeito:** nenhum número muda na base real (provar na cópia nos dois estados: coluna vazia e preenchida). Muda para quem tem, em outro banco, um lançamento com texto
igual ao de um movimento interno do Mercado Pago: passa a contar pela categoria da Pluggy.

## 68. Banco PJ

Só conferir: sem peculiaridade, fica no padrão (sem entrada no mapa). Conferir na cópia que nada nele casa com as peças e que a transferência PJ → PF ainda bate.

## Testes

- Reconhecer: código gravado pela sincronização; o cartão herda; nulo ou formato sem código não apaga o que já estava; códigos diferentes não decidem.
- `internos`: só no banco certo; fora do mapa não; nulo como antes; regra do usuário continua mandando.
- Pix no crédito: só no banco certo; nulo como antes.
- Coluna vazia e reaplicar: nada muda.
- **Na cópia da base (fora do Git):** categoria e regra de cada lançamento e o Resumo de todos os meses, PF e PJ, iguais antes e depois; consultas V1 e V2 da
  [validação](../validacao-dados.md) iguais.
