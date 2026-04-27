<script lang="ts">
  import { doc } from '../stores/doc';
  import { settings } from '../stores/settings';

  interface Props {
    articleEl: HTMLElement | null;
  }
  let { articleEl }: Props = $props();

  // Singleton promise so we only load mermaid once per session.
  let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
  async function getMermaid() {
    if (!mermaidPromise) {
      mermaidPromise = import('mermaid').then((m) => m.default);
    }
    return mermaidPromise;
  }

  let diagramCounter = 0;

  async function renderDiagrams(root: HTMLElement): Promise<void> {
    const placeholders = Array.from(
      root.querySelectorAll<HTMLElement>('.mermaid-block[data-mermaid]'),
    );
    if (placeholders.length === 0) return;

    const m = await getMermaid();
    m.initialize({
      startOnLoad: false,
      theme: $settings.theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'inherit',
    });

    for (const el of placeholders) {
      const source = el.dataset.mermaid ?? '';
      if (!source.trim()) continue;
      const id = `mermaid-diagram-${++diagramCounter}`;
      try {
        const { svg } = await m.render(id, source);
        el.innerHTML = svg;
        // Remove the data attribute once rendered so re-renders don't double-process.
        el.removeAttribute('data-mermaid');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        el.innerHTML = `<pre class="mermaid-error">Mermaid error: ${escapeHtml(msg)}</pre>`;
        el.removeAttribute('data-mermaid');
      }
    }
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  $effect(() => {
    // Access $doc to make this effect re-run whenever the document changes.
    // We only need the signal, not the value.
    void $doc;
    const root = articleEl;
    if (!root) return;
    // Defer slightly so the article's {@html} has been committed to the DOM.
    const id = requestAnimationFrame(() => {
      void renderDiagrams(root);
    });
    return () => cancelAnimationFrame(id);
  });
</script>
