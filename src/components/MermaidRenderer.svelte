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
    while (misses.length > 0) {
      // Each diagram is drawn in its own task, so the page can paint and
      // take input in between; the next one is whichever is now nearest to
      // what's on screen (the reading position is restored meanwhile, and
      // the user may scroll).
      if (misses.length < total) {
        await new Promise((r) => setTimeout(r, 0));
        if (pass !== passSeq) return;
      }
      const el = misses.splice(nearestToScreen(misses), 1)[0];
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

  // Index of the block closest to the visible part of the window (0 for
  // one on screen); the first such block in document order on a tie.
  function nearestToScreen(blocks: HTMLElement[]): number {
    const height = window.innerHeight;
    let best = 0;
    let bestDistance = Infinity;
    blocks.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const distance = r.bottom < 0 ? -r.bottom : r.top > height ? r.top - height : 0;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
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
