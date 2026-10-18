<script lang="ts">
  // Test double for Editor.svelte: renders the markdown it was mounted with,
  // and a button that reports an edit the way the real editor does.
  let { initialMarkdown, onChange }: { initialMarkdown: string; onChange?: (md: string) => void; session?: unknown } = $props();
</script>

<div data-testid="editor-stub">{initialMarkdown}</div>
<button data-testid="editor-stub-type" onclick={() => onChange?.(initialMarkdown.trimEnd() + ' typed\n')}>type</button>
