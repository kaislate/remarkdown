<script lang="ts">
  import { doc } from '../stores/doc';
  import { settings } from '../stores/settings';
  import { readerMode } from '../stores/reader-mode';
  import { diagramThemeFor } from '../lib/reader-themes';
  import { startupMark } from '../lib/startup-trace';
  import {
    applyDiagramSizing,
    buildDiagramError,
    peekMermaidRender,
    renderContextKey,
    renderMermaid,
    resolveDiagramFont,
    type MermaidRenderContext,
    type MermaidRenderOutcome,
  } from '../lib/mermaid-runtime';

  interface Props {
    articleEl: HTMLElement | null;
  }
  let { articleEl }: Props = $props();

  // Each block keeps its source in data-mermaid for its whole life (the
  // markdown renderer puts it there); data-mermaid-rendered records the
  // context key (theme + font) the current svg was drawn for. A block
  // whose key doesn't match the current context is re-rendered — that
  // is how a theme switch reaches diagrams that are already on screen.
  let passSeq = 0;

  function paint(el: HTMLElement, outcome: MermaidRenderOutcome, key: string): void {
    if (outcome.ok) {
      el.innerHTML = outcome.svg;
      const svg = el.querySelector<SVGSVGElement>(':scope > svg');
      if (svg) applyDiagramSizing(svg);
    } else {
      el.replaceChildren(buildDiagramError(outcome.error));
      // mermaid didn't load / the render timed out: nothing is wrong
      // with the diagram, so leave the block unmarked and the next
      // render pass tries again.
      if (outcome.transient) {
        delete el.dataset.mermaidRendered;
        return;
      }
    }
    el.dataset.mermaidRendered = key;
  }

  async function renderDiagrams(root: HTMLElement, ctx: MermaidRenderContext): Promise<void> {
    const pass = ++passSeq;
    const key = renderContextKey(ctx);
    const misses: HTMLElement[] = [];
    // Synchronous pass first: anything already in the cache is painted
    // before this frame is drawn, so re-opening a document (or coming
    // back from edit mode) never flashes empty diagram slots.
    for (const el of root.querySelectorAll<HTMLElement>('.mermaid-block[data-mermaid]')) {
      if (el.dataset.mermaidRendered === key) continue;
      const source = el.dataset.mermaid ?? '';
      if (!source.trim()) continue;
      const hit = peekMermaidRender(source, ctx);
      if (hit) paint(el, hit, key);
      else misses.push(el);
    }
    const total = misses.length;
    // Diagrams nearest to what's on screen are drawn first: the reading
    // position is restored meanwhile, and the user may scroll. One on
    // screen or near it is followed by a break, so the page paints it and
    // takes input before going on. Ones further away are drawn back to
    // back, with a break every BREAK_EVERY_MS. Each break lays out and
    // paints the whole article, and so does measuring where the blocks
    // are once a diagram has changed it, so the order is worked out again
    // only after a break (nothing can scroll in between).
    let lastBreak = performance.now();
    let breakNext = false;
    let queue = byDistanceFromScreen(misses);
    while (queue.length > 0) {
      if (breakNext || performance.now() - lastBreak >= BREAK_EVERY_MS) {
        await new Promise((r) => setTimeout(r, 0));
        if (pass !== passSeq) return;
        lastBreak = performance.now();
        queue = byDistanceFromScreen(queue.map((q) => q.el));
      }
      const { el, distance } = queue.shift()!;
      breakNext = distance <= window.innerHeight;
      const outcome = await renderMermaid(el.dataset.mermaid ?? '', ctx);
      // A newer pass (theme switched again, new document) owns the
      // blocks now; a detached block belongs to a document that's gone.
      if (pass !== passSeq) return;
      if (!el.isConnected || el.dataset.mermaidRendered === key) continue;
      // Old svg stays visible until the new one is ready (no blank
      // frame mid theme switch).
      paint(el, outcome, key);
    }
    if (total > 0) startupMark('mermaid-pass-done', `${total} diagrams`);
  }

  const BREAK_EVERY_MS = 100;

  // The blocks by how far each is from the visible part of the window (0
  // on screen), nearest first; document order among equals.
  function byDistanceFromScreen(blocks: HTMLElement[]): { el: HTMLElement; distance: number }[] {
    const height = window.innerHeight;
    return blocks
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, distance: r.bottom < 0 ? -r.bottom : r.top > height ? r.top - height : 0 };
      })
      .sort((a, b) => a.distance - b.distance);
  }

  $effect(() => {
    // Re-run whenever the document or the theme changes. In reader mode
    // the reader theme decides: light pages (paper, sepia, e-ink) get
    // mermaid's light theme, night gets the dark one.
    void $doc;
    const theme = diagramThemeFor($settings.theme, $readerMode, $settings.readerTheme);
    const root = articleEl;
    if (!root) return;
    const ctx: MermaidRenderContext = { theme, fontFamily: resolveDiagramFont(root) };
    const selector = '.mermaid-block[data-mermaid]';
    const seen = root.querySelectorAll(selector).length;
    void renderDiagrams(root, ctx);
    // Belt and braces: if the article's {@html} wasn't committed yet
    // when this effect ran (the pass above found nothing), pick the
    // blocks up on the next frame.
    const id = requestAnimationFrame(() => {
      if (seen === 0 && root.querySelector(selector)) void renderDiagrams(root, ctx);
    });
    return () => cancelAnimationFrame(id);
  });
</script>
