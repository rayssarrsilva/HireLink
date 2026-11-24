const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ', ccedil: 'ç',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Ccedil: 'Ç',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

/** HTML (or HTML escaped as text, like Greenhouse sends) to readable plain text. */
export function htmlToText(html: string): string {
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s) && !/<\/?[a-z][^>]*>/i.test(s)) s = decodeEntities(s);
  return decodeEntities(
    s
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|section)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Inner text of the first element whose class attribute contains `cls` (regex-free HTML slicing for simple fragments). */
export function textOfClass(html: string, cls: string): string {
  const i = html.search(new RegExp(`class="[^"]*\\b${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^"]*"`));
  if (i < 0) return '';
  const start = html.indexOf('>', i) + 1;
  const tag = html.slice(html.lastIndexOf('<', i) + 1).match(/^\w+/)?.[0] ?? 'div';
  const end = html.indexOf(`</${tag}>`, start);
  return htmlToText(html.slice(start, end < 0 ? undefined : end));
}
