<script lang="ts">
  import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
  import { editMode, toggleEditMode } from '../stores/edit-mode';
</script>

<button
  class="edit-mode-toggle glass glass-pill"
  class:active={$editMode}
  aria-label={$editMode ? 'Exit edit mode' : 'Enter edit mode'}
  aria-pressed={$editMode}
  title={$editMode ? 'Exit edit mode (Ctrl+E)' : 'Edit (Ctrl+E)'}
  onclick={toggleEditMode}
>
  <PencilSimple size={20} weight={$editMode ? 'fill' : 'regular'} />
</button>

<style>
  /* Stacked above the Focus toggle (left:144, bottom:22). We sit at
     bottom:114 to clear: Focus (38) + ToC (38) + gap. */
  .edit-mode-toggle {
    position: fixed;
    bottom: 114px;
    left: 144px;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    color: var(--fg-1);
    cursor: pointer;
    padding: 0;
    z-index: 100;
    transition:
      color 0.2s ease,
      background 0.2s ease,
      border-color 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .edit-mode-toggle:hover {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.08);
    transform: scale(1.05);
  }
  .edit-mode-toggle.active {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.14);
  }
</style>
