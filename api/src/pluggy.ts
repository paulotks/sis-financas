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
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (comChave) headers["X-API-KEY"] = await apiKey();
  const r = await fetch(url, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
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
  balance?: number;
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
  amount: number;
  amountInAccountCurrency?: number | null;
  type: "DEBIT" | "CREDIT";
  status?: string;
  category?: string | null;
  merchant?: { name?: string | null; businessName?: string | null } | null;
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; billId?: string | null } | null;
}
export interface PFatura {
  id: string;
  dueDate: string;
  totalAmount: number;
  minimumPaymentAmount?: number | null;
}
export interface PInvestimento {
  id: string;
  name?: string;
  type?: string;
  subtype?: string;
  balance?: number;
  amount?: number;
}

type Lista<T> = { results: T[] };

export const pluggy = {
  /** Connect Token para abrir o widget no navegador (vale 30 min). itemId: reconectar/atualizar um item. */
  async connectToken(clientUserId: string, itemId?: string) {
    const corpo: Record<string, unknown> = { options: { clientUserId, avoidDuplicates: true } };
    if (itemId) corpo.itemId = itemId;
    return (await requisitar<{ accessToken: string }>("POST", "/connect_token", corpo)).accessToken;
  },
  item: (id: string) => requisitar<PItem>("GET", `/items/${encodeURIComponent(id)}`),
  contas: async (itemId: string) =>
    (await requisitar<Lista<PConta>>("GET", `/accounts?itemId=${encodeURIComponent(itemId)}`)).results,
  faturas: async (contaId: string) =>
    (await requisitar<Lista<PFatura>>("GET", `/bills?accountId=${encodeURIComponent(contaId)}`)).results,
  investimentos: async (itemId: string) =>
    (await requisitar<Lista<PInvestimento>>("GET", `/investments?itemId=${encodeURIComponent(itemId)}`)).results,

  /** Transações de uma conta via GET /v2/transactions (paginação por cursor, páginas de 500). */
  async *transacoes(contaId: string, desde: string) {
    let proxima: string | null =
      `/v2/transactions?accountId=${encodeURIComponent(contaId)}&dateFrom=${encodeURIComponent(desde)}`;
    while (proxima) {
      const pagina: { results: PTransacao[]; next?: string | null } = await requisitar("GET", proxima);
      yield pagina.results;
      const n: string | null | undefined = pagina.next;
      if (!n) proxima = null;
      else if (n.startsWith("http")) proxima = n;
      else
        proxima = `/v2/transactions?accountId=${encodeURIComponent(contaId)}&dateFrom=${encodeURIComponent(desde)}&after=${encodeURIComponent(n)}`;
    }
  },
};
