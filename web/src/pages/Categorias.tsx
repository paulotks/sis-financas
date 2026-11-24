import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, GRUPOS, type Categoria, type Regra } from "../lib/api";
import SelectCategoria from "../components/SelectCategoria";

export default function Categorias() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["categorias"], queryFn: api.categorias });
  const regras = useQuery({ queryKey: ["regras"], queryFn: api.regras });
  const [nome, setNome] = useState("");
  const [grupo, setGrupo] = useState<Categoria["grupo"]>("estilo_de_vida");
  const [cor, setCor] = useState("#7c9cff");

  const criar = useMutation({
    mutationFn: () => api.criarCategoria({ nome, grupo, cor }),
    onSuccess: () => {
      setNome("");
      qc.invalidateQueries({ queryKey: ["categorias"] });
    },
  });
  const apagar = useMutation({
    mutationFn: api.apagarRegra,
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <section>
      <h1>Categorias e regras</h1>
      <div className="duas-colunas">
        <div className="painel">
          <h2>Categorias</h2>
          <form
            className="linha-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim()) criar.mutate();
            }}
          >
            <input className="campo" placeholder="Nova categoria" value={nome} onChange={(e) => setNome(e.target.value)} />
            <select className="campo" value={grupo} onChange={(e) => setGrupo(e.target.value as Categoria["grupo"])}>
              {Object.entries(GRUPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} />
            <button className="botao" disabled={criar.isPending}>Adicionar</button>
          </form>
          {(cats.error ?? criar.error) && <div className="aviso erro">{(cats.error ?? criar.error)!.message}</div>}
          {(Object.keys(GRUPOS) as Categoria["grupo"][]).map((g) => (
            <div key={g}>
              <h3>{GRUPOS[g]}</h3>
              <div className="chips">
                {cats.data?.filter((c) => c.grupo === g).map((c) => (
                  <span key={c.id} className="chip" style={{ borderColor: c.cor ?? undefined }}>{c.nome}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="painel">
          <h2>Regras</h2>
          <p className="mudo pequeno">
            Crie aqui ou ao corrigir a categoria de um lançamento. Valem para todo lançamento, antigo ou novo, cuja descrição original
            contenha o texto, menos os que você editou à mão.
          </p>
          <NovaRegra categorias={cats.data ?? []} regras={regras.data} />
          {(regras.error ?? apagar.error) && <div className="aviso erro">{(regras.error ?? apagar.error)!.message}</div>}
          <table className="tabela compacta regras">
            <tbody>
              {regras.data?.length === 0 && <tr><td className="vazio">Nenhuma regra ainda.</td></tr>}
              {regras.data?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.padrao}</code>
                    <div className="sub">{r.usos} uso(s){r.descricao && ` → ${r.descricao}`}</div>
                  </td>
                  <td>{r.categoria}</td>
                  <td>
                    <button className="icone-botao" title="Apagar regra" onClick={() => apagar.mutate(r.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const EXEMPLOS = 5;

function NovaRegra({ categorias, regras }: { categorias: Categoria[]; regras: Regra[] | undefined }) {
  const qc = useQueryClient();
  const [padrao, setPadrao] = useState("");
  const [categoria, setCategoria] = useState<number | null>(null);
  const texto = padrao.trim();
  const valido = texto.length >= 3;
  const previa = useQuery({
    queryKey: ["previaRegra", texto],
    queryFn: () => api.previaRegra(texto),
    enabled: valido,
    placeholderData: keepPreviousData,
  });
  const n = valido && !previa.isPlaceholderData ? previa.data : undefined; // só vale a prévia deste texto, não a do anterior
  const existente = regras?.find((r) => r.padrao.toLowerCase() === texto.toLowerCase());
  const criar = useMutation({
    // o texto já gravado, e não o novo: a API só ignora maiúsculas sem acento e criaria uma segunda regra
    mutationFn: () => api.criarRegra({ padrao: existente?.padrao ?? texto, categoria_id: categoria! }),
    onSuccess: () => {
      setPadrao("");
      setCategoria(null);
      qc.invalidateQueries();
    },
  });
  // espera a lista de regras e a prévia: sem elas não daria para avisar o que a regra troca
  const pronto = !!regras && !!n && categoria !== null && existente?.categoria_id !== categoria && !criar.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pronto) criar.mutate();
      }}
    >
      <div className="linha-form">
        <input
          className="campo"
          name="padrao"
          aria-label="Texto da regra"
          placeholder="Descrição contém…"
          maxLength={120}
          value={padrao}
          onChange={(e) => {
            setPadrao(e.target.value);
            criar.reset();
          }}
        />
        <SelectCategoria categorias={categorias} valor={categoria} vazio="Vai para…" onChange={setCategoria} />
        <button className="botao" disabled={!pronto}>{existente ? "Trocar categoria" : "Criar regra"}</button>
      </div>
      <div className="pequeno" aria-live="polite">
        {texto && !valido && <p className="mudo">Use pelo menos 3 letras.</p>}
        {existente && (
          <p className="alerta">
            Já existe{existente.categoria_id === categoria ? " e já vai para" : ", hoje vai para"} <strong>{existente.categoria}</strong>.
          </p>
        )}
        {n && (
          <p className="mudo">
            {n.total === 0 ? "Nenhum lançamento parecido; vale para os próximos." : `${n.total} parecido(s), ${n.pendentes} sem categoria.`}
          </p>
        )}
        {!!n?.exemplos.length && (
          <ul className="exemplos">
            {n.exemplos.slice(0, EXEMPLOS).map((x) => (
              <li key={`${x.descricao}|${x.categoria}`}>
                <code>{x.descricao}</code> <span className="mudo">{x.qtd > 1 && `×${x.qtd} `}hoje: {x.categoria ?? "sem categoria"}</span>
              </li>
            ))}
            {n.descricoes > EXEMPLOS && <li className="mudo">e mais {n.descricoes - EXEMPLOS} descrição(ões)</li>}
          </ul>
        )}
        {criar.data && <p className="ok">Regra salva: {criar.data.recategorizados} lançamento(s) mudaram de categoria.</p>}
        {(criar.error ?? previa.error) && <p className="erro">{(criar.error ?? previa.error)!.message}</p>}
      </div>
    </form>
  );
}
