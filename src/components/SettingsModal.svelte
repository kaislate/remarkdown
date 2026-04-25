<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { settings, updateSettings, resetSettings } from '../stores/settings';
  import { ZOOM_LEVELS } from '../stores/ui';
  import { HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $activeModal?.kind === 'settings') closeModal();
  }

  function fmtZoom(z: number) { return `${Math.round(z * 100)}%`; }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $activeModal?.kind === 'settings'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" onclick={closeModal} role="presentation">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="settings-panel glass"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <header>
        <h2>Settings</h2>
        <button class="close" aria-label="Close" onclick={closeModal}>×</button>
      </header>

      <div class="body">
        <section>
          <h3>Appearance</h3>

          <div class="row">
            <label for="setting-theme">Theme</label>
            <select
              id="setting-theme"
              value={$settings.theme}
              onchange={(e) => updateSettings({ theme: (e.currentTarget as HTMLSelectElement).value as 'dark' | 'light' })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div class="row">
            <label for="setting-splash">Show splash on launch</label>
            <input
              id="setting-splash"
              type="checkbox"
              checked={$settings.splashEnabled}
              onchange={(e) => updateSettings({ splashEnabled: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <label for="setting-watermark">Filename watermark</label>
            <input
              id="setting-watermark"
              type="checkbox"
              checked={$settings.watermarkEnabled}
              onchange={(e) => updateSettings({ watermarkEnabled: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row" class:dim={!$settings.watermarkEnabled}>
            <label for="setting-watermark-opacity">Watermark opacity</label>
            <div class="slider-cell">
              <input
                id="setting-watermark-opacity"
                type="range"
                min="0"
                max="0.3"
                step="0.01"
                disabled={!$settings.watermarkEnabled}
                value={$settings.watermarkOpacity}
                oninput={(e) => updateSettings({ watermarkOpacity: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <span class="value">{$settings.watermarkOpacity.toFixed(2)}</span>
            </div>
          </div>
        </section>

        <section>
          <h3>Reading</h3>

          <div class="row">
            <label for="setting-zoom">Default zoom</label>
            <select
              id="setting-zoom"
              value={$settings.defaultZoom}
              onchange={(e) => updateSettings({ defaultZoom: Number((e.currentTarget as HTMLSelectElement).value) })}
            >
              {#each ZOOM_LEVELS as z}
                <option value={z}>{fmtZoom(z)}</option>
              {/each}
            </select>
          </div>

          <div class="row">
            <label for="setting-width">Article width (px)</label>
            <div class="slider-cell">
              <input
                id="setting-width"
                type="range"
                min="480"
                max="1200"
                step="20"
                value={$settings.articleWidth}
                oninput={(e) => updateSettings({ articleWidth: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <span class="value">{$settings.articleWidth}px</span>
            </div>
          </div>

          <div class="row">
            <label for="setting-max-recent">Max recent files</label>
            <input
              id="setting-max-recent"
              type="number"
              min="1"
              max="50"
              value={$settings.maxRecent}
              onchange={(e) => updateSettings({ maxRecent: Math.max(1, Math.min(50, Math.round(Number((e.currentTarget as HTMLInputElement).value)))) })}
            />
          </div>

          <div class="row">
            <label for="setting-open-last">Reopen last file on launch</label>
            <input
              id="setting-open-last"
              type="checkbox"
              checked={$settings.openLastOnStartup}
              onchange={(e) => updateSettings({ openLastOnStartup: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <label for="setting-auto-update">Check for updates on launch</label>
            <input
              id="setting-auto-update"
              type="checkbox"
              checked={$settings.autoCheckForUpdates}
              onchange={(e) => updateSettings({ autoCheckForUpdates: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <label for="setting-show-welcome">Show welcome.md on launch</label>
            <input
              id="setting-show-welcome"
              type="checkbox"
              checked={!$settings.dontShowWelcomeOnLaunch}
              onchange={(e) => updateSettings({ dontShowWelcomeOnLaunch: !(e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <label for="setting-show-tutorial">Show tutorial overlay on welcome.md</label>
            <input
              id="setting-show-tutorial"
              type="checkbox"
              checked={!$settings.welcomeTutorialDismissed}
              onchange={(e) => updateSettings({ welcomeTutorialDismissed: !(e.currentTarget as HTMLInputElement).checked })}
            />
          </div>
        </section>

        <section>
          <h3>Annotation</h3>

          <div class="row">
            <label for="setting-hide-controls">Hide annotation controls</label>
            <input
              id="setting-hide-controls"
              type="checkbox"
              checked={$settings.hideAnnotationControls}
              onchange={(e) => updateSettings({ hideAnnotationControls: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <span class="row-label">Default highlight color</span>
            <div class="swatches" role="radiogroup" aria-label="Default highlight color">
              {#each HIGHLIGHT_COLORS as c}
                <button
                  class="swatch"
                  class:selected={$settings.defaultHighlightColor === c}
                  style:background={c}
                  aria-label={c}
                  aria-pressed={$settings.defaultHighlightColor === c}
                  onclick={() => updateSettings({ defaultHighlightColor: c })}
                ></button>
              {/each}
            </div>
          </div>

          <div class="row">
            <span class="row-label">Default ink color</span>
            <div class="swatches" role="radiogroup" aria-label="Default ink color">
              {#each DRAW_COLORS as c}
                <button
                  class="swatch"
                  class:selected={$settings.defaultInkColor === c}
                  style:background={c}
                  aria-label={c}
                  aria-pressed={$settings.defaultInkColor === c}
                  onclick={() => updateSettings({ defaultInkColor: c })}
                ></button>
              {/each}
            </div>
          </div>

          <div class="row">
            <label for="setting-draw-idle">Drawing idle finalize (ms)</label>
            <div class="slider-cell">
              <input
                id="setting-draw-idle"
                type="range"
                min="500"
                max="10000"
                step="250"
                value={$settings.drawIdleFinalizeMs}
                oninput={(e) => updateSettings({ drawIdleFinalizeMs: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <span class="value">{($settings.drawIdleFinalizeMs / 1000).toFixed(2)}s</span>
            </div>
          </div>

          <div class="row">
            <label for="setting-remark-sentences">re.marks context sentences</label>
            <select
              id="setting-remark-sentences"
              value={$settings.remarkContextSentences}
              onchange={(e) => updateSettings({ remarkContextSentences: Number((e.currentTarget as HTMLSelectElement).value) })}
            >
              {#each [1, 2, 3, 4, 5] as n}
                <option value={n}>{n} {n === 1 ? 'sentence' : 'sentences'}</option>
              {/each}
            </select>
          </div>

          <div class="row">
            <label for="setting-remark-stop-paragraph">Stop at paragraph boundary</label>
            <input
              id="setting-remark-stop-paragraph"
              type="checkbox"
              checked={$settings.remarkContextStopAtParagraph}
              onchange={(e) => updateSettings({ remarkContextStopAtParagraph: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>
        </section>

        <section>
          <h3>Save behaviour</h3>

          <div class="row">
            <label for="setting-save-debounce">Save debounce (ms)</label>
            <div class="slider-cell">
              <input
                id="setting-save-debounce"
                type="range"
                min="100"
                max="2000"
                step="50"
                value={$settings.saveDebounceMs}
                oninput={(e) => updateSettings({ saveDebounceMs: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <span class="value">{$settings.saveDebounceMs}ms</span>
            </div>
          </div>
        </section>
      </div>

      <footer>
        <button class="reset" onclick={() => resetSettings()}>Reset to defaults</button>
        <button class="primary" onclick={closeModal}>Done</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 300;
    backdrop-filter: blur(2px);
  }
  .settings-panel {
    width: min(560px, 92vw);
    max-height: 86vh;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Override the lightweight .glass fill so the panel reads cleanly
       against whatever is behind it. The scrim already darkens the canvas;
       this pushes the panel itself to near-opaque so labels and values
       don't blend with article content showing through. */
    background:
      linear-gradient(var(--bg-1), var(--bg-1)),
      var(--glass-fill);
    background-blend-mode: normal;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 20px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .close:hover { color: var(--fg-0); }

  .body {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    /* Push the scrollbar further away from the controls so the thumb
       doesn't visually crowd values + sliders on the right edge. */
    padding-right: 16px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0 0 4px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-2);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-1);
  }
  .row.dim { opacity: 0.5; }
  .row label, .row-label {
    cursor: default;
  }

  .row select, .row input[type="number"] {
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    color: var(--fg-0);
    padding: 4px 8px;
    border-radius: 6px;
    font-family: inherit;
    font-size: inherit;
    min-width: 120px;
  }
  .row input[type="number"] { width: 70px; min-width: 0; text-align: right; }

  .row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .slider-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 200px;
  }
  .slider-cell input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }
  .value {
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    min-width: 56px;
    text-align: right;
  }

  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    transition: transform 0.08s ease, border-color 0.08s ease;
  }
  .swatch:hover { transform: scale(1.1); }
  .swatch.selected {
    border-color: var(--fg-0);
    transform: scale(1.1);
  }

  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 4px;
  }
  footer button {
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  footer button:hover { color: var(--fg-0); }
  footer .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  footer .primary:hover { color: #fff; filter: brightness(1.08); }
  footer .reset { color: var(--fg-2); }
</style>
