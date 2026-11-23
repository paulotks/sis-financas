/** Detecção de cobranças mensais. Função pura: recebe os gastos (do mais antigo ao mais novo) e devolve o que se repete. */

export interface Gasto {
  data: string; // AAAA-MM-DD
  descricao: string | null;
  descricao_original: string | null;
  valor: number; // centavos, positivo
  categoria: string | null;
  cor: string | null;
  conta: string | null;
}

export interface Recorrente {
  chave: string;
  descricao: string;
  categoria: string | null;
  cor: string | null;
  conta: string | null;
  valor: number; // o da última cobrança
  vezes: number;
  ultima: string;
  proxima: string;
  situacao: "prevista" | "atrasada" | "parada";
}

const TOLERANCIA_VALOR = 0.25; // conta de luz oscila, assinatura aumenta
const MINIMO_VEZES = 3;
const MENSAL: [number, number] = [25, 35];
const MINIMO_REGULAR = 0.6; // parte dos intervalos que precisa ser mensal
const DIAS_PARADA = 45;

const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** "NETFLIX.COM 123 São Paulo" -> "netflix com sao paulo": sem acento, número nem símbolo, para o mesmo lugar dar a mesma chave. */
export const chaveDe = (descricao: string) =>
  descricao.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();

/** Mesmo dia do mês seguinte; 31 vira o último dia. */
export function mesSeguinte(data: string) {
  const [a, m, d] = data.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}

export function detectarRecorrentes(gastos: Gasto[], hoje: string): Recorrente[] {
  const grupos = new Map<string, Gasto[][]>(); // chave -> séries de valor parecido
  for (const g of gastos) {
    const original = g.descricao_original ?? "";
    if (/\d{1,2}\/\d{1,2}\s*$/.test(original)) continue; // parcela escrita no texto (nem todo banco manda o metadado)
    const chave = chaveDe(original);
    if (!chave) continue;
    const series = grupos.get(chave) ?? [];
    grupos.set(chave, series);
    // a primeira série compatível, não a mais próxima: com a conta de luz oscilando, a mais próxima a partia em duas
    const serie = series.find((s) => Math.abs(g.valor - s.at(-1)!.valor) / s.at(-1)!.valor <= TOLERANCIA_VALOR);
    if (serie) serie.push(g);
    else series.push([g]);
  }

  const achados: Recorrente[] = [];
  for (const [chave, series] of grupos) {
    const mensais = series.filter((s) => {
      if (s.length < MINIMO_VEZES) return false;
      const intervalos = s.slice(1).map((g, i) => dias(s[i].data, g.data)).sort((a, b) => a - b);
      const mediana = intervalos[Math.floor(intervalos.length / 2)];
      const mensal = (d: number) => d >= MENSAL[0] && d <= MENSAL[1];
      return mensal(mediana) && intervalos.filter(mensal).length / intervalos.length >= MINIMO_REGULAR;
    });
    // ponytail: uma linha por descrição (a série mais recente). Duas assinaturas com a mesma descrição aparecem como uma;
    // se isso acontecer com dados reais, incluir o valor na chave.
    const s = mensais.sort((a, b) => (a.at(-1)!.data < b.at(-1)!.data ? 1 : -1))[0];
    if (!s) continue;
    const u = s.at(-1)!;
    const proxima = mesSeguinte(u.data);
    achados.push({
      chave,
      descricao: u.descricao || u.descricao_original || chave,
      categoria: u.categoria,
      cor: u.cor,
      conta: u.conta,
      valor: u.valor,
      vezes: s.length,
      ultima: u.data,
      proxima,
      situacao: dias(u.data, hoje) > DIAS_PARADA ? "parada" : proxima < hoje ? "atrasada" : "prevista",
    });
  }
  return achados.sort((a, b) => (a.proxima < b.proxima ? -1 : a.proxima > b.proxima ? 1 : b.valor - a.valor));
}
