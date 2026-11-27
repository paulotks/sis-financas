/** Ícones do menu, desenhados aqui (traço de 1,75 na cor do texto): caractere Unicode mudava de cara a cada fonte. */
const DESENHOS = {
  resumo: <><circle cx="12" cy="12" r="9" /><path d="M12 12l4.5-4.5M12 7v1M7 12h1M16 12h1" /></>,
  lancamentos: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  orcamento: <><circle cx="12" cy="12" r="9" /><path d="M12 3v9h9" /></>,
  mes: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  metas: <path d="M5 21V4h12l-2.5 4L17 12H5" />,
  analises: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  recorrentes: <path d="M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4" />,
  contas: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6.5 15h4" /></>,
  categorias: <><path d="M3 12.5V4a1 1 0 011-1h8.5l8.5 8.5-9 9z" /><circle cx="8" cy="8" r="1.3" /></>,
  conexoes: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  mais: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  sincronizar: <path d="M20 12a8 8 0 11-2.4-5.7L20 8.5M20 3.5v5h-5" />,
};
export type NomeIcone = keyof typeof DESENHOS;

export default function Icone({ nome }: { nome: NomeIcone }) {
  return (
    <svg className="icone" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {DESENHOS[nome]}
    </svg>
  );
}
