import { nomeMes, somarMes } from "../lib/api";

export default function SeletorMes({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  return (
    <div className="seletor-mes">
      <button className="icone-botao" title="Mês anterior" onClick={() => onChange(somarMes(mes, -1))}>‹</button>
      <span>{nomeMes(mes)}</span>
      <button className="icone-botao" title="Próximo mês" onClick={() => onChange(somarMes(mes, 1))}>›</button>
    </div>
  );
}
