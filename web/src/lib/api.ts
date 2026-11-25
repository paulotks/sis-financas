// Tipos e chamadas da API local. Valores sempre em centavos (saída negativa).

export interface Categoria {
  id: number;
  nome: string;
  grupo: "essencial" | "estilo_de_vida" | "financeiro" | "renda" | "transferencia";
  cor: string | null;
}

/** usos = lançamentos + regras + orçamentos; fixa = o código acha pelo nome, não dá para apagar, renomear nem mudar de grupo. */
export type CategoriaComUsos = Categoria & { lancamentos: number; regras: number; orcamentos: number; usos: number; fixa: boolean };

export interface Lancamento {
  id: string;
  conta_id: string;
  data: string;
  descricao: string;
  descricao_original: string;
  valor_centavos: number;
  status: string | null;
  categoria_id: number | null;
  categoria: string | null;
  categoria_cor: string | null;
  categoria_grupo: Categoria["grupo"] | null;
  categoria_manual: boolean;
  categoria_pluggy: string | null;
  comerciante: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  notas: string | null;
  tags: string[];
  ignorado: boolean;
  conta: string;
  conta_tipo: "BANK" | "CREDIT";
  pessoa: "PF" | "PJ";
}

export interface Conta {
  id: string;
  item_id: string;
  tipo: "BANK" | "CREDIT";
  subtipo: string | null;
  nome: string | null;
  apelido: string | null;
  numero: string | null;
  saldo_centavos: number | null;
  limite_centavos: number | null;
  limite_disponivel_centavos: number | null;
  vencimento: string | null;
  pessoa: "PF" | "PJ";
  oculta: number;
  usa_reservas: 0 | 1 | null; // resposta de "usa cofrinho ou caixinha aqui?"; nulo = ainda não respondeu
  conector: string | null;
  imagem_url: string | null;
  ultimo_sync: string | null;
  faltas: Faltas | null; // só cartão
}

/** O que o banco não mandou de um cartão. É aviso: não soma em nada. */
export interface Faltas {
  nao_apareceu: number | null; // teto do gasto que o limite já conta e os lançamentos não; nulo = saldo velho, não dá para saber
  faturas: { de: string; ate: string; qtd: number; diferenca: number }[]; // vencimentos seguidos com a mesma diferença; positiva = falta lançamento
  sem_fatura: { data: string; valor: number }[]; // pagamento cuja fatura não veio
}

/** Contas e cartões separados, sem grupo vazio. */
export const porTipo = (cs: Conta[]) =>
  ([["Contas", cs.filter((c) => c.tipo !== "CREDIT")], ["Cartões de crédito", cs.filter((c) => c.tipo === "CREDIT")]] as const).filter(([, l]) => l.length);

export interface Investimento {
  id: string;
  nome: string | null;
  tipo: string | null; // RESERVA = cofrinho ou caixinha de uma conta
  saldo_centavos: number | null;
  conector: string | null;
  conta_id: string | null; // só reserva
  conta: string | null;
  oculta: number;
}

export interface Conexao {
  item_id: string;
  conector: string | null;
  imagem_url: string | null;
  status: string | null;
  status_execucao: string | null;
  atualizado_pluggy: string | null; // até quando vão os dados que o banco entregou (ultimo_sync = quando nós lemos)
  ultimo_sync: string | null;
  erro: string | null;
  contas: number;
  nomes_contas: string | null;
}

export interface ResultadoSync {
  item_id: string;
  conector: string | null;
  contas: number;
  novos: number;
  atualizados: number;
  erro?: string;
}

export interface Resumo {
  mes: string;
  entradas: number;
  saidas: number;
  pendentes: number;
  porCategoria: { categoria_id: number | null; categoria: string; cor: string | null; total: number; qtd: number }[];
}

export interface Recorrente {
  chave: string; // com valor_chave, diz qual é a cobrança
  valor_chave: number;
  descricao: string;
  antes: string | null; // nome anterior, se o lojista trocou
  categoria: string | null;
  cor: string | null;
  conta: string | null;
  valor: number; // positivo: o da última cobrança
  vezes: number;
  ultima: string;
  proxima: string;
  situacao: "prevista" | "atrasada" | "parada";
  status: "confirmada" | "ignorada" | "cancelada" | null;
  proposta: "confirmada" | "ignorada" | "cancelada" | "sugerida" | null; // do Claude, esperando aceitar
  cobrou_depois: { data: string; valor: number } | null; // cancelada que voltou a cobrar
}

export interface Bem {
  id: number;
  nome: string;
  valor_centavos: number;
}
export interface Patrimonio {
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
  grupo: Categoria["grupo"];
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
  linhas: LinhaOrcamento[]; // em categoria de renda (só aparece se teve saída), planejado é sempre nulo
  sem_categoria: number;
  renda: LinhaRenda[];
  renda_esperada: number | null;
  renda_origem: "definida" | "mediana";
  entradas_sem_categoria: number;
}

/** A renda aguenta o mês? Só PF. nivel nulo = sem contra o que comparar, mês futuro ou mês com renda incompleta. */
export interface Ritmo {
  mes: string;
  situacao: "aberto" | "fechado" | "futuro";
  hoje: string;
  dados_ate: string; // último dia com dado de todos os bancos: a projeção não conta os dias depois dele
  inicio_antes: string | null; // o mês inicial automático mudou na virada do mês: era este
  analisado: boolean; // falso = antes do primeiro mês com a renda completa
  renda: { esperada: number | null; origem: "definida" | "mediana"; recebida: number; extra: number };
  orcado: number;
  gasto: number;
  nao_apareceu: { conta_id: string; conta: string | null; valor: number }[]; // só no mês aberto: teto por cartão, fora de gasto
  parcelas_previstas: number; // só em mês futuro; fora de gasto
  sobra: number;
  teto: number | null;
  projecao: { min: number; max: number; media: number } | null;
  nivel: "verde" | "amarelo" | "vermelho" | null;
  por_dia: { valor: number; no_ritmo: number | null; livre: number; dias: number; recorrentes: number } | null; // no_ritmo = o que a projeção supõe
  acumulado: { de: string; ate: string; meses: number; entradas: number; gasto: number; sobra: number } | null;
  acima: { categoria_id: number; categoria: string; cor: string | null; gasto: number; normal: number; acima: number }[];
  canceladas_cobradas: { descricao: string; data: string; valor: number }[]; // só no mês aberto
}

/** O que uma regra mudaria (`total`); nos exemplos, o que já tem categoria vem primeiro. `parecidos` = os que têm o texto, mudem ou não. */
export interface PreviaRegra {
  parecidos: number;
  total: number;
  pendentes: number;
  descricoes: number;
  exemplos: { descricao: string | null; categoria: string | null; vai_para?: string | null; qtd: number }[]; // vai_para: não vai para a da regra
}

export type Sentido = "saida" | "entrada";
export const SENTIDOS: Record<Sentido, string> = { saida: "só saída", entrada: "só entrada" };

/** sentido nulo = entrada e saída; conta nula = todas. */
export interface Regra {
  id: number;
  padrao: string;
  sentido: Sentido | null;
  conta_id: string | null;
  conta: string | null;
  categoria_id: number;
  categoria: string;
  descricao: string | null;
  usos: number;
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
  meses: { mes: string; aberto: boolean; entradas: number; gasto: number; orcado: number | null; sobra: number; acumulado: number | null }[];
  dia_a_dia: { dados_ate: string; dias: number[]; anterior: number[] | null; mes_anterior: string; ja_lancado: number; orcado: number | null; esperada: number | null };
  categorias: { categoria_id: number; categoria: string; cor: string | null; gasto: number; normal: number | null; mes_passado: number | null; orcado: number | null }[];
  comprometido: { mes: string; parcelas: number; previstas: number; recorrentes: number; esperada: number | null }[];
}

async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { erro?: string }).erro ?? `HTTP ${r.status}`);
  return d as T;
}

const qs = (p: Record<string, string | number | undefined | false>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== false && v !== "") s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : "";
};

export const api = {
  connectToken: (itemId?: string) => req<{ accessToken: string }>("POST", "/api/pluggy/connect-token", { itemId }),
  conexoes: () => req<Conexao[]>("GET", "/api/conexoes"),
  salvarConexao: (itemId: string) => req<ResultadoSync>("POST", "/api/conexoes", { itemId }),
  sincronizar: (itemId?: string) => req<{ resultados: ResultadoSync[] }>("POST", "/api/sync", { itemId }),

  contas: () => req<{ contas: Conta[]; investimentos: Investimento[] }>("GET", "/api/contas"),
  editarConta: (id: string, d: { apelido?: string | null; pessoa?: "PF" | "PJ"; oculta?: boolean; usa_reservas?: boolean }) =>
    req<Conta>("PATCH", `/api/contas/${id}`, d),

  meses: () => req<string[]>("GET", "/api/meses"),
  lancamentos: (f: { mes?: string; conta?: string; categoria?: number; busca?: string; pendentes?: boolean; estornos?: boolean; pessoa?: string }) =>
    req<{ itens: Lancamento[]; total: number }>(
      "GET",
      `/api/lancamentos${qs({ ...f, pendentes: f.pendentes ? "1" : undefined, estornos: f.estornos ? "1" : undefined })}`,
    ),
  editarLancamento: (
    id: string,
    d: { descricao?: string; categoria_id?: number | null; notas?: string | null; tags?: string[]; ignorado?: boolean },
  ) => req<Lancamento & { tambem_mudaram: Lancamento[] }>("PATCH", `/api/lancamentos/${encodeURIComponent(id)}`, d),

  comprasDoEstorno: (id: string) => req<Lancamento[]>("GET", `/api/lancamentos/${encodeURIComponent(id)}/compras`),

  resumo: (mes: string, pessoa = "PF") => req<Resumo>("GET", `/api/resumo${qs({ mes, pessoa })}`),

  recorrentes: (pessoa: string) => req<Recorrente[]>("GET", `/api/recorrentes${qs({ pessoa })}`),
  decidirRecorrente: (d: { chave: string; valor: number; status: Recorrente["status"] }) => req<{ ok: true }>("PUT", "/api/recorrentes", d),

  patrimonio: (pessoa: string) => req<Patrimonio>("GET", `/api/patrimonio${qs({ pessoa })}`),
  criarBem: (d: { nome: string; valor_centavos: number; pessoa: "PF" | "PJ" }) => req<Bem>("POST", "/api/bens", d),
  editarBem: (id: number, d: { nome?: string; valor_centavos?: number }) => req<Bem>("PATCH", `/api/bens/${id}`, d),
  apagarBem: (id: number) => req<{ ok: true }>("DELETE", `/api/bens/${id}`),

  ritmo: (mes: string) => req<Ritmo>("GET", `/api/ritmo${qs({ mes })}`),

  analises: (mes: string) => req<Analises>("GET", `/api/analises${qs({ mes })}`),
  definirInicio: (mes: string | null) => req<{ ok: true }>("PUT", "/api/analises/inicio", { mes }),

  orcamento: (mes: string) => req<Orcamento>("GET", `/api/orcamento${qs({ mes })}`),
  salvarOrcamento: (d: { mes: string; categoria_id: number; valor_centavos: number }) => req<{ ok: true }>("PUT", "/api/orcamento", d),

  categorias: () => req<CategoriaComUsos[]>("GET", "/api/categorias"),
  criarCategoria: (d: { nome: string; grupo: Categoria["grupo"]; cor?: string }) => req<Categoria>("POST", "/api/categorias", d),
  apagarCategoria: (id: number) => req<{ ok: true }>("DELETE", `/api/categorias/${id}`),
  mesclarCategoria: (id: number, destino: number) =>
    req<{ ok: true; lancamentos: number; regras: number }>("POST", `/api/categorias/${id}/mesclar`, { destino }),
  regras: () => req<Regra[]>("GET", "/api/regras"),
  previaRegra: (padrao: string, sentido: Sentido | null, categoria: number | null) =>
    req<PreviaRegra>("GET", `/api/regras/previa${qs({ padrao, sentido: sentido ?? undefined, categoria_id: categoria ?? undefined })}`),
  criarRegra: (d: { padrao: string; sentido: Sentido | null; categoria_id: number }) => req<{ regra: Regra; recategorizados: number }>("POST", "/api/regras", d),
  apagarRegra: (id: number) => req<{ ok: boolean; recategorizados: number }>("DELETE", `/api/regras/${id}`),
};

/** Texto inicial de uma regra: a descrição sem a parcela nem os números do fim. Precisa ser um trecho contínuo do original. */
export const sugerirPadrao = (original: string) => {
  const limpo = original.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, "").replace(/[\s\d*#.,:/|-]+$/, "").trim();
  return (limpo.length >= 3 ? limpo : original.trim()).slice(0, 120);
};

// ---- formatação ----
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const dinheiro = (centavos: number | null | undefined) => (centavos == null ? "—" : brl.format(centavos / 100));
const brlCurto = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
/** "R$ 1,2 mil": para estimativa, em que os centavos dariam uma precisão que não existe. */
export const dinheiroCurto = (centavos: number) => brlCurto.format(centavos / 100);
/** "1.234,56" -> 123456 centavos; vazio = 0; o que não for número = null. */
export const lerDinheiro = (texto: string): number | null => {
  const t = texto.replace(/[R$\s]/g, "");
  if (!t) return 0;
  const n = t.includes(",") || !/^-?\d+\.\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t; // "12.50" é decimal; "1.234" é milhar
  return /^-?\d*\.?\d+$/.test(n) ? Math.round(Number(n) * 100) : null;
};
export const dataCurta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}${a !== String(new Date().getFullYear()) ? "/" + a.slice(2) : ""}`;
};
export const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
/** O Meu Pluggy atualiza 1x por dia: passou de 48 h, o banco está atrasado. */
export const dadosVelhos = (iso: string | null) => iso !== null && Date.now() - Date.parse(iso) > 48 * 3_600_000;
export const nomeMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** "Novembro", sem o ano. */
export const nomeDoMes = (mes: string) => nomeMes(mes).split(" ")[0];
/** "nov/26" */
export const mesCurto = (mes: string) => `${nomeMes(mes).slice(0, 3).toLowerCase()}/${mes.slice(2, 4)}`;
/** Com o que o mês aberto se compara (o `teto`): sem renda conhecida, o orçado. */
export const limiteTexto = (r: Ritmo) => (r.renda.esperada === null ? "o orçado" : "a renda esperada");
/** O nível em palavras e símbolo, para não depender só da cor. */
export const nivelTexto = (r: Ritmo) => {
  if (!r.nivel) return null;
  const limite = r.orcado > 0 ? "orçado" : "renda";
  const fechado = r.situacao === "fechado";
  if (r.nivel === "verde") return { icone: "✓", texto: `${fechado ? "Coube" : "Dentro"} ${limite === "renda" ? (fechado ? "na renda" : "da renda") : (fechado ? "no orçado" : "do orçado")}` };
  if (r.nivel === "amarelo") return { icone: "!", texto: fechado ? "Passou do orçado" : "Passando do orçado" };
  return { icone: "▲", texto: fechado ? "Gastou mais do que entrou" : "Estourando a renda" };
};
export const somarMes = (mes: string, delta: number) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const hoje = () => new Date().toLocaleDateString("sv"); // "sv" = AAAA-MM-DD local; em UTC o dia virava às 21h
export const mesAtual = () => hoje().slice(0, 7);
/** Só as categorias da Pluggy que ficam pendentes (as outras viram categoria nossa no mapa). Nomes da documentação em português. */
const PLUGGY_PT: Record<string, string> = {
  "Transfer - PIX": "Transferência - PIX",
  "Transfer - Internal": "Transferência - Interna",
  "Transfer - Foreign Exchange": "Transferência - Câmbio",
  Transfers: "Transferências",
  Services: "Serviços",
  Insurance: "Seguro",
  "Entrepreneurial activities": "Atividades empreendedoras",
};
export const nomePluggy = (categoria: string) => PLUGGY_PT[categoria] ?? categoria;
export const GRUPOS: Record<Categoria["grupo"], string> = {
  essencial: "Essencial",
  estilo_de_vida: "Estilo de vida",
  financeiro: "Financeiro",
  renda: "Renda",
  transferencia: "Transferência (fora do resumo)",
};
