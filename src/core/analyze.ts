// Shared with FlashHire (src/core/analyze.ts). Keep both copies identical so every link HireLinks saves is read the same way by FlashHire.
import { extractSkills } from './skills';
import { detectLang, normalize } from './text';
import type { Currency, JobAnalysis, JobInfo, Regime, Seniority } from './types';

const ALLOWED_CITY = /\buberaba\b|\buberlandia\b/;
const KNOWN_CITIES =
  /\b(uberaba|uberlandia|sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|campinas|florianopolis|recife|brasilia|salvador|fortaleza|goiania|ribeirao preto|barueri|sao jose dos campos|blumenau|joinville)\b/;

export function analyzeJob(job: Pick<JobInfo, 'title' | 'description'>): JobAnalysis {
  const title = normalize(job.title);
  const desc = normalize(job.description);
  const all = `${title} ${desc}`;
  const lang = detectLang(`${job.title} ${job.description}`);

  return {
    lang,
    seniority: detectSeniority(title, desc),
    regime: detectRegime(all),
    currency: detectCurrency(job.description, lang),
    role: detectRole(title || desc.slice(0, 200)),
    workModel: detectWorkModel(title, desc),
    city: all.match(ALLOWED_CITY)?.[0] ?? all.match(KNOWN_CITIES)?.[0] ?? null,
    salaryMonthly: detectSalary(job.description),
    requiredYears: detectYears(desc),
    skills: extractSkills(all),
    needsAdvancedEnglish:
      /(ingles|english).{0,40}(fluente|avancad|fluent|advanced|proficien|c1|c2)|(fluente|avancad|fluent|advanced|proficient).{0,25}(ingles|english)/.test(all),
  };
}

export function isAllowedCity(city: string | null): boolean {
  return !!city && ALLOWED_CITY.test(city);
}

function detectSeniority(title: string, desc: string): Seniority {
  const pick = (t: string): Seniority => {
    if (/\b(estagio|estagiari[oa]|intern(ship)?)\b/.test(t)) return 'intern';
    if (/\b(senior|sr|lead|staff|principal|especialista|specialist|tech lead|iii)\b/.test(t)) return 'senior';
    if (/\b(pleno|mid|middle|mid level|semi senior|ssr|ii)\b/.test(t)) return 'mid';
    if (/\b(junior|jr|entry level|trainee|graduate|i)\b/.test(t)) return 'junior';
    return 'unknown';
  };
  const fromTitle = pick(title);
  if (fromTitle !== 'unknown') return fromTitle;
  const levelLine = desc.match(/(nivel|level|senioridade|seniority)\s*:?\s*(\w+(\s\w+)?)/);
  return levelLine ? pick(levelLine[2] ?? '') : 'unknown';
}

function detectRegime(t: string): Regime {
  if (/\bclt\b/.test(t)) return 'clt';
  if (/\bpj\b|pessoa juridica/.test(t)) return 'pj';
  if (/\bcontractor\b|independent contract|\bfreelanc|\bb2b\b/.test(t)) return 'contractor';
  return 'unknown';
}

function detectCurrency(raw: string, lang: 'pt' | 'en'): Currency {
  if (/€|\beur\b|\beuros?\b/i.test(raw)) return 'EUR';
  if (/US\$|\bUSD\b|\bdollars?\b|d[oó]lar/i.test(raw) || /(^|[^R])\$\s?\d/.test(raw)) return 'USD';
  if (/R\$|\bBRL\b|\breais\b/i.test(raw)) return 'BRL';
  return lang === 'en' ? 'USD' : 'BRL';
}

function detectRole(t: string): JobAnalysis['role'] {
  if (/\bqa\b|\bquality\b|\bqualidade\b|\btest(e|es|er|ing)?\b|\bsdet\b/.test(t)) return 'qa';
  if (/full ?stack/.test(t)) return 'fullstack';
  if (/front ?end|\bui\b|\bweb developer\b|desenvolvedor[a]? web|\breact\b|\bangular\b|\bvue\b/.test(t)) return 'frontend';
  if (/back ?end|\bapi\b/.test(t)) return 'backend';
  if (/designer|\bux\b|product design/.test(t)) return 'design';
  return 'other';
}

function detectWorkModel(title: string, desc: string): JobAnalysis['workModel'] {
  const t = `${title} ${desc}`;
  if (/\bhibrid|\bhybrid\b/.test(t)) return 'hybrid';
  if (/\bremot[oe]\b|\bhome office\b|\bwork from home\b|\banywhere\b|\bfully remote\b|\b100 remoto\b/.test(t)) return 'remote';
  if (/\bpresencial\b|\bon ?site\b|\bin office\b|\bno escritorio\b/.test(t)) return 'onsite';
  return 'unknown';
}

/** First salary figure found, converted to a monthly value. */
export function detectSalary(raw: string): number | null {
  const m = raw.match(/(R\$|US\$|USD|\$|€|EUR)\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|mil)?/i);
  if (!m) return null;
  let digits = m[2] ?? '';
  // "5.000" / "5,000" are thousands; "5,5" / "5.5" with k are decimals.
  if (/[.,]\d{3}$/.test(digits)) digits = digits.replace(/[.,]/g, '');
  else digits = digits.replace(',', '.');
  let value = Number(digits);
  if (m[3]) value *= 1000;
  if (!Number.isFinite(value) || value <= 0) return null;
  const after = raw.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40).toLowerCase();
  if (/hora|hour|\/h\b|\bhr\b/.test(after)) return Math.round(value * 160);
  if (/ano|year|annual|\/yr|per annum/.test(after) || value > 40000) return Math.round(value / 12);
  return value;
}

function detectYears(desc: string): number | null {
  const re = /(\d{1,2})\s*\+?\s*(anos|years|yrs)/g;
  let best: number | null = null;
  for (const m of desc.matchAll(re)) {
    const i = m.index ?? 0;
    const ctx = desc.slice(Math.max(0, i - 60), i + 60);
    if (!/experien/.test(ctx)) continue;
    const n = Number(m[1]);
    if (n > 0 && n < 20) best = best === null ? n : Math.min(best, n);
  }
  return best;
}
