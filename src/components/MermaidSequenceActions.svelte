<script lang="ts">
  import Plus from 'phosphor-svelte/lib/Plus';
  import ChatCircle from 'phosphor-svelte/lib/ChatCircle';
  import Note from 'phosphor-svelte/lib/Note';
  import type { Readable } from 'svelte/store';

  // Floating action bar for sequence diagrams (Task 8 of Phase 2g).
  // Hosts "+ Participant" / "+ Message" / "+ Note" entry points; the
  // NodeView wires the click handlers and conditionally enables each
  // button based on the current participant count.
  interface ActionsState {
    visible: boolean;
    canAddParticipant: boolean; // true when sequence type and not in fallback
    canAddMessage: boolean; //     true when ≥2 participants
    canAddNote: boolean; //        true when ≥1 participant
    onAddParticipant: () => void;
    onAddMessage: () => void;
    onAddNote: () => void;
  }

  interface Props {
    // See MermaidNodePopover for why this prop is `stateStore` and not
    // `state` — the legacy auto-subscribe syntax would collide with the
    // `$state` rune.
    stateStore: Readable<ActionsState>;
  }
  let { stateStore }: Props = $props();

  // Mirror the store value into local reactive state so all template
  // bindings re-run on store updates.
  let current: ActionsState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });
</script>

{#if current}
  <div
    class="mermaid-sequence-actions glass"
    hidden={!current.visible}
    role="toolbar"
    aria-label="Sequence diagram actions"
  >
    {#if current.canAddParticipant}
      <button
        type="button"
        class="mermaid-action-btn"
        title="Add participant"
        aria-label="Add participant"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => current!.onAddParticipant()}
      >
        <Plus size={12} />
        <span>Participant</span>
      </button>
    {/if}
    {#if current.canAddMessage}
      <button
        type="button"
        class="mermaid-action-btn"
        title="Add message"
        aria-label="Add message"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => current!.onAddMessage()}
      >
        <ChatCircle size={12} />
        <span>Message</span>
      </button>
    {/if}
    {#if current.canAddNote}
      <button
        type="button"
        class="mermaid-action-btn"
        title="Add note"
        aria-label="Add note"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => current!.onAddNote()}
      >
        <Note size={12} />
        <span>Note</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .mermaid-sequence-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    z-index: 40;
    pointer-events: auto;
  }
  /* Re-assert display:none for the [hidden] attribute — same trick as
     the popovers, since display:flex would otherwise win on specificity. */
  .mermaid-sequence-actions[hidden] {
    display: none;
  }
  .mermaid-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 3px 7px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .mermaid-action-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
</style>
