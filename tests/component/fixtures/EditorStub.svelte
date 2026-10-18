<script lang="ts">
  // Test double for Editor.svelte: renders the markdown it was mounted with.
  let { initialMarkdown }: { initialMarkdown: string; onChange?: (md: string) => void; session?: unknown } = $props();
</script>

<div data-testid="editor-stub">{initialMarkdown}</div>
