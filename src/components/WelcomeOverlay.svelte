<script lang="ts">
  import { isWelcomeDocOpen } from '../stores/welcome';
  import { settings, updateSettings } from '../stores/settings';
  import FileArrowDown from 'phosphor-svelte/lib/FileArrowDown';

  function dismiss() {
    updateSettings({ welcomeTutorialDismissed: true });
  }
</script>

{#if $isWelcomeDocOpen && !$settings.welcomeTutorialDismissed}
  <!-- Container has pointer-events: none so the underlying chrome
       (hamburger, tool rail, etc.) stays fully usable through the
       overlay; only the dismiss button re-enables pointer-events. -->
  <div class="overlay" aria-label="Welcome tutorial">
    <!-- Tip 1: Hamburger menu -->
    <div class="tip tip-hamburger">
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true">
        <path d="M 70,60 Q 40,30 18,12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M 8,6 L 24,8 L 18,22 Z" fill="currentColor"/>
      </svg>
      <div class="label">Open <code>.md</code> files and settings here</div>
    </div>

    <!-- Tip 2: Drag-drop hint -->
    <div class="tip tip-drag">
      <span class="icon" aria-hidden="true">
        <FileArrowDown size={28} weight="regular" />
      </span>
      <div class="label">…or drop any <code>.md</code> file into the window</div>
    </div>

    <!-- Tip 3: Minimap bracket -->
    <div class="bracket-row" aria-hidden="true">
      <div class="bracket-label">Navigate long documents here</div>
      <svg class="bracket" viewBox="0 0 24 200" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 4,2 L 18,2 L 18,198 L 4,198" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>
    </div>

    <!-- Tip 4: Annotation tools (bottom-right) -->
    <div class="tip tip-tools">
      <div class="label">Add annotations using these tools</div>
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true">
        <path d="M 10,10 Q 40,40 62,58" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M 72,64 L 56,62 L 62,48 Z" fill="currentColor"/>
      </svg>
    </div>

    <!-- Tip 5: Title bar drag area (top-center) -->
    <div class="tip tip-titlebar">
      <svg class="arrow" viewBox="0 0 30 60" width="30" height="60" aria-hidden="true">
        <path d="M 15,55 L 15,16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M 15,4 L 24,18 L 6,18 Z" fill="currentColor"/>
      </svg>
      <div class="label">Hold to drag the window from here</div>
    </div>

    <!-- Tip 6: Zoom pill (bottom-left) -->
    <div class="tip tip-zoom">
      <div class="label">Resize your view here</div>
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true">
        <path d="M 70,10 Q 40,40 18,58" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M 8,64 L 14,48 L 24,58 Z" fill="currentColor"/>
      </svg>
    </div>

    <!-- Got-it dismiss. Bottom-center, away from the chrome being explained. -->
    <button class="dismiss-tutorial" onclick={dismiss}>
      Got it — dismiss tutorial
    </button>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
    color: var(--accent);
    /* Gentle entrance so the overlay doesn't snap on top of the welcome
       doc as it renders. */
    animation: fadeIn 600ms ease-out 400ms backwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .tip {
    position: fixed;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    pointer-events: none;
  }
  .label {
    background: linear-gradient(var(--bg-1), var(--bg-1)), var(--glass-fill);
    color: var(--fg-0);
    border: 1px solid var(--accent-soft);
    padding: 7px 12px;
    border-radius: 8px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    max-width: 220px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    line-height: 1.4;
  }
  .label code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-2);
    color: var(--accent);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .arrow {
    color: var(--accent);
    flex-shrink: 0;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }
  .icon {
    color: var(--accent);
    margin-top: 2px;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }

  /* Tip 1 — points at the hamburger (top-left). The arrow rises up and
     to the left toward the menu button at (~33, 33). */
  .tip-hamburger {
    top: 70px;
    left: 70px;
    flex-direction: row;
  }

  /* Tip 2 — sits below and to the right of Tip 1, no arrow (the file
     icon serves as its own visual anchor). */
  .tip-drag {
    top: 150px;
    left: 170px;
    flex-direction: row;
    align-items: center;
  }

  /* Tip 3 — vertical bracket alongside the minimap. Minimap is at
     right:16, top:52, bottom:110, so the bracket spans that region with
     a small inset on each end. The label sits to the bracket's left. */
  .bracket-row {
    position: fixed;
    top: 60px;
    right: 162px;
    bottom: 118px;
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    color: var(--accent);
  }
  .bracket-label {
    background: linear-gradient(var(--bg-1), var(--bg-1)), var(--glass-fill);
    color: var(--fg-0);
    border: 1px solid var(--accent-soft);
    padding: 7px 12px;
    border-radius: 8px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    line-height: 1.4;
    white-space: nowrap;
  }
  .bracket {
    height: 100%;
    width: 24px;
    color: var(--accent);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }

  /* Tip 4 — annotation tools at bottom-right. Bubble + arrow above-left
     of the tool pill (which sits at right:22, bottom:22 ~190px wide). */
  .tip-tools {
    bottom: 76px;
    right: 220px;
    flex-direction: row;
    align-items: flex-end;
  }

  /* Tip 5 — title bar drag region. Bubble below the title bar centre,
     arrow points up. */
  .tip-titlebar {
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    flex-direction: row;
    align-items: center;
  }

  /* Tip 6 — zoom pill at bottom-left (bottom:22, left:22, ~120px wide).
     Bubble above-right of the pill, arrow points down-left. */
  .tip-zoom {
    bottom: 76px;
    left: 160px;
    flex-direction: row;
    align-items: flex-end;
  }

  /* Dismiss button — re-enables pointer-events so the user can click it.
     Bottom-centre keeps it away from the watermark, the zoom pill, and
     the annotation tools. */
  .dismiss-tutorial {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: auto;
    background: var(--accent);
    color: #fff;
    border: 0;
    padding: 7px 16px;
    border-radius: 999px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(139, 127, 255, 0.35);
    transition: filter 0.15s ease, transform 0.15s ease;
  }
  .dismiss-tutorial:hover {
    filter: brightness(1.1);
    transform: translateX(-50%) translateY(-1px);
  }
  .dismiss-tutorial:focus-visible {
    outline: 2px solid var(--fg-0);
    outline-offset: 2px;
  }
</style>
