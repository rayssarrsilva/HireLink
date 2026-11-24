import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { openContext, type BrowserChoice } from '../browser/session';
import { COLLECTORS, SOURCE_IDS } from '../collectors';
import { Http, HttpError, RateLimited } from '../collectors/http';
import { Aborted, wait, type CollectorContext } from '../collectors/types';
import { cleanGroups, DEFAULT_EQUIVALENCES, requirementFit } from '../core/fit';
import { DEFAULT_FILTERS, evaluate, rejectReason, roleFromTitle, type FilterSettings } from '../core/filters';
import { detectSite } from '../core/sites';
import { normalize } from '../core/text';
import type { CollectedJob, Lead, Profile, SourceId } from '../core/types';
import { toCsv, toXlsx, writeAtomic, type UiLang } from '../export/sheet';
import type { Store } from '../store/store';

export interface Settings {
  sources: SourceId[];
  keywords: string[];
  remoteRegion: string;
  boards: string[];
  durationHours: number;
  /** Goal shown on screen ("at least 20"). The run keeps going after it until the time is up. */
  target: number;
  /** 0 = no limit. */
  maxJobs: number;
  skipPrevious: boolean;
  sheetLang: UiLang;
  browser: BrowserChoice;
  filters: FilterSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  sources: SOURCE_IDS.filter((s) => s !== 'boards'),
  keywords: ['front-end', 'frontend developer', 'react', 'analista de QA', 'QA tester', 'teste de software'],
  remoteRegion: 'Brasil',
  boards: [],
  durationHours: 3,
  target: 20,
  maxJobs: 0,
  skipPrevious: true,
  sheetLang: 'pt',
  browser: 'auto',
  filters: DEFAULT_FILTERS,
};

export const EMPTY_PROFILE: Profile = { skills: [], englishLevel: 'intermediate', experienceYears: 0 };

type SourceStatus = 'waiting' | 'running' | 'done' | 'error' | 'stopped';

export interface RunState {
  id: string;
  startedAt: string;
  deadline: string;
  endedAt: string | null;
  status: 'running' | 'done';
  stopReason: 'time' | 'user' | 'max' | 'exhausted' | null;
  target: number;
  file: string;
  sources: Partial<Record<SourceId, { status: SourceStatus; read: number; kept: number; error?: string }>>;
  rejected: Record<string, number>;
  jobs: CollectedJob[];
  log: { at: string; msg: string }[];
  needsYou: string | null;
}

export interface EngineOptions {
  dataDir: string;
  exportDir: string;
  /** Tests: point sites to a local server and skip waiting. */
  httpOverrides?: Record<string, string>;
  pace?: number;
  executablePath?: string;
  headless?: boolean;
  /** Tests: how long to wait for the candidate before skipping (ms). */
  waitForYouMs?: number;
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
};

export class Engine extends EventEmitter {
  run: RunState | null = null;
  private ctrl: AbortController | null = null;
  private ctx: BrowserContext | null = null;
  private opening: Promise<BrowserContext> | null = null;
  private browserLock: Promise<unknown> = Promise.resolve();
  private exportTimer: NodeJS.Timeout | null = null;
  private changeTimer: NodeJS.Timeout | null = null;
  private seenKeys = new Set<string>();
  private seenTitles = new Set<string>();

  constructor(
    private store: Store,
    private o: EngineOptions,
  ) {
    super();
    mkdirSync(o.exportDir, { recursive: true });
  }

  get settings(): Settings {
    const s = this.store.getJson<Partial<Settings>>('settings', {});
    return { ...DEFAULT_SETTINGS, ...s, filters: { ...DEFAULT_FILTERS, ...(s.filters ?? {}) } };
  }
  get profile(): Profile {
    return { ...EMPTY_PROFILE, ...this.store.getJson<Partial<Profile>>('profile', {}) };
  }
  get equivalences(): string[][] {
    return this.store.getJson('equivalences', DEFAULT_EQUIVALENCES);
  }
  get isRunning(): boolean {
    return this.run?.status === 'running';
  }

  start(): RunState {
    if (this.isRunning) throw new Error('Já existe uma coleta rodando.');
    const s = this.settings;
    const profile = this.profile;
    if (!profile.skills.length) throw new Error('Adicione suas habilidades em "Seu perfil" antes de coletar.');
    if (!s.sources.length) throw new Error('Escolha pelo menos um site.');
    if (!s.keywords.length && s.sources.some((x) => x !== 'boards' && x !== 'remoteok' && x !== 'weworkremotely' && x !== 'remotive'))
      throw new Error('Escreva pelo menos uma palavra-chave.');

    const now = new Date();
    const durationMs = Math.round(s.durationHours * 3_600_000);
    this.run = {
      id: stamp(now),
      startedAt: now.toISOString(),
      deadline: new Date(now.getTime() + durationMs).toISOString(),
      endedAt: null,
      status: 'running',
      stopReason: null,
      target: s.target,
      file: `HireLinks_${stamp(now)}`,
      sources: Object.fromEntries(s.sources.map((id) => [id, { status: 'waiting' as SourceStatus, read: 0, kept: 0 }])),
      rejected: {},
      jobs: [],
      log: [],
      needsYou: null,
    };
    this.seenKeys = s.skipPrevious ? this.store.historyKeys() : new Set();
    this.seenTitles = new Set();
    this.store.saveRun({ id: this.run.id, startedAt: this.run.startedAt, endedAt: null, found: 0, file: this.run.file });

    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const timer = setTimeout(() => this.abort('time'), durationMs);
    this.log(`Coleta iniciada: ${s.sources.length} site(s), até ${s.durationHours} h, meta de ${s.target} vagas.`);
    void this.loop(s, profile, ctrl.signal).finally(() => clearTimeout(timer));
    this.changed();
    return this.run;
  }

  stop(): void {
    this.abort('user');
  }

  private abort(reason: NonNullable<RunState['stopReason']>): void {
    if (!this.run || this.run.status !== 'running' || this.ctrl?.signal.aborted) return;
    this.run.stopReason = reason;
    this.ctrl?.abort();
  }

  private async loop(s: Settings, profile: Profile, signal: AbortSignal): Promise<void> {
    const run = this.run!;
    const http = new Http(this.o.httpOverrides);
    const groups = cleanGroups(this.equivalences);
    const ctx: CollectorContext = {
      plan: { keywords: s.keywords, remoteRegion: s.remoteRegion, cities: s.filters.cities, maxAgeDays: s.filters.maxAgeDays, boards: s.boards },
      http,
      signal,
      pace: this.o.pace ?? 1,
      log: (m) => this.log(m),
      // One shared browser for Indeed and Glassdoor: the promise is kept so both never open the same profile twice.
      browser: () => {
        if (this.ctx) return Promise.resolve(this.ctx);
        this.opening ??= openContext({
          profileDir: join(this.o.dataDir, 'browser'),
          channel: s.browser,
          executablePath: this.o.executablePath,
          headless: this.o.headless ?? false,
        })
          .then((c) => {
            this.ctx = c;
            c.on('close', () => (this.ctx = null));
            return c;
          })
          .finally(() => (this.opening = null));
        return this.opening;
      },
      withBrowser: <T>(fn: () => Promise<T>) => {
        const next = this.browserLock.then(fn, fn);
        this.browserLock = next.catch(() => undefined);
        return next;
      },
      waitForYou: async (message, done) => {
        run.needsYou = message;
        this.log(message);
        this.emit('notice', message);
        this.changed();
        try {
          for (const p of this.ctx?.pages() ?? []) await p.bringToFront().catch(() => {});
          const until = Date.now() + (this.o.waitForYouMs ?? 5 * 60_000);
          while (Date.now() < until) {
            await wait(3000 * Math.min(1, ctx.pace || 0.05), signal);
            if (await done().catch(() => false)) return true;
          }
          return false;
        } finally {
          run.needsYou = null;
          this.changed();
        }
      },
    };

    await Promise.allSettled(
      s.sources.map(async (id) => {
        const c = COLLECTORS[id];
        const st = run.sources[id]!;
        st.status = 'running';
        this.changed();
        try {
          for await (const lead of c.run(ctx)) {
            if (signal.aborted) break;
            st.read++;
            if (await this.consider(lead, profile, groups, s, signal)) st.kept++;
            this.changed();
          }
          st.status = signal.aborted ? 'stopped' : 'done';
        } catch (e) {
          if (signal.aborted || e instanceof Aborted || (e as Error).name === 'AbortError') st.status = 'stopped';
          else {
            st.status = 'error';
            st.error = friendlyError(e);
            this.log(`${c.label}: ${st.error}${st.error !== (e as Error).message ? ` (detalhe: ${String((e as Error).message ?? e).split('\n')[0]})` : ''}`);
          }
        }
        this.changed();
      }),
    );

    if (!run.stopReason) run.stopReason = 'exhausted';
    run.status = 'done';
    run.endedAt = new Date().toISOString();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    await this.exportNow();
    this.store.saveRun({ id: run.id, startedAt: run.startedAt, endedAt: run.endedAt, found: run.jobs.length, file: run.file });
    const why = { time: 'o tempo acabou', user: 'você parou', max: 'chegou ao máximo de vagas', exhausted: 'os sites não tinham mais vagas novas' }[run.stopReason];
    const goal = run.jobs.length >= run.target ? 'meta atingida' : `abaixo da meta de ${run.target}`;
    this.log(`Coleta encerrada (${why}): ${run.jobs.length} vaga(s), ${goal}.`);
    this.emit('notice', `HireLinks: ${run.jobs.length} vaga(s) na planilha.`);
    this.changed(true);
  }

  /** Decides if a job goes to the spreadsheet. Returns true when it does. */
  private async consider(lead: Lead, profile: Profile, groups: string[][], s: Settings, signal: AbortSignal): Promise<boolean> {
    const run = this.run!;
    const info = detectSite(lead.url);
    if (info.warning || !info.jobKey) return this.reject('invalid-link');
    if (this.seenKeys.has(info.jobKey)) return this.reject('duplicate');
    const titleKey = `${normalize(lead.company)}|${normalize(lead.title)}`;
    if (lead.company && this.seenTitles.has(titleKey)) return this.reject('duplicate');
    this.seenKeys.add(info.jobKey);
    if (lead.company) this.seenTitles.add(titleKey);

    // Cheap checks first: no page is opened for jobs outside the chosen areas.
    if (!s.filters.roles.includes(roleFromTitle(lead.title))) return this.reject('area');

    let description = lead.description;
    let hint = lead.seniorityHint;
    if (description.length < 200 && lead.loadDetails) {
      for (let attempt = 0; ; attempt++) {
        try {
          const d = await lead.loadDetails();
          description = d.description || description;
          hint = d.seniorityHint ?? hint;
          break;
        } catch (e) {
          if (signal.aborted) return false;
          if (e instanceof RateLimited && attempt === 0) {
            this.log(`${COLLECTORS[lead.source].label} pediu uma pausa; espero e tento de novo.`);
            await wait(Math.min(e.retryAfterMs, 120_000) * Math.min(1, this.o.pace ?? 1), signal).catch(() => undefined);
            if (signal.aborted) return false;
            continue;
          }
          // Keeps going with the listing text when it is enough to judge; otherwise the job is skipped.
          if (description.trim().length >= 80) break;
          return this.reject('no-details');
        }
      }
    }
    const full: Lead = { ...lead, description, ...(hint ? { seniorityHint: hint } : {}) };
    const ev = evaluate(full, description);
    const fit = requirementFit(ev.analysis, profile, groups);
    const reason = rejectReason(full, ev, fit, s.filters);
    if (reason) return this.reject(reason);

    const job: CollectedJob = {
      link: info.openUrl,
      jobKey: info.jobKey,
      site: info.label,
      source: lead.source,
      title: lead.title,
      company: lead.company,
      location: lead.location,
      workModel: ev.workModel,
      seniority: ev.seniority,
      percent: fit.percent,
      has: fit.has,
      similar: fit.similar,
      missing: fit.missing,
      postedAt: lead.postedAt,
      collectedAt: new Date().toISOString(),
    };
    run.jobs.push(job);
    this.store.remember(run.id, job);
    this.scheduleExport();
    if (s.maxJobs > 0 && run.jobs.length >= s.maxJobs) this.abort('max');
    return true;
  }

  private reject(code: string): false {
    const r = this.run!.rejected;
    r[code] = (r[code] ?? 0) + 1;
    return false;
  }

  /** The spreadsheet is rewritten a few seconds after each new job, so stopping early never loses anything. */
  private scheduleExport(): void {
    if (this.exportTimer) return;
    this.exportTimer = setTimeout(() => void this.exportNow(), 3000);
  }

  async exportNow(): Promise<void> {
    if (this.exportTimer) clearTimeout(this.exportTimer);
    this.exportTimer = null;
    const run = this.run;
    if (!run) return;
    const lang = this.settings.sheetLang;
    const pt = lang === 'pt';
    const summary: [string, string | number][] = [
      [pt ? 'Gerado por' : 'Made with', 'HireLinks'],
      [pt ? 'Início' : 'Started', run.startedAt.replace('T', ' ').slice(0, 16)],
      [pt ? 'Fim' : 'Ended', (run.endedAt ?? '').replace('T', ' ').slice(0, 16)],
      [pt ? 'Vagas na planilha' : 'Jobs in the sheet', run.jobs.length],
      [pt ? 'Meta' : 'Goal', run.target],
      [pt ? 'Compatibilidade mínima' : 'Minimum match', `${this.settings.filters.minPercent}%`],
      [pt ? 'Como usar' : 'How to use', pt ? 'No FlashHire: aba Fila → Adicionar vagas → Planilha (.xlsx ou .csv).' : 'In FlashHire: Fila (queue) tab → Adicionar vagas → Planilha (.xlsx or .csv).'],
    ];
    try {
      writeAtomic(join(this.o.exportDir, `${run.file}.xlsx`), await toXlsx(run.jobs, lang, summary));
      writeAtomic(join(this.o.exportDir, `${run.file}.csv`), toCsv(run.jobs, lang));
    } catch (e) {
      this.log(`Não consegui salvar a planilha (${(e as Error).message}). Se ela estiver aberta no Excel, feche e eu salvo de novo na próxima vaga.`);
    }
  }

  private log(msg: string): void {
    if (!this.run) return;
    this.run.log.push({ at: new Date().toISOString(), msg });
    if (this.run.log.length > 300) this.run.log.splice(0, this.run.log.length - 300);
    this.changed();
  }

  private changed(now = false): void {
    if (now) {
      if (this.changeTimer) clearTimeout(this.changeTimer);
      this.changeTimer = null;
      this.emit('change');
      return;
    }
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit('change');
    }, 700);
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof RateLimited) return 'o site pediu para diminuir o ritmo; tente de novo mais tarde.';
  if (e instanceof HttpError) return e.status === 403 ? 'o site recusou o acesso agora (403).' : e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (m.startsWith('Não consegui abrir o navegador')) return 'não consegui abrir o Edge nem o Chrome. Confira se um deles está instalado e feche outras janelas do HireLinks.';
  if (/fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|timeout/i.test(m)) return 'sem conexão com o site (verifique a internet).';
  if (/Unexpected token|JSON/i.test(m)) return 'o site respondeu num formato diferente do esperado.';
  return m.split('\n')[0] ?? m;
}
