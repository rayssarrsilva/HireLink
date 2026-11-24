import { describe, expect, it } from 'vitest';
import { detectSite } from '../../src/core/sites';
import type { CollectedJob } from '../../src/core/types';
import { sortJobs, toCsv, toXlsx } from '../../src/export/sheet';
import { linksFromRows, readRows } from '../helpers/flashhire-reader';

const job = (over: Partial<CollectedJob>): CollectedJob => ({
  link: 'https://www.linkedin.com/jobs/view/1/',
  jobKey: 'linkedin:1',
  site: 'LinkedIn',
  source: 'linkedin',
  title: 'Front-end Jr',
  company: 'Acme; "Tech"',
  location: 'Remoto',
  workModel: 'remote',
  seniority: 'junior',
  percent: 70,
  has: ['React'],
  similar: [{ requirement: 'Vitest', via: 'Jest' }],
  missing: ['Docker'],
  postedAt: '2026-11-20T00:00:00.000Z',
  collectedAt: '2026-11-24T21:00:00.000Z',
  ...over,
});

const jobs = [
  job({}),
  job({ link: 'https://acme.gupy.io/jobs/99', jobKey: 'gupy:acme:99', site: 'Gupy', percent: 92, title: 'QA Jr' }),
  job({ link: 'https://www.glassdoor.com.br/job-listing/x?jl=5', jobKey: 'glassdoor:5', site: 'Glassdoor', percent: 45, title: 'Dev Web' }),
  job({ link: 'https://br.indeed.com/viewjob?jk=abc', jobKey: 'indeed:abc', site: 'Indeed', percent: 92, postedAt: '2026-11-23T00:00:00.000Z' }),
];

describe('spreadsheet for FlashHire', () => {
  it('sorts best match first, newest first on ties', () => {
    expect(sortJobs(jobs).map((j) => j.jobKey)).toEqual(['indeed:abc', 'gupy:acme:99', 'linkedin:1', 'glassdoor:5']);
  });

  it('FlashHire reads every link from the .xlsx, in order, as valid jobs', async () => {
    const buf = await toXlsx(jobs, 'pt', [['Gerado por', 'HireLinks']]);
    const links = linksFromRows(await readRows(buf, 'vagas.xlsx'));
    expect(links).toEqual(sortJobs(jobs).map((j) => j.link));
    for (const l of links) expect(detectSite(l).warning).toBeUndefined();
  });

  it('FlashHire reads every link from the .csv (";" and BOM for Excel in Portuguese)', async () => {
    const csv = toCsv(jobs, 'pt');
    expect(csv.startsWith('﻿Link;Compatibilidade;')).toBe(true);
    expect(csv).toContain('"Acme; ""Tech"""');
    expect(csv).toContain('92%');
    const rows = await readRows(Buffer.from(csv, 'utf8'), 'vagas.csv');
    expect(rows[1]![0]).toBe('https://br.indeed.com/viewjob?jk=abc');
    expect(linksFromRows(rows)).toEqual(sortJobs(jobs).map((j) => j.link));
  });

  it('English headers when the sheet is in English', () => {
    expect(toCsv(jobs, 'en').split('\r\n')[0]).toContain('Match;Job;Company');
  });
});
