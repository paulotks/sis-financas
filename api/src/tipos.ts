/**
 * O formato das respostas da API: a tela (web/src/lib/api.ts) e o MCP leem daqui com `import type`, e as rotas de server.ts declaram que
 * devolvem isto. Campo renomeado num lado vira erro de tipo nos outros. Valores em centavos; saída negativa.
 * Horário gravado pelo app: local, "AAAA-MM-DD HH:MM:SS" (às vezes com ".mmm"); só `atualizado_pluggy` (do banco) vem em UTC, com Z.
 * Só tipos, e só de arquivos sem base: a tela confere este arquivo com o tsc dela, que não conhece node:sqlite.
 * ponytail: linha que vem do SQL entra por cast, e o tsc não confere o SELECT contra estes tipos; um SELECT renomeado ainda passa calado.
 */
import type { GRUPOS } from "./grupos.js";
import type { Nivel } from "./ritmo.js";

export type { Recorrente } from "./recorrentes.js";
export type { Nivel };

export type Grupo = (typeof GRUPOS)[number];
export type Pessoa = "PF" | "PJ";
export type Sentido = "saida" | "entrada";
export type Ok = { ok: true };

export interface Categoria {
  id: number;
  nome: string;
  grupo: Grupo;
  cor: string | null;
}

/** tipo = como entra no resumo; usos = lançamentos + regras + orçamentos; fixa = o código acha pelo nome, não dá para apagar, renomear nem mudar de grupo. */
export type CategoriaComUsos = Categoria & { tipo: "gasto" | "renda" | "transferencia"; lancamentos: number; regras: number; orcamentos: number; usos: number; fixa: boolean };

export interface Lancamento {
  id: string;
  conta_id: string;
  data: string;
  descricao: string;
  descricao_original: string;
  valor_centavos: number;
  tipo: string | null; // DEBIT | CREDIT, como a Pluggy mandou
  status: string | null;
  categoria_id: number | null;
  categoria: string | null;
  categoria_cor: string | null;
  categoria_grupo: Grupo | null;
  categoria_manual: boolean;
  categoria_pluggy: string | null;
  comerciante: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  notas: string | null;
  tags: string[];
  ignorado: boolean;
  soma: boolean; // falso = ignorado ou removido pelo banco: fora de todos os totais
  estorno: boolean; // crédito em cartão que não é pagamento de fatura nem transferência
  conta: string;
  conta_tipo: "BANK" | "CREDIT";
  pessoa: Pessoa;
}

/** Rodapé de Lançamentos: a regra do Resumo sobre a lista inteira. Gastos positivos, já com estornos abatidos; fora = transferências. */
export interface TotaisLancamentos {
  entradas: number;
  gastos: number;
  fora_entrou: number;
  fora_saiu: number;
}

/** A linha da tabela `contas`. `numero` não sai no MCP. */
export interface ContaLinha {
  id: string;
  item_id: string;
  tipo: "BANK" | "CREDIT";
  subtipo: string | null;
  nome: string | null;
  apelido: string | null;
  numero: string | null;
  instituicao: string | null;
  saldo_centavos: number | null;
  moeda: string | null;
  limite_centavos: number | null;
  limite_disponivel_centavos: number | null;
  fechamento: string | null;
  vencimento: string | null;
  pessoa: Pessoa;
  oculta: number;
  atualizado_em: string | null; // quando o saldo foi lido
  usa_reservas: 0 | 1 | null; // resposta de "usa cofrinho ou caixinha aqui?"; nulo = ainda não respondeu
}

/** O que o banco não mandou de um cartão. É aviso: não soma em nada. */
export interface Faltas {
  nao_apareceu: number | null; // teto do gasto que o limite já conta e os lançamentos não; nulo = saldo velho, não dá para saber
  faturas: { de: string; ate: string; qtd: number; diferenca: number }[]; // vencimentos seguidos com a mesma diferença; positiva = falta lançamento
  sem_fatura: { data: string; valor: number }[]; // pagamento cuja fatura não veio
}

export interface Conta extends ContaLinha {
  conector: string | null;
  imagem_url: string | null;
  ultimo_sync: string | null;
  faltas: Faltas | null; // só cartão
}

/** `bruto` (o que o banco mandou) não sai no MCP. */
export interface Investimento {
  id: string;
  item_id: string;
  nome: string | null;
  tipo: string | null; // RESERVA = cofrinho ou caixinha de uma conta
  subtipo: string | null;
  saldo_centavos: number | null;
  atualizado_em: string | null;
  bruto: string | null;
  conta_id: string | null; // só reserva
  conta: string | null;
  oculta: number;
  pessoa: Pessoa;
  ativo: number; // soma hoje: não resgatado; na reserva, a conta usa cofrinho
  conector: string | null;
}

export interface Contas {
  contas: Conta[];
  investimentos: Investimento[];
}

export interface Conexao {
  item_id: string;
  conector: string | null;
  conector_id: number | null;
  imagem_url: string | null;
  banco: string | null; // código COMPE; nulo = ainda não se sabe
  status: string | null;
  status_execucao: string | null;
  atualizado_pluggy: string | null; // até quando vão os dados que o banco entregou (ultimo_sync = quando nós lemos)
  ultimo_sync: string | null;
  erro: string | null;
  criado_em: string;
  contas: number;
  nomes_contas: string | null;
}

export interface ResultadoSync {
  item_id: string;
  conector: string | null;
  contas: number;
  novos: number;
  atualizados: number;
  investimentos: number;
  erro?: string;
}

export interface GastoCategoria {
  categoria_id: number | null;
  categoria: string;
  cor: string | null;
  grupo: Grupo | null;
  total: number;
  qtd: number;
}

export interface Resumo {
  mes: string;
  pessoa: Pessoa;
  entradas: number;
  saidas: number;
  pendentes: number;
  porCategoria: GastoCategoria[];
}

export interface Bem {
  id: number;
  nome: string;
  valor_centavos: number;
}

export interface Patrimonio {
  pessoa: Pessoa;
  contas: number;
  investimentos: number;
  bens: number;
  dividas: number;
  total: number;
  historico: { data: string; total: number }[];
  lista_bens: Bem[];
}

export interface LinhaOrcamento {
  categoria_id: number;
  categoria: string;
  cor: string | null;
  grupo: Grupo;
  planejado: number | null;
  realizado: number;
}
export interface LinhaRenda {
  categoria_id: number;
  categoria: string;
  cor: string | null;
  planejado: number | null; // renda esperada digitada
  sugerido: number | null; // mediana dos 3 últimos meses fechados
  recebido: number;
}
export interface Orcamento {
  mes: string;
  planejado: number; // total, sem a renda
  gasto: number; // total, igual às saídas do Resumo
  linhas: LinhaOrcamento[]; // em categoria de renda (só aparece se teve saída), planejado é sempre nulo
  sem_categoria: number;
  renda: LinhaRenda[];
  renda_esperada: number | null;
  renda_origem: "definida" | "mediana";
  metas: number; // o que as metas pedem no mês
  entradas_sem_categoria: number;
}

/** A renda aguenta o mês? Só PF. nivel nulo = sem contra o que comparar, mês futuro ou mês com renda incompleta. */
export interface Ritmo {
  mes: string;
  situacao: "aberto" | "fechado" | "futuro";
  hoje: string;
  dados_ate: string; // último dia com dado de todos os bancos: a projeção não conta os dias depois dele
  inicio: string | null; // primeiro mês da análise
  inicio_antes: string | null; // o mês inicial automático mudou na virada do mês: era este
  analisado: boolean; // falso = antes do primeiro mês com a renda completa
  renda: { esperada: number | null; origem: "definida" | "mediana"; recebida: number; extra: number };
  orcado: number;
  gasto: number;
  sobra: number;
  metas: number; // o que elas pedem no mês
  teto: number | null; // renda esperada menos as metas; sem renda, o orçado
  projecao: { min: number; max: number; media: number } | null;
  nao_apareceu: { conta_id: string; conta: string | null; valor: number }[]; // só no mês aberto: teto por cartão, fora de gasto
  parcelas_previstas: number; // só em mês futuro; fora de gasto
  nivel: Nivel | null;
  falta_metas: number; // quanto falta para sobrar isso (mês aberto: pela projeção)
  por_dia: { valor: number; no_ritmo: number | null; livre: number; dias: number; recorrentes: number } | null; // no_ritmo = o que a projeção supõe
  acumulado: { de: string; ate: string; meses: number; entradas: number; gasto: number; sobra: number } | null;
  acima: { categoria_id: number; categoria: string; cor: string | null; gasto: number; normal: number; acima: number }[];
  canceladas_cobradas: { descricao: string; data: string; valor: number }[]; // só no mês aberto
}

/** Página Análises: só PF, mesmos totais do Resumo. Nulo = não há o que comparar. */
export interface Analises {
  mes: string;
  mes_atual: string;
  inicio: string | null;
  inicio_automatico: string | null;
  inicio_definido: boolean;
  inicio_antes: string | null; // o automático mudou na virada do mês: era este
  orcado_hoje: number | null;
  meses: { mes: string; aberto: boolean; entradas: number; gasto: number; orcado: number | null; metas: number | null; sobra: number; acumulado: number | null }[];
  dia_a_dia: { dados_ate: string; dias: number[]; anterior: number[] | null; mes_anterior: string; ja_lancado: number; orcado: number | null; esperada: number | null; metas: number };
  categorias: { categoria_id: number; categoria: string; cor: string | null; grupo: Grupo; gasto: number; normal: number | null; mes_passado: number | null; orcado: number | null }[];
  comprometido: { mes: string; parcelas: number; previstas: number; recorrentes: number; esperada: number | null }[];
}

/**
 * Contas do mês (só PF): uma linha por compromisso que sai da conta, no mês em que sai. Lente de caixa: não soma em total nenhum, e a fatura já
 * contém as compras do cartão. atrasada = venceu e os dados do banco já cobrem o dia; nao_paga = não foi paga e o saldo foi para a fatura seguinte.
 */
interface CompromissoBase {
  nome: string;
  dia: string; // quando sai: a cobrança, o dia esperado ou o vencimento
  valor: number; // o esperado; paga: o real (na fatura, o total do banco)
  pago: number; // quanto já saiu para ela; numa fatura, menos que o valor sem estar paga = parcial
  pago_em: string | null; // o último pagamento
  situacao: "paga" | "a_pagar" | "atrasada" | "nao_paga";
}
export interface CompromissoRecorrente extends CompromissoBase {
  tipo: "recorrente";
  conta: string | null; // de onde sai
  categoria: string | null;
  cor: string | null;
  chave: string; // com valor_chave, a decisão de Recorrentes (Confirmar / Ignorar)
  valor_chave: number;
  sugestao: boolean;
  parada: boolean; // confirmada que parou de cobrar: atrasada no mês atual, até o Paulo marcar Cancelei
}
export interface CompromissoFatura extends CompromissoBase {
  tipo: "fatura";
  conta_id: string;
  fechamento: string;
  estimada: boolean; // sem o total do banco: o maior entre a média das 3 últimas e o já comprometido
  sem_fatura: boolean; // o banco não mandou o total (não fechou, ou não veio): paga = pelo valor pago
  foi_para: string | null; // nao_paga: o mês da fatura que levou o saldo
  comprometido: number; // o que já está nela: lançamentos do ciclo + parcelas previstas + recorrentes do cartão que ainda vêm
  recorrentes: { nome: string; valor: number; prevista: boolean }[];
  parcelas: { descricao: string; parcela: number; total: number; valor: number; prevista: boolean }[];
  outras: { valor: number; qtd: number }; // o resto das compras do ciclo, com créditos abatidos
}
export type Compromisso = CompromissoRecorrente | CompromissoFatura;
export interface Compromissos {
  mes: string;
  dados_ate: string; // último dia com dado de todos os bancos: atrasada é o que venceu antes dele
  renda: { esperada: number | null; entrou: number }; // esperada = a régua do alarme
  total: number;
  pago: number;
  falta: number;
  metas: number; // o que as metas pedem no mês
  livre: number | null; // renda esperada − contas − metas: não é o guardado do Resumo nem a sobra do Orçamento; nulo sem renda esperada
  linhas: Compromisso[]; // pelo dia; as pagas (e as que foram para a fatura seguinte) no fim
}

/** O que pode medir uma meta, com dívida negativa. `serve` = que tipo de meta pode medir: bem zerado (quitado) e cartão sem dívida, nenhum. */
export interface Posicao {
  origem: "conta" | "investimento" | "bem";
  ref_id: string;
  nome: string | null;
  conta: string | null; // só cofrinho
  sinal: 1 | -1;
  valor: number;
  serve: "juntar" | "quitar" | null;
}

/** A linha da tabela `metas`, com o que ela pede no mês. */
export interface MetaLinha {
  id: number;
  nome: string;
  tipo: "guardar" | "juntar" | "quitar";
  alvo: number | null; // juntar = quanto; quitar = quanto a dívida era
  prazo: string | null;
  por_mes: number | null; // o que pede no mês escolhido; nulo = ainda não pedia nada
  origem: Posicao["origem"] | null;
  ref_id: string | null;
  encerrada_em: string | null;
}
/** Só PF. Progresso nulo = nada ligado, ou a posição saiu do patrimônio. */
export interface Meta extends MetaLinha {
  medida: { nome: string | null; conta: string | null; valor: number } | null;
  falta: number | null;
  feito: number | null; // quitar: negativo = a dívida cresceu
  chega: string | null; // com o por_mes digitado
  precisa: number | null; // por mês, para chegar no prazo
  andou: { dias: number; por_mes: number; chega: string | null } | null; // de verdade, pelas fotos do saldo
}
export interface Metas {
  mes: string;
  total: number;
  metas: Meta[];
  posicoes: Posicao[]; // só as que servem para alguma meta
}

/** A linha da tabela `regras`. sentido nulo = entrada e saída; conta nula = todas. */
export interface RegraLinha {
  id: number;
  padrao: string;
  sentido: Sentido | null;
  conta_id: string | null;
  categoria_id: number;
  descricao: string | null;
  prioridade: number;
  criado_em: string;
}
export interface Regra extends RegraLinha {
  categoria: string;
  conta: string | null;
  usos: number;
}

/** O que uma regra mudaria (`total`); nos exemplos, o que já tem categoria vem primeiro. `parecidos` = os que têm o texto, mudem ou não. */
export interface PreviaRegra {
  parecidos: number;
  total: number;
  pendentes: number;
  descricoes: number;
  exemplos: { descricao: string | null; categoria: string | null; vai_para?: string | null; qtd: number }[]; // vai_para: não vai para a da regra
}

/** Respostas que a tela e o MCP leem iguais. A lista para em 2000; `total` é o de verdade. */
export interface ListaLancamentos {
  itens: Lancamento[];
  total: number;
}
/** `tambem_mudaram` = os outros que a edição mudou (as pernas de um Pix no crédito). */
export type LancamentoEditado = Lancamento & { tambem_mudaram: Lancamento[] };
export interface RegraCriada {
  regra: RegraLinha;
  recategorizados: number;
}
export interface Sincronizacao {
  resultados: ResultadoSync[];
}
