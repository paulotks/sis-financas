import { db } from "./db.js";

/**
 * Investimentos com o dono e se somam hoje. O do banco não tem pessoa: é PJ só se todas as contas do mesmo banco forem PJ; resgatado
 * (TOTAL_WITHDRAWAL) fica inativo. Reserva (cofrinho, caixinha; ver salvarReservas em sync.ts) é de uma conta: segue a pessoa e o "ocultar"
 * dela, e só soma com o sim do usuário (`usa_reservas`), porque o valor pode já estar numa linha de `bens`.
 */
export const INVESTIMENTOS = `
  SELECT i.*, c.id AS conta_id, COALESCE(c.apelido, c.nome) AS conta, COALESCE(c.oculta, 0) AS oculta,
         COALESCE(c.pessoa, CASE WHEN (SELECT MIN(pessoa) FROM contas WHERE item_id = i.item_id) = 'PJ' THEN 'PJ' ELSE 'PF' END) AS pessoa,
         CASE WHEN i.tipo = 'RESERVA' THEN c.usa_reservas IS 1 ELSE json_extract(i.bruto, '$.status') IS NOT 'TOTAL_WITHDRAWAL' END AS ativo
  FROM investimentos i LEFT JOIN contas c ON i.tipo = 'RESERVA' AND c.id = substr(i.id, 1, instr(i.id, ':') - 1)`;

/**
 * Tudo o que compõe o patrimônio, uma linha por item. Cartão entra com sinal -1: pelo Open Finance o saldo dele é o
 * limite usado, que já inclui as parcelas futuras (por isso `faturas` não entra: contaria de novo).
 * Inativo não soma hoje, mas continua no histórico.
 */
const POSICOES = `
  SELECT 'conta' AS origem, id AS ref_id, pessoa, oculta, CASE WHEN tipo = 'CREDIT' THEN -1 ELSE 1 END AS sinal, saldo_centavos AS saldo, 1 AS ativo
  FROM contas WHERE saldo_centavos IS NOT NULL
  UNION ALL
  SELECT 'investimento', id, pessoa, oculta, 1, saldo_centavos, ativo FROM (${INVESTIMENTOS}) WHERE saldo_centavos IS NOT NULL
  UNION ALL
  SELECT 'bem', CAST(id AS TEXT), pessoa, 0, 1, valor_centavos, 1 FROM bens`;

/**
 * Guarda a foto de hoje de cada saldo (a última do dia vale: o que deixou de somar hoje sai dela). Conta oculta também: se voltar a
 * aparecer, tem histórico.
 */
export function registrarSaldos() {
  db.exec(`
    INSERT INTO saldos_diarios (data, origem, ref_id, saldo_centavos)
    SELECT date('now','localtime'), origem, ref_id, saldo FROM (${POSICOES}) WHERE ativo
    ON CONFLICT (data, origem, ref_id) DO UPDATE SET saldo_centavos = excluded.saldo_centavos;
    DELETE FROM saldos_diarios WHERE data = date('now','localtime') AND (origem, ref_id) NOT IN (SELECT origem, ref_id FROM (${POSICOES}) WHERE ativo)`);
}

export interface Posicao { origem: "conta" | "investimento" | "bem"; ref_id: string; nome: string | null; conta: string | null; sinal: 1 | -1; valor: number; serve: "juntar" | "quitar" | null }
/** O que soma hoje, um por um, com dívida negativa. `serve` = que tipo de meta pode medir: bem zerado (quitado) e cartão sem dívida, nenhum. */
export const posicoes = (pessoa: string) =>
  db.prepare(
    `SELECT p.origem, p.ref_id, COALESCE(ct.apelido, ct.nome, i.nome, b.nome) AS nome, i.conta, p.sinal, p.sinal * p.saldo AS valor,
            CASE WHEN p.sinal * p.saldo < 0 THEN 'quitar' WHEN p.sinal = 1 AND NOT (p.origem = 'bem' AND p.saldo = 0) THEN 'juntar' END AS serve
     FROM (${POSICOES}) p
     LEFT JOIN contas ct ON p.origem = 'conta' AND ct.id = p.ref_id
     LEFT JOIN (${INVESTIMENTOS}) i ON p.origem = 'investimento' AND i.id = p.ref_id
     LEFT JOIN bens b ON p.origem = 'bem' AND b.id = CAST(p.ref_id AS INTEGER)
     WHERE p.ativo AND NOT p.oculta AND p.pessoa = ? ORDER BY p.origem = 'conta', nome`,
  ).all(pessoa) as unknown as Posicao[];

export function patrimonio(pessoa: string) {
  const atual = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN origem = 'conta' AND sinal = 1 THEN saldo END), 0) AS contas,
            COALESCE(SUM(CASE WHEN origem = 'investimento' THEN saldo END), 0) AS investimentos,
            COALESCE(SUM(CASE WHEN origem = 'bem' AND saldo > 0 THEN saldo END), 0) AS bens,
            COALESCE(SUM(CASE WHEN sinal = -1 THEN saldo WHEN origem = 'bem' AND saldo < 0 THEN -saldo END), 0) AS dividas,
            COALESCE(SUM(sinal * saldo), 0) AS total
     FROM (${POSICOES}) WHERE ativo AND NOT oculta AND pessoa = ?`,
  ).get(pessoa) as { contas: number; investimentos: number; bens: number; dividas: number; total: number };
  const passado = db.prepare(
    `SELECT s.data, SUM(p.sinal * s.saldo_centavos) AS total
     FROM saldos_diarios s JOIN (${POSICOES}) p ON p.origem = s.origem AND p.ref_id = s.ref_id
     WHERE NOT p.oculta AND p.pessoa = ? AND s.data < date('now','localtime') GROUP BY s.data ORDER BY s.data`,
  ).all(pessoa) as { data: string; total: number }[];
  const { hoje } = db.prepare("SELECT date('now','localtime') AS hoje").get() as { hoje: string };
  return {
    pessoa,
    ...atual,
    historico: [...passado, { data: hoje, total: atual.total }], // o ponto de hoje é sempre ao vivo
    lista_bens: db.prepare("SELECT id, nome, valor_centavos FROM bens WHERE pessoa = ? ORDER BY valor_centavos DESC, nome").all(pessoa),
  };
}
