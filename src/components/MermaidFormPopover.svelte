<script lang="ts">
  import type { Readable } from 'svelte/store';
  import type { FormPopoverState, FormField, RowsField, RowValue } from '../lib/editor/mermaid/form';
  import MermaidIcon from './MermaidIcon.svelte';
  import MermaidRichText from './MermaidRichText.svelte';
  import MermaidSwatches from './MermaidSwatches.svelte';

  // The data-driven popover for diagram items (see mermaid/form.ts).
  // A controller pushes a FormPopoverState through the store; text-like
  // fields keep local drafts so typing never round-trips through the
  // diagram, and commit on blur / Enter (Escape reverts and closes).
  interface Props {
    // See MermaidNodePopover for why this prop is `stateStore`.
    stateStore: Readable<FormPopoverState>;
  }
  let { stateStore }: Props = $props();

  let current: FormPopoverState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });

  // Drafts for text / number / date fields and table cells, keyed by
  // item key + field (+ row + column). Re-seeded whenever the value
  // they were seeded from changes (a fresh open, or the diagram
  // changing underneath).
  // (bind:value on a number input writes numbers / null — hence unknown.)
  let drafts: Record<string, unknown> = $state({});
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const seeded: Record<string, string> = {};

  const fieldKey = (id: string) => `${current?.key ?? ''}::${id}`;
  const cellKey = (id: string, row: number, col: string) => `${fieldKey(id)}::${row}::${col}`;

  function seed(k: string, value: string) {
    if (seeded[k] !== value) {
      seeded[k] = value;
      drafts[k] = value;
    }
  }

  $effect(() => {
    if (!current?.visible) return;
    for (const f of current.fields) {
      if (f.kind === 'text' || f.kind === 'date') seed(fieldKey(f.id), f.value);
      else if (f.kind === 'number') seed(fieldKey(f.id), f.value === null ? '' : String(f.value));
      else if (f.kind === 'rows') {
        f.rows.forEach((row, r) => {
          for (const c of f.columns) {
            if (c.kind === 'text' || c.kind === 'number') seed(cellKey(f.id, r, c.id), String(row[c.id] ?? ''));
          }
        });
      }
    }
  });

  function commitField(f: FormField) {
    const k = fieldKey(f.id);
    if (drafts[k] === undefined) return;
    const draft = text(drafts[k]);
    if (f.kind === 'text' && draft !== f.value) f.onCommit(draft);
    else if (f.kind === 'date' && draft && draft !== f.value) f.onCommit(draft);
    else if (f.kind === 'number') {
      const n = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(n) && n !== f.value) f.onCommit(n);
      else if (!Number.isFinite(n) || draft.trim() === '') drafts[k] = f.value === null ? '' : String(f.value);
    }
  }

  function revertField(f: FormField) {
    if (f.kind === 'text' || f.kind === 'date') drafts[fieldKey(f.id)] = f.value;
    else if (f.kind === 'number') drafts[fieldKey(f.id)] = f.value === null ? '' : String(f.value);
  }

  function onFieldKey(e: KeyboardEvent, f: FormField) {
    if (!current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitField(f);
      current.onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revertField(f);
      current.onClose();
    }
  }

  function commitCell(f: RowsField, row: number, col: string) {
    const column = f.columns.find((c) => c.id === col);
    const raw = drafts[cellKey(f.id, row, col)];
    if (!column || raw === undefined) return;
    const draft = text(raw);
    const old = f.rows[row]?.[col];
    if (column.kind === 'number') {
      const n = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(n)) {
        if (n !== old) f.onCell(row, col, n);
      } else {
        drafts[cellKey(f.id, row, col)] = String(old ?? '');
      }
    } else if (draft !== String(old ?? '')) {
      f.onCell(row, col, draft);
    }
  }

  function onCellKey(e: KeyboardEvent, f: RowsField, row: number, col: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCell(f, row, col);
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      drafts[cellKey(f.id, row, col)] = String(f.rows[row]?.[col] ?? '');
      current?.onClose();
    }
  }

  function cellValue(v: RowValue | undefined): string {
    return v === undefined ? '' : String(v);
  }

  // Keep the popover inside the diagram block horizontally: shift it
  // left when it would run past the right edge.
  let el: HTMLDivElement | null = $state(null);
  let shift = $state(0);
  $effect(() => {
    const x = current?.x ?? 0;
    void current?.fields.length;
    if (!el || !current?.visible) return;
    const parentWidth = (el.offsetParent as HTMLElement | null)?.clientWidth ?? 0;
    const width = el.offsetWidth;
    shift = parentWidth && x + width > parentWidth ? Math.max(-x, parentWidth - width - x - 4) : 0;
  });
</script>

{#if current}
  <div
    bind:this={el}
    class="mermaid-form-popover glass"
    hidden={!current.visible}
    style="left: {current.x + shift}px; top: {current.y}px;"
    role="dialog"
    aria-label={current.title ?? 'Edit'}
  >
    {#if current.title}
      <div class="mermaid-form-title">{current.title}</div>
    {/if}
    {#each current.fields as f (f.id)}
      <div class="mermaid-form-row" data-field={f.id}>
        {#if f.kind !== 'hint' && f.kind !== 'toggle' && f.label}
          <span class="mermaid-form-label">{f.label}</span>
        {/if}
        {#if f.kind === 'text'}
          <input class="mermaid-form-input {f.className ?? ''}" type="text" placeholder={f.placeholder ?? ''}
            aria-label={f.label ?? f.placeholder ?? 'Text'}
            bind:value={drafts[fieldKey(f.id)]}
            onblur={() => commitField(f)} onkeydown={(e) => onFieldKey(e, f)} />
        {:else if f.kind === 'rich'}
          <MermaidRichText value={f.value} placeholder={f.placeholder} multiline={f.multiline}
            className={f.className} ariaLabel={f.label ?? f.placeholder ?? 'Text'}
            onCommit={(md) => f.onCommit(md)} onEnter={() => current!.onClose()} onEscape={() => current!.onClose()} />
        {:else if f.kind === 'number'}
          <input class="mermaid-form-input mermaid-form-number {f.className ?? ''}" type="number"
            min={f.min} max={f.max} step={f.step ?? 'any'} placeholder={f.placeholder ?? ''}
            aria-label={f.label ?? 'Number'}
            bind:value={drafts[fieldKey(f.id)]}
            onblur={() => commitField(f)} onkeydown={(e) => onFieldKey(e, f)} />
        {:else if f.kind === 'date'}
          <input class="mermaid-form-input {f.className ?? ''}" type="date" aria-label={f.label ?? 'Date'}
            bind:value={drafts[fieldKey(f.id)]}
            onchange={() => commitField(f)} onkeydown={(e) => onFieldKey(e, f)} />
        {:else if f.kind === 'toggle'}
          <label class="mermaid-form-toggle">
            <input type="checkbox" checked={f.value} onchange={(e) => f.onChange((e.target as HTMLInputElement).checked)} />
            <span>{f.label}</span>
          </label>
        {:else if f.kind === 'choice'}
          {#if f.display === 'select'}
            <select class="mermaid-form-input" aria-label={f.label ?? 'Choice'} value={f.value}
              onchange={(e) => f.onChange((e.target as HTMLSelectElement).value)}>
              {#each f.options as o (o.value)}
                <option value={o.value}>{o.label}</option>
              {/each}
            </select>
          {:else}
            <div class="mermaid-form-choices" role="radiogroup" aria-label={f.label ?? 'Choice'}>
              {#each f.options as o (o.value)}
                <button type="button" class="mermaid-form-choice" class:active={f.value === o.value} role="radio"
                  aria-checked={f.value === o.value} title={o.label} aria-label={o.label}
                  onmousedown={(e) => e.preventDefault()} onclick={() => f.onChange(o.value)}>
                  {#if o.icon}<MermaidIcon name={o.icon} />{:else}<span>{o.label}</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        {:else if f.kind === 'swatches'}
          <MermaidSwatches value={f.value} palette={f.palette} label={f.label} onChange={(v) => f.onChange(v)} />
        {:else if f.kind === 'rows'}
          <table class="mermaid-form-rows">
            <thead>
              <tr>
                {#each f.columns as c (c.id)}<th>{c.label}</th>{/each}
                <th aria-label="Row actions"></th>
              </tr>
            </thead>
            <tbody>
              {#each f.rows as row, r (r)}
                <tr data-row={r}>
                  {#each f.columns as c (c.id)}
                    <td>
                      {#if c.kind === 'text' || c.kind === 'number'}
                        <input class="mermaid-form-cell" type={c.kind === 'number' ? 'number' : 'text'}
                          step="any" placeholder={c.placeholder ?? ''} aria-label={c.label}
                          style={c.width ? `width: ${c.width}` : ''}
                          bind:value={drafts[cellKey(f.id, r, c.id)]}
                          onblur={() => commitCell(f, r, c.id)} onkeydown={(e) => onCellKey(e, f, r, c.id)} />
                      {:else if c.kind === 'toggle'}
                        <input type="checkbox" aria-label={c.label} checked={!!row[c.id]}
                          onchange={(e) => f.onCell(r, c.id, (e.target as HTMLInputElement).checked)} />
                      {:else}
                        <select class="mermaid-form-cell" aria-label={c.label} value={cellValue(row[c.id])}
                          onchange={(e) => f.onCell(r, c.id, (e.target as HTMLSelectElement).value)}>
                          {#each c.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
                        </select>
                      {/if}
                    </td>
                  {/each}
                  <td class="mermaid-form-row-actions">
                    {#if f.onMove}
                      <button type="button" class="mermaid-form-icon-btn" title="Move up" aria-label="Move up"
                        disabled={r === 0} onmousedown={(e) => e.preventDefault()} onclick={() => f.onMove!(r, r - 1)}>
                        <MermaidIcon name="up" size={12} />
                      </button>
                      <button type="button" class="mermaid-form-icon-btn" title="Move down" aria-label="Move down"
                        disabled={r === f.rows.length - 1} onmousedown={(e) => e.preventDefault()} onclick={() => f.onMove!(r, r + 1)}>
                        <MermaidIcon name="down" size={12} />
                      </button>
                    {/if}
                    {#if f.onRemove}
                      <button type="button" class="mermaid-form-icon-btn danger" title="Remove" aria-label="Remove"
                        onmousedown={(e) => e.preventDefault()} onclick={() => f.onRemove!(r)}>
                        <MermaidIcon name="trash" size={12} />
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if f.onAdd}
            <button type="button" class="mermaid-form-action mermaid-form-add" onmousedown={(e) => e.preventDefault()} onclick={() => f.onAdd!()}>
              <MermaidIcon name="plus" size={12} /><span>{f.addLabel ?? 'Add'}</span>
            </button>
          {/if}
        {:else if f.kind === 'hint'}
          <span class="mermaid-form-hint">{f.text}</span>
        {/if}
      </div>
    {/each}
    {#if current.actions.length}
      <div class="mermaid-form-actions">
        {#each current.actions as a (a.id)}
          <button type="button" class="mermaid-form-action" class:danger={a.danger} data-action={a.id}
            title={a.label} aria-label={a.label}
            onmousedown={(e) => e.preventDefault()} onclick={() => a.onClick()}>
            {#if a.icon}<MermaidIcon name={a.icon} size={13} />{/if}
            <span>{a.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .mermaid-form-popover {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    min-width: 200px;
    max-width: 440px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    z-index: 60;
    pointer-events: auto;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--fg-1);
  }
  .mermaid-form-popover[hidden] { display: none; }
  .mermaid-form-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-2);
  }
  .mermaid-form-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .mermaid-form-label { min-width: 64px; color: var(--fg-2); font-size: 11px; }
  .mermaid-form-input, .mermaid-form-cell {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--font-sans);
    outline: none;
  }
  .mermaid-form-input { flex: 1; min-width: 120px; }
  .mermaid-form-number { max-width: 90px; }
  .mermaid-form-cell { width: 100%; min-width: 3em; box-sizing: border-box; }
  .mermaid-form-input:focus, .mermaid-form-cell:focus { border-color: var(--accent); }
  .mermaid-form-toggle { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
  .mermaid-form-choices { display: flex; gap: 2px; flex-wrap: wrap; }
  .mermaid-form-choice, .mermaid-form-action, .mermaid-form-icon-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .mermaid-form-choice:hover, .mermaid-form-action:hover, .mermaid-form-icon-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-form-choice.active { background: var(--accent-soft); color: var(--accent); }
  .mermaid-form-icon-btn { padding: 2px 3px; }
  .mermaid-form-icon-btn:disabled { opacity: 0.35; cursor: default; }
  .mermaid-form-action.danger:hover, .mermaid-form-icon-btn.danger:hover { color: var(--danger, #f0a0a0); }
  .mermaid-form-actions {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
    border-top: 1px solid var(--glass-border);
    padding-top: 5px;
  }
  .mermaid-form-rows { border-collapse: collapse; width: 100%; }
  .mermaid-form-rows th { text-align: left; font-weight: 500; font-size: 10px; color: var(--fg-2); padding: 0 3px 2px; }
  .mermaid-form-rows td { padding: 1px 2px; }
  .mermaid-form-row-actions { white-space: nowrap; }
  .mermaid-form-hint { color: var(--fg-2); font-size: 11px; }
</style>
