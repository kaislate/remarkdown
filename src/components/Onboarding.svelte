<script lang="ts">
  // First launch: "How do you want to use remarkdown?" Three starting
  // layouts with real screenshots. Continue applies one; "Customize this
  // layout" applies it and shows its option cards to adjust before
  // finishing (Back undoes it). Re-openable from Settings → About.
  import { get } from 'svelte/store';
  import { tick } from 'svelte';
  import { activeModal, closeModal } from '../stores/modals';
  import { settings, updateSettings } from '../stores/settings';
  import type { Settings } from '../lib/settings-schema';
  import { PROFILES, type Profile } from '../lib/profiles';
  import { OPTIONS } from '../lib/settings-catalog';
  import OptionCard from './settings/OptionCard.svelte';

  const isOpen = $derived($activeModal?.kind === 'onboarding');

  let chosen = $state<Profile>(PROFILES[1]);
  let step = $state<'pick' | 'customize'>('pick');
  let before: Settings | null = null;
  let cardEls: HTMLButtonElement[] = $state([]);

  $effect(() => {
    if (isOpen) {
      step = 'pick';
      chosen = PROFILES[1];
    }
  });

  function finish(apply: boolean) {
    if (apply) updateSettings(chosen.settings);
    updateSettings({ onboardingCompleted: true });
    before = null;
    closeModal();
  }

  function customize() {
    before = get(settings);
    updateSettings(chosen.settings);
    step = 'customize';
  }

  function back() {
    if (before) {
      // Undo only what the profile changed (and anything adjusted since).
      const restore: Partial<Settings> = {};
      const keys = new Set([...Object.keys(chosen.settings), ...chosen.customize
        .map((id) => OPTIONS.find((o) => o.id === id)?.control)
        .flatMap((c) => (c && c.type !== 'custom' ? [c.key] : []))]);
      for (const k of keys) (restore as Record<string, unknown>)[k] = before[k as keyof Settings];
      updateSettings(restore);
    }
    before = null;
    step = 'pick';
  }

  async function onCardKeydown(e: KeyboardEvent, i: number) {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % PROFILES.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + PROFILES.length) % PROFILES.length;
    if (next < 0) return;
    e.preventDefault();
    chosen = PROFILES[next];
    await tick();
    cardEls[next]?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (!isOpen || e.key !== 'Escape') return;
    if (step === 'customize') back();
    else finish(false);
  }

  const customizeOptions = $derived(
    chosen.customize.map((id) => OPTIONS.find((o) => o.id === id)!).filter(Boolean),
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if isOpen}
  <div class="scrim" role="presentation">
    <div class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      {#if step === 'pick'}
        <h2 id="onb-title">How do you want to use remarkdown?</h2>
        <p class="sub">Pick a starting point. You can change any of this later in Settings.</p>

        <div class="cards" role="radiogroup" aria-labelledby="onb-title">
          {#each PROFILES as p, i (p.id)}
            <button
              class="card"
              role="radio"
              aria-checked={chosen.id === p.id}
              tabindex={chosen.id === p.id ? 0 : -1}
              bind:this={cardEls[i]}
              onclick={() => (chosen = p)}
              onkeydown={(e) => onCardKeydown(e, i)}
            >
              <img src={p.screenshot} alt={`remarkdown set up for ${p.title.toLowerCase()}s`} />
              <h3>{p.title}</h3>
              <p>{p.tagline}</p>
              <ul>
                {#each p.bullets as b (b)}<li>{b}</li>{/each}
              </ul>
            </button>
          {/each}
        </div>

        <div class="actions">
          <button class="link" onclick={() => finish(false)}>Skip for now</button>
          <span class="spacer"></span>
          <button class="secondary" onclick={customize}>Customize this layout…</button>
          <button class="primary" onclick={() => finish(true)}>Continue</button>
        </div>
      {:else}
        <h2 id="onb-title">Customize the {chosen.title} layout</h2>
        <p class="sub">These are already set for {chosen.title.toLowerCase()}s. Change anything you like.</p>
        <div class="options">
          {#each customizeOptions as o (o.id)}
            <OptionCard option={o} />
          {/each}
        </div>
        <div class="actions">
          <button class="secondary" onclick={back}>Back</button>
          <span class="spacer"></span>
          <button class="primary" onclick={() => finish(false)}>Done</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 310;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(3px);
  }
  .onboarding {
    width: min(920px, 94vw);
    max-height: 92vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 30px 32px 24px;
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    background: var(--bg-1);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
  }
  h2 {
    margin: 0;
    text-align: center;
    font: 600 22px var(--font-sans);
    color: var(--fg-0);
    text-wrap: balance;
  }
  .sub {
    margin: -8px 0 4px;
    text-align: center;
    font: 13.5px var(--font-sans);
    color: var(--fg-2);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    text-align: left;
    border-radius: 12px;
    border: 1px solid var(--glass-border);
    background: var(--bg-0);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .card:hover { transform: translateY(-2px); }
  .card[aria-checked='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  img {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    object-position: top left;
    border-radius: 7px;
    border: 1px solid var(--glass-border);
    background: var(--bg-1);
  }
  h3 { margin: 4px 0 0; font: 600 15px var(--font-sans); color: var(--fg-0); }
  .card p { margin: 0; font: 12.5px/1.45 var(--font-sans); color: var(--fg-1); }
  ul {
    margin: 0;
    padding-left: 16px;
    display: grid;
    gap: 2px;
    font: 12px var(--font-sans);
    color: var(--fg-2);
  }
  .options { display: flex; flex-direction: column; gap: 10px; }
  .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .spacer { flex: 1 1 auto; }
  .actions button {
    font: 600 13px var(--font-sans);
    border-radius: 8px;
    padding: 9px 16px;
    cursor: pointer;
  }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; }
  .primary:hover { filter: brightness(1.08); }
  .secondary { background: transparent; border: 1px solid var(--glass-border); color: var(--fg-1); }
  .secondary:hover { color: var(--fg-0); }
  .link { background: transparent; border: 0; color: var(--fg-2); padding-left: 0 !important; }
  .link:hover { color: var(--fg-0); }
  @media (max-width: 720px) {
    .cards { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card { transition: none; }
  }
</style>
