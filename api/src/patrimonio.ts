import { db } from "./db.js";

/**
 * Tudo o que compõe o patrimônio, uma linha por item. Cartão entra com sinal -1: pelo Open Finance o saldo dele é o
 * limite usado, que já inclui as parcelas futuras (por isso `faturas` não entra: contaria de novo).
 * Investimento não tem pessoa: é PJ só se todas as contas do mesmo banco forem PJ. Resgatado (TOTAL_WITHDRAWAL) fica
 * inativo: não soma hoje, mas continua no histórico.
 */
const POSICOES = `
  SELECT 'conta' AS origem, id AS ref_id, pessoa, oculta, CASE WHEN tipo = 'CREDIT' THEN -1 ELSE 1 END AS sinal, saldo_centavos AS saldo, 1 AS ativo
  FROM contas WHERE saldo_centavos IS NOT NULL
  UNION ALL
  SELECT 'investimento', id, CASE WHEN (SELECT MIN(pessoa) FROM contas WHERE item_id = i.item_id) = 'PJ' THEN 'PJ' ELSE 'PF' END, 0, 1,
         saldo_centavos, json_extract(bruto, '$.status') IS NOT 'TOTAL_WITHDRAWAL'
  FROM investimentos i WHERE saldo_centavos IS NOT NULL
  UNION ALL
  SELECT 'bem', CAST(id AS TEXT), pessoa, 0, 1, valor_centavos, 1 FROM bens`;

/** Guarda a foto de hoje de cada saldo (a última do dia vale). Conta oculta também: se voltar a aparecer, tem histórico. */
export function registrarSaldos() {
  db.exec(`
    INSERT INTO saldos_diarios (data, origem, ref_id, saldo_centavos)
    SELECT date('now','localtime'), origem, ref_id, saldo FROM (${POSICOES}) WHERE ativo
    ON CONFLICT (data, origem, ref_id) DO UPDATE SET saldo_centavos = excluded.saldo_centavos`);
}

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
