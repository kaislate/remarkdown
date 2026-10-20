// Changing a diagram through its text: for the kinds of diagram the
// visual editor doesn't cover (git graphs, C4, architecture…), for the
// rare lines a visual editor can't take apart, and for fixing a diagram
// that won't draw. The panel opens under the diagram — the text on the
// left, the diagram as it will look on the right, redrawn as you type,
// with what's wrong if it can't be drawn — and Save puts it back through
// the node view's commit (the one sanctioned way to change a diagram).

import { renderMermaid, applyDiagramSizing, type MermaidRenderContext } from '../../mermaid-runtime';

export interface TextPanelOptions {
  // Where the panel goes (a UI host from the node view; PM ignores it).
  host: HTMLElement;
  text: string;
  context: () => MermaidRenderContext;
  onSave: (text: string) => void;
  onClose: () => void;
}

export interface TextPanel {
  destroy(): void;
}

const PREVIEW_DELAY = 250;

// The first line of a mermaid error says what's wrong; the rest is noise.
function plainError(e: string): string {
  const first = e.split('\n').find((l) => l.trim()) ?? e;
  return first.replace(/^Error:\s*/, '').slice(0, 200);
}

export function openTextPanel(o: TextPanelOptions): TextPanel {
  const panel = document.createElement('div');
  panel.className = 'mermaid-text-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Edit diagram text');

  const box = document.createElement('textarea');
  box.className = 'mermaid-text-box';
  box.spellcheck = false;
  box.value = o.text;
  box.setAttribute('aria-label', 'Diagram text');

  const side = document.createElement('div');
  side.className = 'mermaid-text-side';
  const preview = document.createElement('div');
  preview.className = 'mermaid-text-preview';
  preview.setAttribute('aria-label', 'How it will look');
  const problem = document.createElement('p');
  problem.className = 'mermaid-text-problem';
  problem.hidden = true;
  side.append(preview, problem);

  const actions = document.createElement('div');
  actions.className = 'mermaid-text-actions';
  const hint = document.createElement('span');
  hint.className = 'mermaid-text-hint';
  hint.textContent = 'Ctrl+Enter to save · Esc to cancel';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mermaid-text-cancel';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'mermaid-text-save';
  save.textContent = 'Save';
  actions.append(hint, cancel, save);

  const body = document.createElement('div');
  body.className = 'mermaid-text-body';
  body.append(box, side);
  panel.append(body, actions);
  o.host.replaceChildren(panel);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  async function redraw() {
    const mine = ++seq;
    const outcome = await renderMermaid(box.value, o.context());
    if (mine !== seq) return;
    if (outcome.ok) {
      preview.innerHTML = outcome.svg;
      const svg = preview.querySelector<SVGSVGElement>(':scope > svg');
      if (svg) applyDiagramSizing(svg);
      preview.classList.remove('stale');
      problem.hidden = true;
    } else {
      // Keep the last good drawing, faded, and say what's wrong.
      preview.classList.add('stale');
      problem.hidden = false;
      problem.textContent = `Can't draw this yet: ${plainError(outcome.error)}`;
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void redraw(), PREVIEW_DELAY);
  };

  box.addEventListener('input', schedule);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      o.onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      o.onSave(box.value);
    } else if (e.key === 'Tab') {
      // Indent, as diagram text is indented — rather than leaving the box.
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = box;
      box.setRangeText('  ', s, end, 'end');
      schedule();
    }
  });
  save.addEventListener('click', () => o.onSave(box.value));
  cancel.addEventListener('click', () => o.onClose());

  void redraw();
  requestAnimationFrame(() => box.focus());

  return {
    destroy() {
      if (timer) clearTimeout(timer);
      seq++;
      o.host.replaceChildren();
    },
  };
}
