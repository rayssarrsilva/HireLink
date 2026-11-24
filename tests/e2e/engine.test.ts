import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectSite } from '../../src/core/sites';
import { Engine, DEFAULT_SETTINGS, type Settings } from '../../src/engine/engine';
import { Store } from '../../src/store/store';
import { startFakeSites } from '../fixtures/fake-sites';
import { linksFromRows, readRows } from '../helpers/flashhire-reader';

let sites: Awaited<ReturnType<typeof startFakeSites>>;
let dir = '';

beforeAll(async () => {
  sites = await startFakeSites();
  dir = mkdtempSync(join(tmpdir(), 'hirelinks-e2e-'));
});

afterAll(async () => {
  await sites.close();
  rmSync(dir, { recursive: true, force: true });
});

function engine(store: Store) {
  return new Engine(store, {
    dataDir: join(dir, 'data'),
    exportDir: join(dir, 'exports'),
    pace: 0,
    headless: true,
    executablePath: process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
    waitForYouMs: 15_000,
    httpOverrides: sites.overrides,
  });
}

const finished = (e: Engine) =>
  new Promise<void>((ok) => {
    const check = () => {
      if (e.run?.status === 'done') {
        e.off('change', check);
        ok();
      }
    };
    e.on('change', check);
    check();
  });

describe('HireLinks engine (local fake sites)', () => {
  const store = new Store(':memory:');
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    sources: ['gupy', 'linkedin', 'remotive', 'indeed'],
    keywords: ['frontend'],
    remoteRegion: '',
    durationHours: 0.25,
    target: 3,
    filters: { ...DEFAULT_SETTINGS.filters, cities: ['Uberaba'] },
  };

  it('collects only matching jobs, waits for the candidate on a human check, and writes a sheet FlashHire reads', async () => {
    store.setJson('settings', settings);
    store.setJson('profile', { skills: ['React', 'TypeScript', 'CSS', 'HTML', 'Git', 'Jest', 'Playwright', 'Test cases/plans', 'Manual testing', 'Automated testing', 'Scrum/Agile', 'QA'], englishLevel: 'advanced', experienceYears: 0 });
    const e = engine(store);
    const notices: string[] = [];
    e.on('notice', (m: string) => notices.push(m));
    e.start();
    await finished(e);
    const run = e.run!;

    const titles = run.jobs.map((j) => `${j.site}: ${j.title}`).sort();
    expect(titles).toEqual([
      'Gupy: Analista de QA Júnior', // description loaded from the job page
      'Gupy: Desenvolvedora Front-end Júnior',
      'Indeed: Front-end Developer Jr', // after the "are you human?" page
      'LinkedIn: Desenvolvedor Web', // on-site, but in Uberaba
      'Remotive: QA Engineer',
    ]);
    expect(run.rejected).toMatchObject({ senior: 1, area: 1, duplicate: 1, region: 1 });
    expect(run.stopReason).toBe('exhausted');
    expect(notices.some((n) => n.includes('Indeed pediu uma verificação'))).toBe(true);
    expect(Object.values(run.sources).every((s) => s.status === 'done')).toBe(true);
    for (const j of run.jobs) expect(j.percent).toBeGreaterThanOrEqual(40);

    const xlsx = join(dir, 'exports', `${run.file}.xlsx`);
    const links = linksFromRows(await readRows(readFileSync(xlsx), 'x.xlsx'));
    expect(links).toHaveLength(5);
    expect(links).toContain('https://www.linkedin.com/jobs/view/5001/');
    expect(links).toContain('https://br.indeed.com/viewjob?jk=ind777');
    for (const l of links) expect(detectSite(l).warning).toBeUndefined();
    const csv = readFileSync(join(dir, 'exports', `${run.file}.csv`), 'utf8');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(6);
  });

  it('a second run never repeats links already delivered', async () => {
    store.setJson('settings', { ...settings, sources: ['gupy', 'remotive'] });
    const e = engine(store);
    await new Promise((r) => setTimeout(r, 61_000 - (Date.now() % 60_000))); // new minute → new file name
    e.start();
    await finished(e);
    expect(e.run!.jobs).toHaveLength(0);
    expect(e.run!.rejected.duplicate).toBe(3);
    expect(store.historyCount()).toBe(5);
  });
});
