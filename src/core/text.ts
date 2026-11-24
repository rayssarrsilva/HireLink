// Shared with FlashHire (src/core/text.ts). Keep both copies identical so every link HireLinks saves is read the same way by FlashHire.
const STOPWORDS = new Set(
  (
    'a o os as um uma uns umas de da do das dos em no na nos nas por para pra com sem sobre e ou que se sua seu suas seus ' +
    'voce você qual quais quanto quantos quantas como the a an of to in on for with and or is are do does did you your ' +
    'please por favor informe indique describe tell us what which how if any this that be have has'
  ).split(' '),
);

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Similarity between two short texts: mix of Jaccard and containment (0..1). */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const containment = inter / Math.min(ta.size, tb.size);
  return 0.5 * jaccard + 0.5 * containment;
}

export function detectLang(text: string): 'pt' | 'en' {
  const t = ` ${normalize(text)} `;
  const pt = (t.match(/ (voce|nao|para|com|experiencia|vaga|requisitos|conhecimento|desenvolvimento|empresa|sera|beneficios) /g) ?? []).length;
  const en = (t.match(/ (you|the|and|experience|requirements|with|will|our|team|role|skills|benefits) /g) ?? []).length;
  return pt >= en ? 'pt' : 'en';
}

export function firstNumber(text: string): number | null {
  const m = text.replace(/\./g, '').replace(',', '.').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
