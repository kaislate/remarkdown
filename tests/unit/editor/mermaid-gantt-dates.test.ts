// Gantt dates are read the way mermaid reads them: dayjs strict parsing
// in the chart's dateFormat. dayjs (mermaid's own dependency) is the
// oracle here.
import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import {
  GANTT_DATE_FORMATS,
  formatGanttDate,
  ganttDateAs,
  ganttDateFormatSupported,
  parseGanttDate,
  toGanttDate,
  fromGanttDate,
} from '../../../src/lib/editor/mermaid/gantt-dates';

dayjs.extend(customParseFormat);

const SAMPLES = [
  new Date(2026, 0, 31),
  new Date(2026, 1, 28, 14, 30),
  new Date(1999, 11, 1, 9, 5, 7),
  new Date(2068, 6, 4),
  new Date(1969, 6, 4),
];

const FORMATS = [
  ...GANTT_DATE_FORMATS.map((f) => f.format),
  'YYYY-MM-DD HH:mm:ss',
  'D/M/YY',
  'YYYYMMDD',
  'DD MMM YYYY',
  'MMMM D YYYY',
  'YYYY-MM',
  '[Week of] YYYY-MM-DD',
  'HH:mm:ss.SSS',
];

describe('gantt dates', () => {
  it('lists common formats with an example each', () => {
    for (const f of GANTT_DATE_FORMATS) {
      expect(ganttDateFormatSupported(f.format), f.format).toBe(true);
      expect(formatGanttDate(new Date(2026, 0, 31, 14, 30), f.format)).toBe(f.example);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it('formats like dayjs', () => {
    for (const format of FORMATS) {
      for (const d of SAMPLES) expect(formatGanttDate(d, format), format).toBe(dayjs(d).format(format));
    }
  });

  it('parses strictly, like dayjs', () => {
    const inputs = ['2026-01-31', '2026-1-31', '31-01-2026', '2026-02-30', '31/01/2026', '01/31/2026', '1/2/26', '20260131', '14:30', '2026-01-31 14:30', '31 Jan 2026', 'January 5 2026', 'Week of 2026-01-31', 'nope', ''];
    for (const format of FORMATS) {
      for (const text of inputs) {
        const ours = parseGanttDate(text, format);
        const theirs = dayjs(text, format, true);
        expect(ours !== null, `${text} as ${format}`).toBe(theirs.isValid());
        if (ours && theirs.isValid()) expect(ours.getTime(), `${text} as ${format}`).toBe(theirs.toDate().getTime());
      }
    }
  });

  it('round-trips model date strings', () => {
    expect(toGanttDate(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(toGanttDate(new Date(2026, 0, 31, 14, 30))).toBe('2026-01-31T14:30');
    expect(toGanttDate(new Date(2026, 0, 31, 14, 30, 5))).toBe('2026-01-31T14:30:05');
    expect(fromGanttDate('2026-01-31')?.getTime()).toBe(new Date(2026, 0, 31).getTime());
    expect(fromGanttDate('2026-01-31 14:30')?.getTime()).toBe(new Date(2026, 0, 31, 14, 30).getTime());
    expect(fromGanttDate('2026-02-30')).toBeNull();
    expect(fromGanttDate('31/01/2026')).toBeNull();
  });

  it('says what a date reads back as in a given format', () => {
    expect(ganttDateAs('2026-01-31T14:30', 'YYYY-MM-DD')).toBe('2026-01-31');
    expect(ganttDateAs('2026-01-31', 'DD.MM.YYYY HH:mm')).toBe('2026-01-31');
    const today = toGanttDate(new Date()).slice(0, 10);
    expect(ganttDateAs('2026-01-31T14:30', 'HH:mm')).toBe(`${today}T14:30`);
  });

  it('knows which formats it can write', () => {
    expect(ganttDateFormatSupported('YYYY-MM-DD')).toBe(true);
    expect(ganttDateFormatSupported('Do MMM YYYY')).toBe(false);
    expect(ganttDateFormatSupported('X')).toBe(false);
    expect(ganttDateFormatSupported('MMM D, YYYY')).toBe(false); // a comma would split the task data
  });
});
