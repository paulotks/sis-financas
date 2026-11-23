import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, quando, type Conexao } from "../lib/api";
import { abrirPluggyConnect } from "../lib/pluggyConnect";

const LIMITE_CONEXOES = 5;

/** Status que indicam banco sem autorização/dados velhos (UPDATED/UPDATING/CREATED são normais). */
const problema = (c: Conexao) =>
  ["LOGIN_ERROR", "OUTDATED", "WAITING_USER_INPUT", "WAITING_USER_ACTION"].includes(c.status ?? "") ||
  ["USER_AUTHORIZATION_PENDING", "USER_AUTHORIZATION_NOT_GRANTED", "INVALID_CREDENTIALS", "ERROR"].includes(c.status_execucao ?? "");

export default function Conexoes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["conexoes"], queryFn: api.conexoes });
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  /** Abre o widget (novo banco ou reconexão), grava o item e já sincroniza. */
  const conectar = useMutation({
    mutationFn: async () => {
      const { accessToken } = await api.connectToken();
      const novoId = await abrirPluggyConnect(accessToken);
      if (!novoId) return null;
      return api.salvarConexao(novoId);
    },
    onSuccess: (r) => {
      if (!r) return;
      setMsg(r.erro
        ? { tipo: "erro", texto: `Conectado, mas a sincronização falhou: ${r.erro}` }
        : { tipo: "ok", texto: `${r.conector ?? "Banco"} conectado: ${r.contas} conta(s), ${r.novos} lançamento(s) novos.` });
      qc.invalidateQueries();
    },
    onError: (e) => setMsg({ tipo: "erro", texto: e.message }),
  });

  const sync = useMutation({
    mutationFn: (itemId: string) => api.sincronizar(itemId),
    onSuccess: ({ resultados: [r] }) => {
      setMsg(r.erro ? { tipo: "erro", texto: r.erro } : { tipo: "ok", texto: `${r.conector}: ${r.novos} novos, ${r.atualizados} atualizados.` });
      qc.invalidateQueries();
    },
    onError: (e) => setMsg({ tipo: "erro", texto: e.message }),
  });

  const total = q.data?.length ?? 0;
  const cheio = total >= LIMITE_CONEXOES;

  return (
    <section>
      <header className="topo">
        <h1>Conexões <span className="mudo">({total}/{LIMITE_CONEXOES})</span></h1>
        <button className="botao" disabled={conectar.isPending || cheio} onClick={() => conectar.mutate()}
          title={cheio ? "Limite do plano gratuito do Meu Pluggy" : undefined}>
          {conectar.isPending ? "Aguardando o banco…" : "+ Conectar banco"}
        </button>
      </header>
      <p className="mudo">
        Cada banco autorizado pelo Open Finance (via Meu Pluggy) vira uma conexão. As credenciais da Pluggy ficam só na API local; o
        navegador recebe apenas um token temporário. O plano gratuito aceita até {LIMITE_CONEXOES} conexões ativas.
      </p>
      {cheio && <div className="aviso erro">Limite de {LIMITE_CONEXOES} conexões atingido: para trocar um banco, remova-o antes em meu.pluggy.ai.</div>}

      {msg && <div className={`aviso ${msg.tipo === "erro" ? "erro" : ""}`}>{msg.texto}</div>}

      <table className="tabela">
        <thead>
          <tr>
            <th>Banco / contas</th>
            <th>Contas</th>
            <th>Status</th>
            <th>Última sincronização</th>
            <th style={{ width: 220 }} />
          </tr>
        </thead>
        <tbody>
          {q.data?.length === 0 && (
            <tr><td colSpan={5} className="vazio">Nenhum banco conectado. Clique em “Conectar banco”.</td></tr>
          )}
          {q.data?.map((c) => (
            <tr key={c.item_id}>
              <td>
                <div className="com-logo">
                  {c.imagem_url && <img src={c.imagem_url} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
                  <div>
                    {c.nomes_contas ?? c.conector ?? "—"}
                    <div className="sub">{c.conector} · <code>{c.item_id}</code></div>
                  </div>
                </div>
              </td>
              <td>{c.contas}</td>
              <td>
                {c.erro ? <span className="neg" title={c.erro}>erro</span> : <span className="selo">{c.status ?? "—"}</span>}
                {problema(c) && (
                  <div className="neg sub" title={`status ${c.status} / execução ${c.status_execucao}`}>
                    Dados podem estar desatualizados: reautorize em meu.pluggy.ai
                  </div>
                )}
              </td>
              <td className="mudo">{quando(c.ultimo_sync)}</td>
              <td className="acoes-linha">
                <button className="botao secundario" disabled={sync.isPending} onClick={() => sync.mutate(c.item_id)}>Sincronizar</button>
                <a className="botao secundario" href="https://meu.pluggy.ai" target="_blank" rel="noreferrer"
                  title="O item do Meu Pluggy não se atualiza pelo app: reautorize o banco no site do Meu Pluggy (atualiza sozinho a cada 24h)">
                  Reautorizar
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
