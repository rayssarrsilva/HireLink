// Copy of FlashHire's reader (src/import/sheet.ts: readRows, parseCsv, linksFromRows) so the tests prove FlashHire reads HireLinks' sheets.
import ExcelJS from 'exceljs';

/** Reads rows (array of cell strings) from an .xlsx or .csv buffer. */
export async function readRows(buf: Buffer, fileName: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value as unknown;
        let text = '';
        if (v && typeof v === 'object') {
          const o = v as { hyperlink?: string; text?: unknown; result?: unknown; richText?: { text: string }[] };
          text = o.hyperlink ?? (o.richText ? o.richText.map((r) => r.text).join('') : String(o.text ?? o.result ?? ''));
        } else text = v === null || v === undefined ? '' : String(v);
        cells[col - 1] = text;
      });
      rows.push(Array.from(cells, (c) => c ?? ''));
    });
    return rows;
  }
  return parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
}

export function parseCsv(text: string): string[][] {
  const delimiter = (text.split('\n')[0] ?? '').split(';').length > (text.split('\n')[0] ?? '').split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** One link per row: the first cell of each row that looks like a URL. */
export function linksFromRows(rows: string[][]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const cell = r.find((c) => /https?:\/\/\S+/.test(c));
    const m = cell?.match(/https?:\/\/\S+/);
    if (m) out.push(m[0].replace(/[)\],;]+$/, ''));
  }
  return out;
}

