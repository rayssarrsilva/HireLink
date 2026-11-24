import { htmlToText } from '../core/html';
import type { Lead } from '../core/types';
import { HttpError } from './http';
import { between, type Collector } from './types';

export type BoardAts = 'greenhouse' | 'lever' | 'ashby';
export interface Board {
  ats: BoardAts;
  slug: string;
}

/**
 * Accepts what the candidate pastes: a careers link (job-boards.greenhouse.io/acme, jobs.lever.co/acme,
 * jobs.ashbyhq.com/acme) or "greenhouse:acme".
 */
export function parseBoard(raw: string): Board | null {
  const s = raw.trim();
  const short = s.match(/^(greenhouse|lever|ashby)\s*:\s*([\w.-]+)$/i);
  if (short) return { ats: short[1]!.toLowerCase() as BoardAts, slug: short[2]! };
  let u: URL;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const first = u.pathname.split('/').filter(Boolean)[0];
  const host = u.hostname;
  if (/greenhouse\.io$/.test(host)) {
    const slug = host.startsWith('boards-api.') ? u.pathname.match(/boards\/([\w.-]+)/)?.[1] : (u.searchParams.get('for') ?? first);
    return slug ? { ats: 'greenhouse', slug } : null;
  }
  if (/lever\.co$/.test(host) && first) return { ats: 'lever', slug: first };
  if (/ashbyhq\.com$/.test(host) && first) return { ats: 'ashby', slug: first };
  return null;
}

const nice = (slug: string) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  content?: string;
  company_name?: string;
}
export function parseGreenhouse(slug: string, data: { jobs?: GhJob[] }): Lead[] {
  return (data.jobs ?? []).map((j) => ({
    source: 'boards',
    url: `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}`,
    title: j.title,
    company: j.company_name ?? nice(slug),
    location: j.location?.name ?? '',
    description: htmlToText(j.content ?? ''),
    postedAt: j.first_published ?? j.updated_at ?? null,
  }));
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; commitment?: string };
  descriptionPlain?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
}
export function parseLever(slug: string, data: LeverJob[]): Lead[] {
  return data.map((j) => ({
    source: 'boards',
    url: j.hostedUrl ?? `https://jobs.lever.co/${slug}/${j.id}`,
    title: j.text,
    company: nice(slug),
    location: [j.workplaceType === 'remote' ? 'Remote' : j.workplaceType === 'hybrid' ? 'Hybrid' : '', j.categories?.location ?? ''].filter(Boolean).join(' · '),
    description: [j.descriptionPlain ?? '', ...(j.lists ?? []).map((l) => `${l.text ?? ''}\n${htmlToText(l.content ?? '')}`), j.additionalPlain ?? ''].join('\n'),
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    remote: j.workplaceType === 'remote',
  }));
}

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}
export function parseAshby(slug: string, data: { jobs?: AshbyJob[] }): Lead[] {
  return (data.jobs ?? []).map((j) => ({
    source: 'boards',
    url: j.jobUrl ?? `https://jobs.ashbyhq.com/${slug}/${j.id}`,
    title: j.title,
    company: nice(slug),
    location: [j.isRemote ? 'Remote' : (j.workplaceType ?? ''), j.location ?? ''].filter(Boolean).join(' · '),
    description: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ''),
    postedAt: j.publishedAt ?? null,
    remote: j.isRemote === true,
  }));
}

export const boards: Collector = {
  id: 'boards',
  label: 'Greenhouse · Lever · Ashby',
  kind: 'api',
  async *run(ctx) {
    for (const raw of ctx.plan.boards) {
      const b = parseBoard(raw);
      if (!b) {
        ctx.log(`Não reconheci "${raw}" como página de vagas do Greenhouse, Lever ou Ashby.`);
        continue;
      }
      try {
        if (b.ats === 'greenhouse') yield* parseGreenhouse(b.slug, await ctx.http.json(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`, ctx.signal));
        if (b.ats === 'lever') yield* parseLever(b.slug, await ctx.http.json(`https://api.lever.co/v0/postings/${b.slug}?mode=json`, ctx.signal));
        if (b.ats === 'ashby') yield* parseAshby(b.slug, await ctx.http.json(`https://api.ashbyhq.com/posting-api/job-board/${b.slug}`, ctx.signal));
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) ctx.log(`${nice(b.slug)} (${b.ats}): página de vagas não encontrada.`);
        else throw e;
      }
      await between(ctx, 1000, 2500);
    }
  },
};
