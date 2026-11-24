import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { COLLECTORS, SOURCE_IDS } from '../collectors';
import { DEFAULT_EQUIVALENCES } from '../core/fit';
import { REJECT_LABELS } from '../core/filters';
import { extractSkills, SKILLS } from '../core/skills';
import { normalize } from '../core/text';
import { DEFAULT_SETTINGS, Engine } from '../engine/engine';
import { Store } from '../store/store';

const ROOT = resolve(import.meta.dirname, '../..');
const DATA = resolve(process.env.HIRELINKS_DATA ?? join(ROOT, 'data'));
const EXPORTS = resolve(process.env.HIRELINKS_EXPORTS ?? join(ROOT, 'exports'));
const PORT = Number(process.env.PORT ?? 4174);
const HOST = '127.0.0.1';
const TOKEN = randomBytes(32).toString('hex');

const store = new Store(join(DATA, 'hirelinks.db'));
store.closeInterrupted();
const engine = new Engine(store, {
  dataDir: DATA,
  exportDir: EXPORTS,
  executablePath: process.env.CHROME_PATH,
  // Only for local testing against fake pages (see tests/fixtures/fake-sites.ts).
  httpOverrides: process.env.HIRELINKS_HTTP_OVERRIDES ? (JSON.parse(process.env.HIRELINKS_HTTP_OVERRIDES) as Record<string, string>) : undefined,
  pace: process.env.HIRELINKS_PACE ? Number(process.env.HIRELINKS_PACE) : undefined,
});

const app = Fastify({ bodyLimit: 12 * 1024 * 1024, logger: false });

// ---------- security (same model as FlashHire) ----------
const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);

app.addHook('onRequest', async (req, reply) => {
  if (!allowedHosts.has(req.headers.host ?? '')) return reply.code(421).send({ error: 'Host não permitido' });
  if (req.url.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return reply.code(403).send({ error: 'Origem não permitida' });
    const given = (req.headers['x-hirelinks-token'] as string | undefined) ?? (req.query as { token?: string }).token ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.code(401).send({ error: 'Sessão inválida. Recarregue a página.' });
  }
});

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cache-Control', 'no-store');
  return payload;
});

app.setErrorHandler((err, _req, reply) => {
  const status = err instanceof z.ZodError ? 400 : ((err as { statusCode?: number }).statusCode ?? 400);
  reply.code(status).send({ error: err instanceof z.ZodError ? 'Dados inválidos' : err instanceof Error ? err.message : String(err) });
});

// ---------- state ----------
app.get('/api/state', async () => ({
  settings: engine.settings,
  profile: engine.profile,
  equivalences: engine.equivalences,
  defaults: { equivalences: DEFAULT_EQUIVALENCES, keywords: DEFAULT_SETTINGS.keywords },
  skills: Object.keys(SKILLS),
  sources: SOURCE_IDS.map((id) => ({ id, label: COLLECTORS[id].label, kind: COLLECTORS[id].kind })),
  rejectLabels: REJECT_LABELS,
  running: engine.isRunning,
  run: engine.run,
  history: store.historyCount(),
  runs: store.runs().map((r) => ({ ...r, files: ['xlsx', 'csv'].filter((ext) => existsSync(join(EXPORTS, `${r.file}.${ext}`))) })),
}));

app.get('/api/events', async (req, reply) => {
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onChange = () => send('change', {});
  const onNotice = (m: string) => send('notice', m);
  engine.on('change', onChange);
  engine.on('notice', onNotice);
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
  req.raw.on('close', () => {
    clearInterval(ping);
    engine.off('change', onChange);
    engine.off('notice', onNotice);
  });
});

// ---------- profile ----------
const ProfileBody = z.object({
  skills: z.array(z.string().max(60)).max(200),
  englishLevel: z.enum(['basic', 'intermediate', 'advanced', 'fluent']),
  experienceYears: z.number().min(0).max(40),
});
app.put('/api/profile', async (req) => {
  const p = ProfileBody.parse(req.body);
  const known = new Set(Object.keys(SKILLS));
  store.setJson('profile', { ...p, skills: p.skills.filter((s) => known.has(s)) });
  engine.emit('change');
  return { ok: true };
});

app.put('/api/equivalences', async (req) => {
  const groups = z.array(z.array(z.string().max(60)).max(20)).max(60).parse(req.body);
  store.setJson('equivalences', groups);
  engine.emit('change');
  return { ok: true };
});

/** Reads a résumé (PDF or text) and returns the skills found in it. Nothing is stored here: she confirms them on screen. */
app.post('/api/profile/resume', async (req) => {
  const b = z.object({ fileName: z.string().max(200), base64: z.string().max(14_000_000) }).parse(req.body);
  const buf = Buffer.from(b.base64, 'base64');
  let text: string;
  if (/\.pdf$/i.test(b.fileName)) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (/\.(txt|md|json)$/i.test(b.fileName)) text = buf.toString('utf8');
  else throw new Error('Envie o currículo em PDF (ou .txt / .md).');
  return { skills: extractSkills(normalize(text)), chars: text.length };
});

// ---------- settings ----------
const Role = z.enum(['frontend', 'qa', 'fullstack', 'backend', 'design', 'other']);
const SettingsBody = z.object({
  sources: z.array(z.enum(SOURCE_IDS as [string, ...string[]])).max(20),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30),
  remoteRegion: z.string().max(80),
  boards: z.array(z.string().trim().min(1).max(200)).max(100),
  durationHours: z.number().min(0.25).max(12),
  target: z.number().int().min(1).max(1000),
  maxJobs: z.number().int().min(0).max(5000),
  skipPrevious: z.boolean(),
  sheetLang: z.enum(['pt', 'en']),
  browser: z.enum(['auto', 'msedge', 'chrome']),
  filters: z.object({
    minPercent: z.number().int().min(0).max(100),
    minRequirements: z.number().int().min(1).max(20),
    roles: z.array(Role).min(1),
    excludeIntern: z.boolean(),
    excludeSenior: z.boolean(),
    midMinPercent: z.number().int().min(0).max(100),
    maxAgeDays: z.number().int().min(1).max(60),
    cities: z.array(z.string().trim().min(1).max(60)).max(20),
    onsiteMinSalaryBRL: z.number().min(0).max(1_000_000),
  }),
});
app.put('/api/settings', async (req) => {
  if (engine.isRunning) throw new Error('Pare a coleta para mudar os ajustes.');
  store.setJson('settings', SettingsBody.parse(req.body));
  engine.emit('change');
  return { ok: true };
});

// ---------- run ----------
app.post('/api/run/start', async () => ({ ok: true, id: engine.start().id }));
app.post('/api/run/stop', async () => {
  engine.stop();
  return { ok: true };
});
app.post('/api/history/clear', async () => {
  if (engine.isRunning) throw new Error('Pare a coleta antes.');
  store.clearHistory();
  engine.emit('change');
  return { ok: true };
});

app.get('/api/files/:name', async (req, reply) => {
  const { name } = z.object({ name: z.string().regex(/^HireLinks_[\w-]+\.(xlsx|csv)$/) }).parse(req.params);
  const path = join(EXPORTS, name);
  if (!existsSync(path)) return reply.code(404).send({ error: 'Arquivo não encontrado.' });
  if (engine.isRunning && engine.run && name.startsWith(engine.run.file)) await engine.exportNow();
  reply.header('content-disposition', `attachment; filename="${name}"`);
  reply.type(name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return reply.send(createReadStream(path));
});

app.post('/api/files/open-folder', async () => {
  const cmd = process.platform === 'win32' ? ['explorer', [EXPORTS]] : process.platform === 'darwin' ? ['open', [EXPORTS]] : ['xdg-open', [EXPORTS]];
  spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  return { ok: true, path: EXPORTS };
});

// ---------- UI ----------
const WEB = join(ROOT, 'dist/web');
if (existsSync(WEB)) {
  const indexHtml = readFileSync(join(WEB, 'index.html'), 'utf8').replace('<!--HL_TOKEN-->', `<meta name="hl-token" content="${TOKEN}">`);
  app.register(fastifyStatic, { root: WEB, index: false, wildcard: false });
  app.get('/', async (_req, reply) => reply.type('text/html').send(indexHtml));
}

const shutdown = async () => {
  engine.stop();
  await new Promise((r) => setTimeout(r, 500));
  await engine.exportNow();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());

await app.listen({ host: HOST, port: PORT });
const url = `http://${HOST}:${PORT}`;
console.log(`\n  HireLinks rodando em ${url}\n  Planilhas em: ${EXPORTS}\n  (só este computador acessa; feche esta janela para encerrar)\n`);
if (!process.argv.includes('--no-open')) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
