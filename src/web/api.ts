export const token = document.querySelector<HTMLMetaElement>('meta[name="hl-token"]')?.content ?? '';

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'x-hirelinks-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  return data;
}

export function events(onChange: () => void, onNotice: (m: string) => void): () => void {
  const es = new EventSource(`/api/events?token=${token}`);
  es.addEventListener('change', onChange);
  es.addEventListener('notice', (e) => onNotice(JSON.parse((e as MessageEvent).data) as string));
  return () => es.close();
}

export const fileUrl = (name: string) => `/api/files/${encodeURIComponent(name)}?token=${token}`;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export type SourceId = 'gupy' | 'linkedin' | 'indeed' | 'glassdoor' | 'getonboard' | 'remotive' | 'remoteok' | 'weworkremotely' | 'boards';
export type Role = 'frontend' | 'qa' | 'fullstack' | 'backend' | 'design' | 'other';
export type EnglishLevel = 'basic' | 'intermediate' | 'advanced' | 'fluent';

export interface Filters {
  minPercent: number; minRequirements: number; roles: Role[]; excludeIntern: boolean; excludeSenior: boolean;
  midMinPercent: number; maxAgeDays: number; cities: string[]; onsiteMinSalaryBRL: number;
}
export interface Settings {
  sources: SourceId[]; keywords: string[]; remoteRegion: string; boards: string[]; durationHours: number; target: number;
  maxJobs: number; skipPrevious: boolean; sheetLang: 'pt' | 'en'; browser: 'auto' | 'msedge' | 'chrome'; filters: Filters;
}
export interface Profile { skills: string[]; englishLevel: EnglishLevel; experienceYears: number }
export interface Job {
  link: string; jobKey: string; site: string; source: SourceId; title: string; company: string; location: string;
  workModel: 'remote' | 'hybrid' | 'onsite' | 'unknown'; seniority: 'intern' | 'junior' | 'mid' | 'senior' | 'unknown';
  percent: number; has: string[]; similar: { requirement: string; via: string }[]; missing: string[]; postedAt: string | null; collectedAt: string;
}
export interface Run {
  id: string; startedAt: string; deadline: string; endedAt: string | null; status: 'running' | 'done';
  stopReason: 'time' | 'user' | 'max' | 'exhausted' | null; target: number; file: string;
  sources: Partial<Record<SourceId, { status: 'waiting' | 'running' | 'done' | 'error' | 'stopped'; read: number; kept: number; error?: string }>>;
  rejected: Record<string, number>; jobs: Job[]; log: { at: string; msg: string }[]; needsYou: string | null;
}
export interface State {
  settings: Settings; profile: Profile; equivalences: string[][];
  defaults: { equivalences: string[][]; keywords: string[] };
  skills: string[];
  sources: { id: SourceId; label: string; kind: 'api' | 'guest' | 'browser' }[];
  rejectLabels: Record<string, { pt: string; en: string }>;
  running: boolean; run: Run | null; history: number;
  runs: { id: string; startedAt: string; endedAt: string | null; found: number; file: string; files: string[] }[];
}
