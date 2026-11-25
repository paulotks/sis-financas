import { credenciaisPluggy, env } from "./env.js";

/** Cliente mínimo da API Pluggy. As credenciais ficam só aqui no servidor. */

let cache: { apiKey: string; expiraEm: number } | null = null;

export class ErroPluggy extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown, comChave = true): Promise<T> {
  const url = caminho.startsWith("http") ? caminho : env.pluggyUrl + caminho;
  // a paginação pode devolver URL completa: a chave só pode ir para a própria Pluggy
  if (new URL(url).origin !== new URL(env.pluggyUrl).origin) throw new Error("URL fora da Pluggy recusada");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (comChave) headers["X-API-KEY"] = await apiKey();
  const r = await fetch(url, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000), // sem isto, uma chamada travada prenderia a fila de sincronização
  });
  if (!r.ok) {
    let msg = "";
    try {
      msg = ((await r.json()) as { message?: string }).message ?? "";
    } catch {}
    if (comChave && (r.status === 401 || r.status === 403)) cache = null; // chave expirou antes do previsto
    throw new ErroPluggy(r.status, `Pluggy ${metodo} ${new URL(url).pathname}: HTTP ${r.status}${msg ? " — " + msg : ""}`);
  }
  return (await r.json()) as T;
}

/** API key do servidor: vale 2 h, renovada com 10 min de folga. */
async function apiKey(): Promise<string> {
  if (cache && Date.now() < cache.expiraEm) return cache.apiKey;
  const { clientId, clientSecret } = credenciaisPluggy();
  const r = await requisitar<{ apiKey: string }>("POST", "/auth", { clientId, clientSecret }, false);
  cache = { apiKey: r.apiKey, expiraEm: Date.now() + 110 * 60_000 };
  return r.apiKey;
}

// ---- tipos (só os campos usados) ----
export interface PItem {
  id: string;
  status?: string;
  executionStatus?: string;
  statusDetail?: Partial<Record<"transactions" | "creditCards", { isUpdated?: boolean } | null>> | null;
  lastUpdatedAt?: string | null;
  connector?: { id: number; name: string; imageUrl?: string };
}
export interface PConta {
  id: string;
  type: "BANK" | "CREDIT" | string;
  subtype?: string;
  name?: string;
  marketingName?: string | null;
  number?: string;
  balance?: number | null;
  currencyCode?: string;
  owner?: string | null;
  bankData?: { transferNumber?: string | null } | null;
  creditData?: {
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
  } | null;
}
export interface PTransacao {
  id: string;
  accountId: string;
  date: string;
  description: string;
  descriptionRaw?: string | null;
  amount?: number | null;
  amountInAccountCurrency?: number | null;
  type: string; // DEBIT | CREDIT; a resposta não é validada, então outro valor pode chegar
  status?: string;
  category?: string | null;
  merchant?: { name?: string | null; businessName?: string | null } | null;
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; billId?: string | null } | null;
}
export interface PFatura {
  id: string;
  dueDate: string;
  totalAmount?: number | null;
  minimumPaymentAmount?: number | null;
}
export interface PInvestimento {
  id: string;
  name?: string;
  type?: string;
  subtype?: string;
  balance?: number | null;
  amount?: number | null;
}

/** Lê todas as páginas de uma lista (contas, faturas, investimentos). Transações usam cursor, abaixo. */
async function todas<T>(caminho: string): Promise<T[]> {
  const itens: T[] = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const r = await requisitar<{ results: T[]; totalPages?: number }>("GET", `${caminho}&page=${pagina}`);
    itens.push(...r.results);
    total = r.totalPages ?? 1;
  }
  return itens;
}

export const pluggy = {
  /** Connect Token para abrir o widget no navegador (vale 30 min). itemId: reconectar/atualizar um item. */
  async connectToken(clientUserId: string, itemId?: string) {
    // Sem avoidDuplicates: no MeuPluggy todos os bancos usam o mesmo conector (200) e a mesma conta Meu Pluggy,
    // então a Pluggy trataria o 2º banco como "credencial duplicada" e recusaria. O dedupe fica na nossa base (item_id).
    const corpo: Record<string, unknown> = { options: { clientUserId } };
    if (itemId) corpo.itemId = itemId;
    return (await requisitar<{ accessToken: string }>("POST", "/connect_token", corpo)).accessToken;
  },
  item: (id: string) => requisitar<PItem>("GET", `/items/${encodeURIComponent(id)}`),
  contas: (itemId: string) => todas<PConta>(`/accounts?itemId=${encodeURIComponent(itemId)}`),
  faturas: (contaId: string) => todas<PFatura>(`/bills?accountId=${encodeURIComponent(contaId)}`),
  investimentos: (itemId: string) => todas<PInvestimento>(`/investments?itemId=${encodeURIComponent(itemId)}`),

  /** Transações de uma conta via GET /v2/transactions (paginação por cursor, páginas de 500). */
  async *transacoes(contaId: string, desde: string) {
    let proxima: string | null =
      `/v2/transactions?accountId=${encodeURIComponent(contaId)}&dateFrom=${encodeURIComponent(desde)}`;
    while (proxima) {
      const pagina: { results: PTransacao[]; next?: string | null } = await requisitar("GET", proxima);
      yield pagina.results;
      // `next` já é a query string pronta ("?accountId=...&after=..."); new URL também aceita URL completa
      proxima = pagina.next ? new URL(pagina.next, env.pluggyUrl + "/v2/transactions").href : null;
    }
  },
};
