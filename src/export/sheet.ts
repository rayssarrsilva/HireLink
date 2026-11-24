import ExcelJS from 'exceljs';
import { renameSync, writeFileSync } from 'node:fs';
import type { CollectedJob, Seniority, WorkModel } from '../core/types';

export type UiLang = 'pt' | 'en';

const HEAD = {
  pt: ['Link', 'Compatibilidade', 'Vaga', 'Empresa', 'Site', 'Modelo', 'Local', 'Nível', 'Requisitos que você tem', 'Equivalentes que você tem', 'Requisitos que faltam', 'Publicada em', 'Coletada em'],
  en: ['Link', 'Match', 'Job', 'Company', 'Site', 'Work model', 'Location', 'Level', 'Requirements you have', 'Equivalents you have', 'Missing requirements', 'Posted on', 'Collected on'],
};
const MODEL: Record<UiLang, Record<WorkModel, string>> = {
  pt: { remote: 'Remoto', hybrid: 'Híbrido', onsite: 'Presencial', unknown: '' },
  en: { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: '' },
};
const LEVEL: Record<UiLang, Record<Seniority, string>> = {
  pt: { intern: 'Estágio', junior: 'Júnior', mid: 'Pleno', senior: 'Sênior', unknown: '' },
  en: { intern: 'Intern', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', unknown: '' },
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** Best matches first; ties go to the newest. */
export function sortJobs(jobs: CollectedJob[]): CollectedJob[] {
  return [...jobs].sort((a, b) => b.percent - a.percent || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
}

/** One row per job. The link is ALWAYS the first column and the only URL in the row: that is what FlashHire reads. */
export function rows(jobs: CollectedJob[], lang: UiLang): (string | number)[][] {
  return sortJobs(jobs).map((j) => [
    j.link,
    j.percent,
    j.title,
    j.company,
    j.site,
    MODEL[lang][j.workModel],
    j.location,
    LEVEL[lang][j.seniority],
    j.has.join(', '),
    j.similar.map((s) => `${s.requirement} (${lang === 'pt' ? 'você tem' : 'you have'} ${s.via})`).join(', '),
    j.missing.join(', '),
    day(j.postedAt),
    day(j.collectedAt),
  ]);
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with ";" and BOM: opens straight in Excel in Portuguese and is read by FlashHire. */
export function toCsv(jobs: CollectedJob[], lang: UiLang): string {
  const lines = [HEAD[lang], ...rows(jobs, lang).map((r) => r.map((c, i) => (i === 1 ? `${c}%` : c)))];
  return '﻿' + lines.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export async function toXlsx(jobs: CollectedJob[], lang: UiLang, summary: [string, string | number][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HireLinks';
  const ws = wb.addWorksheet(lang === 'pt' ? 'Vagas' : 'Jobs', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(HEAD[lang]);
  for (const r of rows(jobs, lang)) {
    const row = ws.addRow(r);
    const link = String(r[0]);
    row.getCell(1).value = { text: link, hyperlink: link };
    row.getCell(1).font = { color: { argb: 'FF0B5CAD' }, underline: true };
    const pct = row.getCell(2);
    pct.value = Number(r[1]) / 100;
    pct.numFmt = '0%';
    const p = Number(r[1]);
    pct.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p >= 80 ? 'FFD8EFE1' : p >= 60 ? 'FFFBECC8' : 'FFF1F1F1' } };
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E4D4A' } };
  [60, 16, 38, 26, 14, 12, 26, 11, 40, 40, 40, 13, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.autoFilter = { from: 'A1', to: 'M1' };

  // Second sheet: summary. FlashHire only reads the first sheet.
  const info = wb.addWorksheet(lang === 'pt' ? 'Resumo' : 'Summary');
  for (const [k, v] of summary) info.addRow([k, v]);
  info.getColumn(1).width = 44;
  info.getColumn(2).width = 40;
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Writes next to the final name and renames, so an open file is never left half written. */
export function writeAtomic(path: string, data: string | Buffer): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
