// NodeView for code_block nodes whose fence is mermaid (isMermaidFence:
// ```mermaid, ```Mermaid, ```mermaid title="…", …).
// Renders the diagram through the shared mermaid runtime, layered over
// PM's hidden source surface. What a click on the diagram does depends
// on the diagram type: a per-type DiagramController (mermaid/
// controller.ts, registered in mermaid/registry.ts) parses the source,
// maps SVG elements to items, opens popovers and turns their edits into
// source-preserving text changes -> PM transaction -> update() ->
// re-render. Types without a controller render read-only.
import type { Node } from 'prosemirror-model';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';
import { detectDiagramType, type MermaidDiagramType } from './mermaid-detect';
import { settings } from '../../stores/settings';
import { isMermaidFence } from '../mermaid-fence';
import { MERMAID_EDIT_META } from './mermaid-source-guard';
import {
  applyDiagramSizing,
  buildDiagramError,
  currentRenderContext,
  peekMermaidRender,
  renderMermaid,
} from '../mermaid-runtime';
import { createController, type DiagramController, type DiagramHost, type Point } from './mermaid/controller';
import './mermaid/registry';
import { openTextPanel, type TextPanel } from './mermaid/text-panel';

// Rendering goes through the shared mermaid runtime: theme (from
// settings) + font (the editor surface's) + strict security applied on
// every render, serialized with the reader's renders, cached by source.
// See src/lib/mermaid-runtime.ts.

// Under diagrams the visual editor can't change (other kinds, or lines
// it can't take apart): they're changed through their text instead, in
// a panel with a live preview (mermaid/text-panel.ts). Under a diagram
// that won't draw, the same panel is the way to fix it. Product rule:
// never point people at markdown or "the source".
const FALLBACK_NOTE = 'This diagram is changed through its text.';
const FALLBACK_BUTTON = 'Edit diagram text';
const FIX_NOTE = 'You can fix it by changing its text.';
const FIX_BUTTON = 'Fix the diagram text';

// Mermaid sources each editor started with. A diagram that fails to
// render with one of these was already broken in the file; any other
// failing source came from an edit in this session, so the error box
// also says how to undo it.
const initialSources = new WeakMap<EditorView, Set<string>>();

function recordInitialSources(view: EditorView): Set<string> {
  let set = initialSources.get(view);
  if (!set) {
    set = new Set();
    const found = set;
    view.state.doc.descendants((n) => {
      if (n.type.name === 'code_block' && isMermaidFence(String(n.attrs.language || ''))) {
        found.add(n.textContent);
      }
      return true;
    });
    initialSources.set(view, set);
  }
  return set;
}

export class MermaidNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private view: EditorView;
  private getPos: () => number | undefined;
  private renderedEl: HTMLElement;
  // Monotonic counter for renders in flight. renderFromNode captures
  // the value at entry and bails before touching the DOM if a newer
  // render has started since — without this, a slow older render (the
  // first one pays the dynamic import of mermaid) can resolve AFTER a
  // newer one and clobber the fresh SVG with stale output.
  private renderSeq = 0;
  // The controller for the current diagram type (null: read-only type),
  // and the type it was made for — swapped when the source's type
  // changes (e.g. an undo back across a type change).
  private controller: DiagramController | null = null;
  private controllerType: MermaidDiagramType | null = null;
  private host: DiagramHost;
  private escListener: ((e: KeyboardEvent) => void) | null = null;
  // Theme follows the app setting, like the reader. The subscription
  // re-renders the diagram when the user switches theme mid-edit.
  private unsubscribeSettings: (() => void) | null = null;
  private renderedTheme: string | null = null;
  // "Editing coming soon" note under render-only diagrams (see
  // FALLBACK_NOTE); hidden for editable and for broken diagrams.
  private fallbackNote: HTMLElement;
  private fallbackText: HTMLElement;
  private fallbackButton: HTMLButtonElement;
  private initialSources: Set<string>;
  // The text panel, while open, and its host.
  private textPanel: TextPanel | null = null;
  private textPanelHost: HTMLElement | null = null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Outer wrapper holds both the rendered SVG and PM's <code> source
    // (which we keep in the DOM but visually hidden so PM still owns
    // the text — needed for round-trip and for source-as-fallback if
    // the rendered side ever blows up).
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-block-editor';

    const rendered = document.createElement('div');
    rendered.className = 'mermaid-rendered';
    // Mark the rendered SVG container non-editable so:
    //   1. The browser can't put PM's text cursor inside it on click —
    //      otherwise clicks on the diagram land the cursor inside the
    //      mermaid code_block, and every toolbar insert (callout / code
    //      / tasks / table / mermaid) refuses because they all guard
    //      on `$from.parent.type.name === 'code_block'`.
    //   2. Mermaid renders edge labels and node text inside <foreignObject>
    //      (HTML inside SVG). Without contenteditable=false those inherit
    //      PM's contenteditable=true and the user can type directly into
    //      the live SVG — corrupting the doc since PM doesn't know about
    //      the change. Click-to-edit goes through our popovers only.
    rendered.contentEditable = 'false';

    // Source container — required by PM as contentDOM but hidden from
    // the user. We use a <pre><code> shape so any future debug-toggle
    // (or fallback) can reuse the existing code-block CSS.
    const pre = document.createElement('pre');
    pre.className = 'mermaid-source';
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    pre.appendChild(code);

    const fallbackNote = document.createElement('div');
    fallbackNote.className = 'mermaid-fallback-note';
    fallbackNote.contentEditable = 'false';
    fallbackNote.hidden = true;
    const fallbackText = document.createElement('span');
    fallbackText.className = 'mermaid-fallback-text';
    fallbackText.textContent = FALLBACK_NOTE;
    const fallbackButton = document.createElement('button');
    fallbackButton.type = 'button';
    fallbackButton.className = 'mermaid-text-edit-btn';
    fallbackButton.textContent = FALLBACK_BUTTON;
    fallbackButton.addEventListener('mousedown', (e) => e.preventDefault());
    fallbackButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openText();
    });
    fallbackNote.append(fallbackText, fallbackButton);

    wrap.appendChild(rendered);
    wrap.appendChild(fallbackNote);
    wrap.appendChild(pre);

    this.dom = wrap;
    this.contentDOM = code;
    this.renderedEl = rendered;
    this.fallbackNote = fallbackNote;
    this.fallbackText = fallbackText;
    this.fallbackButton = fallbackButton;
    this.initialSources = recordInitialSources(view);
    this.host = this.createHost();

    // One click listener on the rendered container. Mermaid renders
    // replace its innerHTML, not the container, so the listener stays.
    this.renderedEl.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      if (!target || !this.controller || this.dom.classList.contains('mermaid-fallback')) return;
      if (this.controller.click(target, e)) e.stopPropagation();
    });

    // First render. Subsequent renders happen via update() and theme
    // changes. (A cache hit paints synchronously, before PM inserts the
    // wrapper — no empty-box flash when PM rebuilds this NodeView.)
    void this.renderFromNode(node);
    this.unsubscribeSettings = settings.subscribe((s) => {
      if (this.renderedTheme !== null && s.theme !== this.renderedTheme) {
        void this.renderFromNode(this.node);
      }
    });
  }

  // What controllers see of this node view (see DiagramHost).
  private createHost(): DiagramHost {
    return {
      dom: this.dom,
      renderedEl: this.renderedEl,
      source: () => this.currentSource(),
      commit: (source) => this.commitSource(source),
      createUiHost: (className) => {
        // Hosts carry `mermaid-popover-host` so stopEvent /
        // ignoreMutation treat everything in them as UI.
        const el = document.createElement('div');
        el.className = className.includes('mermaid-popover-host') ? className : `mermaid-popover-host ${className}`;
        // The wrapper sits inside ProseMirror's editable area: without
        // this, a click in a popover's rich-text field (itself
        // contenteditable) leaves the caret in the document, and Ctrl+A
        // then typing replaces the whole document.
        el.contentEditable = 'false';
        this.dom.appendChild(el);
        return el;
      },
      anchor: (el, placement) => this.anchor(el, placement),
      setEscapeHandler: (handler) => this.setEscapeHandler(handler),
    };
  }

  // Popover hosts are `position: absolute; inset: 0` inside the
  // wrapper, so anchors are in WRAPPER coordinates.
  private anchor(el: Element | null, placement: 'right' | 'center' | 'below'): Point {
    if (!el || typeof (el as SVGGraphicsElement).getBoundingClientRect !== 'function') return { x: 0, y: 0 };
    const rect = (el as SVGGraphicsElement).getBoundingClientRect();
    const wrapperRect = this.dom.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    if (placement === 'center') {
      return {
        x: (rect.left + rect.right) / 2 - wrapperRect.left,
        y: (rect.top + rect.bottom) / 2 - wrapperRect.top,
      };
    }
    if (placement === 'below') return { x: rect.left - wrapperRect.left, y: rect.bottom - wrapperRect.top + 6 };
    return { x: rect.right - wrapperRect.left + 8, y: rect.top - wrapperRect.top };
  }

  // Escape on `document` (not this.dom) — focus may be elsewhere when
  // the user wants to bail out of a pick mode.
  private setEscapeHandler(handler: (() => void) | null): void {
    if (this.escListener) {
      document.removeEventListener('keydown', this.escListener);
      this.escListener = null;
    }
    if (!handler) return;
    this.escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handler();
      }
    };
    document.addEventListener('keydown', this.escListener);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    if (!isMermaidFence(String(node.attrs.language || ''))) return false;
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
  // keeps the editor from doing surprising things). Same for clicks
  // inside the popover hosts — those are real UI events for our Svelte
  // components, not PM input.
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return (
      target.closest('.mermaid-rendered') !== null ||
      target.closest('.mermaid-popover-host') !== null ||
      target.closest('.mermaid-fallback-note') !== null
    );
  }

  // The rendered side is non-content — we generate it ourselves via
  // mermaid.render and write innerHTML. PM's mutation observer
  // shouldn't redraw on our writes. Same for the popover hosts: they're
  // owned by Svelte, not PM.
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (!target) return false;
    const targetEl =
      target.nodeType === 1
        ? (target as Element)
        : target.parentElement;
    if (
      targetEl?.closest('.mermaid-rendered') !== null ||
      targetEl?.closest('.mermaid-popover-host') !== null ||
      targetEl?.closest('.mermaid-fallback-note') !== null
    ) {
      return true;
    }
    // Adding / removing a popover host (a controller swap) is UI too.
    if (mutation.type === 'childList' && targetEl === this.dom) {
      const nodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
      if (nodes.length && nodes.every((n) => (n as Element).classList?.contains('mermaid-popover-host'))) return true;
    }
    // Class-only mutations on the wrapper itself (e.g. our own
    // .mermaid-has-selection / .mermaid-connect-mode toggles) are UI
    // state, not document content — without this PM treats them as a
    // real mutation and re-builds the NodeView, which destroys the
    // popover before it can render.
    if (
      mutation.type === 'attributes' &&
      (mutation as MutationRecord).attributeName === 'class' &&
      targetEl === this.dom
    ) {
      return true;
    }
    return false;
  }

  // Cleanup when PM tears down the NodeView (block removed, editor
  // destroyed, etc.). Without this the Svelte components would leak.
  destroy(): void {
    this.closeText();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.controller?.destroy();
    this.controller = null;
    this.setEscapeHandler(null);
  }

  // The text panel (see FALLBACK_NOTE): under the diagram, in the flow
  // of the page, until saved or cancelled.
  private openText(): void {
    if (this.textPanel) return;
    const source = this.currentSource();
    if (source == null) return;
    this.controller?.cleared();
    this.textPanelHost = this.host.createUiHost('mermaid-text-panel-host');
    this.dom.classList.add('mermaid-text-open');
    this.textPanel = openTextPanel({
      host: this.textPanelHost,
      text: source,
      context: () => currentRenderContext(this.view.dom),
      onSave: (text) => {
        this.closeText();
        // A block's text doesn't end in a newline (the fence closes it).
        this.commitSource(text.replace(/\s+$/, ''));
        this.view.focus();
      },
      onClose: () => {
        this.closeText();
        this.view.focus();
      },
    });
  }

  private closeText(): void {
    this.textPanel?.destroy();
    this.textPanel = null;
    this.textPanelHost?.remove();
    this.textPanelHost = null;
    this.dom.classList.remove('mermaid-text-open');
  }

  // The note under the diagram: how to change it, or to fix it.
  private showNote(kind: 'edit' | 'fix' | null): void {
    this.fallbackNote.hidden = kind === null;
    this.fallbackNote.classList.toggle('fix', kind === 'fix');
    this.fallbackText.textContent = kind === 'fix' ? FIX_NOTE : FALLBACK_NOTE;
    this.fallbackButton.textContent = kind === 'fix' ? FIX_BUTTON : FALLBACK_BUTTON;
  }

  // The controller for `type`, (re)created when the type changed.
  private controllerFor(type: MermaidDiagramType): DiagramController | null {
    if (this.controllerType !== type) {
      this.controller?.destroy();
      this.setEscapeHandler(null);
      this.controller = createController(type, this.host);
      this.controllerType = type;
    }
    return this.controller;
  }

  private async renderFromNode(node: Node): Promise<void> {
    const seq = ++this.renderSeq;
    const source = node.textContent;
    const ctx = currentRenderContext(this.view.dom);
    this.renderedTheme = ctx.theme;
    const controller = this.controllerFor(detectDiagramType(source));
    const editable = controller?.load(source) ?? false;
    this.dom.classList.toggle('mermaid-fallback', !editable);
    const active = editable ? controller : null;

    // Empty diagram (e.g. a fresh one from the toolbar): skip mermaid
    // and show the controller's placeholder button instead — mermaid
    // would draw an empty SVG with nothing to click.
    const empty = active?.emptyState() ?? null;
    if (empty) {
      active!.cleared();
      this.renderedEl.innerHTML = '';
      const placeholder = document.createElement('button');
      placeholder.type = 'button';
      placeholder.className = 'mermaid-empty-state';
      placeholder.textContent = empty.label;
      // Mirror toolbar-button behaviour: don't steal focus from PM on
      // mousedown so the surrounding selection survives the click.
      placeholder.addEventListener('mousedown', (e) => e.preventDefault());
      placeholder.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        empty.onActivate();
      });
      this.renderedEl.appendChild(placeholder);
      this.showNote(null);
      return;
    }

    // Cache hit → no await → the svg lands in this same call.
    const outcome = peekMermaidRender(source, ctx) ?? (await renderMermaid(source, ctx));
    // A newer render started while this one was in flight — drop the
    // stale result instead of clobbering the fresh SVG (or painting a
    // superseded error box).
    if (seq !== this.renderSeq) return;
    if (outcome.ok) {
      this.renderedEl.innerHTML = outcome.svg;
      const svgRoot = this.renderedEl.querySelector<SVGSVGElement>(':scope > svg');
      if (svgRoot) applyDiagramSizing(svgRoot);
      this.showNote(editable ? null : 'edit');
      if (active) active.rendered();
      else controller?.cleared();
    } else {
      // Broken, not unsupported: offer to fix it through its text. When
      // this source didn't exist when the editor opened, an edit in this
      // session broke it — say how to get back.
      this.showNote('fix');
      this.renderedEl.replaceChildren(
        buildDiagramError(outcome.error, { undoHint: !this.initialSources.has(source) }),
      );
      controller?.cleared();
    }
  }

  // Replace the code_block's text with newSource. PM applies the
  // transaction, our update() fires, renderFromNode re-parses and
  // re-renders the SVG. Single source of truth: the document.
  private commitSource(newSource: string): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    // Nothing changed (e.g. TD picked on a TB chart): no transaction, so
    // no empty undo step.
    if (node.textContent === newSource) return;
    const tr = this.view.state.tr.replaceWith(
      pos + 1,
      pos + 1 + node.content.size,
      this.view.state.schema.text(newSource),
    );
    // The only sanctioned way to change a diagram's source (see
    // mermaid-source-guard.ts, which drops untagged changes).
    tr.setMeta(MERMAID_EDIT_META, true);
    this.view.dispatch(tr);
  }

  // The block's current source, straight from the document.
  private currentSource(): string | null {
    const pos = this.getPos();
    if (pos == null) return null;
    return this.view.state.doc.nodeAt(pos)?.textContent ?? null;
  }
}
