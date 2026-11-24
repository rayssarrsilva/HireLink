import { decodeEntities, htmlToText } from '../core/html';
import type { Lead, Seniority } from '../core/types';
import { between, type Collector } from './types';

// ---------- Remotive (public API · https://remotive.com/api/remote-jobs) ----------
interface RemotiveJob {
  url: string;
  title: string;
  company_name: string;
  publication_date?: string;
  candidate_required_location?: string;
  description?: string;
}

export function parseRemotive(data: { jobs?: RemotiveJob[] }): Lead[] {
  return (data.jobs ?? []).map((j) => ({
    source: 'remotive',
    url: j.url,
    title: j.title,
    company: j.company_name,
    location: `Remote · ${j.candidate_required_location ?? ''}`.trim(),
    description: htmlToText(j.description ?? ''),
    postedAt: j.publication_date ? new Date(j.publication_date).toISOString() : null,
    remote: true,
  }));
}

/** Remotive asks for few calls a day: two category calls per run, then filtered here. */
export const remotive: Collector = {
  id: 'remotive',
  label: 'Remotive',
  kind: 'api',
  async *run(ctx) {
    for (const q of ['category=software-dev', 'category=qa']) {
      const data = await ctx.http.json<{ jobs?: RemotiveJob[] }>(`https://remotive.com/api/remote-jobs?${q}`, ctx.signal);
      yield* parseRemotive(data);
      await between(ctx, 2000, 4000);
    }
  },
};

// ---------- Remote OK (public API · https://remoteok.com/api, element 0 is the legal notice) ----------
interface RemoteOkJob {
  id?: string;
  legal?: string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  date?: string;
  url?: string;
  tags?: string[];
}

export function parseRemoteOk(data: RemoteOkJob[]): Lead[] {
  return data
    .filter((j) => !j.legal && j.url && j.position)
    .map((j) => ({
      source: 'remoteok',
      url: j.url!,
      title: j.position!,
      company: j.company ?? '',
      location: `Remote · ${j.location ?? ''}`.trim(),
      description: `${htmlToText(j.description ?? '')}\n${(j.tags ?? []).join(', ')}`,
      postedAt: j.date ? new Date(j.date).toISOString() : null,
      remote: true,
    }));
}

export const remoteok: Collector = {
  id: 'remoteok',
  label: 'Remote OK',
  kind: 'api',
  async *run(ctx) {
    yield* parseRemoteOk(await ctx.http.json<RemoteOkJob[]>('https://remoteok.com/api', ctx.signal));
  },
};

// ---------- We Work Remotely (RSS per category) ----------
export function parseWwrRss(xml: string): Lead[] {
  const out: Lead[] = [];
  for (const item of xml.split(/<item>/).slice(1)) {
    const tag = (name: string) => {
      const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
      return m ? decodeEntities((m[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '';
    };
    const rawTitle = tag('title');
    const sep = rawTitle.indexOf(':');
    const link = tag('link') || tag('guid');
    if (!link) continue;
    const pub = tag('pubDate');
    out.push({
      source: 'weworkremotely',
      url: link,
      company: sep > 0 ? rawTitle.slice(0, sep).trim() : '',
      title: sep > 0 ? rawTitle.slice(sep + 1).trim() : rawTitle,
      location: `Remote · ${tag('region')}`.trim(),
      description: htmlToText(tag('description')),
      postedAt: pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null,
      remote: true,
    });
  }
  return out;
}

export const weworkremotely: Collector = {
  id: 'weworkremotely',
  label: 'We Work Remotely',
  kind: 'api',
  async *run(ctx) {
    for (const cat of ['remote-front-end-programming-jobs', 'remote-full-stack-programming-jobs']) {
      yield* parseWwrRss(await ctx.http.text(`https://weworkremotely.com/categories/${cat}.rss`, ctx.signal, 'application/rss+xml'));
      await between(ctx, 2000, 4000);
    }
  },
};

// ---------- Get on Board (public API · /api/v0/search/jobs) ----------
interface GobJob {
  id: string;
  attributes: {
    title: string;
    description?: string;
    functions?: string;
    desirable?: string;
    remote?: boolean;
    remote_modality?: string;
    countries?: string[];
    published_at?: number;
    seniority?: { data?: { id?: number } };
    company?: { data?: { attributes?: { name?: string } } };
  };
  links?: { public_url?: string };
}

// Get on Board seniority ids: 1 no experience, 2 junior, 3 semi senior, 4 senior, 5 expert.
const GOB_SENIORITY: Record<number, Seniority> = { 1: 'junior', 2: 'junior', 3: 'mid', 4: 'senior', 5: 'senior' };

export function parseGetOnBoard(data: { data?: GobJob[] }): Lead[] {
  return (data.data ?? []).map((j) => {
    const a = j.attributes;
    const modality = a.remote_modality ?? (a.remote ? 'fully_remote' : 'no_remote');
    const remote = modality === 'fully_remote' || modality === 'remote_local' || modality === 'temporarily_remote';
    const level = a.seniority?.data?.id;
    return {
      source: 'getonboard' as const,
      url: j.links?.public_url ?? `https://www.getonbrd.com/jobs/${j.id}`,
      title: a.title,
      company: a.company?.data?.attributes?.name ?? '',
      location: `${modality === 'hybrid' ? 'Hybrid' : remote ? 'Remote' : 'On-site'} · ${(a.countries ?? []).join(', ')}`,
      description: htmlToText([a.description, a.functions, a.desirable].filter(Boolean).join('\n')),
      postedAt: a.published_at ? new Date(a.published_at * 1000).toISOString() : null,
      remote,
      ...(level && GOB_SENIORITY[level] ? { seniorityHint: GOB_SENIORITY[level] } : {}),
    };
  });
}

export const getonboard: Collector = {
  id: 'getonboard',
  label: 'Get on Board',
  kind: 'api',
  async *run(ctx) {
    for (const kw of ctx.plan.keywords) {
      for (let page = 1; page <= 5; page++) {
        const url = `https://www.getonbrd.com/api/v0/search/jobs?query=${encodeURIComponent(kw)}&per_page=50&page=${page}&expand=${encodeURIComponent('["company"]')}`;
        const data = await ctx.http.json<{ data?: GobJob[]; meta?: { total_pages?: number } }>(url, ctx.signal);
        yield* parseGetOnBoard(data);
        if (!data.data?.length || page >= (data.meta?.total_pages ?? 1)) break;
        await between(ctx, 1500, 3500);
      }
    }
  },
};
