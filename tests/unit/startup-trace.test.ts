import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));

import { invoke } from '@tauri-apps/api/core';
import {
  buildTraceMarks,
  createStartupTrace,
  samePathLoose,
} from '../../src/lib/startup-trace';

describe('startup trace (pure parts)', () => {
  it('page timings and marks become epoch ms, in time order', () => {
    const marks = buildTraceMarks(
      [
        { name: 'script-start', t: 300 },
        { name: 'app-mounted', t: 450, detail: 'x' },
      ],
      {
        timeOrigin: 1_000_000,
        nav: { responseEnd: 20, domInteractive: 250, domContentLoadedEventStart: 260 },
        resources: [
          { name: 'http://tauri.localhost/assets/index-AbC123.js', responseEnd: 120 },
          { name: 'http://tauri.localhost/assets/index-AbC123.css', responseEnd: 90 },
          { name: 'http://tauri.localhost/assets/other-zz.js', responseEnd: 999 },
        ],
      },
    );
    expect(marks).toEqual([
      { name: 'nav-start', epochMs: 1_000_000 },
      { name: 'html-received', epochMs: 1_000_020 },
      { name: 'entry-css-received', epochMs: 1_000_090 },
      { name: 'entry-js-received', epochMs: 1_000_120 },
      { name: 'dom-interactive', epochMs: 1_000_250 },
      { name: 'dom-content-loaded', epochMs: 1_000_260 },
      { name: 'script-start', epochMs: 1_000_300 },
      { name: 'app-mounted', epochMs: 1_000_450, detail: 'x' },
    ]);
  });

  it('missing navigation timings are left out, not zero', () => {
    const marks = buildTraceMarks([{ name: 'a', t: 5 }], { timeOrigin: 10, nav: undefined, resources: [] });
    expect(marks).toEqual([{ name: 'nav-start', epochMs: 10 }, { name: 'a', epochMs: 15 }]);
  });

  it('paths compare across slash direction and case', () => {
    expect(samePathLoose('C:\\Docs\\A.md', 'c:/docs/a.md')).toBe(true);
    expect(samePathLoose('C:\\Docs\\A.md', 'C:\\Docs\\B.md')).toBe(false);
  });
});

describe('startup trace recorder', () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it('keeps the first mark of each name and sums spans', () => {
    let now = 0;
    const tr = createStartupTrace(() => now);
    now = 5; tr.mark('a');
    now = 9; tr.mark('a');
    tr.span('render', 3);
    tr.span('render', 4.5);
    expect(tr.snapshot().marks).toEqual([{ name: 'a', t: 5 }]);
    expect(tr.snapshot().spans).toEqual([{ name: 'render', ms: 7.5, count: 2 }]);
  });

  it('knows the launched documents', () => {
    const tr = createStartupTrace(() => 0);
    expect(tr.isLaunched('C:\\a.md')).toBe(false);
    tr.noteLaunched(['C:\\a.md']);
    expect(tr.isLaunched('c:/A.md')).toBe(true);
    expect(tr.isLaunched('C:\\b.md')).toBe(false);
  });

  it('timed() records how long an async step took, even when it throws', async () => {
    let now = 0;
    const tr = createStartupTrace(() => now);
    await tr.timed('read', async () => { now += 7; return 1; });
    await expect(tr.timed('read', async () => { now += 3; throw new Error('x'); })).rejects.toThrow('x');
    expect(tr.snapshot().spans).toEqual([{ name: 'read', ms: 10, count: 2 }]);
  });

  it('flushes once, in one call, and records nothing after', async () => {
    const tr = createStartupTrace(() => 1);
    tr.mark('a');
    await tr.flush({ timeOrigin: 100, nav: undefined, resources: [] });
    await tr.flush({ timeOrigin: 100, nav: undefined, resources: [] });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('startup_trace', {
      marks: [{ name: 'nav-start', epochMs: 100 }, { name: 'a', epochMs: 101 }],
      spans: [],
    });
    tr.mark('late');
    tr.span('render', 1);
    expect(tr.snapshot()).toEqual({ marks: [{ name: 'a', t: 1 }], spans: [] });
  });

  it('marks the first frame on which the document is showing', () => {
    let now = 0;
    const frames: Array<() => void> = [];
    const tr = createStartupTrace(() => now, (cb) => { frames.push(cb); });
    let shown = false;
    tr.markWhenShown('paint', () => shown);
    now = 16; frames.shift()!();
    expect(tr.snapshot().marks).toEqual([]);
    shown = true;
    now = 32; frames.shift()!();
    expect(tr.snapshot().marks).toEqual([{ name: 'paint', t: 32 }]);
    expect(frames).toHaveLength(0);
  });

  it('stops watching for a document that never shows', () => {
    const frames: Array<() => void> = [];
    const tr = createStartupTrace(() => 0, (cb) => { frames.push(cb); });
    tr.markWhenShown('paint', () => false, 3);
    for (let i = 0; i < 3; i++) frames.shift()!();
    expect(frames).toHaveLength(0);
    expect(tr.snapshot().marks).toEqual([]);
  });

  it('a host without the command never fails startup', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('unknown command'));
    const tr = createStartupTrace(() => 1);
    await expect(tr.flush({ timeOrigin: 0, nav: undefined, resources: [] })).resolves.toBeUndefined();
  });
});
