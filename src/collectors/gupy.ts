import { htmlToText } from '../core/html';
import type { Details, Lead } from '../core/types';
import { HttpError } from './http';
import { between, type Collector, type CollectorContext } from './types';

interface GupyJob {
  id: number;
  name: string;
  jobUrl: string;
  careerPageName?: string;
  city?: string;
  state?: string;
  workplaceType?: string;
  isRemoteWork?: boolean;
  publishedDate?: string;
  description?: string;
}

export function parseGupy(data: { data?: GupyJob[] }, ctx?: Pick<CollectorContext, 'http' | 'signal'>): Lead[] {
  return (data.data ?? []).map((j) => {
    const type = (j.workplaceType ?? '').toLowerCase();
    const remote = j.isRemoteWork === true || type === 'remote';
    const model = type === 'hybrid' ? 'Híbrido' : remote ? 'Remoto' : type ? 'Presencial' : '';
    const description = htmlToText(j.description ?? '');
    return {
      source: 'gupy' as const,
      url: j.jobUrl,
      title: j.name,
      company: j.careerPageName ?? '',
      location: [model, [j.city, j.state].filter(Boolean).join(' - ')].filter(Boolean).join(' · '),
      description,
      postedAt: j.publishedDate ? new Date(j.publishedDate).toISOString() : null,
      remote,
      ...(description.length < 300 && ctx ? { loadDetails: () => gupyDetails(j.jobUrl, ctx) } : {}),
    };
  });
}

/** Gupy job pages are Next.js: the full text is in __NEXT_DATA__ (description, responsibilities, prerequisites…). */
export async function gupyDetails(url: string, ctx: Pick<CollectorContext, 'http' | 'signal'>): Promise<Details> {
  const html = await ctx.http.text(url, ctx.signal);
  return { description: gupyTextFromHtml(html) };
}

export function gupyTextFromHtml(html: string): string {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m?.[1]) {
    try {
      const parts: string[] = [];
      const walk = (v: unknown, key = '') => {
        if (typeof v === 'string') {
          if (/description|responsibilit|prerequisit|requirement|relevantExperiences|aboutCompany/i.test(key) && v.length > 20) parts.push(htmlToText(v));
        } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
      };
      walk(JSON.parse(m[1]));
      const text = [...new Set(parts)].join('\n\n');
      if (text.length > 40) return text;
    } catch {
      /* falls back to the page text */
    }
  }
  return htmlToText(html.replace(/^[\s\S]*?<body[^>]*>/i, '')).slice(0, 15_000);
}

/**
 * Gupy changes the address its portal uses (portal.api.gupy.io and employability-portal.gupy.io stopped answering
 * in Oct/2026). HireLinks tries the current one first and falls back to the older ones; same { data, pagination } shape.
 */
export const GUPY_ENDPOINTS = [
  'https://portal.gupy.io/api/job-search/jobs',
  'https://employability-portal.gupy.io/api/v1/jobs',
  'https://portal.api.gupy.io/api/v1/jobs',
];

export const gupy: Collector = {
  id: 'gupy',
  label: 'Gupy',
  kind: 'api',
  async *run(ctx) {
    let endpoints = GUPY_ENDPOINTS;
    for (const kw of ctx.plan.keywords) {
      for (let offset = 0; offset < 200; offset += 50) {
        let data: { data?: GupyJob[]; pagination?: { total?: number } } | null = null;
        for (const ep of endpoints) {
          try {
            data = await ctx.http.json(`${ep}?jobName=${encodeURIComponent(kw)}&offset=${offset}&limit=50`, ctx.signal);
            endpoints = [ep]; // keeps the address that answered for the rest of the run
            break;
          } catch (e) {
            if (!(e instanceof HttpError) || (e.status !== 404 && e.status !== 410) || ep === endpoints[endpoints.length - 1]) throw e;
          }
        }
        yield* parseGupy(data ?? {}, ctx);
        if (!data?.data?.length || offset + 50 >= (data.pagination?.total ?? 0)) break;
        await between(ctx, 1500, 3500);
      }
    }
  },
};
