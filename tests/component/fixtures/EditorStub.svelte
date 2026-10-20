<script lang="ts">
  // Test double for Editor.svelte: renders the markdown it was mounted with,
  // and a button that reports an edit the way the real editor does.
  let { initialMarkdown, onChange }: { initialMarkdown: string; onChange?: (md: string) => void; session?: unknown } = $props();
  // Like the real editor, the text is read once, when the editor mounts:
  // a different document only shows if the editor is remounted.
  // svelte-ignore state_referenced_locally
  const mountedWith = initialMarkdown;
  const w = window as unknown as { __editorMounts?: number };
  w.__editorMounts = (w.__editorMounts ?? 0) + 1;
</script>

<div data-testid="editor-stub">{mountedWith}</div>
<button data-testid="editor-stub-type" onclick={() => onChange?.(mountedWith.trimEnd() + ' typed\n')}>type</button>
