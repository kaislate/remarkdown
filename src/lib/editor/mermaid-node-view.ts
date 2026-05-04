// NodeView for code_block nodes whose attrs.language === 'mermaid'.
// Renders the diagram using the mermaid singleton, layered over PM's
// hidden source surface. Click-to-edit, popovers, and edit operations
// land in subsequent tasks; this commit is just the wrapper + initial
// render + parse/fallback decision.
import type { Node } from 'prosemirror-model';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';
import { parseMermaid } from './mermaid-parser';

let mermaidSingleton: typeof import('mermaid').default | null = null;
async function getMermaid() {
  if (mermaidSingleton) return mermaidSingleton;
  const m = await import('mermaid');
  const mermaid = m.default;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
  });
  mermaidSingleton = mermaid;
  return mermaid;
}

let renderId = 0;

type MermaidSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; from: string; to: string }
  | null;

export class MermaidNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private renderedEl: HTMLElement;
  private selected: MermaidSelection = null;

  constructor(
    node: Node,
    _view: EditorView,
    _getPos: () => number | undefined,
  ) {
    this.node = node;

    // Outer wrapper holds both the rendered SVG and PM's <code> source
    // (which we keep in the DOM but visually hidden so PM still owns
    // the text — needed for round-trip and for source-as-fallback if
    // the rendered side ever blows up).
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-block-editor';

    const rendered = document.createElement('div');
    rendered.className = 'mermaid-rendered';

    // Source container — required by PM as contentDOM but hidden from
    // the user. We use a <pre><code> shape so any future debug-toggle
    // (or fallback) can reuse the existing code-block CSS.
    const pre = document.createElement('pre');
    pre.className = 'mermaid-source';
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    pre.appendChild(code);

    wrap.appendChild(rendered);
    wrap.appendChild(pre);

    this.dom = wrap;
    this.contentDOM = code;
    this.renderedEl = rendered;

    // Wire click delegation once on the rendered container. Subsequent
    // mermaid renders replace innerHTML inside renderedEl but don't
    // touch renderedEl itself, so the listener stays.
    this.wireClickHandlers();

    // First render. Subsequent renders happen via update().
    void this.renderFromNode(node);
  }

  private wireClickHandlers(): void {
    this.renderedEl.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      const nodeEl = target.closest(
        'g.node[id^="flowchart-"]',
      ) as SVGGElement | null;
      if (nodeEl) {
        const m = /^flowchart-([A-Za-z][A-Za-z0-9_]*)/.exec(nodeEl.id);
        if (m) {
          this.selectGraphNode(m[1]);
          e.stopPropagation();
          return;
        }
      }
      const edgeEl = target.closest(
        'path.flowchart-link[id^="L-"]',
      ) as SVGPathElement | null;
      if (edgeEl) {
        const m = /^L-([A-Za-z][A-Za-z0-9_]*)-([A-Za-z][A-Za-z0-9_]*)/.exec(
          edgeEl.id,
        );
        if (m) {
          this.selectGraphEdge(m[1], m[2]);
          e.stopPropagation();
          return;
        }
      }
      // Click on empty diagram area — clear selection.
      this.clearSelection();
    });
  }

  // Private helpers are named selectGraph* (not selectNode/selectEdge)
  // to avoid clashing with the NodeView interface's optional
  // `selectNode` method, which has a different signature (() => void)
  // and meaning (PM's node-selection visual treatment).
  private selectGraphNode(id: string): void {
    this.selected = { kind: 'node', id };
    this.dom.classList.add('mermaid-has-selection');
    // Highlight the selected SVG node visually.
    this.renderedEl
      .querySelectorAll('g.node.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    this.renderedEl
      .querySelector(`g.node[id^="flowchart-${id}-"]`)
      ?.classList.add('mermaid-selected');
  }

  private selectGraphEdge(from: string, to: string): void {
    this.selected = { kind: 'edge', from, to };
    this.dom.classList.add('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('path.flowchart-link.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    this.renderedEl
      .querySelector(`path.flowchart-link[id^="L-${from}-${to}-"]`)
      ?.classList.add('mermaid-selected');
  }

  private clearSelection(): void {
    this.selected = null;
    this.dom.classList.remove('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
  }

  // Read-only view of the current selection. Tasks 5-6 use this to
  // drive popover content; exposed here so the field actually has a
  // reader (and so downstream code doesn't need to reach into private
  // state).
  getSelection(): MermaidSelection {
    return this.selected;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    if (String(node.attrs.language || '') !== 'mermaid') return false;
    const oldText = this.node.textContent;
    const newText = node.textContent;
    this.node = node;
    if (newText !== oldText) {
      void this.renderFromNode(node);
    }
    return true;
  }

  // Block PM from interpreting clicks inside the rendered preview as
  // cursor moves into the source (the source is hidden anyway, but
  // keeps the editor from doing surprising things).
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return target.closest('.mermaid-rendered') !== null;
  }

  // The rendered side is non-content — we generate it ourselves via
  // mermaid.render and write innerHTML. PM's mutation observer
  // shouldn't redraw on our writes.
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (!target) return false;
    const targetEl =
      target.nodeType === 1
        ? (target as Element)
        : target.parentElement;
    return targetEl?.closest('.mermaid-rendered') !== null;
  }

  private async renderFromNode(node: Node): Promise<void> {
    const source = node.textContent;
    const parsed = parseMermaid(source);
    if (!parsed.ok) {
      this.dom.classList.add('mermaid-fallback');
    } else {
      this.dom.classList.remove('mermaid-fallback');
    }

    try {
      const mermaid = await getMermaid();
      const id = `remarkdown-mermaid-${++renderId}`;
      const { svg } = await mermaid.render(id, source);
      this.renderedEl.innerHTML = svg;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.renderedEl.innerHTML = '';
      const errBox = document.createElement('pre');
      errBox.className = 'mermaid-error';
      errBox.textContent = `Mermaid error: ${msg}`;
      this.renderedEl.appendChild(errBox);
    }
  }
}
