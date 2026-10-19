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

const TOKEN = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|mm|m|ss|s|SSS|[A-Za-z]|[^A-Za-z[]+|\[/g;
const KNOWN = new Set(['YYYY', 'YY', 'MMMM', 'MMM', 'MM', 'M', 'DD', 'D', 'HH', 'H', 'mm', 'm', 'ss', 's', 'SSS']);

function tokens(format: string): string[] {
  return format.match(TOKEN) ?? [];
}

// Can dates be read and written in `format`? Not with tokens outside
// the list above, and not with a `,` `#` `;` — those would end or split
// the task's data in the source.
export function ganttDateFormatSupported(format: string): boolean {
  if (!format.trim() || /[,#;]/.test(format)) return false;
  return tokens(format).every((t) => {
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

const PART: Record<string, string> = {
  YYYY: '(\\d{4})', YY: '(\\d\\d)', MMMM: '([A-Za-z]+)', MMM: '([A-Za-z]+)', MM: '(\\d\\d)', M: '(\\d\\d?)',
  DD: '(\\d\\d)', D: '(\\d\\d?)', HH: '(\\d\\d?)', H: '(\\d\\d?)', mm: '(\\d\\d?)', m: '(\\d\\d?)',
  ss: '(\\d\\d?)', s: '(\\d\\d?)', SSS: '(\\d{3})',
};

// `text` as a date in `format`, strictly; null when it isn't one.
export function parseGanttDate(text: string, format: string): Date | null {
  if (!ganttDateFormatSupported(format)) return null;
  const toks = tokens(format);
  const re = new RegExp(
    '^' + toks.map((t) => PART[t] ?? (t.startsWith('[') ? t.slice(1, -1) : t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$',
  );
  const m = re.exec(text);
  if (!m) return null;
  const f: Record<string, number> = {};
  let g = 1;
  for (const t of toks) {
    if (!PART[t]) continue;
    const v = m[g++];
    if (t === 'MMMM' || t === 'MMM') {
      const i = (t === 'MMMM' ? MONTHS : SHORT).indexOf(v);
      if (i < 0) return null;
      f.month = i + 1;
    } else if (t === 'YY') f.year = (Number(v) > 68 ? 1900 : 2000) + Number(v);
    else f[{ YYYY: 'year', MM: 'month', M: 'month', DD: 'day', D: 'day', HH: 'hours', H: 'hours', mm: 'minutes', m: 'minutes', ss: 'seconds', s: 'seconds', SSS: 'ms' }[t]!] = Number(v);
  }
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
