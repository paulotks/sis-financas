// Entrada usada pelo Claude Desktop. Nada de console.log aqui nem em mcp.ts: a saída padrão é o protocolo.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { criarServidor } from "./mcp.js";

// sempre local, na porta do app de uso diário (app-windows.ps1); este processo não lê o .env, então outra porta precisa
// vir no `env` da configuração do Claude Desktop
await criarServidor(`http://127.0.0.1:${Number(process.env.PORT) || 80}`).connect(new StdioServerTransport());
