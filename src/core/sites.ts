// Shared with FlashHire (src/core/sites.ts). Keep both copies identical so every link HireLinks saves is read the same way by FlashHire.
import type { SiteId, SiteInfo } from './types';

const LABELS: Record<SiteId, string> = {
  linkedin: 'LinkedIn',
  gupy: 'Gupy',
  glassdoor: 'Glassdoor',
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  getonboard: 'Get on Board',
  remotive: 'Remotive',
  weworkremotely: 'We Work Remotely',
  remoteok: 'Remote OK',
  wellfound: 'Wellfound',
  other: 'Site da empresa',
};

/** Sites whose terms forbid automated submission: FlashHire fills, the candidate clicks "Send". */
export const MANUAL_SUBMIT_SITES: ReadonlySet<SiteId> = new Set(['linkedin', 'glassdoor', 'indeed']);

export function siteLabel(site: SiteId): string {
  return LABELS[site];
}

export function detectSite(rawUrl: string): SiteInfo {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return base('other', rawUrl, 'no-job', null, 'Link inválido.');
  }
  const host = url.hostname.replace(/^www\./, '');

  if (host.endsWith('linkedin.com')) {
    // A: /jobs/search-results/?currentJobId=123 · /jobs/collections/...?currentJobId=123
    // B: /jobs/view/123/
    const viewMatch = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/);
    const current = url.searchParams.get('currentJobId');
    const id = viewMatch?.[1] ?? current;
    if (!id) return base('linkedin', url.href, 'no-job', null, 'O link do LinkedIn não tem o número da vaga.');
    return base('linkedin', `https://www.linkedin.com/jobs/view/${id}/`, viewMatch ? 'direct' : 'search', `linkedin:${id}`);
  }

  if (host.endsWith('gupy.io')) {
    // A: empresa.gupy.io/job/<base64>?jobBoardSource=... · /jobs/123
    // B: empresa.gupy.io/candidates/... (login or application already started)
    const company = host.split('.')[0] ?? 'gupy';
    const jobMatch = url.pathname.match(/\/jobs?\/([^/?#]+)/);
    if (jobMatch?.[1]) {
      const raw = jobMatch[1];
      const id = decodeGupyId(raw) ?? raw;
      const clean = new URL(url.href);
      clean.search = '';
      return base('gupy', clean.href, 'direct', `gupy:${company}:${id}`);
    }
    if (url.pathname.startsWith('/candidates')) {
      return base('gupy', url.href, 'login', null, 'Este link da Gupy é a tela de login/candidatura, não uma vaga. Use o link da página da vaga.');
    }
    return base('gupy', url.href, 'no-job', null, 'Não encontrei a vaga neste link da Gupy.');
  }

  if (host.includes('glassdoor.')) {
    // A: /Job/index.htm?jl=123 or /job-listing/...?jl=123 · B: goes through Indeed SmartApply
    const jl = url.searchParams.get('jl');
    if (jl) {
      return base('glassdoor', url.href, url.pathname.includes('job-listing') ? 'direct' : 'search', `glassdoor:${jl}`);
    }
    if (/job-listing/.test(url.pathname)) return base('glassdoor', url.href, 'direct', `glassdoor:${url.pathname}`);
    return base(
      'glassdoor',
      url.href,
      'no-job',
      null,
      'Este link do Glassdoor é a lista de vagas, sem a vaga escolhida. Abra a vaga e copie o link com "jl=" (botão Compartilhar).',
    );
  }

  if (host.endsWith('indeed.com') || host.includes('.indeed.')) {
    if (host.startsWith('smartapply.')) {
      return base(
        'indeed',
        url.href,
        'apply-flow',
        null,
        'Este é o formulário do Indeed já aberto (expira com a sessão). Use o link da vaga no Glassdoor/Indeed.',
      );
    }
    const jk = url.searchParams.get('jk') ?? url.searchParams.get('vjk');
    return base('indeed', jk ? `https://${host}/viewjob?jk=${jk}` : url.href, jk ? 'direct' : 'no-job', jk ? `indeed:${jk}` : null);
  }

  const simple: [RegExp, SiteId][] = [
    [/greenhouse\.io$/, 'greenhouse'],
    [/lever\.co$/, 'lever'],
    [/ashbyhq\.com$/, 'ashby'],
    [/workable\.com$/, 'workable'],
    [/getonbrd\.com$|getonboard\./, 'getonboard'],
    [/remotive\.com$/, 'remotive'],
    [/weworkremotely\.com$/, 'weworkremotely'],
    [/remoteok\.(com|io)$/, 'remoteok'],
    [/wellfound\.com$|angel\.co$/, 'wellfound'],
  ];
  for (const [re, site] of simple) {
    if (re.test(host)) {
      const clean = new URL(url.href);
      for (const p of ['gh_src', 'utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source']) clean.searchParams.delete(p);
      return base(site, clean.href, 'direct', `${site}:${clean.host}${clean.pathname}`);
    }
  }
  return base('other', url.href, 'direct', `other:${url.host}${url.pathname}`);
}

function base(site: SiteId, openUrl: string, variant: SiteInfo['variant'], jobKey: string | null, warning?: string): SiteInfo {
  return {
    site,
    label: LABELS[site],
    variant,
    openUrl,
    jobKey,
    manualSubmit: MANUAL_SUBMIT_SITES.has(site),
    ...(warning ? { warning } : {}),
  };
}

function decodeGupyId(raw: string): string | null {
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as { jobId?: number };
    return parsed.jobId ? String(parsed.jobId) : null;
  } catch {
    return /^\d+$/.test(raw) ? raw : null;
  }
}
