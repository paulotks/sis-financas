import { agora, centavos, db, transacao } from "./db.js";
import { env } from "./env.js";
import { carregarRegras, sugerirCategoria } from "./categorizar.js";
import { ErroPluggy, pluggy, type PConta, type PItem, type PTransacao } from "./pluggy.js";

export interface ResultadoSync {
  item_id: string;
  conector: string | null;
  contas: number;
  novos: number;
  atualizados: number;
  investimentos: number;
  erro?: string;
}

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export function salvarConexao(item: PItem) {
  db.prepare(
    `INSERT INTO conexoes (item_id, conector, conector_id, imagem_url, status, status_execucao, atualizado_pluggy)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(item_id) DO UPDATE SET conector=excluded.conector, conector_id=excluded.conector_id,
       imagem_url=excluded.imagem_url, status=excluded.status, status_execucao=excluded.status_execucao,
       atualizado_pluggy=excluded.atualizado_pluggy`,
  ).run(
    item.id,
    item.connector?.name ?? null,
    item.connector?.id ?? null,
    item.connector?.imageUrl ?? null,
    item.status ?? null,
    item.executionStatus ?? null,
    item.lastUpdatedAt ?? null,
  );
}

function parecePJ(conector: string | null, c: PConta) {
  const txt = `${conector ?? ""} ${c.name ?? ""} ${c.marketingName ?? ""}`.toLowerCase();
  return /empresa|\bpj\b|business|cnpj/.test(txt);
}

function salvarConta(itemId: string, conector: string | null, c: PConta) {
  const cd = c.creditData ?? {};
  db.prepare(
    `INSERT INTO contas (id, item_id, tipo, subtipo, nome, numero, instituicao, saldo_centavos, moeda,
       limite_centavos, limite_disponivel_centavos, fechamento, vencimento, pessoa, atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, subtipo=excluded.subtipo, nome=excluded.nome,
       numero=excluded.numero, instituicao=excluded.instituicao, saldo_centavos=excluded.saldo_centavos,
       moeda=excluded.moeda, limite_centavos=excluded.limite_centavos,
       limite_disponivel_centavos=excluded.limite_disponivel_centavos, fechamento=excluded.fechamento,
       vencimento=excluded.vencimento, atualizado_em=excluded.atualizado_em`,
  ).run(
    c.id,
    itemId,
    c.type,
    c.subtype ?? null,
    c.marketingName || c.name || null,
    c.number ?? null,
    conector,
    centavos(c.balance),
    c.currencyCode ?? "BRL",
    centavos(cd.creditLimit),
    centavos(cd.availableCreditLimit),
    cd.balanceCloseDate?.slice(0, 10) ?? null,
    cd.balanceDueDate?.slice(0, 10) ?? null,
    // PF/PJ só é deduzido na criação (o UPDATE não mexe em pessoa); depois vale o que for marcado na tela
    parecePJ(conector, c) ? "PJ" : "PF",
    agora(),
  );
}

/** Valor com sinal a partir do tipo (DEBIT = saída), independente da convenção do banco. */
const valorComSinal = (t: PTransacao) => {
  const v = Math.abs(centavos(t.amountInAccountCurrency ?? t.amount) ?? 0);
  return t.type === "DEBIT" ? -v : v;
};

function salvarTransacoes(lista: PTransacao[], regras: ReturnType<typeof carregarRegras>) {
  let novos = 0;
  let atualizados = 0;
  const existe = db.prepare("SELECT 1 FROM lancamentos WHERE id = ?");
  const inserir = db.prepare(
    `INSERT INTO lancamentos (id, conta_id, data, descricao_original, descricao, valor_centavos, tipo, status,
       categoria_pluggy, categoria_id, regra_id, comerciante, parcela, total_parcelas, fatura_id, bruto, atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`,
  );
  // atualização preserva o que é do usuário: descricao, categoria manual, notas, tags, ignorado
  const atualizar = db.prepare(
    `UPDATE lancamentos SET data=?, descricao_original=?, valor_centavos=?, tipo=?, status=?, categoria_pluggy=?,
       comerciante=?, parcela=?, total_parcelas=?, fatura_id=?, bruto=?, atualizado_em=datetime('now','localtime')
     WHERE id=?`,
  );
  for (const t of lista) {
    const original = (t.descriptionRaw || t.description || "").trim();
    const comerciante = t.merchant?.businessName || t.merchant?.name || null;
    const cc = t.creditCardMetadata ?? {};
    const comum = {
      data: t.date.slice(0, 10),
      valor: valorComSinal(t),
      parcela: cc.installmentNumber ?? null,
      total: cc.totalInstallments ?? null,
      fatura: cc.billId ?? null,
    };
    if (existe.get(t.id)) {
      atualizar.run(comum.data, original, comum.valor, t.type, t.status ?? null, t.category ?? null, comerciante,
        comum.parcela, comum.total, comum.fatura, JSON.stringify(t), t.id);
      atualizados++;
    } else {
      const s = sugerirCategoria(original, t.category, regras);
      inserir.run(t.id, t.accountId, comum.data, original, s.descricao || t.description || original, comum.valor,
        t.type, t.status ?? null, t.category ?? null, s.categoria_id, s.regra_id, comerciante, comum.parcela,
        comum.total, comum.fatura, JSON.stringify(t));
      novos++;
    }
  }
  return { novos, atualizados };
}

/** Busca na Pluggy e grava: item, contas, transações, faturas (cartões) e investimentos. */
export async function sincronizarItem(itemId: string, desde?: string): Promise<ResultadoSync> {
  const inicio = agora();
  const reg = db.prepare("INSERT INTO sincronizacoes (item_id, inicio) VALUES (?, ?)").run(itemId, inicio);
  const res: ResultadoSync = { item_id: itemId, conector: null, contas: 0, novos: 0, atualizados: 0, investimentos: 0 };
  try {
    const item = await pluggy.item(itemId);
    salvarConexao(item);
    res.conector = item.connector?.name ?? null;

    const contas = await pluggy.contas(itemId);
    transacao(() => contas.forEach((c) => salvarConta(itemId, res.conector, c)));
    res.contas = contas.length;

    const regras = carregarRegras();
    for (const c of contas) {
      // incremental: volta 15 dias a partir do último lançamento, para pegar pendentes que viraram lançados
      const ultimo = (db.prepare("SELECT MAX(data) AS d FROM lancamentos WHERE conta_id = ?").get(c.id) as { d: string | null }).d;
      const de = desde ?? (ultimo ? new Date(Date.parse(ultimo) - 15 * 86_400_000).toISOString().slice(0, 10) : diasAtras(env.syncDiasIniciais));
      for await (const pagina of pluggy.transacoes(c.id, de)) {
        const r = transacao(() => salvarTransacoes(pagina, regras));
        res.novos += r.novos;
        res.atualizados += r.atualizados;
      }
      if (c.type === "CREDIT") {
        try {
          const faturas = await pluggy.faturas(c.id);
          transacao(() =>
            faturas.forEach((f) =>
              db.prepare(
                `INSERT INTO faturas (id, conta_id, vencimento, total_centavos, minimo_centavos, bruto) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET vencimento=excluded.vencimento, total_centavos=excluded.total_centavos,
                   minimo_centavos=excluded.minimo_centavos, bruto=excluded.bruto`,
              ).run(f.id, c.id, f.dueDate?.slice(0, 10) ?? null, centavos(f.totalAmount), centavos(f.minimumPaymentAmount), JSON.stringify(f)),
            ),
          );
        } catch (e) {
          if (!(e instanceof ErroPluggy)) throw e; // banco sem faturas pelo Open Finance: segue
        }
      }
    }

    // investimentos (ex.: cofrinhos do Mercado Pago, se o banco expuser)
    try {
      const invs = await pluggy.investimentos(itemId);
      transacao(() =>
        invs.forEach((i) =>
          db.prepare(
            `INSERT INTO investimentos (id, item_id, nome, tipo, subtipo, saldo_centavos, atualizado_em, bruto) VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, tipo=excluded.tipo, subtipo=excluded.subtipo,
               saldo_centavos=excluded.saldo_centavos, atualizado_em=excluded.atualizado_em, bruto=excluded.bruto`,
          ).run(i.id, itemId, i.name ?? null, i.type ?? null, i.subtype ?? null, centavos(i.balance ?? i.amount), agora(), JSON.stringify(i)),
        ),
      );
      res.investimentos = invs.length;
    } catch (e) {
      if (!(e instanceof ErroPluggy)) throw e;
    }

    db.prepare("UPDATE conexoes SET ultimo_sync = ?, erro = NULL WHERE item_id = ?").run(agora(), itemId);
  } catch (e) {
    res.erro = e instanceof Error ? e.message : String(e);
    db.prepare("UPDATE conexoes SET erro = ? WHERE item_id = ?").run(res.erro, itemId);
  }
  db.prepare("UPDATE sincronizacoes SET fim=?, contas=?, novos=?, atualizados=?, erro=? WHERE id=?").run(
    agora(), res.contas, res.novos, res.atualizados, res.erro ?? null, Number(reg.lastInsertRowid),
  );
  return res;
}

let emAndamento: Promise<ResultadoSync[]> | null = null;

/** Sincroniza tudo (ou um item). Duas chamadas ao mesmo tempo reaproveitam a mesma execução. */
export function sincronizar(itemId?: string, desde?: string) {
  if (emAndamento) return emAndamento;
  const ids = itemId
    ? [itemId]
    : (db.prepare("SELECT item_id FROM conexoes ORDER BY criado_em").all() as { item_id: string }[]).map((r) => r.item_id);
  emAndamento = (async () => {
    const out: ResultadoSync[] = [];
    for (const id of ids) out.push(await sincronizarItem(id, desde));
    return out;
  })().finally(() => {
    emAndamento = null;
  });
  return emAndamento;
}
