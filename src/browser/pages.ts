import type { Page } from 'playwright';
import type { CollectorContext } from '../collectors/types';

/** "Are you human?" pages (Cloudflare and similar). HireLinks never tries to solve them: it asks the candidate. */
export async function isChallenge(page: Page): Promise<boolean> {
  const title = (await page.title().catch(() => '')).toLowerCase();
  if (/just a moment|um momento|attention required|security check|verify you are human|verifica[çc][aã]o/.test(title)) return true;
  return (await page.locator('iframe[src*="challenges.cloudflare.com"], #challenge-form, #px-captcha, iframe[title*="captcha" i]').count().catch(() => 0)) > 0;
}

export async function isLoginWall(page: Page): Promise<boolean> {
  return (await page.locator('[data-test="authModal"], form[action*="login" i] input[type="password"], #LoginModal').count().catch(() => 0)) > 0;
}

/** Checks per site in this run. */
const checks = new WeakMap<CollectorContext, Map<string, number>>();

/**
 * Goes to a URL and, when the site shows a check or a login wall, asks the candidate to handle it.
 * Careful by design: the first check waits for her; if the same site asks again (or the check is not cleared),
 * HireLinks stops that site for the rest of the run instead of insisting. Returns false when the page is not usable.
 */
export async function openClear(page: Page, url: string, ctx: CollectorContext, site: string, ready: () => Promise<boolean>): Promise<boolean> {
  if (ctx.isBlocked(site)) return false;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(Math.round(1500 * ctx.pace) + 200);
  if (await isChallenge(page)) {
    const map = checks.get(ctx) ?? new Map<string, number>();
    checks.set(ctx, map);
    const n = (map.get(site) ?? 0) + 1;
    map.set(site, n);
    if (n > 1) {
      ctx.block(site, `${site} pediu a verificação "você é humano?" de novo. Parei o ${site} nesta coleta para não arriscar; os outros sites continuam.`);
      return false;
    }
    const ok = await ctx.waitForYou(
      `${site} pediu uma verificação "você é humano?". Marque a caixa na janela do navegador (só desta vez). Se aparecer de novo, eu paro o ${site} e sigo com os outros sites.`,
      async () => !(await isChallenge(page)) && (await ready()),
    );
    if (!ok) ctx.block(site, `A verificação do ${site} não liberou. Parei o ${site} nesta coleta; os outros sites continuam.`);
    return ok;
  }
  if (!(await ready()) && (await isLoginWall(page))) {
    const ok = await ctx.waitForYou(
      `${site} pediu login. Entre com e-mail e senha na janela do navegador (o botão "Continuar com Google" não funciona nessa janela). Depois disso a coleta continua sozinha.`,
      ready,
    );
    if (!ok) ctx.block(site, `${site} continuou pedindo login. Parei o ${site} nesta coleta; os outros sites continuam.`);
    return ok;
  }
  return true;
}

/** The largest text block that looks like a job description (same idea as FlashHire's extractor). */
export async function readDescription(page: Page, selectors: string[]): Promise<string> {
  return page.evaluate((sels) => {
    const clean = (s: string | null | undefined) => (s ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    for (const s of sels) {
      const t = clean((document.querySelector(s) as HTMLElement | null)?.innerText);
      if (t.length > 150) return t.slice(0, 15_000);
    }
    let best = '';
    for (const el of Array.from(document.querySelectorAll('[class*="description" i], [id*="description" i], article, main, section')) as HTMLElement[]) {
      const t = clean(el.innerText);
      if (t.length > best.length && t.length < 30_000) best = t;
    }
    return (best.length > 200 ? best : clean(document.body.innerText)).slice(0, 15_000);
  }, selectors);
}
