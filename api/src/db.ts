import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env.js";

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

/** Migrações em ordem; cada uma roda uma única vez (controle por PRAGMA user_version). */
const MIGRACOES: string[] = [
  `
  CREATE TABLE conexoes (
    item_id           TEXT PRIMARY KEY,
    conector          TEXT,
    conector_id       INTEGER,
    imagem_url        TEXT,
    status            TEXT,
    status_execucao   TEXT,
    atualizado_pluggy TEXT,
    ultimo_sync       TEXT,
    erro              TEXT,
    criado_em         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE contas (
    id                         TEXT PRIMARY KEY,
    item_id                    TEXT NOT NULL REFERENCES conexoes(item_id) ON DELETE CASCADE,
    tipo                       TEXT,              -- BANK | CREDIT
    subtipo                    TEXT,              -- CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD
    nome                       TEXT,
    apelido                    TEXT,
    numero                     TEXT,
    instituicao                TEXT,
    saldo_centavos             INTEGER,
    moeda                      TEXT,
    limite_centavos            INTEGER,
    limite_disponivel_centavos INTEGER,
    fechamento                 TEXT,
    vencimento                 TEXT,
    pessoa                     TEXT NOT NULL DEFAULT 'PF' CHECK (pessoa IN ('PF','PJ')),
    oculta                     INTEGER NOT NULL DEFAULT 0,
    atualizado_em              TEXT
  );

  CREATE TABLE categorias (
    id     INTEGER PRIMARY KEY,
    nome   TEXT NOT NULL UNIQUE,
    grupo  TEXT NOT NULL CHECK (grupo IN ('essencial','estilo_de_vida','financeiro','renda','transferencia')),
    cor    TEXT
  );

  CREATE TABLE lancamentos (
    id                 TEXT PRIMARY KEY,                 -- id da transação na Pluggy
    conta_id           TEXT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
    data               TEXT NOT NULL,                    -- AAAA-MM-DD
    descricao_original TEXT,
    descricao          TEXT,                             -- editável
    valor_centavos     INTEGER NOT NULL,                 -- saída negativa
    tipo               TEXT,                             -- DEBIT | CREDIT
    status             TEXT,                             -- POSTED | PENDING
    categoria_pluggy   TEXT,
    categoria_id       INTEGER REFERENCES categorias(id),
    categoria_manual   INTEGER NOT NULL DEFAULT 0,
    regra_id           INTEGER,
    comerciante        TEXT,
    parcela            INTEGER,
    total_parcelas     INTEGER,
    fatura_id          TEXT,
    notas              TEXT,
    tags               TEXT NOT NULL DEFAULT '[]',
    ignorado           INTEGER NOT NULL DEFAULT 0,
    bruto              TEXT,
    criado_em          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em      TEXT
  );
  CREATE INDEX ix_lanc_data  ON lancamentos(data);
  CREATE INDEX ix_lanc_conta ON lancamentos(conta_id, data);

  CREATE TABLE faturas (
    id              TEXT PRIMARY KEY,
    conta_id        TEXT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
    vencimento      TEXT,
    total_centavos  INTEGER,
    minimo_centavos INTEGER,
    bruto           TEXT
  );

  CREATE TABLE investimentos (
    id             TEXT PRIMARY KEY,
    item_id        TEXT NOT NULL REFERENCES conexoes(item_id) ON DELETE CASCADE,
    nome           TEXT,
    tipo           TEXT,
    subtipo        TEXT,
    saldo_centavos INTEGER,
    atualizado_em  TEXT,
    bruto          TEXT
  );

  CREATE TABLE regras (
    id           INTEGER PRIMARY KEY,
    padrao       TEXT NOT NULL,                        -- texto contido na descrição original (sem diferenciar maiúsculas)
    categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
    descricao    TEXT,                                 -- nome limpo opcional
    prioridade   INTEGER NOT NULL DEFAULT 50,
    criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (padrao)
  );

  CREATE TABLE sincronizacoes (
    id          INTEGER PRIMARY KEY,
    item_id     TEXT,
    inicio      TEXT NOT NULL,
    fim         TEXT,
    contas      INTEGER DEFAULT 0,
    novos       INTEGER DEFAULT 0,
    atualizados INTEGER DEFAULT 0,
    erro        TEXT
  );

  INSERT INTO categorias (nome, grupo, cor) VALUES
    ('Moradia','essencial','#7c9cff'),
    ('Contas da casa','essencial','#5fb3ff'),
    ('Mercado','essencial','#4fd1a5'),
    ('Transporte','essencial','#ffb74d'),
    ('Combustível','essencial','#ff9f43'),
    ('Saúde','essencial','#ff6b81'),
    ('Educação','essencial','#a78bfa'),
    ('Pet','essencial','#c4a484'),
    ('Família','essencial','#f78fb3'),
    ('Alimentação fora','estilo_de_vida','#feca57'),
    ('Compras','estilo_de_vida','#ff7eb6'),
    ('Assinaturas','estilo_de_vida','#48dbfb'),
    ('Lazer','estilo_de_vida','#1dd1a1'),
    ('Cuidados pessoais','estilo_de_vida','#f8a5c2'),
    ('Impostos e taxas','financeiro','#b2bec3'),
    ('Juros e dívidas','financeiro','#e17055'),
    ('Investimentos','financeiro','#00cec9'),
    ('Renda','renda','#2ecc71'),
    ('Transferência entre contas','transferencia','#636e72'),
    ('Pagamento de fatura','transferencia','#636e72'),
    ('Outros','estilo_de_vida','#95a5a6');
  `,
  `
  CREATE TABLE orcamentos (
    categoria_id   INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
    mes            TEXT NOT NULL,                          -- AAAA-MM; vale deste mês em diante, até a próxima linha da categoria
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
    PRIMARY KEY (categoria_id, mes)
  );
  `,
  `
  CREATE TABLE saldos_diarios (                            -- o saldo é sobrescrito a cada sincronização; sem isto não há evolução
    data           TEXT NOT NULL,                          -- AAAA-MM-DD local
    origem         TEXT NOT NULL CHECK (origem IN ('conta','investimento','bem')),
    ref_id         TEXT NOT NULL,
    saldo_centavos INTEGER NOT NULL,
    PRIMARY KEY (data, origem, ref_id)
  );
  CREATE TABLE bens (                                      -- linhas manuais do patrimônio; valor negativo = dívida
    id             INTEGER PRIMARY KEY,
    nome           TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    pessoa         TEXT NOT NULL DEFAULT 'PF' CHECK (pessoa IN ('PF','PJ')),
    criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
  `
  CREATE TABLE recorrencias (                              -- só a decisão do Paulo; a detecção é refeita a cada leitura
    chave     TEXT PRIMARY KEY,                            -- descrição original sem acento, número e símbolo
    status    TEXT NOT NULL CHECK (status IN ('confirmada','ignorada')),
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
];

export function migrar() {
  const versao = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let i = versao; i < MIGRACOES.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRACOES[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function transacao<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const centavos = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));
export const agora = () => new Date().toISOString();
