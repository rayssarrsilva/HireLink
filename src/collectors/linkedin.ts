import { decodeEntities, htmlToText, textOfClass } from '../core/html';
import type { Details, Lead, Seniority } from '../core/types';
import { RateLimited } from './http';
import { between, wait, type Collector, type CollectorContext } from './types';

/**
 * LinkedIn's public guest job pages (the same ones shown to logged-out visitors), read slowly.
 * No login is used, so the candidate's account is never involved.
 */
const SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/';

export interface LinkedInCard {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string | null;
}

export function parseLinkedInCards(html: string): LinkedInCard[] {
  const cards: LinkedInCard[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split(/<li[\s>]/).slice(1)) {
    const id = chunk.match(/urn:li:jobPosting:(\d+)/)?.[1] ?? chunk.match(/\/jobs\/view\/[^"?]*?-?(\d{6,})/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const date = chunk.match(/<time[^>]*datetime="([\d-]+)"/)?.[1];
    cards.push({
      id,
      title: textOfClass(chunk, 'base-search-card__title'),
      company: textOfClass(chunk, 'base-search-card__subtitle'),
      location: textOfClass(chunk, 'job-search-card__location'),
      postedAt: date ? new Date(`${date}T12:00:00Z`).toISOString() : null,
    });
  }
  return cards;
}

const LEVELS: [RegExp, Seniority][] = [
  [/internship|est[aá]gio/i, 'intern'],
  [/entry level|assistente|j[uú]nior|associate/i, 'junior'],
  [/mid-senior|pleno/i, 'mid'],
  [/director|diretor|executiv/i, 'senior'],
];

export function parseLinkedInDetail(html: string): { description: string; seniority: Seniority | null } {
  const start = html.search(/show-more-less-html__markup/);
  let description = '';
  if (start >= 0) {
    const from = html.indexOf('>', start) + 1;
    const stops = ['show-more-less-html__button', 'description__job-criteria', '</section>'].map((s) => html.indexOf(s, from)).filter((i) => i > 0);
    description = htmlToText(html.slice(from, stops.length ? Math.min(...stops) : undefined).replace(/<button[\s\S]*$/, ''));
  }
  if (!description) description = htmlToText(html).slice(0, 15_000);
  let seniority: Seniority | null = null;
  const crit = html.match(/description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/);
  const level = crit ? decodeEntities(crit[1] ?? '').trim() : '';
  for (const [re, s] of LEVELS) if (re.test(level)) {
    seniority = s;
    break;
  }
  return { description, seniority };
}

export const linkedin: Collector = {
  id: 'linkedin',
  label: 'LinkedIn',
  kind: 'guest',
  async *run(ctx) {
    const seconds = Math.max(1, ctx.plan.maxAgeDays) * 86_400;
    const searches: string[] = [];
    for (const kw of ctx.plan.keywords) {
      if (ctx.plan.remoteRegion.trim()) searches.push(`keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(ctx.plan.remoteRegion)}&f_WT=2`);
      for (const city of ctx.plan.cities) searches.push(`keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(city)}`);
    }
    let strikes = 0;
    for (const q of searches) {
      for (let start = 0; start < 100; ) {
        let html: string;
        try {
          html = await ctx.http.text(`${SEARCH}?${q}&f_TPR=r${seconds}&start=${start}`, ctx.signal);
          strikes = 0;
        } catch (e) {
          if (!(e instanceof RateLimited)) throw e;
          if (++strikes >= 3) {
            ctx.log('LinkedIn pediu para diminuir o ritmo três vezes seguidas; parei o LinkedIn nesta coleta.');
            return;
          }
          ctx.log(`LinkedIn pediu uma pausa; volto em ${Math.round((e.retryAfterMs * strikes) / 60_000)} min.`);
          await wait(e.retryAfterMs * strikes * Math.min(1, ctx.pace || 0), ctx.signal);
          continue;
        }
        const cards = parseLinkedInCards(html);
        if (!cards.length) break;
        for (const c of cards) {
          yield {
            source: 'linkedin',
            url: `https://www.linkedin.com/jobs/view/${c.id}/`,
            title: c.title,
            company: c.company,
            location: c.location,
            description: '',
            postedAt: c.postedAt,
            loadDetails: () => detail(c.id, ctx),
          } satisfies Lead;
        }
        start += cards.length;
        await between(ctx, 3000, 7000);
      }
    }
  },
};

/** Detail page: the description plus the seniority LinkedIn states. */
async function detail(id: string, ctx: CollectorContext): Promise<Details> {
  await between(ctx, 2500, 6000);
  const { description, seniority } = parseLinkedInDetail(await ctx.http.text(DETAIL + id, ctx.signal));
  return seniority ? { description, seniorityHint: seniority } : { description };
}
