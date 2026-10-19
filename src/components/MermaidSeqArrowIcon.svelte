<script lang="ts">
  import type { MessageStyle } from '../lib/editor/mermaid-sequence-graph';

  // A small drawing of a sequence-diagram arrow kind for the message
  // popover: solid or dotted line, and its head (none, filled arrow,
  // cross, open "async" arrow, or arrows both ways).
  interface Props {
    style: MessageStyle;
    size?: number;
  }
  let { style, size = 20 }: Props = $props();

  const dotted = $derived(['dotted', 'reply', 'dottedCross', 'dottedAsync', 'dottedBoth'].includes(style));
  const head = $derived(
    style === 'solid' || style === 'dotted' ? 'none'
    : style === 'cross' || style === 'dottedCross' ? 'cross'
    : style === 'async' || style === 'dottedAsync' ? 'open'
    : 'arrow',
  );
  const both = $derived(style === 'both' || style === 'dottedBoth');
</script>

<svg width={size} height={size * 0.6} viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  <line x1={both ? 5 : 1} y1="6" x2={head === 'none' ? 19 : 15} y2="6" stroke-dasharray={dotted ? '2 1.6' : undefined} />
  {#each both ? ['end', 'start'] : ['end'] as side (side)}
    <g transform={side === 'start' ? 'translate(20 0) scale(-1 1)' : undefined}>
      {#if head === 'arrow'}
        <path d="M14 2.5L19 6l-5 3.5z" fill="currentColor" stroke="none" />
      {:else if head === 'open'}
        <path d="M14.5 2.5L19 6l-4.5 3.5" />
      {:else if head === 'cross'}
        <path d="M14.5 3l4 6M18.5 3l-4 6" />
      {/if}
    </g>
  {/each}
</svg>
