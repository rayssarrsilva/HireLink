import { describe, expect, it } from 'vitest';
import { analyzeJob } from '../../src/core/analyze';
import { DEFAULT_EQUIVALENCES, ENGLISH_REQ, requirementFit, cleanGroups } from '../../src/core/fit';
import { DEFAULT_FILTERS, evaluate, inCities, rejectReason, remoteOutsideReach } from '../../src/core/filters';
import { htmlToText } from '../../src/core/html';
import type { Lead, Profile } from '../../src/core/types';

const me: Profile = { skills: ['React', 'TypeScript', 'CSS', 'Git', 'Jest', 'Playwright', 'HTML'], englishLevel: 'advanced', experienceYears: 1 };

const lead = (p: Partial<Lead> & { description: string }): Lead => ({
  source: 'gupy',
  url: 'https://acme.gupy.io/jobs/1',
  title: 'Desenvolvedora Front-end Júnior',
  company: 'Acme',
  location: 'Remoto',
  postedAt: new Date().toISOString(),
  ...p,
});

describe('requirementFit', () => {
  it('counts exact skills and equivalents with the same weight', () => {
    const a = analyzeJob({ title: 'Front-end', description: 'Requisitos: React, JavaScript, Sass, Vitest, Cypress e Docker.' });
    const fit = requirementFit(a, me, DEFAULT_EQUIVALENCES);
    expect(fit.has).toEqual(['React']);
    expect(fit.similar).toEqual(
      expect.arrayContaining([
        { requirement: 'JavaScript', via: 'TypeScript' },
        { requirement: 'Sass', via: 'CSS' },
        { requirement: 'Vitest', via: 'Jest' },
        { requirement: 'Cypress', via: 'Playwright' },
      ]),
    );
    expect(fit.missing).toEqual(['Docker']);
    expect(fit.total).toBe(6);
    expect(fit.percent).toBe(83); // 5 of 6
  });

  it('turns English and years of experience into requirements', () => {
    const a = analyzeJob({ title: 'QA', description: 'Inglês avançado. Experiência de 3 anos com testes automatizados e Playwright.' });
    const fit = requirementFit(a, me, []);
    expect(fit.has).toContain(ENGLISH_REQ);
    expect(fit.missing.some((m) => m.startsWith('3+ anos'))).toBe(true);
  });

  it('equivalents typed by the candidate are cleaned', () => {
    expect(cleanGroups([[' React ', 'Vue', ''], ['Solo'], []])).toEqual([['React', 'Vue']]);
  });
});

describe('filters', () => {
  const run = (l: Lead) => {
    const ev = evaluate(l, l.description);
    return rejectReason(l, ev, requirementFit(ev.analysis, me, DEFAULT_EQUIVALENCES), DEFAULT_FILTERS);
  };
  const good = 'Requisitos: React, TypeScript, CSS, HTML, Git e Jest. Trabalho 100% remoto.';

  it('keeps a remote junior job with a high match', () => expect(run(lead({ description: good }))).toBeNull());
  it('skips jobs outside the chosen areas', () => expect(run(lead({ title: 'Analista Financeiro', description: good }))).toBe('area'));
  it('skips senior', () => expect(run(lead({ title: 'Desenvolvedor Front-end Sênior', description: good }))).toBe('senior'));
  it('uses the seniority the site states when the title has none', () =>
    expect(run(lead({ title: 'Front-end Developer', description: good, seniorityHint: 'senior' }))).toBe('senior'));
  it('skips old jobs', () => expect(run(lead({ description: good, postedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }))).toBe('old'));
  it('skips when too few requirements were recognized', () => expect(run(lead({ description: 'Vaga remota com React.' }))).toBe('few-requirements'));
  it('skips below the minimum', () =>
    expect(run(lead({ description: 'Remoto. Requisitos: React, Angular, Docker, Kubernetes, AWS, Java, Python, Go.' }))).toBe('below-min'));
  it('mid-level needs the higher minimum', () =>
    expect(run(lead({ title: 'Desenvolvedor Front-end Pleno', description: 'Remoto. React, TypeScript, CSS, Docker, AWS.' }))).toBe('mid-below'));
  it('on-site only in her cities, unless the salary is above the line', () => {
    expect(run(lead({ location: 'Presencial · São Paulo - SP', description: good.replace('Trabalho 100% remoto.', '') }))).toBe('onsite');
    expect(run(lead({ location: 'Presencial · Uberaba - MG', description: good.replace('Trabalho 100% remoto.', '') }))).toBeNull();
    expect(run(lead({ location: 'Presencial · São Paulo - SP', description: `${good.replace('Trabalho 100% remoto.', '')} Salário R$ 6.000` }))).toBeNull();
  });
  it('remote jobs only for another country are skipped', () => {
    expect(remoteOutsideReach('Remote · US Only')).toBe(true);
    expect(remoteOutsideReach('Candidates must be located in the United States.')).toBe(true);
    expect(remoteOutsideReach('Remote · Latin America')).toBe(false);
    expect(remoteOutsideReach('Remote, worldwide. Not US only.')).toBe(false);
    expect(run(lead({ source: 'remoteok', title: 'Frontend Developer', location: 'Remote · USA only', description: good, remote: true }))).toBe('region');
  });
  it('matches cities without accents', () => expect(inCities('Uberlandia, MG', ['Uberlândia'])).toBe(true));
});

describe('htmlToText', () => {
  it('reads HTML and HTML escaped as text', () => {
    expect(htmlToText('<p>React &amp; CSS</p><ul><li>Git</li></ul>')).toBe('React & CSS\n• Git');
    expect(htmlToText('&lt;p&gt;Vue&lt;/p&gt;')).toBe('Vue');
  });
});
