import type { Fit, JobAnalysis, Profile } from './types';

/**
 * Starting equivalence groups. A skill counts as fully met when the candidate has any other skill
 * in the same group. These are only a starting point: she edits them in "Seu perfil".
 */
export const DEFAULT_EQUIVALENCES: string[][] = [
  ['JavaScript', 'TypeScript'],
  ['React', 'Next.js'],
  ['CSS', 'Sass'],
  ['Tailwind CSS', 'Bootstrap'],
  ['Redux', 'Zustand'],
  ['Jest', 'Vitest'],
  ['Cypress', 'Playwright', 'Selenium'],
  ['SQL', 'PostgreSQL', 'MySQL'],
];

export const ENGLISH_REQ = 'Inglês avançado · Advanced English';
export const yearsReq = (n: number) => `${n}+ anos de experiência · ${n}+ years of experience`;

/**
 * Requirement coverage: each requirement found in the job is one item.
 * It counts as met when she has it, or has an equivalent from the same group (same weight).
 */
export function requirementFit(job: JobAnalysis, profile: Profile, groups: string[][]): Fit {
  const mine = new Set(profile.skills);
  const has: string[] = [];
  const similar: Fit['similar'] = [];
  const missing: string[] = [];

  for (const req of new Set(job.skills)) {
    if (mine.has(req)) {
      has.push(req);
      continue;
    }
    const via = equivalentOf(req, mine, groups);
    if (via) similar.push({ requirement: req, via });
    else missing.push(req);
  }

  if (job.needsAdvancedEnglish) {
    (profile.englishLevel === 'advanced' || profile.englishLevel === 'fluent' ? has : missing).push(ENGLISH_REQ);
  }
  if (job.requiredYears !== null) {
    (profile.experienceYears >= job.requiredYears ? has : missing).push(yearsReq(job.requiredYears));
  }

  const total = has.length + similar.length + missing.length;
  const percent = total ? Math.round((100 * (has.length + similar.length)) / total) : 0;
  return { percent, total, has, similar, missing };
}

function equivalentOf(req: string, mine: Set<string>, groups: string[][]): string | null {
  for (const g of groups) {
    if (!g.includes(req)) continue;
    const found = g.find((s) => s !== req && mine.has(s));
    if (found) return found;
  }
  return null;
}

/** Cleans groups typed by the candidate: trims, drops empties and single-item groups. */
export function cleanGroups(groups: string[][]): string[][] {
  return groups.map((g) => [...new Set(g.map((s) => s.trim()).filter(Boolean))]).filter((g) => g.length >= 2);
}
