// The diagram text panel redraws its preview at each pause in typing.
// Renders are serialized app-wide, so a preview can wait its turn behind
// others; one replaced by a newer pause before its turn is skipped, and
// previews stay out of the cache the document's diagrams paint from.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openTextPanel } from '../../../src/lib/editor/mermaid/text-panel';
import { renderMermaid, peekMermaidRender, resetMermaidRuntimeForTests } from '../../../src/lib/mermaid-runtime';

const mocked = vi.hoisted(() => ({
  renders: [] as Array<{ source: string; resolve: () => void }>,
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: () => { throw new Error('use mermaidAPI.render'); },
    mermaidAPI: {
      render: (id: string, source: string) =>
        new Promise<{ svg: string }>((res) => {
          mocked.renders.push({ source, resolve: () => res({ svg: `<svg id="${id}" data-src="${source.split('\n').pop()}"></svg>` }) });
        }),
    },
  },
}));

const DARK = { theme: 'dark' as const, fontFamily: 'Charter, serif' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function flush(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) await sleep(0);
}

function type(box: HTMLTextAreaElement, text: string): void {
  box.value = text;
  box.dispatchEvent(new Event('input'));
}

beforeEach(() => {
  resetMermaidRuntimeForTests();
  mocked.renders.length = 0;
});

describe('diagram text panel preview', () => {
  it('draws only the latest of the pauses that queued up behind other diagrams', async () => {
    // Another diagram is drawing.
    const other = renderMermaid('flowchart TD\nOTHER', DARK);
    await flush();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = openTextPanel({ host, text: 'flowchart TD\nT0', context: () => DARK, onSave: () => {}, onClose: () => {} });
    const box = host.querySelector<HTMLTextAreaElement>('.mermaid-text-box')!;
    type(box, 'flowchart TD\nT1');
    await sleep(300);
    type(box, 'flowchart TD\nT2');
    await sleep(300);
    type(box, 'flowchart TD\nT3');
    await sleep(300);
    mocked.renders[0].resolve();
    await other;
    await flush(8);
    // eslint-disable-next-line no-console
    console.log(`[perf] text panel: mermaid renders for 4 queued previews: ${mocked.renders.length - 1}`);
    expect(mocked.renders.map((r) => r.source)).toEqual(['flowchart TD\nOTHER', 'flowchart TD\nT3']);
    mocked.renders[1].resolve();
    await flush();
    expect(host.querySelector('.mermaid-text-preview svg')?.getAttribute('data-src')).toBe('T3');
    // Earlier previews never reached the cache.
    expect(peekMermaidRender('flowchart TD\nT1', DARK)).toBeNull();
    panel.destroy();
    host.remove();
  });

  it('a preview still waiting when the panel closes is never drawn', async () => {
    const other = renderMermaid('flowchart TD\nOTHER', DARK);
    await flush();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = openTextPanel({ host, text: 'flowchart TD\nT0', context: () => DARK, onSave: () => {}, onClose: () => {} });
    panel.destroy();
    mocked.renders[0].resolve();
    await other;
    await flush(8);
    expect(mocked.renders.map((r) => r.source)).toEqual(['flowchart TD\nOTHER']);
    host.remove();
  });
});
