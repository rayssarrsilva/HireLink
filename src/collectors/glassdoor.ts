import type { Page } from 'playwright';
import { openClear, readDescription } from '../browser/pages';
import type { Lead } from '../core/types';
import { between, type Collector } from './types';

const ORIGIN = 'https://www.glassdoor.com.br';

interface GdCard {
  id: string;
  href: string;
  title: string;
  company: string;
  location: string;
  age: string;
}

/** "24h", "3d", "30d+" → days. */
export function glassdoorAgeDays(text: string): number | null {
  const t = text.toLowerCase().trim();
  if (/^\d+\s*h/.test(t)) return 0;
  const d = t.match(/(\d+)\s*d/);
  return d ? Number(d[1]) : null;
}

/** Always a link with "jl=", the format FlashHire expects for Glassdoor. */
export function glassdoorLink(href: string, id: string): string | null {
  try {
    const u = new URL(href || `${ORIGIN}/job-listing/vaga?jl=${id}`, ORIGIN);
    if (!u.searchParams.get('jl')) {
      if (!id) return null;
      u.searchParams.set('jl', id);
    }
    for (const k of [...u.searchParams.keys()]) if (k !== 'jl') u.searchParams.delete(k);
    return `${ORIGIN}${u.pathname}?jl=${u.searchParams.get('jl')}`;
  } catch {
    return null;
  }
}

export const glassdoor: Collector = {
  id: 'glassdoor',
  label: 'Glassdoor',
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
    const age = Math.min(30, Math.max(1, ctx.plan.maxAgeDays));
    try {
      for (const [q, l] of queries) {
        const url = ctx.http.rewrite(`${ORIGIN}/Job/jobs.htm?sc.keyword=${encodeURIComponent(q)}${l ? `&locKeyword=${encodeURIComponent(l)}` : ''}&fromAge=${age}`);
        const cards = await ctx.withBrowser(async () => {
          const p = await tab('list');
          const hasCards = async () => (await p.locator('[data-jobid], li[data-test="jobListing"], a[href*="jl="]').count()) > 0;
          if (!(await openClear(p, url, ctx, 'Glassdoor', hasCards))) return null;
          const all: GdCard[] = [];
          const seen = new Set<string>();
          for (let more = 0; more < 4; more++) {
            await p.keyboard.press('Escape').catch(() => {});
            for (const c of await readGlassdoorCards(p)) {
              const key = c.id || c.href;
              if (!seen.has(key)) {
                seen.add(key);
                all.push(c);
              }
            }
            const btn = p.locator('[data-test="load-more"], button:has-text("Mostrar mais vagas"), button:has-text("Show more jobs")').first();
            if (!(await btn.isVisible().catch(() => false))) break;
            await btn.click().catch(() => {});
            await between(ctx, 2500, 5000);
          }
          return all;
        });
        if (cards === null) {
          ctx.log('Glassdoor: a verificação ou o login não foi resolvido; pulei esta busca.');
          continue;
        }
        for (const c of cards) {
          const link = glassdoorLink(c.href, c.id);
          if (!link) continue;
          const days = glassdoorAgeDays(c.age);
          yield {
            source: 'glassdoor',
            url: link,
            title: c.title,
            company: c.company,
            location: c.location,
            description: '',
            postedAt: days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString(),
            loadDetails: () =>
              ctx.withBrowser(async () => {
                await between(ctx, 4000, 10_000);
                const p = await tab('detail');
                const sels = ['[class*="JobDetails_jobDescription"]', '[data-test="jobDescriptionContent"]', '.jobDescriptionContent', '#JobDescriptionContainer'];
                const ok = await openClear(p, ctx.http.rewrite(link), ctx, 'Glassdoor', async () => (await p.locator(sels.join(', ')).count()) > 0);
                return { description: ok ? await readDescription(p, sels) : '' };
              }),
          } satisfies Lead;
        }
        await between(ctx, 6000, 14_000);
      }
    } finally {
      await (list as Page | null)?.close().catch(() => {});
      await (detail as Page | null)?.close().catch(() => {});
    }
  },
};

function readGlassdoorCards(p: Page): Promise<GdCard[]> {
  return p.evaluate(() => {
    const text = (root: Element, sels: string) => ((root.querySelector(sels) as HTMLElement | null)?.innerText ?? '').trim();
    const items = Array.from(document.querySelectorAll('li[data-test="jobListing"], li[data-jobid]'));
    return items.map((li) => {
      const a = li.querySelector('a[data-test="job-link"], a[data-test="job-title"], a[href*="jl="], a[href*="job-listing"]') as HTMLAnchorElement | null;
      return {
        id: li.getAttribute('data-jobid') ?? li.querySelector('[data-jobid]')?.getAttribute('data-jobid') ?? '',
        href: a?.href ?? '',
        title: text(li, '[data-test="job-title"], [id^="job-title"]') || (a?.innerText ?? '').trim(),
        company: text(li, '[data-test="employer-short-name"], [class*="EmployerProfile_compactEmployerName"], [class*="employerName" i]'),
        location: text(li, '[data-test="emp-location"], [id^="job-location"]'),
        age: text(li, '[data-test="job-age"]'),
      };
    });
  });
}
