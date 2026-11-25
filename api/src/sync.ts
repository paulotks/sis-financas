import { agora, centavos, db, transacao } from "./db.js";
import { env } from "./env.js";
import { carregarRegras, reaplicarRegras, sugerirCategoria } from "./categorizar.js";
import { registrarSaldos } from "./patrimonio.js";
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

/** Janela em que lançamentos que sumiram da Pluggy são removidos daqui (menor que a da busca: o que sumir por engano volta). */
const DIAS_CONFERENCIA = 60;

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
       numero=excluded.numero, instituicao=excluded.instituicao, moeda=excluded.moeda,
       saldo_centavos=COALESCE(excluded.saldo_centavos, saldo_centavos),
       limite_centavos=COALESCE(excluded.limite_centavos, limite_centavos),
       limite_disponivel_centavos=COALESCE(excluded.limite_disponivel_centavos, limite_disponivel_centavos),
       fechamento=excluded.fechamento, vencimento=excluded.vencimento,
       atualizado_em=COALESCE(excluded.atualizado_em, atualizado_em)`,
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
    c.balance == null ? null : agora(), // de quando é o saldo: sem saldo novo, ficam o último e a data dele
  );
}

/** Valor com sinal a partir do tipo (DEBIT = saída), independente da convenção do banco. */
const valorComSinal = (t: PTransacao) => {
  const v = Math.abs(centavos(t.amountInAccountCurrency ?? t.amount) ?? 0);
  return t.type === "DEBIT" ? -v : v;
};

function salvarTransacoes(lista: PTransacao[], regras: ReturnType<typeof carregarRegras>) {
  const novos: string[] = [];
  let atualizados = 0;
  const existe = db.prepare("SELECT bruto FROM lancamentos WHERE id = ?");
  const inserir = db.prepare(
    `INSERT INTO lancamentos (id, conta_id, data, descricao_original, descricao, valor_centavos, tipo, status,
       categoria_pluggy, categoria_id, regra_id, comerciante, parcela, total_parcelas, fatura_id, bruto, atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`,
  );
  // atualização preserva o que é do usuário: descricao, categoria manual, notas, tags, ignorado
  // e a última categoria da Pluggy: fora do trial ela vem null, e reaplicarRegras descategorizaria tudo
  const atualizar = db.prepare(
    `UPDATE lancamentos SET data=?, descricao_original=?, valor_centavos=?, tipo=?, status=?,
       categoria_pluggy=COALESCE(?, categoria_pluggy), comerciante=?, parcela=?, total_parcelas=?, fatura_id=?, bruto=?, atualizado_em=datetime('now','localtime')
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
    const bruto = JSON.stringify(t);
    const antes = existe.get(t.id) as { bruto: string } | undefined;
    if (antes) {
      atualizar.run(comum.data, original, comum.valor, t.type, t.status ?? null, t.category ?? null, comerciante,
        comum.parcela, comum.total, comum.fatura, bruto, t.id);
      if (antes.bruto !== bruto) atualizados++; // relido sem mudança não conta
    } else {
      const s = sugerirCategoria({ descricao_original: original, categoria_pluggy: t.category, valor_centavos: comum.valor, conta_id: t.accountId }, regras);
      inserir.run(t.id, t.accountId, comum.data, original, s.descricao || t.description || original, comum.valor,
        t.type, t.status ?? null, t.category ?? null, s.categoria_id, s.regra_id, comerciante, comum.parcela,
        comum.total, comum.fatura, bruto);
      novos.push(t.id);
    }
  }
  return { novos, atualizados };
}

/**
 * Quando a fatura fecha, a Pluggy pode apagar um lançamento e recriá-lo com outro id; sem isto, o antigo ficaria e
 * contaria em dobro. O que o Paulo editou passa para o substituto; sem substituto, o editado fica como REMOVIDO:
 * aparece na lista, não soma, e volta ao normal se o banco o devolver (o status vem do banco a cada sincronização).
 * ponytail: substituto = mesma parcela e 2 de 3 entre valor, data e descrição; usar o providerId se isso errar com dados reais.
 */
function removerSumidos(contaId: string, de: string, lista: PTransacao[], novos: string[]) {
  if (!lista.length) return; // resposta vazia costuma ser falha do banco: não apaga nada
  const maisAntigo = lista.reduce((m, t) => (t.date < m ? t.date : m), lista[0].date).slice(0, 10);
  const limite = [de, diasAtras(DIAS_CONFERENCIA), maisAntigo].sort()[2];
  const sumidos = db.prepare(
    `SELECT id, data, descricao, descricao_original, valor_centavos, parcela, categoria_id, categoria_manual, notas, tags, ignorado,
       COALESCE(descricao,'') NOT IN (COALESCE(descricao_original,''), COALESCE(json_extract(bruto,'$.description'),'')) AS descricao_editada
     FROM lancamentos
     WHERE conta_id = ? AND data > ? AND bruto IS NOT NULL AND id NOT IN (SELECT value FROM json_each(?))`,
  ).all(contaId, limite, JSON.stringify(lista.map((t) => t.id))) as {
    id: string; data: string; descricao: string; descricao_original: string; valor_centavos: number; parcela: number | null;
    categoria_id: number | null; categoria_manual: number; notas: string | null; tags: string; ignorado: number; descricao_editada: number;
  }[];
  const livres = new Set(novos);
  const buscar = db.prepare(
    `SELECT id FROM lancamentos
     WHERE id IN (SELECT value FROM json_each(?)) AND parcela IS ? AND (valor_centavos = ?) + (data = ?) + (descricao_original = ?) >= 2
     ORDER BY (valor_centavos = ?) + (descricao_original = ?) DESC, abs(julianday(data) - julianday(?)) LIMIT 1`,
  );
  for (const s of sumidos) {
    if (s.categoria_manual || s.ignorado || s.notas || s.tags !== "[]" || s.descricao_editada) {
      const par = buscar.get(JSON.stringify([...livres]), s.parcela, s.valor_centavos, s.data, s.descricao_original,
        s.valor_centavos, s.descricao_original, s.data) as { id: string } | undefined;
      if (!par) {
        db.prepare("UPDATE lancamentos SET status = 'REMOVIDO' WHERE id = ?").run(s.id);
        continue;
      }
      livres.delete(par.id);
      db.prepare("UPDATE lancamentos SET notas = ?, tags = ?, ignorado = ? WHERE id = ?").run(s.notas, s.tags, s.ignorado, par.id);
      if (s.categoria_manual)
        db.prepare("UPDATE lancamentos SET categoria_id = ?, categoria_manual = 1, regra_id = NULL WHERE id = ?").run(s.categoria_id, par.id);
      if (s.descricao_editada) db.prepare("UPDATE lancamentos SET descricao = ? WHERE id = ?").run(s.descricao, par.id);
    }
    db.prepare("DELETE FROM lancamentos WHERE id = ?").run(s.id);
  }
}

/** 404 = conta ou banco sem o produto (o comum é vir lista vazia). Qualquer outro erro é falha. */
const semProduto = (e: unknown) => e instanceof ErroPluggy && e.status === 404;

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Busca na Pluggy e grava: item, contas, transações, faturas (cartões) e investimentos. */
export async function sincronizarItem(itemId: string, desde?: string): Promise<ResultadoSync> {
  const inicio = agora();
  const reg = db.prepare("INSERT INTO sincronizacoes (item_id, inicio) VALUES (?, ?)").run(itemId, inicio);
  const res: ResultadoSync = { item_id: itemId, conector: null, contas: 0, novos: 0, atualizados: 0, investimentos: 0 };
  const avisos: string[] = []; // o que não deu para ler, sem impedir o resto
  /** Faturas e investimentos: a falha não pode custar os lançamentos das outras contas, mas também não pode sumir. */
  const lerSePuder = async (oQue: string, ler: () => Promise<void>) => {
    try {
      await ler();
    } catch (e) {
      if (!semProduto(e)) avisos.push(`${oQue}: ${mensagem(e)}`);
    }
  };
  try {
    const item = await pluggy.item(itemId);
    salvarConexao(item);
    res.conector = item.connector?.name ?? null;

    const contas = await pluggy.contas(itemId);
    transacao(() => contas.forEach((c) => salvarConta(itemId, res.conector, c)));
    res.contas = contas.length;

    const regras = carregarRegras();
    for (const c of contas) {
      // Relê a janela inteira: a Pluggy cria lançamentos com data passada e parcelas com data futura, então partir
      // do "último lançamento" deixaria buracos. São poucas páginas de 500.
      const de = desde ?? diasAtras(env.syncDiasIniciais);
      const lista: PTransacao[] = [];
      for await (const pagina of pluggy.transacoes(c.id, de)) lista.push(...pagina);
      // só grava com todas as páginas em mãos, numa transação: conta inteira ou nada
      const r = transacao(() => {
        const r = salvarTransacoes(lista, regras);
        removerSumidos(c.id, de, lista, r.novos);
        return r;
      });
      res.novos += r.novos.length;
      res.atualizados += r.atualizados;
      if (c.type === "CREDIT") {
        await lerSePuder("Faturas não lidas", async () => {
          const faturas = await pluggy.faturas(c.id);
          transacao(() =>
            faturas.forEach((f) =>
              db.prepare(
                `INSERT INTO faturas (id, conta_id, vencimento, total_centavos, minimo_centavos, bruto) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET vencimento=excluded.vencimento, total_centavos=COALESCE(excluded.total_centavos, total_centavos),
                   minimo_centavos=excluded.minimo_centavos, bruto=excluded.bruto`,
              ).run(f.id, c.id, f.dueDate?.slice(0, 10) ?? null, centavos(f.totalAmount), centavos(f.minimumPaymentAmount), JSON.stringify(f)),
            ),
          );
        });
      }
    }

    // investimentos (ex.: cofrinhos do Mercado Pago, se o banco expuser)
    await lerSePuder("Investimentos não lidos", async () => {
      const invs = await pluggy.investimentos(itemId);
      transacao(() =>
        invs.forEach((i) =>
          db.prepare(
            `INSERT INTO investimentos (id, item_id, nome, tipo, subtipo, saldo_centavos, atualizado_em, bruto) VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, tipo=excluded.tipo, subtipo=excluded.subtipo,
               saldo_centavos=COALESCE(excluded.saldo_centavos, saldo_centavos), atualizado_em=excluded.atualizado_em, bruto=excluded.bruto`,
          ).run(i.id, itemId, i.name ?? null, i.type ?? null, i.subtype ?? null, centavos(i.balance ?? i.amount), agora(), JSON.stringify(i)),
        ),
      );
      res.investimentos = invs.length;
    });

    if (avisos.length) res.erro = avisos.join(" · ");
    db.prepare("UPDATE conexoes SET ultimo_sync = ?, erro = ? WHERE item_id = ?").run(agora(), res.erro ?? null, itemId);
  } catch (e) {
    res.erro = mensagem(e);
    db.prepare("UPDATE conexoes SET erro = ? WHERE item_id = ?").run(res.erro, itemId);
  }
  db.prepare("UPDATE sincronizacoes SET fim=?, contas=?, novos=?, atualizados=?, erro=? WHERE id=?").run(
    agora(), res.contas, res.novos, res.atualizados, res.erro ?? null, Number(reg.lastInsertRowid),
  );
  return res;
}

let fila: Promise<unknown> = Promise.resolve();

/** Sincroniza tudo (ou um item). Uma por vez: chamadas simultâneas entram na fila e cada uma recebe o próprio resultado. */
export function sincronizar(itemId?: string, desde?: string): Promise<ResultadoSync[]> {
  const execucao = fila.then(async () => {
    const ids = itemId
      ? [itemId]
      : (db.prepare("SELECT item_id FROM conexoes ORDER BY criado_em").all() as { item_id: string }[]).map((r) => r.item_id);
    const out: ResultadoSync[] = [];
    for (const id of ids) out.push(await sincronizarItem(id, desde));
    transacao(() => reaplicarRegras()); // o Pix no crédito só se resolve com as três pernas na base
    registrarSaldos();
    return out;
  });
  fila = execucao.catch(() => {});
  return execucao;
}
