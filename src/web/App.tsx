import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, events, fileToBase64, fileUrl, type Job, type Profile, type Role, type Run, type Settings, type SourceId, type State } from './api';
import { savedLang, storeLang, T, type Dict, type Lang } from './i18n';

type Tab = 'collect' | 'profile' | 'search' | 'history';

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('collect');
  const [lang, setLang] = useState<Lang>(savedLang);
  const [toast, setToast] = useState<string | null>(null);
  const t = T[lang];

  const refresh = useCallback(async () => setState(await api<State>('/state')), []);
  useEffect(() => {
    void refresh();
    return events(
      () => void refresh(),
      (m) => {
        setToast(m);
        if ('Notification' in window && Notification.permission === 'granted') new Notification('HireLinks', { body: m });
      },
    );
  }, [refresh]);

  useEffect(() => {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
    const n = state?.run?.status === 'running' ? state.run.jobs.length : 0;
    document.title = n ? `(${n}) HireLinks` : 'HireLinks';
  }, [lang, state?.run?.jobs.length, state?.run?.status]);

  const notify = (e: unknown) => setToast(e instanceof Error ? e.message : String(e));
  const switchLang = () => {
    const next = lang === 'pt' ? 'en' : 'pt';
    setLang(next);
    storeLang(next);
  };

  if (!state) return <main className="center">{t.loading}</main>;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
              <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </svg>
          </span>
          <div>
            <h1>HireLinks</h1>
            <p className="muted small">{t.tagline}</p>
          </div>
        </div>
        <div className="top-info">
          <span className={`pill ${state.running ? 'on' : ''}`} role="status">
            {state.running ? t.running : t.idle}
          </span>
          <button className="ghost small" onClick={switchLang} aria-label={lang === 'pt' ? 'Switch to English' : 'Mudar para português'}>
            {lang === 'pt' ? 'EN' : 'PT'}
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="HireLinks">
        {(Object.keys(t.tabs) as Tab[]).map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
            {t.tabs[k]}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'collect' && <Collect state={state} t={t} lang={lang} notify={notify} goProfile={() => setTab('profile')} />}
        {tab === 'profile' && <ProfileTab state={state} t={t} notify={notify} />}
        {tab === 'search' && <SearchTab state={state} t={t} notify={notify} />}
        {tab === 'history' && <HistoryTab state={state} t={t} lang={lang} notify={notify} />}
      </main>

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------- Collect ----------------
function Collect({ state, t, lang, notify, goProfile }: { state: State; t: Dict; lang: Lang; notify: (e: unknown) => void; goProfile: () => void }) {
  const run = state.run;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (run?.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run?.status]);

  const start = async () => {
    try {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      await api('/run/start', 'POST');
    } catch (e) {
      notify(e);
    }
  };
  const stop = () => api('/run/stop', 'POST').catch(notify);

  const labelOf = (id: SourceId) => state.sources.find((s) => s.id === id)?.label ?? id;
  const kindOf = (id: SourceId) => state.sources.find((s) => s.id === id)?.kind ?? 'api';

  return (
    <div className="stack">
      {!state.profile.skills.length && (
        <div className="card callout">
          <p>{t.noProfile}</p>
          <button className="primary" onClick={goProfile}>
            {t.goProfile}
          </button>
        </div>
      )}

      <section className="card hero" aria-labelledby="run-h">
        <div className="row wrap">
          <div>
            <h2 id="run-h">{state.running ? t.running : run ? t.lastRun : t.start}</h2>
            {run && <Progress run={run} t={t} now={now} />}
            {run?.status === 'done' && run.stopReason && <p className="muted">{t.ended[run.stopReason]}</p>}
          </div>
          {state.running ? (
            <button className="danger big" onClick={stop}>
              {t.stop}
            </button>
          ) : (
            <button className="primary big" onClick={start} disabled={!state.profile.skills.length}>
              {t.start}
            </button>
          )}
        </div>
        {run?.needsYou && (
          <div className="needs" role="alert">
            <strong>{t.needsYou}:</strong> {run.needsYou}
          </div>
        )}
      </section>

      {run && (
        <section className="card" aria-labelledby="src-h">
          <h2 id="src-h">{t.sources}</h2>
          <ul className="sources">
            {(Object.keys(run.sources) as SourceId[]).map((id) => {
              const s = run.sources[id]!;
              return (
                <li key={id}>
                  <div className="row">
                    <strong>{labelOf(id)}</strong>
                    <span className={`pill st-${s.status}`}>{t.status[s.status]}</span>
                  </div>
                  <span className="muted small">
                    {t.kind[kindOf(id)]} · {s.read} {t.read} · <b>{s.kept}</b> {t.kept}
                  </span>
                  {s.error && <span className="error small">{s.error}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {run && (
        <section className="card" aria-labelledby="sheet-h">
          <h2 id="sheet-h">{t.sheet}</h2>
          <p className="muted small">{t.sheetHint}</p>
          <div className="actions">
            {run.jobs.length > 0 && (
              <>
                <a className="button primary" href={fileUrl(`${run.file}.xlsx`)} download>
                  {t.download('xlsx')}
                </a>
                <a className="button" href={fileUrl(`${run.file}.csv`)} download>
                  {t.download('csv')}
                </a>
              </>
            )}
            <button onClick={() => api('/files/open-folder', 'POST').catch(notify)}>{t.openFolder}</button>
          </div>
        </section>
      )}

      <section aria-labelledby="res-h" className="stack">
        <h2 id="res-h">
          {t.results} {run ? `(${run.jobs.length})` : ''}
        </h2>
        {run?.jobs.length ? <Results jobs={run.jobs} t={t} /> : <p className="card empty muted">{t.emptyResults}</p>}
      </section>

      {run && Object.keys(run.rejected).length > 0 && (
        <details className="card">
          <summary>
            <strong>{t.rejected}</strong>
          </summary>
          <ul className="plain">
            {Object.entries(run.rejected)
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => (
                <li key={code} className="row">
                  <span>{state.rejectLabels[code]?.[lang] ?? code}</span>
                  <b>{n}</b>
                </li>
              ))}
          </ul>
        </details>
      )}

      {run && run.log.length > 0 && (
        <details className="card">
          <summary>
            <strong>{t.log}</strong>
          </summary>
          <ol className="log">
            {[...run.log].reverse().map((l, i) => (
              <li key={i}>
                <time>{new Date(l.at).toLocaleTimeString(lang === 'pt' ? 'pt-BR' : 'en-US')}</time>
                {l.msg}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Progress({ run, t, now }: { run: Run; t: Dict; now: number }) {
  const n = run.jobs.length;
  const pct = Math.min(100, Math.round((100 * n) / Math.max(1, run.target)));
  const left = Math.max(0, Date.parse(run.deadline) - now);
  const hh = Math.floor(left / 3_600_000);
  const mm = Math.floor((left % 3_600_000) / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  return (
    <div className="progress-wrap">
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={run.target} aria-valuenow={n} aria-label={t.goal(n, run.target)}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="small">
        {n >= run.target ? t.goalDone(n) : t.goal(n, run.target)}
        {run.status === 'running' && (
          <>
            {' · '}
            {t.timeLeft}: <b className="mono">{`${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`}</b>
          </>
        )}
      </p>
    </div>
  );
}

function Results({ jobs, t }: { jobs: Job[]; t: Dict }) {
  const sorted = useMemo(() => [...jobs].sort((a, b) => b.percent - a.percent), [jobs]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t.col.match}</th>
            <th scope="col">{t.col.job}</th>
            <th scope="col">{t.col.site}</th>
            <th scope="col">{t.col.model}</th>
            <th scope="col">{t.col.level}</th>
            <th scope="col">{t.col.details}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((j) => (
            <Row key={j.jobKey} j={j} t={t} open={open === j.jobKey} toggle={() => setOpen(open === j.jobKey ? null : j.jobKey)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ j, t, open, toggle }: { j: Job; t: Dict; open: boolean; toggle: () => void }) {
  const tone = j.percent >= 80 ? 'hi' : j.percent >= 60 ? 'mid' : 'lo';
  return (
    <>
      <tr>
        <td>
          <span className={`score ${tone}`}>{j.percent}%</span>
        </td>
        <td>
          <a href={j.link} target="_blank" rel="noreferrer noopener">
            {j.title}
          </a>
          <div className="muted small">
            {j.company}
            {j.location ? ` · ${j.location}` : ''}
          </div>
        </td>
        <td className="nowrap">{j.site}</td>
        <td className="nowrap">{t.model[j.workModel]}</td>
        <td className="nowrap">{t.level[j.seniority]}</td>
        <td>
          <button className="small" aria-expanded={open} onClick={toggle}>
            {j.has.length + j.similar.length}/{j.has.length + j.similar.length + j.missing.length}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="details">
          <td colSpan={6}>
            <Chips title={t.has} items={j.has} tone="ok" />
            <Chips title={t.similar} items={j.similar.map((s) => `${s.requirement} (${t.youHave} ${s.via})`)} tone="eq" />
            <Chips title={t.missing} items={j.missing} tone="miss" />
          </td>
        </tr>
      )}
    </>
  );
}

function Chips({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="chips-line">
      <span className="small muted">{title}:</span>
      {items.map((i) => (
        <span key={i} className={`chip ${tone}`}>
          {i}
        </span>
      ))}
    </div>
  );
}

// ---------------- Profile ----------------
function ProfileTab({ state, t, notify }: { state: State; t: Dict; notify: (e: unknown) => void }) {
  const [p, setP] = useState<Profile>(state.profile);
  const [found, setFound] = useState<string[] | null>(null);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<string[]>(state.equivalences.map((g) => g.join(', ')));
  const chosen = new Set(p.skills);

  const toggle = (s: string) => setP({ ...p, skills: chosen.has(s) ? p.skills.filter((x) => x !== s) : [...p.skills, s] });
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await api<{ skills: string[] }>('/profile/resume', 'POST', { fileName: f.name, base64: await fileToBase64(f) });
      setFound(r.skills);
    } catch (e) {
      notify(e);
    }
  };
  const save = async () => {
    try {
      await api('/profile', 'PUT', p);
      notify(t.saved);
    } catch (e) {
      notify(e);
    }
  };
  const saveGroups = async () => {
    try {
      await api(
        '/equivalences',
        'PUT',
        groups.map((g) => g.split(',').map((s) => s.trim()).filter(Boolean)).filter((g) => g.length >= 2),
      );
      notify(t.saved);
    } catch (e) {
      notify(e);
    }
  };
  const visible = state.skills.filter((s) => s.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="stack">
      <section className="card">
        <h2>{t.resumeTitle}</h2>
        <p className="muted small">{t.resumeHint}</p>
        <label className="file">
          <input type="file" accept=".pdf,.txt,.md" onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {found && (
          <div className="found">
            <p>{t.found(found.length)}</p>
            <Chips title="" items={found} tone="ok" />
            <button className="primary" onClick={() => setP({ ...p, skills: [...new Set([...p.skills, ...found])] })} disabled={!found.length}>
              {t.useThese}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row wrap">
          <h2>{t.skillsTitle}</h2>
          <span className="pill">{t.selected(p.skills.length)}</span>
        </div>
        <p className="muted small">{t.skillsHint}</p>
        <label>
          {t.filterSkills}
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </label>
        <div className="skill-grid" role="group" aria-label={t.skillsTitle}>
          {visible.map((s) => (
            <button key={s} className={`skill ${chosen.has(s) ? 'on' : ''}`} aria-pressed={chosen.has(s)} onClick={() => toggle(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="grid2">
          <label>
            {t.english}
            <select value={p.englishLevel} onChange={(e) => setP({ ...p, englishLevel: e.target.value as Profile['englishLevel'] })}>
              {(Object.keys(t.englishOpts) as Profile['englishLevel'][]).map((k) => (
                <option key={k} value={k}>
                  {t.englishOpts[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.years}
            <input type="number" min={0} max={40} step={0.5} value={p.experienceYears} onChange={(e) => setP({ ...p, experienceYears: Number(e.target.value) })} />
          </label>
        </div>
        <div className="actions">
          <button className="primary" onClick={save}>
            {t.save}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>{t.eqTitle}</h2>
        <p className="muted small">{t.eqHint}</p>
        <ul className="plain">
          {groups.map((g, i) => (
            <li key={i} className="row">
              <input aria-label={`${t.eqTitle} ${i + 1}`} value={g} placeholder={t.eqPlaceholder} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="ghost small" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button onClick={() => setGroups([...groups, ''])}>{t.addGroup}</button>
          <button className="ghost" onClick={() => setGroups(state.defaults.equivalences.map((g) => g.join(', ')))}>
            {t.restore}
          </button>
          <button className="primary" onClick={saveGroups}>
            {t.save}
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------- Search & filters ----------------
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function SearchTab({ state, t, notify }: { state: State; t: Dict; notify: (e: unknown) => void }) {
  const [s, setS] = useState<Settings>(state.settings);
  const [kw, setKw] = useState(state.settings.keywords.join('\n'));
  const [cities, setCities] = useState(state.settings.filters.cities.join('\n'));
  const [boards, setBoards] = useState(state.settings.boards.join('\n'));
  const f = s.filters;
  const setF = (patch: Partial<Settings['filters']>) => setS({ ...s, filters: { ...f, ...patch } });
  const num = (v: string) => (v === '' ? 0 : Number(v));

  const save = async () => {
    try {
      await api('/settings', 'PUT', { ...s, keywords: lines(kw), boards: lines(boards), filters: { ...f, cities: lines(cities) } });
      notify(t.saved);
    } catch (e) {
      notify(e);
    }
  };

  return (
    <div className="stack">
      <Card title={t.sitesTitle}>
        <div className="checks">
          {state.sources.map((src) => (
            <label key={src.id} className="check">
              <input
                type="checkbox"
                checked={s.sources.includes(src.id)}
                onChange={(e) => setS({ ...s, sources: e.target.checked ? [...s.sources, src.id] : s.sources.filter((x) => x !== src.id) })}
              />
              {src.label} <span className="muted small">· {t.kind[src.kind]}</span>
            </label>
          ))}
        </div>
        <div className="grid2">
          <label>
            {t.keywords}
            <textarea rows={6} value={kw} onChange={(e) => setKw(e.target.value)} />
          </label>
          <div className="stack">
            <label>
              {t.remoteRegion}
              <input value={s.remoteRegion} onChange={(e) => setS({ ...s, remoteRegion: e.target.value })} />
            </label>
            <label>
              {t.cities}
              <textarea rows={3} value={cities} onChange={(e) => setCities(e.target.value)} />
            </label>
          </div>
        </div>
        <label>
          {t.boards}
          <textarea rows={3} value={boards} onChange={(e) => setBoards(e.target.value)} placeholder="https://job-boards.greenhouse.io/..." />
          <span className="muted small">{t.boardsHint}</span>
        </label>
      </Card>

      <Card title={t.filtersTitle}>
        <fieldset className="checks">
          <legend>{t.roles}</legend>
          {(Object.keys(t.roleNames) as Role[]).map((r) => (
            <label key={r} className="check">
              <input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />
              {t.roleNames[r]}
            </label>
          ))}
        </fieldset>
        <div className="grid3">
          <NumField label={t.minPercent} value={f.minPercent} min={0} max={100} onChange={(v) => setF({ minPercent: num(v) })} />
          <NumField label={t.minReq} value={f.minRequirements} min={1} max={20} onChange={(v) => setF({ minRequirements: num(v) })} />
          <NumField label={t.midMin} value={f.midMinPercent} min={0} max={100} onChange={(v) => setF({ midMinPercent: num(v) })} />
          <NumField label={t.maxAge} value={f.maxAgeDays} min={1} max={60} onChange={(v) => setF({ maxAgeDays: num(v) })} />
          <NumField label={t.onsiteSalary} value={f.onsiteMinSalaryBRL} min={0} step={100} onChange={(v) => setF({ onsiteMinSalaryBRL: num(v) })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={f.excludeIntern} onChange={(e) => setF({ excludeIntern: e.target.checked })} />
          {t.excludeIntern}
        </label>
        <label className="check">
          <input type="checkbox" checked={f.excludeSenior} onChange={(e) => setF({ excludeSenior: e.target.checked })} />
          {t.excludeSenior}
        </label>
      </Card>

      <Card title={t.runTitle}>
        <div className="grid3">
          <NumField label={t.duration} value={s.durationHours} min={0.25} max={12} step={0.25} onChange={(v) => setS({ ...s, durationHours: num(v) })} />
          <NumField label={t.target} value={s.target} min={1} onChange={(v) => setS({ ...s, target: num(v) })} />
          <NumField label={t.maxJobs} value={s.maxJobs} min={0} onChange={(v) => setS({ ...s, maxJobs: num(v) })} />
          <label>
            {t.sheetLang}
            <select value={s.sheetLang} onChange={(e) => setS({ ...s, sheetLang: e.target.value as Settings['sheetLang'] })}>
              <option value="pt">Português</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t.browser}
            <select value={s.browser} onChange={(e) => setS({ ...s, browser: e.target.value as Settings['browser'] })}>
              <option value="auto">{t.browserAuto}</option>
              <option value="msedge">Microsoft Edge</option>
              <option value="chrome">Google Chrome</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.skipPrevious} onChange={(e) => setS({ ...s, skipPrevious: e.target.checked })} />
          {t.skipPrevious}
        </label>
      </Card>

      <div className="actions sticky">
        <button className="primary" onClick={save} disabled={state.running}>
          {t.save}
        </button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: string) => void; min?: number; max?: number; step?: number }) {
  return (
    <label>
      {label}
      <input type="number" value={value} min={min} max={max} step={step ?? 1} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card stack">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------------- History ----------------
function HistoryTab({ state, t, lang, notify }: { state: State; t: Dict; lang: Lang; notify: (e: unknown) => void }) {
  const clear = async () => {
    if (!window.confirm(t.confirmClear)) return;
    await api('/history/clear', 'POST').catch(notify);
  };
  return (
    <div className="stack">
      <section className="card">
        <h2>{t.historyTitle}</h2>
        <p className="muted small">{t.remembered(state.history)}</p>
        {state.runs.length === 0 ? (
          <p className="muted">{t.historyEmpty}</p>
        ) : (
          <ul className="plain">
            {state.runs.map((r) => (
              <li key={r.id} className="row wrap">
                <span>
                  <b>{new Date(r.startedAt).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US')}</b> · {t.jobsN(r.found)}
                </span>
                <span className="actions tight">
                  {r.files.map((ext) => (
                    <a key={ext} className="button small" href={fileUrl(`${r.file}.${ext}`)} download>
                      .{ext}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button className="ghost" onClick={clear} disabled={state.running || state.history === 0}>
            {t.clearHistory}
          </button>
        </div>
      </section>
    </div>
  );
}
