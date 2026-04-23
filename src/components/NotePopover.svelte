<script lang="ts">
  interface Props {
    body: string;
    onUpdate: (next: string) => void;
    onDelete: () => void;
  }
  let { body, onUpdate, onDelete }: Props = $props();
</script>

<div class="popover glass" role="dialog" aria-label="Note">
  <textarea
    aria-label="Note body"
    value={body}
    oninput={(e) => onUpdate((e.currentTarget as HTMLTextAreaElement).value)}
    rows="4"
  ></textarea>
  <div class="actions">
    <button class="danger" onclick={onDelete}>Delete</button>
  </div>
</div>

<style>
  .popover {
    padding: 10px;
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  textarea {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 6px 8px;
    font-family: var(--font-sans);
    font-size: 13px;
    resize: vertical;
  }
  .actions { display: flex; justify-content: flex-end; }
  .danger {
    background: transparent;
    color: var(--fg-2);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 12px;
  }
  .danger:hover { color: #ff8080; border-color: #ff8080; }
</style>
