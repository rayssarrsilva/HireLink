import { createServer, type Server } from 'node:http';

/** Local pages that imitate each site's real format, so the engine can be tested without the internet. */
const REQS = 'Requisitos: React, TypeScript, CSS, HTML, Git e Jest.';
const now = new Date().toISOString();
let indeedChallengeShown = false;
export const resetFakeSites = () => (indeedChallengeShown = false);

export function route(path: string): { type: string; body: string } | null {
  const json = (o: unknown) => ({ type: 'application/json', body: JSON.stringify(o) });
  const html = (b: string) => ({ type: 'text/html; charset=utf-8', body: b });
  const u = new URL(path, 'http://x');

  // ---- Gupy portal API + one job page ----
  if (u.pathname === '/gupy/api/job-search/jobs') {
    if (u.searchParams.get('offset') !== '0') return json({ data: [], pagination: { total: 3 } });
    return json({
      pagination: { total: 3 },
      data: [
        { id: 1, name: 'Desenvolvedora Front-end Júnior', jobUrl: 'https://acme.gupy.io/jobs/101?jobBoardSource=gupy_portal', careerPageName: 'Acme', workplaceType: 'remote', isRemoteWork: true, publishedDate: now, description: `<p>Vaga 100% remota para o nosso time de produto. ${REQS} Você vai construir telas acessíveis e responsivas, revisar código e escrever testes. Somos um time pequeno e acolhedor.</p>` },
        { id: 2, name: 'Desenvolvedor Front-end Sênior', jobUrl: 'https://acme.gupy.io/jobs/102', careerPageName: 'Acme', workplaceType: 'remote', isRemoteWork: true, publishedDate: now, description: `<p>${REQS} Liderança técnica de um time grande, mentoria e definição de arquitetura do front-end da empresa toda.</p>` },
        { id: 3, name: 'Analista de QA Júnior', jobUrl: 'https://beta.gupy.io/jobs/103', careerPageName: 'Beta', workplaceType: 'remote', isRemoteWork: true, publishedDate: now, description: 'curta' },
      ],
    });
  }
  if (u.pathname === '/beta/jobs/103') {
    const data = { props: { pageProps: { job: { description: '<p>Vaga remota de QA. Testes manuais e automatizados com Playwright e Jest, casos de teste, Git e Scrum. Trabalho 100% remoto.</p>' } } } };
    return html(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`);
  }

  // ---- LinkedIn guest pages ----
  if (u.pathname === '/li/jobs-guest/jobs/api/seeMoreJobPostings/search') {
    if (u.searchParams.get('start') !== '0' || u.searchParams.get('location') !== 'Uberaba') return html('');
    const card = (id: string, title: string, company: string) =>
      `<li><div class="base-card" data-entity-urn="urn:li:jobPosting:${id}"><h3 class="base-search-card__title">${title}</h3><h4 class="base-search-card__subtitle"><a>${company}</a></h4><span class="job-search-card__location">Uberaba, Minas Gerais, Brasil</span><time datetime="${now.slice(0, 10)}"></time></div></li>`;
    return html(card('5001', 'Desenvolvedor Web', 'Gamma') + card('5002', 'Analista Financeiro', 'Gamma') + card('5003', 'Desenvolvedora Front-end Júnior', 'Acme'));
  }
  if (u.pathname === '/li/jobs-guest/jobs/api/jobPosting/5001') {
    return html(`<div class="show-more-less-html__markup">Vaga presencial em Uberaba. ${REQS} Venha fazer parte do nosso time.</div><button class="show-more-less-html__button"></button>
      <span class="description__job-criteria-text">Júnior</span>`);
  }

  // ---- Remotive ----
  if (u.pathname === '/remotive/api/remote-jobs') {
    if (u.searchParams.get('category') !== 'qa') return json({ jobs: [{ url: 'https://remotive.com/remote-jobs/software-dev/frontend-dev-1', title: 'Frontend Developer', company_name: 'Delta', publication_date: now, candidate_required_location: 'USA Only', description: `<p>${REQS}</p>` }] });
    return json({ jobs: [{ url: 'https://remotive.com/remote-jobs/qa/qa-engineer-2', title: 'QA Engineer', company_name: 'Epsilon', publication_date: now, candidate_required_location: 'LATAM', description: '<p>Test automation with Playwright and Jest, test cases, Git, Scrum, React apps.</p>' }] });
  }

  // ---- Indeed (real browser), with an "are you human?" page the first time ----
  if (u.pathname === '/indeed/jobs') {
    if (u.searchParams.get('start') !== '0' || u.searchParams.get('l') !== '') return html('<html><head><title>Vagas</title></head><body><div class="jobsearch-NoResult-messageContainer">Nada</div></body></html>');
    const cards = `<ul><li><a data-jk="ind777" href="#"><span title="Front-end Developer Jr">Front-end Developer Jr</span></a><span data-testid="company-name">Zeta</span><span data-testid="text-location">Remoto</span><span class="date">Publicada há 2 dias</span></li></ul>`;
    if (!indeedChallengeShown) {
      indeedChallengeShown = true;
      return html(`<html><head><title>Just a moment...</title></head><body><div id="challenge-form">Verify you are human</div>
        <script>setTimeout(() => { document.title = 'Vagas'; document.body.innerHTML = ${JSON.stringify(cards)}; }, 700);</script></body></html>`);
    }
    return html(`<html><head><title>Vagas</title></head><body>${cards}</body></html>`);
  }
  if (u.pathname === '/indeed/viewjob') {
    return html(`<html><head><title>Vaga</title></head><body><div id="jobDescriptionText">Trabalho remoto. ${REQS} Empresa com cultura de feedback e aprendizado contínuo para quem está começando na área.</div></body></html>`);
  }
  // ---- Glassdoor that always answers "Humans only" (the check never clears) ----
  if (u.pathname.startsWith('/gd/')) {
    return html('<html><head><title>Just a moment...</title></head><body><h1>Humans only</h1><div id="challenge-form"></div></body></html>');
  }
  return null;
}


export async function startFakeSites(): Promise<{ base: string; overrides: Record<string, string>; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const r = route(req.url ?? '/');
    if (!r) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': r.type }).end(r.body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    base,
    overrides: {
      'https://portal.gupy.io': `${base}/gupy`,
      'https://beta.gupy.io': `${base}/beta`,
      'https://acme.gupy.io': `${base}/acme`,
      'https://www.linkedin.com': `${base}/li`,
      'https://remotive.com': `${base}/remotive`,
      'https://br.indeed.com': `${base}/indeed`,
      'https://www.glassdoor.com.br': `${base}/gd`,
    },
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
