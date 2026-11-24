// ---------- shared with FlashHire (same shapes as FlashHire's src/core/types.ts) ----------
export type SiteId =
  | 'linkedin'
  | 'gupy'
  | 'glassdoor'
  | 'indeed'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'getonboard'
  | 'remotive'
  | 'weworkremotely'
  | 'remoteok'
  | 'wellfound'
  | 'other';

export type LinkVariant = 'search' | 'direct' | 'apply-flow' | 'login' | 'no-job';

export interface SiteInfo {
  site: SiteId;
  label: string;
  variant: LinkVariant;
  /** URL the browser should open (normalized). */
  openUrl: string;
  /** Stable id used to avoid applying twice to the same job. */
  jobKey: string | null;
  /** True when the final click must be made by the candidate (site rules). */
  manualSubmit: boolean;
  /** Human-readable problem with the link, if any. */
  warning?: string;
}

export type Lang = 'pt' | 'en';
export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'unknown';
export type Regime = 'clt' | 'pj' | 'contractor' | 'unknown';
export type Currency = 'BRL' | 'USD' | 'EUR';
export type Role = 'frontend' | 'qa' | 'fullstack' | 'backend' | 'design' | 'other';
export type WorkModel = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export interface JobInfo {
  url: string;
  title: string;
  company: string;
  description: string;
  site: SiteId;
}

export interface JobAnalysis {
  lang: Lang;
  seniority: Seniority;
  regime: Regime;
  currency: Currency;
  role: Role;
  workModel: WorkModel;
  city: string | null;
  salaryMonthly: number | null;
  requiredYears: number | null;
  skills: string[];
  needsAdvancedEnglish: boolean;
}

// ---------- HireLinks ----------
export type SourceId =
  | 'gupy'
  | 'linkedin'
  | 'indeed'
  | 'glassdoor'
  | 'getonboard'
  | 'remotive'
  | 'remoteok'
  | 'weworkremotely'
  | 'boards';

export type EnglishLevel = 'basic' | 'intermediate' | 'advanced' | 'fluent';

/** What the candidate has, taken from her own résumé and confirmed by her. */
export interface Profile {
  skills: string[];
  englishLevel: EnglishLevel;
  experienceYears: number;
}

export interface Details {
  description: string;
  seniorityHint?: Seniority;
}

/** A job found on a site, before scoring. Details may be loaded later (only if the job is new). */
export interface Lead {
  source: SourceId;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  /** ISO date, when the site says. */
  postedAt: string | null;
  /** The site itself says the job is remote. */
  remote?: boolean;
  /** Seniority stated by the site (LinkedIn "Seniority level", Get on Board seniority). */
  seniorityHint?: Seniority;
  /** Loads the full description when the listing does not include it. */
  loadDetails?: () => Promise<Details>;
}

export interface Fit {
  /** 0–100: requirements she has, or has an equivalent of, over all requirements found. */
  percent: number;
  total: number;
  has: string[];
  similar: { requirement: string; via: string }[];
  missing: string[];
}

export interface CollectedJob {
  link: string;
  jobKey: string;
  site: string;
  source: SourceId;
  title: string;
  company: string;
  location: string;
  workModel: WorkModel;
  seniority: Seniority;
  percent: number;
  has: string[];
  similar: { requirement: string; via: string }[];
  missing: string[];
  postedAt: string | null;
  collectedAt: string;
}
