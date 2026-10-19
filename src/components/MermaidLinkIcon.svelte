<script lang="ts">
  import type { EdgeEnds, EdgeStroke } from '../lib/editor/mermaid-graph';

  // A small drawing of a connection: its line (solid / dotted / thick /
  // invisible) and what its ends look like.
  interface Props {
    stroke?: EdgeStroke;
    ends?: EdgeEnds;
    size?: number;
  }
  let { stroke = 'solid', ends = 'arrow', size = 18 }: Props = $props();

  const head = $derived(ends === 'arrow' || ends === 'both-arrow' ? 'arrow' : ends === 'circle' || ends === 'both-circle' ? 'circle' : ends === 'cross' || ends === 'both-cross' ? 'cross' : 'none');
  const both = $derived(ends.startsWith('both-'));
</script>

<svg width={size} height={size * 0.67} viewBox="0 0 18 12" fill="none" stroke="currentColor" aria-hidden="true">
  <line
    x1={both ? 4 : 1}
    y1="6"
    x2={head === 'none' ? 17 : 13}
    y2="6"
    stroke-width={stroke === 'thick' ? 2.6 : 1.3}
    stroke-dasharray={stroke === 'dotted' ? '1.6 1.8' : stroke === 'invisible' ? '0.6 2.4' : undefined}
    opacity={stroke === 'invisible' ? 0.5 : 1}
  />
  {#each both ? ['end', 'start'] : ['end'] as side (side)}
    <g transform={side === 'start' ? 'translate(18 0) scale(-1 1)' : undefined}>
      {#if head === 'arrow'}
        <path d="M12 2.5L17 6l-5 3.5z" fill="currentColor" stroke="none" />
      {:else if head === 'circle'}
        <circle cx="14.5" cy="6" r="2.4" stroke-width="1.3" />
      {:else if head === 'cross'}
        <path d="M12.5 3.5l4 5M16.5 3.5l-4 5" stroke-width="1.3" />
      {/if}
    </g>
  {/each}
</svg>
