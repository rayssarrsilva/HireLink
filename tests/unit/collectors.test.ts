import { describe, expect, it } from 'vitest';
import { parseAshby, parseBoard, parseGreenhouse, parseLever } from '../../src/collectors/boards';
import { parseGetOnBoard, parseRemoteOk, parseRemotive, parseWwrRss } from '../../src/collectors/feeds';
import { glassdoorAgeDays, glassdoorLink } from '../../src/collectors/glassdoor';
import { gupyTextFromHtml, parseGupy } from '../../src/collectors/gupy';
import { indeedAgeDays, indeedFromAge } from '../../src/collectors/indeed';
import { parseLinkedInCards, parseLinkedInDetail } from '../../src/collectors/linkedin';
import { detectSite } from '../../src/core/sites';

/** Every link HireLinks produces must be accepted by FlashHire's link reader with no warning. */
const flashHireOk = (url: string) => {
  const s = detectSite(url);
  expect(s.warning, url).toBeUndefined();
  expect(s.jobKey, url).toBeTruthy();
  return s;
};

describe('LinkedIn guest pages', () => {
  const html = `
<li>
  <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4012345678">
    <a class="base-card__full-link" href="https://br.linkedin.com/jobs/view/desenvolvedora-front-end-at-acme-4012345678?refId=x"></a>
    <h3 class="base-search-card__title">
        Desenvolvedora Front-end Júnior
    </h3>
    <h4 class="base-search-card__subtitle"><a href="#">Acme &amp; Co</a></h4>
    <div class="base-search-card__metadata"><span class="job-search-card__location">Uberaba, Minas Gerais, Brasil</span>
    <time class="job-search-card__listdate" datetime="2026-11-20">4 dias atrás</time></div>
  </div>
</li>
<li><div class="base-card" data-entity-urn="urn:li:jobPosting:4099999999"><h3 class="base-search-card__title">QA Analyst</h3><h4 class="base-search-card__subtitle">Beta</h4></div></li>`;

  it('reads the cards', () => {
    const cards = parseLinkedInCards(html);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ id: '4012345678', title: 'Desenvolvedora Front-end Júnior', company: 'Acme & Co', location: 'Uberaba, Minas Gerais, Brasil' });
    expect(cards[0]!.postedAt).toContain('2026-11-20');
    expect(flashHireOk(`https://www.linkedin.com/jobs/view/${cards[0]!.id}/`).jobKey).toBe('linkedin:4012345678');
  });

  it('reads the description and the stated seniority', () => {
    const d = parseLinkedInDetail(`<section><div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5">
      <p>Buscamos pessoa com <strong>React</strong> e TypeScript.</p><ul><li>Git</li></ul>
    </div><button class="show-more-less-html__button">Mostrar mais</button></section>
    <ul class="description__job-criteria-list"><li><h3 class="description__job-criteria-subheader">Nível de experiência</h3>
    <span class="description__job-criteria-text description__job-criteria-text--criteria">Assistente</span></li></ul>`);
    expect(d.description).toContain('React');
    expect(d.description).toContain('• Git');
    expect(d.seniority).toBe('junior');
  });
});

describe('Gupy', () => {
  it('reads the portal API and keeps links FlashHire accepts', () => {
    const leads = parseGupy({
      data: [
        { id: 1, name: 'Analista de QA Jr', jobUrl: 'https://acme.gupy.io/job/eyJqb2JJZCI6OTg3Niwic291cmNlIjoiZ3VweV9wb3J0YWwifQ==?jobBoardSource=gupy_portal', careerPageName: 'Acme', city: 'Uberlândia', state: 'MG', workplaceType: 'on-site', publishedDate: '2026-11-22T10:00:00.000Z', description: '<p>Testes manuais</p>' },
        { id: 2, name: 'Dev Front', jobUrl: 'https://beta.gupy.io/jobs/555?jobBoardSource=gupy_portal', careerPageName: 'Beta', workplaceType: 'remote', isRemoteWork: true },
      ],
    });
    expect(leads[0]).toMatchObject({ company: 'Acme', location: 'Presencial · Uberlândia - MG', remote: false });
    expect(leads[1]).toMatchObject({ remote: true, location: 'Remoto' });
    expect(flashHireOk(leads[0]!.url).jobKey).toBe('gupy:acme:9876');
    expect(flashHireOk(leads[1]!.url).jobKey).toBe('gupy:beta:555');
  });

  it('reads the full text from the job page', () => {
    const html = `<html><body><h1>x</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { job: { description: '<p>Sobre a vaga com React e muito mais texto aqui</p>', prerequisites: '<ul><li>Cypress e testes automatizados</li></ul>' } } },
    })}</script></body></html>`;
    const t = gupyTextFromHtml(html);
    expect(t).toContain('React');
    expect(t).toContain('Cypress');
  });
});

describe('remote boards', () => {
  it('Remotive', () => {
    const [l] = parseRemotive({ jobs: [{ url: 'https://remotive.com/remote-jobs/software-dev/frontend-engineer-123', title: 'Frontend Engineer', company_name: 'Gamma', publication_date: '2026-11-21T09:00:00', candidate_required_location: 'LATAM', description: '<p>React</p>' }] });
    expect(l).toMatchObject({ location: 'Remote · LATAM', remote: true, description: 'React' });
    flashHireOk(l!.url);
  });

  it('Remote OK skips the legal notice', () => {
    const leads = parseRemoteOk([{ legal: 'API Terms of Service' }, { id: '1', position: 'QA Engineer', company: 'Delta', location: 'Latin America', url: 'https://remoteOK.com/remote-jobs/remote-qa-engineer-delta-1', date: '2026-11-23T16:00:27+00:00', tags: ['qa', 'cypress'] }]);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.description).toContain('cypress');
    expect(flashHireOk(leads[0]!.url).site).toBe('remoteok');
  });

  it('We Work Remotely RSS', () => {
    const [l] = parseWwrRss(`<rss><channel><item><title>Epsilon: Senior React Developer</title><region>Anywhere in the World</region>
      <link>https://weworkremotely.com/remote-jobs/epsilon-senior-react-developer</link><pubDate>Mon, 23 Nov 2026 10:00:00 +0000</pubDate>
      <description>&lt;p&gt;We use React&lt;/p&gt;</description></item></channel></rss>`);
    expect(l).toMatchObject({ company: 'Epsilon', title: 'Senior React Developer', description: 'We use React' });
    expect(flashHireOk(l!.url).site).toBe('weworkremotely');
  });

  it('Get on Board', () => {
    const [l] = parseGetOnBoard({ data: [{ id: 'frontend-zeta-remote', attributes: { title: 'Frontend Developer', description: '<p>React</p>', remote_modality: 'fully_remote', countries: ['Remote'], published_at: 1795535105, seniority: { data: { id: 2 } } }, links: { public_url: 'https://www.getonbrd.com/jobs/programming/frontend-zeta-remote' } }] });
    expect(l).toMatchObject({ remote: true, seniorityHint: 'junior' });
    expect(flashHireOk(l!.url).site).toBe('getonboard');
  });
});

describe('company boards', () => {
  it('understands pasted links', () => {
    expect(parseBoard('https://job-boards.greenhouse.io/nubank')).toEqual({ ats: 'greenhouse', slug: 'nubank' });
    expect(parseBoard('boards.greenhouse.io/embed/job_board?for=acme')).toEqual({ ats: 'greenhouse', slug: 'acme' });
    expect(parseBoard('https://jobs.lever.co/beta/abc')).toEqual({ ats: 'lever', slug: 'beta' });
    expect(parseBoard('jobs.ashbyhq.com/gamma')).toEqual({ ats: 'ashby', slug: 'gamma' });
    expect(parseBoard('lever: delta')).toEqual({ ats: 'lever', slug: 'delta' });
    expect(parseBoard('https://acme.com/careers')).toBeNull();
  });

  it('Greenhouse, Lever and Ashby links are read by FlashHire', () => {
    const gh = parseGreenhouse('acme-co', { jobs: [{ id: 42, title: 'QA', content: '&lt;p&gt;Cypress&lt;/p&gt;', location: { name: 'Remote - Brazil' } }] });
    expect(gh[0]!.description).toBe('Cypress');
    expect(gh[0]!.company).toBe('Acme Co');
    expect(flashHireOk(gh[0]!.url).site).toBe('greenhouse');
    const lv = parseLever('beta', [{ id: 'x1', text: 'Frontend', hostedUrl: 'https://jobs.lever.co/beta/x1', workplaceType: 'remote', descriptionPlain: 'React', lists: [{ text: 'Requirements', content: '<li>CSS</li>' }] }]);
    expect(lv[0]!.description).toContain('CSS');
    expect(flashHireOk(lv[0]!.url).site).toBe('lever');
    const ab = parseAshby('gamma', { jobs: [{ id: 'y', title: 'UI Engineer', isRemote: true, jobUrl: 'https://jobs.ashbyhq.com/gamma/y', descriptionPlain: 'Figma' }] });
    expect(flashHireOk(ab[0]!.url).site).toBe('ashby');
  });
});

describe('browser sites', () => {
  it('Glassdoor links always carry jl=, the format FlashHire reads', () => {
    const a = glassdoorLink('https://www.glassdoor.com.br/job-listing/dev-front-acme-JV_IC123_KO0,9_KE10,14.htm?jl=1009876543&src=GD_JOB_AD&ao=1', '');
    expect(a).toBe('https://www.glassdoor.com.br/job-listing/dev-front-acme-JV_IC123_KO0,9_KE10,14.htm?jl=1009876543');
    expect(flashHireOk(a!).jobKey).toBe('glassdoor:1009876543');
    const b = glassdoorLink('', '777');
    expect(flashHireOk(b!).jobKey).toBe('glassdoor:777');
    expect(glassdoorAgeDays('24h')).toBe(0);
    expect(glassdoorAgeDays('30d+')).toBe(30);
  });

  it('Indeed links and dates', () => {
    expect(flashHireOk('https://br.indeed.com/viewjob?jk=abc123def').jobKey).toBe('indeed:abc123def');
    expect(indeedAgeDays('Publicada há 3 dias')).toBe(3);
    expect(indeedAgeDays('Just posted')).toBe(0);
    expect(indeedAgeDays('Postado há mais de 30 dias')).toBe(30);
    expect(indeedFromAge(10)).toBe(14);
    expect(indeedFromAge(2)).toBe(3);
  });
});
