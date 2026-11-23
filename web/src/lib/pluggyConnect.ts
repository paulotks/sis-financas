// Carrega o widget Pluggy Connect sob demanda e abre o fluxo Open Finance.
// O token vem da nossa API: client_id/secret nunca chegam ao navegador.

// versão fixa (a da documentação): "latest" poderia mudar a API sem aviso
const SCRIPT = "https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js";

interface PluggyConnectOpcoes {
  connectToken: string;
  includeSandbox?: boolean;
  updateItem?: string;
  onSuccess?: (d: { item: { id: string; connector?: { name?: string } } }) => void;
  onError?: (e: { message?: string; data?: { item?: { id: string; executionStatus?: string } } }) => void;
  onClose?: () => void;
}
declare global {
  interface Window {
    PluggyConnect?: new (o: PluggyConnectOpcoes) => { init: () => void };
  }
}

let carregando: Promise<void> | null = null;
function carregarScript() {
  if (window.PluggyConnect) return Promise.resolve();
  carregando ??= new Promise<void>((ok, falha) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      carregando = null;
      falha(new Error("Não foi possível carregar o widget da Pluggy (sem internet?)"));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

/** Abre o widget. Resolve com o itemId conectado, ou null se o usuário fechar sem conectar. */
export async function abrirPluggyConnect(connectToken: string, updateItem?: string): Promise<string | null> {
  await carregarScript();
  return new Promise((ok, falha) => {
    let resolvido = false;
    const widget = new window.PluggyConnect!({
      connectToken,
      includeSandbox: false, // só bancos reais
      updateItem,
      onSuccess: (d) => {
        resolvido = true;
        ok(d.item.id);
      },
      onError: (e) => {
        resolvido = true;
        // autorização ainda pendente no banco: o item existe e o sucesso chega depois; guarda o item em vez de falhar
        const item = e?.data?.item;
        if (item && item.executionStatus === "USER_AUTHORIZATION_PENDING") return ok(item.id);
        falha(new Error(e?.message ?? "Falha na conexão com o banco"));
      },
      onClose: () => {
        if (!resolvido) ok(null);
      },
    });
    widget.init();
  });
}
