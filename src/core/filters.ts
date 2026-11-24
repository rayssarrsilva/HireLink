import { analyzeJob } from './analyze';
import { normalize } from './text';
import type { Fit, JobAnalysis, Lead, Role, Seniority, WorkModel } from './types';

export interface FilterSettings {
  /** Lowest requirement coverage kept (40–100). */
  minPercent: number;
  /** Jobs where fewer requirements were recognized are skipped: the percentage would not mean much. */
  minRequirements: number;
  roles: Role[];
  excludeIntern: boolean;
  excludeSenior: boolean;
  /** Pleno/mid jobs only from this coverage up. */
  midMinPercent: number;
  /** Only jobs published in the last N days (when the site says the date). */
  maxAgeDays: number;
  /** Cities where on-site/hybrid jobs are fine. */
  cities: string[];
  /** On-site/hybrid elsewhere only above this monthly salary in BRL (0 = never). */
  onsiteMinSalaryBRL: number;
}

export const DEFAULT_FILTERS: FilterSettings = {
  minPercent: 40,
  minRequirements: 3,
  roles: ['frontend', 'qa'],
  excludeIntern: true,
  excludeSenior: true,
  midMinPercent: 80,
  maxAgeDays: 14,
  cities: ['Uberaba', 'Uberlândia'],
  onsiteMinSalaryBRL: 4500,
};

export type RejectCode =
  | 'area'
  | 'old'
  | 'few-requirements'
  | 'below-min'
  | 'intern'
  | 'senior'
  | 'mid-below'
  | 'onsite'
  | 'region';

/** Area from the title only: cheap check before opening the job page. */
export function roleFromTitle(title: string): Role {
  return analyzeJob({ title, description: '' }).role;
}

export interface Evaluated {
  analysis: JobAnalysis;
  workModel: WorkModel;
  seniority: Seniority;
}

/** Combines what the text says with what the site says (remote boards, LinkedIn seniority, location field). */
export function evaluate(lead: Lead, description: string): Evaluated {
  const analysis = analyzeJob({ title: lead.title, description: `${description}\n${lead.location}` });
  let workModel = analysis.workModel;
  const loc = normalize(lead.location);
  if (/\bhibrid|\bhybrid\b/.test(loc)) workModel = 'hybrid';
  else if (lead.remote || /\bremot|\bhome office\b|\banywhere\b|\bworldwide\b/.test(loc)) workModel = workModel === 'hybrid' ? 'hybrid' : 'remote';
  else if (/\bpresencial\b|\bon ?site\b/.test(loc)) workModel = 'onsite';
  const seniority = analysis.seniority === 'unknown' && lead.seniorityHint ? lead.seniorityHint : analysis.seniority;
  return { analysis, workModel, seniority };
}

export function rejectReason(lead: Lead, ev: Evaluated, fit: Fit, f: FilterSettings, now = Date.now()): RejectCode | null {
  if (!f.roles.includes(ev.analysis.role)) return 'area';
  if (lead.postedAt) {
    const age = (now - Date.parse(lead.postedAt)) / 86_400_000;
    if (Number.isFinite(age) && age > f.maxAgeDays) return 'old';
  }
  if (ev.seniority === 'intern' && f.excludeIntern) return 'intern';
  if (ev.seniority === 'senior' && f.excludeSenior) return 'senior';
  if (fit.total < f.minRequirements) return 'few-requirements';
  if (fit.percent < f.minPercent) return 'below-min';
  if (ev.seniority === 'mid' && fit.percent < f.midMinPercent) return 'mid-below';
  if (ev.workModel === 'onsite' || ev.workModel === 'hybrid') {
    if (!inCities(`${lead.location} ${ev.analysis.city ?? ''}`, f.cities)) {
      const brl = ev.analysis.currency === 'BRL' ? ev.analysis.salaryMonthly : null;
      if (!f.onsiteMinSalaryBRL || brl === null || brl <= f.onsiteMinSalaryBRL) return 'onsite';
    }
  }
  if (ev.workModel === 'remote' && remoteOutsideReach(`${lead.location}\n${lead.description}`)) return 'region';
  return null;
}

export function inCities(text: string, cities: string[]): boolean {
  const t = ` ${normalize(text)} `;
  return cities.some((c) => {
    const n = normalize(c);
    return n.length > 1 && t.includes(` ${n} `);
  });
}

const OPEN_TO_BRAZIL = /\b(latam|latin america|america latina|south america|brazil|brasil|worldwide|anywhere|global|any country|all countries|americas)\b/;
const RESTRICTED =
  /\b(us|usa|u s|united states|canada|uk|united kingdom|europe|eu|emea|apac|india|germany|australia)\s*(only|based|residents?|citizens?)\b|\bmust (be )?(located|based|reside|live) in (the )?(us|usa|united states|canada|uk|united kingdom|europe|eu)\b|\b(only|exclusively) (open to|for) (candidates )?(in|from) (the )?(us|usa|united states|canada|uk|europe)\b/;

/** Remote jobs that only hire in another country (e.g. "US only"), with no mention of Brazil/LatAm/worldwide. */
export function remoteOutsideReach(text: string): boolean {
  const t = normalize(text.replace(/\./g, ' '));
  return RESTRICTED.test(t) && !OPEN_TO_BRAZIL.test(t);
}

export const REJECT_LABELS: Record<RejectCode | 'duplicate' | 'invalid-link' | 'no-details', { pt: string; en: string }> = {
  area: { pt: 'Fora das áreas escolhidas', en: 'Outside the chosen areas' },
  old: { pt: 'Publicada há muito tempo', en: 'Posted too long ago' },
  'few-requirements': { pt: 'Poucos requisitos reconhecidos', en: 'Too few requirements recognized' },
  'below-min': { pt: 'Abaixo da compatibilidade mínima', en: 'Below the minimum match' },
  intern: { pt: 'Estágio', en: 'Internship' },
  senior: { pt: 'Sênior', en: 'Senior' },
  'mid-below': { pt: 'Pleno abaixo do mínimo para pleno', en: 'Mid-level below the mid-level minimum' },
  onsite: { pt: 'Presencial/híbrida fora das suas cidades', en: 'On-site/hybrid outside your cities' },
  region: { pt: 'Remota só para outro país', en: 'Remote, but only for another country' },
  duplicate: { pt: 'Repetida', en: 'Duplicate' },
  'invalid-link': { pt: 'Link que o FlashHire não aceita', en: 'Link FlashHire cannot use' },
  'no-details': { pt: 'Não consegui abrir a vaga', en: 'Could not open the job' },
};
