// Tipos e chamadas da API local. Valores sempre em centavos (saída negativa).

export interface Categoria {
  id: number;
  nome: string;
  grupo: "essencial" | "estilo_de_vida" | "financeiro" | "renda" | "transferencia";
  cor: string | null;
}

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
  conector: string | null;
  imagem_url: string | null;
  ultimo_sync: string | null;
}

export interface Investimento {
  id: string;
  nome: string | null;
  tipo: string | null;
  saldo_centavos: number | null;
  conector: string | null;
}

export interface Conexao {
  item_id: string;
  conector: string | null;
  imagem_url: string | null;
  status: string | null;
  status_execucao: string | null;
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
  saldos: { contas: number; cartoes: number };
}

export interface Regra {
  id: number;
  padrao: string;
  categoria_id: number;
  categoria: string;
  descricao: string | null;
  usos: number;
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
  editarConta: (id: string, d: { apelido?: string | null; pessoa?: "PF" | "PJ"; oculta?: boolean }) =>
    req<Conta>("PATCH", `/api/contas/${id}`, d),

  meses: () => req<string[]>("GET", "/api/meses"),
  lancamentos: (f: { mes?: string; conta?: string; categoria?: number; busca?: string; pendentes?: boolean; pessoa?: string }) =>
    req<{ itens: Lancamento[]; total: number }>(
      "GET",
      `/api/lancamentos${qs({ ...f, pendentes: f.pendentes ? "1" : undefined })}`,
    ),
  editarLancamento: (
    id: string,
    d: { descricao?: string; categoria_id?: number | null; notas?: string | null; tags?: string[]; ignorado?: boolean },
  ) => req<Lancamento>("PATCH", `/api/lancamentos/${encodeURIComponent(id)}`, d),

  resumo: (mes: string, pessoa = "PF") => req<Resumo>("GET", `/api/resumo${qs({ mes, pessoa })}`),

  categorias: () => req<Categoria[]>("GET", "/api/categorias"),
  criarCategoria: (d: { nome: string; grupo: Categoria["grupo"]; cor?: string }) => req<Categoria>("POST", "/api/categorias", d),
  regras: () => req<Regra[]>("GET", "/api/regras"),
  previaRegra: (padrao: string) => req<{ total: number; pendentes: number }>("GET", `/api/regras/previa${qs({ padrao })}`),
  criarRegra: (d: { padrao: string; categoria_id: number }) => req<{ regra: Regra; recategorizados: number }>("POST", "/api/regras", d),
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
export const dataCurta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}${a !== String(new Date().getFullYear()) ? "/" + a.slice(2) : ""}`;
};
export const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
export const nomeMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const somarMes = (mes: string, delta: number) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const mesAtual = () => new Date().toLocaleDateString("sv").slice(0, 7); // "sv" = AAAA-MM-DD local; em UTC o mês virava às 21h
export const GRUPOS: Record<Categoria["grupo"], string> = {
  essencial: "Essencial",
  estilo_de_vida: "Estilo de vida",
  financeiro: "Financeiro",
  renda: "Renda",
  transferencia: "Transferência (fora do resumo)",
};
