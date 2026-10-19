<script lang="ts">
  // One setting: a small animated depiction, a title and a plain-words
  // description, and its control. The depiction plays while the card is
  // hovered or focused, and for a moment after the value changes, so you
  // can see what you just turned on.
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import Depiction from './Depiction.svelte';
  import type { OptionDef } from '../../lib/settings-catalog';
  import type { Settings } from '../../lib/settings-schema';
  import { settings, updateSettings } from '../../stores/settings';

  interface Props {
    option: OptionDef;
    // Renders the control for `control.type === 'custom'` options.
    custom?: Snippet;
  }
  let { option, custom }: Props = $props();

  const PLAY_AFTER_CHANGE_MS = 2400;

  let hovered = $state(false);
  let focused = $state(false);
  let justChanged = $state(false);
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const playing = $derived(hovered || focused || justChanged);

  const enabled = $derived(option.enabled ? option.enabled($settings) : true);
  const control = $derived(option.control);
  const titleId = $derived(`${option.id}-title`);
  const value = $derived(control.type === 'custom' ? undefined : $settings[control.key]);

  function set(patch: Partial<Settings>) {
    updateSettings(patch);
    justChanged = true;
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { justChanged = false; changeTimer = null; }, PLAY_AFTER_CHANGE_MS);
  }

  onDestroy(() => { if (changeTimer) clearTimeout(changeTimer); });

  function onSwitch(e: Event) {
    if (control.type !== 'switch') return;
    const checked = (e.currentTarget as HTMLInputElement).checked;
    set({ [control.key]: control.invert ? !checked : checked } as Partial<Settings>);
  }

  function onSegment(v: string | number) {
    if (control.type !== 'segmented') return;
    set({ [control.key]: v } as Partial<Settings>);
  }

  function onSegmentKeydown(e: KeyboardEvent, i: number) {
    if (control.type !== 'segmented') return;
    const opts = control.options;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % opts.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + opts.length) % opts.length;
    if (next < 0) return;
    e.preventDefault();
    onSegment(opts[next].value);
    const group = (e.currentTarget as HTMLElement).parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  }

  function onSelect(e: Event) {
    if (control.type !== 'select') return;
    const raw = (e.currentTarget as HTMLSelectElement).value;
    const match = control.options.find((o) => String(o.value) === raw);
    if (match) set({ [control.key]: match.value } as Partial<Settings>);
  }

  function onSlider(e: Event) {
    if (control.type !== 'slider') return;
    set({ [control.key]: Number((e.currentTarget as HTMLInputElement).value) } as Partial<Settings>);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="option-card"
  class:disabled={!enabled}
  data-option={option.id}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={() => (focused = false)}
>
  <Depiction name={option.depiction} {playing} {value} />

  <div class="words">
    <div class="title" id={titleId}>
      {option.title}
      {#if option.badge}<span class="badge">{option.badge}</span>{/if}
    </div>
    <p class="desc">{option.description}</p>
  </div>

  <div class="control">
    {#if control.type === 'switch'}
      <input
        id={option.id}
        class="switch"
        type="checkbox"
        role="switch"
        aria-labelledby={titleId}
        disabled={!enabled}
        checked={control.invert ? !value : !!value}
        onchange={onSwitch}
      />
    {:else if control.type === 'segmented'}
      <div class="segmented" role="radiogroup" id={option.id} aria-labelledby={titleId}>
        {#each control.options as o, i (o.value)}
          <button
            role="radio"
            aria-checked={value === o.value}
            tabindex={value === o.value ? 0 : -1}
            disabled={!enabled}
            onclick={() => onSegment(o.value)}
            onkeydown={(e) => onSegmentKeydown(e, i)}
          >{o.label}</button>
        {/each}
      </div>
    {:else if control.type === 'select'}
      <select id={option.id} aria-labelledby={titleId} disabled={!enabled} value={String(value)} onchange={onSelect}>
        {#each control.options as o (o.value)}
          <option value={String(o.value)}>{o.label}</option>
        {/each}
      </select>
    {:else if control.type === 'slider'}
      <div class="slider">
        <input
          id={option.id}
          type="range"
          aria-labelledby={titleId}
          min={control.min}
          max={control.max}
          step={control.step}
          disabled={!enabled}
          value={value as number}
          oninput={onSlider}
        />
        <span class="value">{control.format(value as number)}</span>
      </div>
    {:else if control.type === 'swatches'}
      <div class="swatches" role="radiogroup" id={option.id} aria-labelledby={titleId}>
        {#each control.colors as c (c)}
          <button
            role="radio"
            class="swatch"
            aria-label={c}
            aria-checked={value === c}
            disabled={!enabled}
            style:background={c}
            onclick={() => set({ [control.key]: c } as Partial<Settings>)}
          ></button>
        {/each}
      </div>
    {:else if custom}
      {@render custom()}
    {/if}
  </div>
</div>

<style>
  .option-card {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 10px 12px 10px 10px;
    border-radius: 10px;
    border: 1px solid var(--glass-border);
    background: var(--bg-0);
    transition: border-color 0.18s ease, transform 0.18s ease;
  }
  .option-card:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--glass-border)); }
  .option-card.disabled { opacity: 0.5; }
  .words { min-width: 0; display: grid; gap: 3px; }
  .title {
    font-family: var(--font-sans);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--fg-0);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    border-radius: 999px;
    padding: 0 6px;
  }
  .desc {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.45;
    color: var(--fg-2);
  }
  .control { display: flex; align-items: center; justify-content: flex-end; }

  /* Switch: a real checkbox (keyboard + screen readers) drawn as a toggle. */
  .switch {
    appearance: none;
    width: 36px;
    height: 20px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--glass-border);
    position: relative;
    cursor: pointer;
    margin: 0;
    transition: background-color 0.2s ease;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--fg-1);
    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease;
  }
  .switch:checked { background: var(--accent); border-color: var(--accent); }
  .switch:checked::after { transform: translateX(16px); background: #fff; }
  .switch:focus-visible, .segmented button:focus-visible, .swatch:focus-visible, select:focus-visible, input[type='range']:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .segmented {
    display: inline-flex;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .segmented button {
    font: 500 12px var(--font-sans);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    padding: 6px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .segmented button + button { border-left: 1px solid var(--glass-border); }
  .segmented button[aria-checked='true'] { background: var(--accent-soft); color: var(--fg-0); }

  select {
    font: 13px var(--font-sans);
    color: var(--fg-0);
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 5px 8px;
  }
  .slider { display: flex; align-items: center; gap: 8px; }
  .slider input { width: 120px; accent-color: var(--accent); }
  .value {
    min-width: 62px;
    font: 12px var(--font-sans);
    color: var(--fg-1);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .swatches { display: flex; gap: 6px; }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .swatch[aria-checked='true'] { border-color: var(--fg-0); box-shadow: 0 0 0 2px var(--accent-soft); }

  @media (prefers-reduced-motion: reduce) {
    .switch, .switch::after, .option-card { transition: none; }
  }
</style>
