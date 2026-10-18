// Reader-mode diagram rendering. mermaid is mocked (instant renders
// that echo the theme they were initialized with) so the test is about
// MermaidRenderer's orchestration: which blocks render, when they
// re-render, what a failure looks like.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import MermaidRenderer from '../../src/components/MermaidRenderer.svelte';
import { settings } from '../../src/stores/settings';
import { DEFAULT_SETTINGS } from '../../src/lib/settings-schema';
import { resetMermaidRuntimeForTests } from '../../src/lib/mermaid-runtime';

const mocked = vi.hoisted(() => ({ theme: '', renders: [] as string[] }));

vi.mock('mermaid', () => ({
  default: {
    initialize: (config: { theme: string }) => {
      mocked.theme = config.theme;
    },
    render: async (id: string, source: string) => {
      mocked.renders.push(source);
      if (source.includes('BROKEN')) {
        // mermaid leaves its temp container behind on failure.
        const tmp = document.createElement('div');
        tmp.id = `d${id}`;
        document.body.appendChild(tmp);
        throw new Error('Parse error on line 2: Expecting SQE, got EOF');
      }
      return {
        svg: `<svg id="${id}" data-theme="${mocked.theme}" viewBox="0 0 1000 100" width="100%" style="max-width: 1000px;"></svg>`,
      };
    },
  },
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
}

function article(html: string): HTMLElement {
  const el = document.createElement('article');
  el.className = 'viewer md-rendered';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const block = (src: string) =>
  `<div class="mermaid-block" data-mermaid="${src.replace(/"/g, '&quot;')}"></div>`;

beforeEach(() => {
  resetMermaidRuntimeForTests();
  mocked.renders.length = 0;
  settings.set({ ...DEFAULT_SETTINGS, theme: 'dark' });
  document.body.innerHTML = '';
});

describe('MermaidRenderer', () => {
  it('renders each placeholder and keeps its source for later re-renders', async () => {
    const root = article(block('flowchart TD\nA-->B'));
    render(MermaidRenderer, { props: { articleEl: root } });
    await settle();
    const el = root.querySelector<HTMLElement>('.mermaid-block')!;
    expect(el.querySelector('svg')?.getAttribute('data-theme')).toBe('dark');
    expect(el.dataset.mermaid).toBe('flowchart TD\nA-->B');
    expect(el.dataset.mermaidRendered).toBeTruthy();
  });

  it('re-renders already-drawn diagrams when the theme changes', async () => {
    const root = article(block('flowchart TD\nA-->B'));
    render(MermaidRenderer, { props: { articleEl: root } });
    await settle();
    expect(root.querySelector('svg')?.getAttribute('data-theme')).toBe('dark');
    settings.set({ ...DEFAULT_SETTINGS, theme: 'light' });
    await settle();
    expect(root.querySelector('svg')?.getAttribute('data-theme')).toBe('default');
    // And back: served from the cache, no third mermaid render.
    settings.set({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await settle();
    expect(root.querySelector('svg')?.getAttribute('data-theme')).toBe('dark');
    expect(mocked.renders.length).toBe(2);
  });

  it('paints a cached diagram synchronously when the same document is re-inserted', async () => {
    const first = article(block('flowchart TD\nA-->B'));
    const r1 = render(MermaidRenderer, { props: { articleEl: first } });
    await settle();
    r1.unmount();
    first.remove();

    const second = article(block('flowchart TD\nA-->B'));
    render(MermaidRenderer, { props: { articleEl: second } });
    // No timers/awaits beyond Svelte's own effect flush.
    await tick();
    expect(second.querySelector('.mermaid-block svg')).not.toBeNull();
    expect(mocked.renders.length).toBe(1);
  });

  it('never lets two copies of a diagram share svg ids', async () => {
    const root = article(block('flowchart TD\nA-->B') + block('flowchart TD\nA-->B'));
    render(MermaidRenderer, { props: { articleEl: root } });
    await settle();
    const ids = Array.from(root.querySelectorAll('svg')).map((s) => s.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps wide diagrams at a readable scale', async () => {
    const root = article(block('gantt\ntitle wide'));
    render(MermaidRenderer, { props: { articleEl: root } });
    await settle();
    const svg = root.querySelector<SVGSVGElement>('svg')!;
    expect(svg.style.minWidth).toBe('750px');
  });

  it('shows a friendly error (details collapsed) and leaves nothing on <body>', async () => {
    const root = article(block('flowchart TD\nBROKEN['));
    render(MermaidRenderer, { props: { articleEl: root } });
    await settle();
    const err = root.querySelector('.mermaid-error');
    expect(err).not.toBeNull();
    expect(err!.querySelector('.mermaid-error-title')?.textContent).toBe(
      "This diagram couldn't be displayed.",
    );
    expect(err!.querySelector('details')?.open).toBe(false);
    expect(err!.querySelector('details')?.textContent).toContain('Expecting SQE');
    const strays = Array.from(document.body.children).filter((c) => c !== root && c.id.startsWith('d'));
    expect(strays).toEqual([]);
  });
});
