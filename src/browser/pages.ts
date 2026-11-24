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

/**
 * Goes to a URL and, when the site shows a check or a login wall, asks the candidate to handle it
 * in the browser window, waiting until the page is usable again. Returns false if she did not.
 */
export async function openClear(page: Page, url: string, ctx: CollectorContext, site: string, ready: () => Promise<boolean>): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(Math.round(1500 * ctx.pace) + 200);
  if (await isChallenge(page)) {
    return ctx.waitForYou(`${site} pediu uma verificação "você é humano?". Resolva na janela do navegador; depois disso a coleta continua sozinha.`, async () => !(await isChallenge(page)) && (await ready()));
  }
  if (!(await ready()) && (await isLoginWall(page))) {
    return ctx.waitForYou(`${site} pediu login. Entre na sua conta na janela do navegador (só uma vez); depois disso a coleta continua sozinha.`, ready);
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
