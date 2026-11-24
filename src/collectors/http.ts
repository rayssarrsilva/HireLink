export class RateLimited extends Error {
  constructor(
    public url: string,
    public retryAfterMs: number,
  ) {
    super(`Limite de acessos atingido em ${new URL(url).host}`);
  }
}

export class HttpError extends Error {
  constructor(
    public url: string,
    public status: number,
  ) {
    super(`HTTP ${status} em ${new URL(url).host}`);
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * fetch with timeout and a couple of retries. `overrides` maps a real origin to another one
 * (used by the tests to point every site at a local fake server).
 */
export class Http {
  constructor(private overrides: Record<string, string> = {}) {}

  rewrite(url: string): string {
    const u = new URL(url);
    const to = this.overrides[u.origin];
    return to ? to.replace(/\/$/, '') + u.pathname + u.search : url;
  }

  async text(url: string, signal: AbortSignal, accept = 'text/html,application/json;q=0.9,*/*;q=0.8'): Promise<string> {
    const target = this.rewrite(url);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(target, {
          headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
          redirect: 'follow',
        });
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after'));
          throw new RateLimited(url, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
        }
        if (res.status >= 500) throw new HttpError(url, res.status);
        if (!res.ok) throw Object.assign(new HttpError(url, res.status), { final: true });
        return await res.text();
      } catch (e) {
        if (signal.aborted || e instanceof RateLimited || (e as { final?: boolean }).final) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async json<T>(url: string, signal: AbortSignal): Promise<T> {
    return JSON.parse(await this.text(url, signal, 'application/json')) as T;
  }
}
