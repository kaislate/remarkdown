<script lang="ts">
  import type { StarterKind } from '../lib/editor/mermaid-commands';

  // A tiny picture of each kind of diagram for the toolbar's "Diagram"
  // menu — people pick by what it looks like, not by its name.
  interface Props {
    kind: StarterKind;
  }
  let { kind }: Props = $props();
</script>

<svg width="44" height="30" viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
  {#if kind === 'flowchart'}
    <rect x="15" y="2" width="14" height="7" rx="1.5" /><path d="M22 9v4" /><path d="M22 13l6 4-6 4-6-4z" />
    <path d="M16 17H8v6M28 17h8v6" /><rect x="3" y="23" width="10" height="5" rx="1" /><rect x="31" y="23" width="10" height="5" rx="1" />
  {:else if kind === 'sequence'}
    <rect x="3" y="2" width="12" height="5" rx="1" /><rect x="29" y="2" width="12" height="5" rx="1" />
    <path d="M9 7v21M35 7v21" stroke-dasharray="1.5 1.5" /><path d="M9 13h24M30 11l3 2-3 2" /><path d="M35 21H12M14 19l-3 2 3 2" stroke-dasharray="2 1.4" />
  {:else if kind === 'pie'}
    <circle cx="22" cy="15" r="12" /><path d="M22 15V3M22 15l10 7M22 15L11 21" /><path d="M22 3a12 12 0 0 1 10 19L22 15z" fill="currentColor" opacity="0.25" stroke="none" />
  {:else if kind === 'timeline'}
    <path d="M3 15h38" /><circle cx="9" cy="15" r="2" fill="currentColor" /><circle cx="22" cy="15" r="2" fill="currentColor" /><circle cx="35" cy="15" r="2" fill="currentColor" />
    <rect x="4" y="3" width="10" height="5" rx="1" /><rect x="17" y="22" width="10" height="5" rx="1" /><rect x="30" y="3" width="10" height="5" rx="1" />
  {:else if kind === 'gantt'}
    <path d="M3 3v25M3 28h38" /><rect x="6" y="5" width="14" height="4" rx="1" fill="currentColor" opacity="0.35" />
    <rect x="16" y="12" width="16" height="4" rx="1" fill="currentColor" opacity="0.35" /><rect x="26" y="19" width="12" height="4" rx="1" fill="currentColor" opacity="0.35" />
  {:else if kind === 'state'}
    <circle cx="5" cy="15" r="2.5" fill="currentColor" /><path d="M8 15h4" /><rect x="12" y="10" width="11" height="10" rx="4" />
    <path d="M23 15h5" /><rect x="28" y="10" width="11" height="10" rx="4" /><path d="M33.5 20v4" /><circle cx="33.5" cy="27" r="2" />
  {:else if kind === 'class'}
    <rect x="3" y="3" width="14" height="24" /><path d="M3 9h14M3 17h14" /><rect x="27" y="3" width="14" height="24" /><path d="M27 9h14M27 17h14" />
    <path d="M17 15h10M24 12l3 3-3 3" />
  {:else if kind === 'er'}
    <rect x="2" y="5" width="13" height="20" /><path d="M2 10h13" /><rect x="29" y="5" width="13" height="20" /><path d="M29 10h13" />
    <path d="M15 15h14M17 12v6M27 12l2 3-2 3M27 15h2" />
  {:else if kind === 'mindmap'}
    <ellipse cx="22" cy="15" rx="7" ry="4.5" /><path d="M15 14L7 7M15 16L7 23M29 14l8-7M29 16l8 7" />
    <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="24" r="2.5" /><circle cx="38" cy="6" r="2.5" /><circle cx="38" cy="24" r="2.5" />
  {:else}
    <rect x="2" y="2" width="12" height="26" rx="1.5" /><rect x="16" y="2" width="12" height="26" rx="1.5" /><rect x="30" y="2" width="12" height="26" rx="1.5" />
    <rect x="4" y="6" width="8" height="5" rx="1" fill="currentColor" opacity="0.35" /><rect x="4" y="13" width="8" height="5" rx="1" fill="currentColor" opacity="0.35" />
    <rect x="18" y="6" width="8" height="5" rx="1" fill="currentColor" opacity="0.35" /><rect x="32" y="6" width="8" height="5" rx="1" fill="currentColor" opacity="0.35" />
  {/if}
</svg>
