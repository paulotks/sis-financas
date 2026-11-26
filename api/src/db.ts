import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env.js";

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
/** Para comparar textos na busca: sem maiúsculas nem acentos. As regras não usam (mudaria o que cada uma pega). */
export const simplificar = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// só em consulta: em índice, CHECK ou gatilho, outro programa não abriria a base
db.function("simplificar", { deterministic: true, directOnly: true }, (t) => (typeof t === "string" ? simplificar(t) : t));

/** Migrações em ordem; cada uma roda uma única vez (controle por PRAGMA user_version). */
export const MIGRACOES: string[] = [
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
  // regra com sentido e conta: recria a tabela porque o SQLite não tira UNIQUE; os ids ficam (lancamentos.regra_id aponta para eles)
  `
  CREATE TABLE regras_nova (
    id           INTEGER PRIMARY KEY,
    padrao       TEXT NOT NULL,                        -- texto contido na descrição original (sem diferenciar maiúsculas)
    sentido      TEXT CHECK (sentido IN ('saida','entrada')),          -- nulo = os dois
    conta_id     TEXT REFERENCES contas(id) ON DELETE CASCADE,         -- nulo = todas
    categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
    descricao    TEXT,                                 -- nome limpo opcional
    prioridade   INTEGER NOT NULL DEFAULT 50,
    criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  INSERT INTO regras_nova (id, padrao, categoria_id, descricao, prioridade, criado_em)
    SELECT id, padrao, categoria_id, descricao, prioridade, criado_em FROM regras;
  DROP TABLE regras;
  ALTER TABLE regras_nova RENAME TO regras;
  -- COALESCE porque o índice trata nulos como diferentes e deixaria duas regras iguais "para tudo"
  CREATE UNIQUE INDEX ux_regras ON regras (padrao COLLATE NOCASE, COALESCE(sentido,''), COALESCE(conta_id,''));
  `,
  // investir não é gasto e resgatar não é renda: sai do resumo e do orçamento, como as transferências
  `UPDATE categorias SET grupo = 'transferencia' WHERE nome = 'Investimentos'`,
  `
  CREATE TABLE config (                                    -- escolhas do usuário; linha ausente = o cálculo automático
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );
  `,
  // decisão por cobrança (nome + valor), estado cancelada e proposta do MCP; recria a tabela porque o SQLite não muda CHECK nem chave primária
  `
  CREATE TABLE recorrencias_nova (                         -- só a decisão do Paulo; a detecção é refeita a cada leitura
    chave          TEXT NOT NULL,                          -- descrição original sem acento, número e símbolo
    valor_centavos INTEGER NOT NULL,                       -- um valor que a cobrança já teve; 0 = todas com esse nome (decisões antigas)
    status         TEXT NOT NULL CHECK (status IN ('confirmada','ignorada','cancelada','sugerida')),
    proposta       TEXT CHECK (proposta IN ('confirmada','ignorada','cancelada','sugerida')),   -- do MCP: não vale até ser aceita na tela
    decidido_em    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (chave, valor_centavos)
  );
  INSERT INTO recorrencias_nova (chave, valor_centavos, status, decidido_em) SELECT chave, 0, status, criado_em FROM recorrencias;
  DROP TABLE recorrencias;
  ALTER TABLE recorrencias_nova RENAME TO recorrencias;
  `,
  // as telas de categorias e regras contam os usos linha a linha
  `
  CREATE INDEX ix_lanc_categoria ON lancamentos(categoria_id);
  CREATE INDEX ix_lanc_regra     ON lancamentos(regra_id);
  `,
  // "você usa cofrinho ou caixinha nesta conta?": nulo = ainda não respondeu (a reserva não soma)
  `ALTER TABLE contas ADD COLUMN usa_reservas INTEGER CHECK (usa_reservas IN (0, 1))`,
  // código COMPE do banco (todos chegam como MeuPluggy): escolhe o adaptador; nulo = ainda não se sabe
  `ALTER TABLE conexoes ADD COLUMN banco TEXT`,
  // metas (só PF): o que cada uma pede por mês sai do teto do alarme
  `
  CREATE TABLE metas (
    id            INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    tipo          TEXT NOT NULL CHECK (tipo IN ('guardar','juntar','quitar')),
    alvo_centavos INTEGER CHECK (alvo_centavos > 0),       -- juntar = quanto; quitar = quanto a dívida era
    prazo         TEXT,                                    -- AAAA-MM
    origem        TEXT CHECK (origem IN ('conta','investimento','bem')),   -- de onde sai o progresso, como em saldos_diarios
    ref_id        TEXT,
    encerrada_em  TEXT,                                    -- AAAA-MM
    criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK ((origem IS NULL) = (ref_id IS NULL))
  );
  CREATE TABLE metas_mensais (
    meta_id        INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
    mes            TEXT NOT NULL,                          -- AAAA-MM; vale deste mês em diante, até a próxima linha da meta
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
    PRIMARY KEY (meta_id, mes)
  );
  `,
  // horários gravados pelo app: de UTC (toISOString) para o local das outras colunas; misturados, a comparação de texto erra no mesmo dia
  `
  UPDATE conexoes       SET ultimo_sync   = strftime('%Y-%m-%d %H:%M:%f', ultimo_sync, 'localtime')   WHERE ultimo_sync   LIKE '%Z';
  UPDATE contas         SET atualizado_em = strftime('%Y-%m-%d %H:%M:%f', atualizado_em, 'localtime') WHERE atualizado_em LIKE '%Z';
  UPDATE investimentos  SET atualizado_em = strftime('%Y-%m-%d %H:%M:%f', atualizado_em, 'localtime') WHERE atualizado_em LIKE '%Z';
  UPDATE sincronizacoes SET inicio        = strftime('%Y-%m-%d %H:%M:%f', inicio, 'localtime')        WHERE inicio        LIKE '%Z';
  UPDATE sincronizacoes SET fim           = strftime('%Y-%m-%d %H:%M:%f', fim, 'localtime')           WHERE fim           LIKE '%Z';
  `,
  // contas do mês cadastradas à mão (só PF): não somam em total nenhum; o pagamento é achado pelo texto a cada leitura, sem guardar id
  `
  CREATE TABLE compromissos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,             -- apagada não empresta o id: o MCP edita pelo id que leu
    nome           TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),  -- o esperado
    dia            INTEGER NOT NULL CHECK (dia BETWEEN 1 AND 31), -- 31 = o último do mês
    texto          TEXT,                                          -- normalizado como o nome da cobrança; nulo = só a marca à mão
    inicio         TEXT NOT NULL,                                 -- AAAA-MM
    fim            TEXT,                                          -- AAAA-MM; nulo = sem fim
    criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK (fim IS NULL OR fim >= inicio)
  );
  CREATE TABLE compromissos_pagos (
    compromisso_id INTEGER NOT NULL REFERENCES compromissos(id) ON DELETE CASCADE,
    mes            TEXT NOT NULL,                                 -- AAAA-MM
    valor_centavos INTEGER NOT NULL,                              -- o esperado no dia da marca
    PRIMARY KEY (compromisso_id, mes)
  );
  `,
];

const COPIAS = 14; // de cada tipo
const agoraLocal = (formato: string) => (db.prepare("SELECT strftime(?, 'now', 'localtime') AS t").get(formato) as { t: string }).t;

/**
 * VACUUM INTO e não cópia do arquivo: o mais recente pode estar só no -wal. Nunca troca uma cópia que já existe.
 * Depois apaga as mais antigas do mesmo tipo.
 */
function copiar(banco: DatabaseSync, tipo: "diaria" | "migracao", momento: string) {
  const prefixo = `${path.parse(env.dbPath).name}-${tipo}-`;
  const destino = path.join(env.copiasDir, `${prefixo}${momento}.db`);
  if (fs.existsSync(destino)) return;
  fs.mkdirSync(env.copiasDir, { recursive: true });
  const parcial = `${destino}.${crypto.randomUUID()}.tmp`; // só recebe o nome final inteira: meia cópia não pode valer como cópia
  try {
    banco.prepare("VACUUM INTO ?").run(parcial);
    fs.renameSync(parcial, destino);
  } finally {
    fs.rmSync(parcial, { force: true });
  }
  const todas = fs.readdirSync(env.copiasDir).filter((n) => n.startsWith(prefixo) && n.endsWith(".db")).sort();
  for (const velha of todas.slice(0, -COPIAS)) {
    try {
      fs.rmSync(path.join(env.copiasDir, velha));
    } catch {
      // em uso por outro programa: sai na próxima
    }
  }
}

/** Uma por dia; chamada ao subir e de hora em hora, porque o app fica dias no ar. Falhar não derruba o app. */
export function copiaDoDia() {
  try {
    copiar(db, "diaria", agoraLocal("%Y-%m-%d"));
  } catch (e) {
    console.error(`Cópia do dia NÃO foi feita em ${env.copiasDir}: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Com foreign_keys ligado, o DROP TABLE de uma migração que recria `contas` apagaria lançamentos e faturas em cascata, sem erro.
 * Desligar só vale fora da transação (dentro o SQLite ignora); em troca, nenhuma migração termina com registro órfão.
 */
export function migrar(banco = db, migracoes = MIGRACOES) {
  const lerVersao = () => (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const versao = lerVersao();
  if (versao > migracoes.length)
    throw new Error(`a base (versão ${versao}) é mais nova que este código (versão ${migracoes.length}): atualize o código e compile de novo`);
  if (versao > 0 && versao < migracoes.length) {
    try {
      copiar(banco, "migracao", `${agoraLocal("%Y-%m-%d-%H%M%S")}-v${versao}`);
    } catch (e) {
      throw new Error(`sem a cópia em ${env.copiasDir} a base não foi migrada: ${e instanceof Error ? e.message : e}`, { cause: e });
    }
  }
  banco.exec("PRAGMA foreign_keys = OFF");
  try {
    for (let i = versao; i < migracoes.length; i++) {
      banco.exec("BEGIN IMMEDIATE");
      try {
        if (lerVersao() > i) {
          banco.exec("ROLLBACK"); // outro processo subiu junto e já fez esta
          continue;
        }
        banco.exec(migracoes[i]);
        const orfaos = banco.prepare("PRAGMA foreign_key_check").all() as { table: string; parent: string }[];
        if (orfaos.length) {
          const onde = [...new Set(orfaos.map((o) => `${o.table} -> ${o.parent}`))].join(", ");
          throw new Error(`migração ${i + 1} desfeita: deixaria ${orfaos.length} registro(s) órfão(s) (${onde})`);
        }
        banco.exec(`PRAGMA user_version = ${i + 1}`);
        banco.exec("COMMIT");
      } catch (e) {
        banco.exec("ROLLBACK");
        throw e;
      }
    }
  } finally {
    banco.exec("PRAGMA foreign_keys = ON");
  }
}

/** IMMEDIATE: espera a vez (busy_timeout) antes de ler. No BEGIN comum, ler e depois gravar falha na hora se outro processo gravou no meio. */
export function transacao<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
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
/**
 * Horário local, como o DEFAULT das colunas (`datetime('now','localtime')`), mais os milissegundos: todo horário que o app grava se compara
 * como texto. Sem os milissegundos, duas sincronizações no mesmo segundo fariam o saldo da anterior parecer novo (faltas.ts).
 * Só `conexoes.atualizado_pluggy` (do banco) é UTC, com Z.
 */
export const agora = () => agoraLocal("%Y-%m-%d %H:%M:%f");
