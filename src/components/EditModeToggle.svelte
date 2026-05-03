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
  /* Stacked under the hamburger (left:14, top:14, height:38). We sit at
     top:60 = 14 + 38 + 8gap. ToC and Focus stack below this in 46-step
     increments (38 button height + 8 gap). */
  .edit-mode-toggle {
    position: fixed;
    top: 60px;
    left: 14px;
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
