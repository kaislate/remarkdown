// Dates in gantt charts, read and written the way mermaid does it:
// mermaid parses a task date with dayjs in strict mode against the
// chart's `dateFormat` (moment-style tokens), and only falls back to
// JavaScript's Date parser when that fails.
//
// This module covers the tokens people actually use — YYYY YY M MM MMM
// MMMM D DD H HH m mm s ss SSS and [literal] text — without depending
// on dayjs. "Strict" means what dayjs means by it: the text must be
// exactly what formatting the parsed date gives back (so 2026-02-30 and
// 2026-1-31 are not YYYY-MM-DD dates).
//
// In the model and the edit API a date is a plain local date string:
// 'YYYY-MM-DD', or 'YYYY-MM-DDTHH:mm' / 'YYYY-MM-DDTHH:mm:ss' when it has
// a time of day.

export interface GanttDateFormat {
  format: string;
  // Friendly name for a picker.
  label: string;
  // 31 January 2026, 14:30 in this format.
  example: string;
}

// Formats offered when the user picks how dates are written.
export const GANTT_DATE_FORMATS: readonly GanttDateFormat[] = [
  { format: 'YYYY-MM-DD', label: 'Year-month-day', example: '2026-01-31' },
  { format: 'DD-MM-YYYY', label: 'Day-month-year', example: '31-01-2026' },
  { format: 'DD/MM/YYYY', label: 'Day/month/year', example: '31/01/2026' },
  { format: 'MM/DD/YYYY', label: 'Month/day/year', example: '01/31/2026' },
  { format: 'DD.MM.YYYY', label: 'Day.month.year', example: '31.01.2026' },
  { format: 'YYYY-MM-DD HH:mm', label: 'Date and time', example: '2026-01-31 14:30' },
  { format: 'HH:mm', label: 'Time of day', example: '14:30' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

const NAMED = ['YYYY', 'YY', 'MMMM', 'MMM', 'MM', 'M', 'DD', 'D', 'HH', 'H', 'mm', 'm', 'ss', 's', 'SSS'];
const KNOWN = new Set(NAMED);

// `format` split into tokens: a `[literal]`, a named token (the first in
// NAMED that fits, as a regex alternation picks), any other letter, a
// run of other text, or a `[` with no `]` after it. Done by hand: as a
// regex, `\[[^\]]*\]` ran to the end of the format from every `[` that
// no `]` follows, so a format of `[`s was quadratic.
export function ganttFormatTokens(format: string): string[] {
  const out: string[] = [];
  // The first `]` at or after the last `[` looked at; -1 once none is
  // left, so no later `[` looks again.
  let close = -2;
  for (let i = 0; i < format.length; ) {
    const c = format[i];
    let end: number;
    if (c === '[') {
      if (close !== -1 && close < i) close = format.indexOf(']', i);
      end = close === -1 ? i + 1 : close + 1;
    } else if (/[A-Za-z]/.test(c)) {
      end = i + (NAMED.find((t) => format.startsWith(t, i))?.length ?? 1);
    } else {
      end = i + 1;
      while (end < format.length && !/[A-Za-z[]/.test(format[end])) end++;
    }
    out.push(format.slice(i, end));
    i = end;
  }
  return out;
}

// No real format comes near this; a longer one is left alone, unread.
const MAX_FORMAT_LENGTH = 200;

// A chart has one dateFormat and reads every task's dates in it, so
// the last format's tokens (and whether it's supported) are kept:
// splitting a long format again for each task was quadratic.
let lastFormat: string | null = null;
let lastTokens: string[] = [];
let lastSupported = false;

function tokens(format: string): string[] {
  if (format !== lastFormat) {
    lastFormat = format;
    const tooLong = format.length > MAX_FORMAT_LENGTH;
    lastTokens = tooLong ? [] : ganttFormatTokens(format);
    lastSupported = !tooLong && supported(format, lastTokens);
  }
  return lastTokens;
}

// Can dates be read and written in `format`? Not with tokens outside
// the list above, and not with a `,` `#` `;` — those would end or split
// the task's data in the source.
export function ganttDateFormatSupported(format: string): boolean {
  tokens(format);
  return lastSupported;
}

function supported(format: string, toks: string[]): boolean {
  if (!format.trim() || /[,#;]/.test(format)) return false;
  return toks.every((t) => {
    if (KNOWN.has(t)) return true;
    // `[literal]`; a lone `[` is an unclosed one.
    if (t.startsWith('[')) return t !== '[';
    return !/[A-Za-z]/.test(t);
  });
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatGanttDate(d: Date, format: string): string {
  return tokens(format)
    .map((t) => {
      switch (t) {
        case 'YYYY': return pad(d.getFullYear(), 4);
        case 'YY': return String(d.getFullYear()).slice(-2);
        case 'MMMM': return MONTHS[d.getMonth()];
        case 'MMM': return SHORT[d.getMonth()];
        case 'MM': return pad(d.getMonth() + 1);
        case 'M': return String(d.getMonth() + 1);
        case 'DD': return pad(d.getDate());
        case 'D': return String(d.getDate());
        case 'HH': return pad(d.getHours());
        case 'H': return String(d.getHours());
        case 'mm': return pad(d.getMinutes());
        case 'm': return String(d.getMinutes());
        case 'ss': return pad(d.getSeconds());
        case 's': return String(d.getSeconds());
        case 'SSS': return pad(d.getMilliseconds(), 3);
        default: return t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
      }
    })
    .join('');
}

// Each token is matched where the last one ended, as much as it takes,
// and never tried again with less: that is how dayjs reads a date. One
// regex over the whole format would backtrack through every way to
// split a run of digits between one-or-two-digit tokens, 2^n tries for
// `HHHH…` against a long number, so a crafted chart froze the editor.
const PART: Record<string, RegExp> = {
  YYYY: /\d{4}/y, YY: /\d\d/y, MMMM: /[A-Za-z]+/y, MMM: /[A-Za-z]+/y, MM: /\d\d/y, M: /\d\d?/y,
  DD: /\d\d/y, D: /\d\d?/y, HH: /\d\d?/y, H: /\d\d?/y, mm: /\d\d?/y, m: /\d\d?/y,
  ss: /\d\d?/y, s: /\d\d?/y, SSS: /\d{3}/y,
};

// `text` as a date in `format`, strictly; null when it isn't one.
export function parseGanttDate(text: string, format: string): Date | null {
  if (!ganttDateFormatSupported(format)) return null;
  const f: Record<string, number> = {};
  let pos = 0;
  for (const t of tokens(format)) {
    const re = PART[t];
    if (!re) {
      const literal = t.startsWith('[') ? t.slice(1, -1) : t;
      if (!text.startsWith(literal, pos)) return null;
      pos += literal.length;
      continue;
    }
    re.lastIndex = pos;
    const v = re.exec(text)?.[0];
    if (v === undefined) return null;
    pos += v.length;
    if (t === 'MMMM' || t === 'MMM') {
      const i = (t === 'MMMM' ? MONTHS : SHORT).indexOf(v);
      if (i < 0) return null;
      f.month = i + 1;
    } else if (t === 'YY') f.year = (Number(v) > 68 ? 1900 : 2000) + Number(v);
    else f[{ YYYY: 'year', MM: 'month', M: 'month', DD: 'day', D: 'day', HH: 'hours', H: 'hours', mm: 'minutes', m: 'minutes', ss: 'seconds', s: 'seconds', SSS: 'ms' }[t]!] = Number(v);
  }
  if (pos !== text.length) return null;
  // dayjs fills what the format leaves out from today (time: midnight).
  const now = new Date();
  const year = f.year || now.getFullYear();
  const month = f.year && !f.month ? 0 : f.month > 0 ? f.month - 1 : now.getMonth();
  const day = f.day || (!f.year && !f.month ? now.getDate() : 1);
  const d = new Date(year, month, day, f.hours || 0, f.minutes || 0, f.seconds || 0, f.ms || 0);
  return formatGanttDate(d, format) === text ? d : null;
}

// Date → model string.
export function toGanttDate(d: Date): string {
  const day = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!d.getHours() && !d.getMinutes() && !d.getSeconds()) return day;
  return `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}${d.getSeconds() ? `:${pad(d.getSeconds())}` : ''}`;
}

// Model / API string → Date ('T' or a space before the time); null when
// it isn't a real date.
export function fromGanttDate(s: string): Date | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, se = 0] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x))) as number[];
  const date = new Date(y, mo - 1, d, h, mi, se);
  const ok = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi;
  return ok ? date : null;
}

// What date `s` reads back as once written in `format` (a date-only
// format drops the time; a time-only one takes today's date, as mermaid
// does). null when `s` isn't a date or the format is unsupported.
export function ganttDateAs(s: string, format: string): string | null {
  const d = fromGanttDate(s);
  if (!d || !ganttDateFormatSupported(format)) return null;
  const back = parseGanttDate(formatGanttDate(d, format), format);
  return back ? toGanttDate(back) : null;
}
