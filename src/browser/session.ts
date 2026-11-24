import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';

/**
 * esbuild (used by tsx) can wrap functions with __name(); functions passed to
 * page.evaluate then fail in the page. This shim makes them safe in every frame.
 */
export const EVALUATE_SHIM = 'globalThis.__name = globalThis.__name || ((f) => f);';

export type BrowserChoice = 'auto' | 'msedge' | 'chrome';

export interface BrowserOptions {
  /** Folder that keeps HireLinks's own browser profiles (one per browser). */
  profileDir: string;
  /** Installed browser to use. 'auto' tries Edge first on Windows (it always comes with it), then Chrome. */
  channel?: BrowserChoice | undefined;
  executablePath?: string | undefined;
  headless?: boolean;
}

export function channelsToTry(choice: BrowserChoice = 'auto', platform = process.platform): ('msedge' | 'chrome')[] {
  if (choice !== 'auto') return [choice];
  return platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'msedge'];
}

let resolved: 'msedge' | 'chrome' | null = null;

/** Name shown to the candidate ("Edge" / "Chrome"). */
export function browserName(): string {
  return resolved === 'msedge' ? 'Edge' : resolved === 'chrome' ? 'Chrome' : 'navegador';
}

/**
 * Opens HireLinks's own browser profile (kept between runs, separate from the candidate's
 * everyday profile), used for Indeed and Glassdoor (she signs in there only if a site asks). Passwords never reach HireLinks.
 */
export async function openContext(o: BrowserOptions): Promise<BrowserContext> {
  const errors: string[] = [];
  const candidates = o.executablePath ? [null] : channelsToTry(o.channel);
  for (const channel of candidates) {
    try {
      const ctx = await chromium.launchPersistentContext(channel ? join(o.profileDir, channel) : o.profileDir, {
        channel: channel ?? undefined,
        executablePath: o.executablePath,
        headless: o.headless ?? false,
        viewport: null,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        args: ['--start-maximized'],
      });
      resolved = channel ?? 'chrome';
      await ctx.addInitScript({ content: EVALUATE_SHIM });
      return ctx;
    } catch (e) {
      errors.push(`${channel}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(`Não consegui abrir o navegador (${errors.join(' | ')}). Confira se o Edge ou o Chrome está instalado.`);
}
