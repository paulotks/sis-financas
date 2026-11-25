import path from "node:path";
import { fileURLToPath } from "node:url";

// raiz do projeto (api/src -> api -> raiz; também vale para api/dist)
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

try {
  process.loadEnvFile(path.join(RAIZ, ".env"));
} catch {
  // sem .env: segue com as variáveis do ambiente
}

const DB_PATH = path.resolve(RAIZ, process.env.DB_PATH || "data/financas.db");

export const env = {
  // || e não ??: variável vazia ("PORT=") no .env também cai no padrão
  porta: Number(process.env.PORT) || 3333,
  dbPath: DB_PATH,
  // padrão ao lado da base: um worktree sem .env nunca mexe nas cópias de verdade
  copiasDir: path.resolve(RAIZ, process.env.COPIAS_DIR || path.join(path.dirname(DB_PATH), "copias")),
  pluggyUrl: process.env.PLUGGY_API_URL || "https://api.pluggy.ai",
  syncDiasIniciais: Number(process.env.SYNC_DIAS_INICIAIS) || 365,
  webDist: path.join(RAIZ, "web", "dist"),
};

export function credenciaisPluggy() {
  const clientId = process.env.PLUGGY_CLIENT_ID ?? process.env.CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET ?? process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Credenciais Pluggy ausentes: preencha PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env");
  }
  return { clientId, clientSecret };
}
