<script lang="ts">
  import Note from 'phosphor-svelte/lib/Note';
  import Code from 'phosphor-svelte/lib/Code';
  import CheckSquare from 'phosphor-svelte/lib/CheckSquare';
  import Table from 'phosphor-svelte/lib/Table';
  import Asterisk from 'phosphor-svelte/lib/Asterisk';
  import FlowArrow from 'phosphor-svelte/lib/FlowArrow';
  import CaretDown from 'phosphor-svelte/lib/CaretDown';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import MathOperations from 'phosphor-svelte/lib/MathOperations';
  import Minus from 'phosphor-svelte/lib/Minus';
  import { BLOCK_STYLES, type BlockStyle } from '../lib/editor/block-commands';

  import MermaidDiagramThumb from './MermaidDiagramThumb.svelte';
  import type { StarterKind } from '../lib/editor/mermaid-commands';

  type ToolbarAction = 'callout' | 'code' | 'tasks' | 'table' | 'footnote' | 'mermaid' | 'sequence' | 'diagram' | 'image' | 'formula' | 'divider';

  interface Props {
    // 'diagram' comes with the kind of diagram to insert.
    onInsert: (action: ToolbarAction, diagram?: StarterKind) => void;
    // The style of the block the cursor is in (null: not a text style —
    // code, a diagram…), and the way to change it.
    blockStyle?: BlockStyle | null;
    onBlockStyle?: (style: BlockStyle) => void;
  }

  // The diagram menu: a picture and a plain name for each kind the
  // editor can edit (flowchart / sequence keep their original actions).
  const DIAGRAMS: Array<{ kind: StarterKind; label: string; hint: string; action: string }> = [
    { kind: 'flowchart', label: 'Flowchart', hint: 'Boxes joined by arrows', action: 'flowchart' },
    { kind: 'sequence', label: 'Sequence', hint: 'Who sends what to whom, in order', action: 'sequence' },
    { kind: 'pie', label: 'Pie chart', hint: 'Shares of a whole', action: 'diagram-pie' },
    { kind: 'timeline', label: 'Timeline', hint: 'Events through time', action: 'diagram-timeline' },
    { kind: 'gantt', label: 'Gantt chart', hint: 'A schedule of tasks', action: 'diagram-gantt' },
    { kind: 'state', label: 'States', hint: 'Steps something moves through', action: 'diagram-state' },
    { kind: 'class', label: 'Classes', hint: 'Things, their parts and how they relate', action: 'diagram-class' },
    { kind: 'er', label: 'Database (ER)', hint: 'Tables and how they connect', action: 'diagram-er' },
    { kind: 'mindmap', label: 'Mind map', hint: 'Ideas branching from one centre', action: 'diagram-mindmap' },
    { kind: 'kanban', label: 'Board (kanban)', hint: 'Cards in columns', action: 'diagram-kanban' },
    { kind: 'xychart', label: 'Bar & line chart', hint: 'Numbers across a few categories', action: 'diagram-xychart' },
    { kind: 'journey', label: 'Journey', hint: 'Steps of an experience, and how each felt', action: 'diagram-journey' },
    { kind: 'quadrant', label: 'Quadrant', hint: 'Things placed on two scales', action: 'diagram-quadrant' },
    { kind: 'radar', label: 'Radar', hint: 'Scores on several measures, compared', action: 'diagram-radar' },
    { kind: 'sankey', label: 'Flows (Sankey)', hint: 'How amounts flow from one thing to another', action: 'diagram-sankey' },
    { kind: 'packet', label: 'Packet', hint: 'The fields of a message, bit by bit', action: 'diagram-packet' },
  ];
  let { onInsert, blockStyle = 'paragraph', onBlockStyle = () => {} }: Props = $props();

  const styleLabel = $derived(BLOCK_STYLES.find((s) => s.style === blockStyle)?.label ?? 'Text style');

  // After clicking a dropdown option, close the <details> menus so they
  // don't stay pinned open. Browsers don't auto-close <details> on a
  // click inside their own content (only on the summary toggle), so we
  // flip `open` ourselves.
  function closeMenu() {
    for (const d of document.querySelectorAll<HTMLDetailsElement>('.toolbar-dropdown')) d.open = false;
  }

  // Opening one menu closes the other.
  function onToggle(e: Event) {
    const opened = e.currentTarget as HTMLDetailsElement;
    if (!opened.open) return;
    for (const d of document.querySelectorAll<HTMLDetailsElement>('.toolbar-dropdown')) if (d !== opened) d.open = false;
  }
</script>

<div class="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
  <details class="toolbar-dropdown style-dropdown" ontoggle={onToggle}>
    <summary
      class="toolbar-btn style-btn"
      data-action="style-menu"
      title="Text style: headings, lists, quotes"
      aria-label={`Text style: ${styleLabel}`}
      onmousedown={(e) => e.preventDefault()}
    >
      <span class="label style-label">{styleLabel}</span>
      <CaretDown size={10} weight="bold" />
    </summary>
    <div class="toolbar-dropdown-menu style-menu" role="menu">
      {#each BLOCK_STYLES as s (s.style)}
        <button
          type="button"
          class="toolbar-dropdown-item style-item style-{s.style}"
          class:current={blockStyle === s.style}
          data-style={s.style}
          role="menuitemradio"
          aria-checked={blockStyle === s.style}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            onBlockStyle(s.style);
            closeMenu();
          }}
        >
          <span class="style-name">{s.label}</span>
          <span class="style-keys">{s.keys}</span>
        </button>
      {/each}
      <div class="menu-sep" role="separator"></div>
      <button
        type="button"
        class="toolbar-dropdown-item style-item"
        data-action="divider"
        role="menuitem"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          onInsert('divider');
          closeMenu();
        }}
      >
        <span class="style-name"><Minus size={14} /> Divider line</span>
        <span class="style-keys">---</span>
      </button>
    </div>
  </details>
  <span class="toolbar-sep" aria-hidden="true"></span>
  <button
    class="toolbar-btn"
    type="button"
    data-action="insert-callout"
    title="Insert callout"
    aria-label="Insert callout"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('callout')}
  >
    <Note size={18} weight="regular" />
    <span class="label">Callout</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="code"
    title="Insert code block"
    aria-label="Insert code block"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('code')}
  >
    <Code size={18} weight="regular" />
    <span class="label">Code</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="tasks"
    title="Insert task list"
    aria-label="Insert task list"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('tasks')}
  >
    <CheckSquare size={18} weight="regular" />
    <span class="label">Tasks</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="table"
    title="Insert table"
    aria-label="Insert table"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('table')}
  >
    <Table size={18} weight="regular" />
    <span class="label">Table</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="footnote"
    title="Insert footnote"
    aria-label="Insert footnote"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('footnote')}
  >
    <Asterisk size={18} weight="regular" />
    <span class="label">Footnote</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="image"
    title="Insert a picture"
    aria-label="Insert a picture"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('image')}
  >
    <ImageIcon size={18} weight="regular" />
    <span class="label">Picture</span>
  </button>
  <button
    class="toolbar-btn"
    type="button"
    data-action="formula"
    title="Insert a formula (select text first to turn it into one)"
    aria-label="Insert a formula"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => onInsert('formula')}
  >
    <MathOperations size={18} weight="regular" />
    <span class="label">Formula</span>
  </button>
  <details class="toolbar-dropdown" ontoggle={onToggle}>
    <summary
      class="toolbar-btn"
      data-action="diagram-menu"
      title="Insert diagram"
      aria-label="Insert diagram"
      onmousedown={(e) => e.preventDefault()}
    >
      <FlowArrow size={18} weight="regular" />
      <span class="label">Diagram</span>
      <CaretDown size={10} weight="bold" />
    </summary>
    <div class="toolbar-dropdown-menu toolbar-diagram-menu" role="menu">
      {#each DIAGRAMS as d (d.kind)}
        <button
          type="button"
          class="toolbar-dropdown-item toolbar-diagram-tile"
          data-action={d.action}
          role="menuitem"
          title={d.hint}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            if (d.kind === 'flowchart') onInsert('mermaid');
            else if (d.kind === 'sequence') onInsert('sequence');
            else onInsert('diagram', d.kind);
            closeMenu();
          }}
        >
          <MermaidDiagramThumb kind={d.kind} />
          <span>{d.label}</span>
        </button>
      {/each}
    </div>
  </details>
</div>

<style>
  .editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    /* Its buttons answer to its own width (the editor column), below. */
    container-type: inline-size;
    padding: 6px 8px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--glass-border);
    position: sticky;
    top: 0;
    /* The Tauri title-bar drag region (TitleBar.svelte's
       `.titlebar-drag`) is `position: fixed; top: 0; height: 38px;
       z-index: 50` and covers the middle of the top edge. With the
       toolbar's old z-index of 5 the drag region sat ON TOP of the
       toolbar buttons and Tauri's window-drag handler intercepted
       every pointerdown before the click could reach our buttons —
       the user saw a perfectly normal-looking toolbar that did
       absolutely nothing when clicked. Raising the toolbar above
       the drag region (51 > 50) makes the buttons actually
       clickable; the title-bar drag still works in the regions to
       the left and right of the toolbar where they don't overlap. */
    z-index: 51;
  }
  /* An open menu sits above the minimap (z-index 85), which it can reach. */
  .editor-toolbar:has(details[open]) {
    z-index: 95;
  }
  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .toolbar-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
    border-color: var(--glass-border);
  }
  .toolbar-btn .label {
    font-family: var(--font-sans);
  }
  /* <details> dropdown — uses the native disclosure widget for
     accessible open/close, with the default triangle marker
     suppressed so the summary visually matches the other toolbar
     buttons. The CaretDown icon inside the summary acts as the
     visual affordance instead. */
  .toolbar-dropdown {
    position: relative;
  }
  .toolbar-dropdown > summary {
    list-style: none;
    cursor: pointer;
  }
  .toolbar-dropdown > summary::-webkit-details-marker {
    display: none;
  }
  .toolbar-dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    min-width: 140px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    z-index: 100;
  }
  .toolbar-dropdown-item {
    display: flex;
    align-items: center;
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 12px;
  }
  /* The diagram menu is a grid of pictured tiles. */
  .toolbar-diagram-menu {
    /* Opens leftwards: the button sits towards the right of the toolbar. */
    left: auto;
    right: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(120px, 1fr));
    gap: 2px;
    min-width: 260px;
  }
  .toolbar-diagram-tile {
    gap: 8px;
  }
  .toolbar-diagram-tile :global(svg) {
    flex: none;
    color: var(--fg-2);
  }
  .toolbar-diagram-tile:hover :global(svg) {
    color: var(--accent);
  }
  .toolbar-dropdown-item:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  /* Text style: the current style's name, and a menu that shows each
     style the way it will look. */
  .style-btn { min-width: 118px; justify-content: space-between; }
  .style-label { font-weight: 600; }
  .style-menu { min-width: 230px; }
  .style-item { justify-content: space-between; gap: 16px; }
  .style-item.current { color: var(--accent); }
  .style-name { display: inline-flex; align-items: center; gap: 6px; }
  .style-keys { color: var(--fg-2); font-size: 11px; }
  .style-h1 .style-name { font-size: 17px; font-weight: 700; }
  .style-h2 .style-name { font-size: 15px; font-weight: 700; }
  .style-h3 .style-name { font-size: 13px; font-weight: 700; }
  .style-quote .style-name { font-style: italic; border-left: 2px solid var(--fg-2); padding-left: 6px; }
  .menu-sep { height: 1px; margin: 4px 2px; background: var(--glass-border); }
  .toolbar-sep { width: 1px; height: 20px; margin: 0 4px; background: var(--glass-border); }
  /* A narrow editor column (a small window, tabs in a sidebar): icons
     only, the names in their tooltips; narrower still, a second row. */
  @container (max-width: 860px) {
    .toolbar-btn:not(.style-btn) .label { display: none; }
  }
</style>
