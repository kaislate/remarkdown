<script lang="ts">
  interface Props {
    body: string;
    onUpdate: (next: string) => void;
    onDelete: () => void;
  }
  let { body, onUpdate, onDelete }: Props = $props();
</script>

<div class="popover sticky-note" role="dialog" aria-label="Note">
  <textarea
    aria-label="Note body"
    placeholder="Write a note…"
    value={body}
    oninput={(e) => onUpdate((e.currentTarget as HTMLTextAreaElement).value)}
    rows="4"
  ></textarea>
  <div class="actions">
    <button class="danger" onclick={onDelete}>Delete</button>
  </div>
</div>

<style>
  /* Sticky-note popover styled to match the tutorial tip boxes:
     near-opaque bg-1 backdrop, accent-soft border, soft drop shadow,
     and a handwritten font so the contents read like a hand-written
     marginalia rather than a system-font dialog. */
  .sticky-note {
    width: 260px;
    padding: 10px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: linear-gradient(var(--bg-1), var(--bg-1)), var(--glass-fill);
    border: 1px solid var(--accent-soft);
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  }
  textarea {
    background: transparent;
    color: var(--fg-0);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 6px 8px;
    font-family:
      'Segoe Print',
      'Patrick Hand',
      'Architects Daughter',
      'Kalam',
      'Indie Flower',
      'Comic Sans MS',
      'Bradley Hand',
      'Marker Felt',
      cursive;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.01em;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  textarea::placeholder {
    color: var(--fg-2);
    font-weight: 500;
  }
  textarea:focus {
    border-color: var(--accent-soft);
    background: rgba(0, 0, 0, 0.12);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .danger {
    background: transparent;
    color: var(--fg-2);
    border: 0;
    font-family:
      'Segoe Print',
      'Patrick Hand',
      'Architects Daughter',
      'Comic Sans MS',
      'Bradley Hand',
      cursive;
    font-size: 12px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 6px;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .danger:hover {
    color: #ff8080;
  }
</style>
