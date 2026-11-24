import type { BrowserContext } from 'playwright';
import type { Lead, SourceId } from '../core/types';
import type { Http } from './http';

export interface SearchPlan {
  keywords: string[];
  /** Region for remote searches on LinkedIn (e.g. "Brasil"). */
  remoteRegion: string;
  /** Cities searched for on-site/hybrid jobs. */
  cities: string[];
  maxAgeDays: number;
  /** Company career boards (Greenhouse, Lever, Ashby): links or "greenhouse:slug". */
  boards: string[];
}

export interface CollectorContext {
  plan: SearchPlan;
  http: Http;
  signal: AbortSignal;
  /** Opens (once) HireLinks' own browser profile. Only for sites that need a real browser. */
  browser: () => Promise<BrowserContext>;
  /** Only one browser tab works at a time, at a human pace. */
  withBrowser: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Asks the candidate to act in the browser window (login wall, "are you human" check) and waits. */
  waitForYou: (message: string, done: () => Promise<boolean>) => Promise<boolean>;
  log: (msg: string) => void;
  /** Multiplies every pause (0 in tests). */
  pace: number;
}

export interface Collector {
  id: SourceId;
  label: string;
  /** api: public feed or API · guest: public pages read over HTTP · browser: real browser at a human pace. */
  kind: 'api' | 'guest' | 'browser';
  run(ctx: CollectorContext): AsyncGenerator<Lead>;
}

export class Aborted extends Error {
  constructor() {
    super('aborted');
  }
}

/** Sleep that ends early (throwing) when the run stops. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Aborted());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export const between = (ctx: CollectorContext, min: number, max: number) =>
  wait(Math.round((min + Math.random() * (max - min)) * ctx.pace), ctx.signal);
