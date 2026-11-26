// Chamadas da API local. Valores sempre em centavos (saída negativa).
// O formato das respostas é o da própria API (api/src/tipos.ts): campo renomeado lá vira erro de tipo aqui.
import type { Analises, Bem, Categoria, CategoriaComUsos, Conexao, Conta, ContaLinha, Contas, Grupo, Lancamento, LancamentoEditado } from "../../../api/src/tipos";
import type { ListaLancamentos, Meta, Metas, Ok, Orcamento, Patrimonio, Posicao, PreviaRegra, Recorrente, Regra, RegraCriada } from "../../../api/src/tipos";
import type { ResultadoSync, Resumo, Ritmo, Sentido, Sincronizacao, TotaisLancamentos } from "../../../api/src/tipos";
export type * from "../../../api/src/tipos";

/** Contas e cartões separados, sem grupo vazio. */
export const porTipo = (cs: Conta[]) =>
  ([["Contas", cs.filter((c) => c.tipo !== "CREDIT")], ["Cartões de crédito", cs.filter((c) => c.tipo === "CREDIT")]] as const).filter(([, l]) => l.length);

export const SENTIDOS: Record<Sentido, string> = { saida: "só saída", entrada: "só entrada" };

export interface EdicaoMeta {
  nome?: string;
  alvo?: number;
  prazo?: string | null;
  por_mes?: number;
  mes?: string; // o por_mes vale deste mês em diante
  medida?: Pick<Posicao, "origem" | "ref_id"> | null;
}

export interface FiltroLancamentos {
  mes?: string;
  conta?: string;
  categoria?: number;
  busca?: string;
  pendentes?: boolean;
  estornos?: boolean;
  pessoa?: string;
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

const qsLancamentos = (f: FiltroLancamentos) => qs({ ...f, pendentes: f.pendentes ? "1" : undefined, estornos: f.estornos ? "1" : undefined });

export const api = {
  connectToken: (itemId?: string) => req<{ accessToken: string }>("POST", "/api/pluggy/connect-token", { itemId }),
  conexoes: () => req<Conexao[]>("GET", "/api/conexoes"),
  salvarConexao: (itemId: string) => req<ResultadoSync>("POST", "/api/conexoes", { itemId }),
  sincronizar: (itemId?: string) => req<Sincronizacao>("POST", "/api/sync", { itemId }),

  contas: () => req<Contas>("GET", "/api/contas"),
  editarConta: (id: string, d: { apelido?: string | null; pessoa?: "PF" | "PJ"; oculta?: boolean; usa_reservas?: boolean }) =>
    req<ContaLinha>("PATCH", `/api/contas/${id}`, d),

  meses: () => req<string[]>("GET", "/api/meses"),
  lancamentos: (f: FiltroLancamentos) => req<ListaLancamentos>("GET", `/api/lancamentos${qsLancamentos(f)}`),
  totaisLancamentos: (f: FiltroLancamentos) => req<TotaisLancamentos>("GET", `/api/lancamentos/totais${qsLancamentos(f)}`),
  editarLancamento: (
    id: string,
    d: { descricao?: string; categoria_id?: number | null; notas?: string | null; tags?: string[]; ignorado?: boolean },
  ) => req<LancamentoEditado>("PATCH", `/api/lancamentos/${encodeURIComponent(id)}`, d),

  comprasDoEstorno: (id: string) => req<Lancamento[]>("GET", `/api/lancamentos/${encodeURIComponent(id)}/compras`),

  resumo: (mes: string, pessoa = "PF") => req<Resumo>("GET", `/api/resumo${qs({ mes, pessoa })}`),

  recorrentes: (pessoa: string) => req<Recorrente[]>("GET", `/api/recorrentes${qs({ pessoa })}`),
  decidirRecorrente: (d: { chave: string; valor: number; status: Recorrente["status"] }) => req<Ok>("PUT", "/api/recorrentes", d),

  patrimonio: (pessoa: string) => req<Patrimonio>("GET", `/api/patrimonio${qs({ pessoa })}`),
  criarBem: (d: { nome: string; valor_centavos: number; pessoa: "PF" | "PJ" }) => req<Bem>("POST", "/api/bens", d),
  editarBem: (id: number, d: { nome?: string; valor_centavos?: number }) => req<Bem>("PATCH", `/api/bens/${id}`, d),
  apagarBem: (id: number) => req<Ok>("DELETE", `/api/bens/${id}`),

  metas: (mes: string) => req<Metas>("GET", `/api/metas${qs({ mes })}`),
  criarMeta: (d: EdicaoMeta & { nome: string; tipo: Meta["tipo"] }) => req<Meta>("POST", "/api/metas", d),
  editarMeta: (id: number, d: EdicaoMeta & { encerrada?: boolean }) => req<Meta>("PATCH", `/api/metas/${id}`, d),
  apagarMeta: (id: number) => req<Ok>("DELETE", `/api/metas/${id}`),

  ritmo: (mes: string) => req<Ritmo>("GET", `/api/ritmo${qs({ mes })}`),

  analises: (mes: string) => req<Analises>("GET", `/api/analises${qs({ mes })}`),
  definirInicio: (mes: string | null) => req<Ok>("PUT", "/api/analises/inicio", { mes }),

  orcamento: (mes: string) => req<Orcamento>("GET", `/api/orcamento${qs({ mes })}`),
  salvarOrcamento: (d: { mes: string; categoria_id: number; valor_centavos: number }) => req<Ok>("PUT", "/api/orcamento", d),

  categorias: () => req<CategoriaComUsos[]>("GET", "/api/categorias"),
  criarCategoria: (d: { nome: string; grupo: Categoria["grupo"]; cor?: string }) => req<Categoria>("POST", "/api/categorias", d),
  apagarCategoria: (id: number) => req<Ok>("DELETE", `/api/categorias/${id}`),
  mesclarCategoria: (id: number, destino: number) =>
    req<Ok & { lancamentos: number; regras: number }>("POST", `/api/categorias/${id}/mesclar`, { destino }),
  regras: () => req<Regra[]>("GET", "/api/regras"),
  previaRegra: (padrao: string, sentido: Sentido | null, categoria: number | null) =>
    req<PreviaRegra>("GET", `/api/regras/previa${qs({ padrao, sentido: sentido ?? undefined, categoria_id: categoria ?? undefined })}`),
  criarRegra: (d: { padrao: string; sentido: Sentido | null; categoria_id: number }) => req<RegraCriada>("POST", "/api/regras", d),
  apagarRegra: (id: number) => req<Ok & { recategorizados: number }>("DELETE", `/api/regras/${id}`),
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
export const limiteTexto = (r: Ritmo) => (r.renda.esperada === null ? "o orçado" : r.metas > 0 ? "a renda menos as metas" : "a renda esperada");
/** O nível em palavras e símbolo, para não depender só da cor. */
export const nivelTexto = (r: Ritmo) => {
  if (!r.nivel) return null;
  const limite = r.orcado > 0 ? "orçado" : "renda";
  const fechado = r.situacao === "fechado";
  if (r.nivel === "verde") return { icone: "✓", texto: `${fechado ? "Coube" : "Dentro"} ${limite === "renda" ? (fechado ? "na renda" : "da renda") : (fechado ? "no orçado" : "do orçado")}` };
  if (r.nivel === "amarelo" && r.falta_metas > 0) return { icone: "!", texto: fechado ? "Não sobrou para as metas" : "Não sobra para as metas" };
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
export const GRUPOS: Record<Grupo, string> = {
  essencial: "Essencial",
  estilo_de_vida: "Estilo de vida",
  financeiro: "Financeiro",
  renda: "Renda",
  transferencia: "Transferência (fora do resumo)",
};
