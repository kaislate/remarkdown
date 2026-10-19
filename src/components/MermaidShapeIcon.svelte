<script lang="ts">
  import type { MermaidShape } from '../lib/editor/mermaid-graph';

  // A small drawing of each flowchart shape for the shape picker — a
  // picture of the shape is clearer than any name.
  interface Props {
    shape: MermaidShape;
    size?: number;
  }
  let { shape, size = 16 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  {#if shape === 'rect'}
    <rect x="1.5" y="4" width="13" height="8" />
  {:else if shape === 'rounded'}
    <rect x="1.5" y="4" width="13" height="8" rx="2.5" />
  {:else if shape === 'stadium'}
    <rect x="1.5" y="4" width="13" height="8" rx="4" />
  {:else if shape === 'subroutine'}
    <rect x="1.5" y="4" width="13" height="8" /><path d="M4 4v8M12 4v8" />
  {:else if shape === 'cylinder'}
    <ellipse cx="8" cy="4" rx="5.5" ry="2" /><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" />
  {:else if shape === 'circle'}
    <circle cx="8" cy="8" r="5.5" />
  {:else if shape === 'doubleCircle'}
    <circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="3.8" />
  {:else if shape === 'asymmetric'}
    <path d="M1.5 4h13v8h-13l3-4z" />
  {:else if shape === 'diamond'}
    <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" />
  {:else if shape === 'hexagon'}
    <path d="M4.5 3.5h7L14.5 8l-3 4.5h-7L1.5 8z" />
  {:else if shape === 'parallelogram'}
    <path d="M4.5 4h10l-3 8h-10z" />
  {:else if shape === 'parallelogramAlt'}
    <path d="M1.5 4h10l3 8h-10z" />
  {:else if shape === 'trapezoid'}
    <path d="M4.5 4h7l3 8h-13z" />
  {:else if shape === 'trapezoidAlt'}
    <path d="M1.5 4h13l-3 8h-7z" />
  {:else}
    <rect x="1.5" y="4" width="13" height="8" stroke-dasharray="2 1.5" />
  {/if}
</svg>
