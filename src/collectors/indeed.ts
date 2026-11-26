import type { Page } from 'playwright';
import { openClear, readDescription } from '../browser/pages';
import type { Lead } from '../core/types';
import { between, type Collector, type CollectorContext } from './types';

const ORIGIN = 'https://br.indeed.com';

interface IndeedCard {
  jk: string;
  title: string;
  company: string;
  location: string;
  age: string;
}

/** "Publicada há 3 dias", "Just posted", "30+ days ago" → days (null when unknown). */
export function indeedAgeDays(text: string): number | null {
  const t = text.toLowerCase();
  if (/hoje|today|just posted|agora|recente|active/.test(t)) return 0;
  const n = t.match(/(\d+)\+?\s*(dia|day)/);
  return n ? Number(n[1]) : null;
}

/** Indeed accepts 1, 3, 7 or 14 days in "fromage". */
export const indeedFromAge = (days: number) => [1, 3, 7, 14].find((d) => d >= days) ?? 14;

export const indeed: Collector = {
  id: 'indeed',
  label: 'Indeed',
  kind: 'browser',
  async *run(ctx) {
    let list: Page | null = null;
    let detail: Page | null = null;
    const tab = async (which: 'list' | 'detail') => {
      const current = which === 'list' ? list : detail;
      if (current && !current.isClosed()) return current;
      const p = await (await ctx.browser()).newPage();
      if (which === 'list') list = p;
      else detail = p;
      return p;
    };
    const queries: [string, string][] = [];
    for (const kw of ctx.plan.keywords) {
      queries.push([kw, '']);
      for (const city of ctx.plan.cities) queries.push([kw, city]);
    }
    try {
      for (const [q, l] of queries) {
        for (let page = 0; page < 5; page++) {
          const url = ctx.http.rewrite(`${ORIGIN}/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(l)}&fromage=${indeedFromAge(ctx.plan.maxAgeDays)}&start=${page * 10}`);
          const cards = await ctx.withBrowser('Indeed', async () => {
            const p = await tab('list');
            const ok = await openClear(p, url, ctx, 'Indeed', async () => (await p.locator('[data-jk]').count()) > 0 || (await p.locator('#mosaic-provider-jobcards, .jobsearch-NoResult-messageContainer').count()) > 0);
            return ok ? readIndeedCards(p) : null;
          });
          if (cards === null) {
            if (ctx.isBlocked('Indeed')) return;
            break;
          }
          if (!cards.length) break;
          for (const c of cards) {
            if (ctx.isBlocked('Indeed')) return;
            const days = indeedAgeDays(c.age);
            yield {
              source: 'indeed',
              url: `${ORIGIN}/viewjob?jk=${c.jk}`,
              title: c.title,
              company: c.company,
              location: c.location,
              description: '',
              postedAt: days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString(),
              loadDetails: () =>
                ctx.withBrowser('Indeed', async () => {
                  if (ctx.isBlocked('Indeed')) return { description: '' };
                  await between(ctx, 4000, 10_000);
                  const p = await tab('detail');
                  const ok = await openClear(p, ctx.http.rewrite(`${ORIGIN}/viewjob?jk=${c.jk}`), ctx, 'Indeed', async () => (await p.locator('#jobDescriptionText').count()) > 0);
                  return { description: ok ? await readDescription(p, ['#jobDescriptionText']) : '' };
                }),
            } satisfies Lead;
          }
          await between(ctx, 5000, 12_000);
        }
      }
    } finally {
      await (list as Page | null)?.close().catch(() => {});
      await (detail as Page | null)?.close().catch(() => {});
    }
  },
};

function readIndeedCards(p: Page): Promise<IndeedCard[]> {
  return p.evaluate(() => {
    const text = (root: Element, sels: string) => ((root.querySelector(sels) as HTMLElement | null)?.innerText ?? '').trim();
    const out: { jk: string; title: string; company: string; location: string; age: string }[] = [];
    const seen = new Set<string>();
    for (const a of Array.from(document.querySelectorAll('a[data-jk]'))) {
      const jk = a.getAttribute('data-jk') ?? '';
      if (!jk || seen.has(jk)) continue;
      seen.add(jk);
      const card = a.closest('li, .job_seen_beacon, .result') ?? a;
      out.push({
        jk,
        title: ((a.querySelector('span[title]') as HTMLElement | null)?.getAttribute('title') ?? (a as HTMLElement).innerText ?? '').trim(),
        company: text(card, '[data-testid="company-name"], .companyName'),
        location: text(card, '[data-testid="text-location"], .companyLocation'),
        age: text(card, '[data-testid="myJobsStateDate"], .date, [class*="date" i]'),
      });
    }
    return out;
  });
}
