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
            <label for="setting-open-focus">Open new documents in Focus mode</label>
            <input
              id="setting-open-focus"
              type="checkbox"
              checked={$settings.openInFocusMode}
              onchange={(e) => updateSettings({ openInFocusMode: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <div>
              <label for="setting-minimap-popout">Minimap popout in Focus mode</label>
              <div class="hint">hover the right edge of the screen to reveal the minimap while reading</div>
            </div>
            <input
              id="setting-minimap-popout"
              type="checkbox"
              checked={$settings.minimapPopoutInFocusMode}
              onchange={(e) => updateSettings({ minimapPopoutInFocusMode: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>
        </section>

        <section>
          <h3>Startup &amp; files</h3>

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
            <label for="setting-show-welcome">Show welcome.md on launch</label>
            <input
              id="setting-show-welcome"
              type="checkbox"
              checked={!$settings.dontShowWelcomeOnLaunch}
              onchange={(e) => updateSettings({ dontShowWelcomeOnLaunch: !(e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row" class:dim={$settings.dontShowWelcomeOnLaunch}>
            <label for="setting-show-tutorial">Show tutorial overlay on welcome.md</label>
            <input
              id="setting-show-tutorial"
              type="checkbox"
              disabled={$settings.dontShowWelcomeOnLaunch}
              checked={!$settings.welcomeTutorialDismissed}
              onchange={(e) => updateSettings({ welcomeTutorialDismissed: !(e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <label for="setting-max-recent">Max recent files</label>
            <div class="slider-cell">
              <input
                id="setting-max-recent"
                type="range"
                min="1"
                max="50"
                step="1"
                value={$settings.maxRecent}
                oninput={(e) => updateSettings({ maxRecent: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <input
                type="number"
                class="value-input"
                min="1"
                max="50"
                step="1"
                aria-label="Max recent files"
                value={$settings.maxRecent}
                onchange={(e) => updateSettings({ maxRecent: Math.max(1, Math.min(50, Math.round(Number((e.currentTarget as HTMLInputElement).value)))) })}
              />
            </div>
          </div>

          <div class="row">
            <div>
              <label for="setting-save-debounce">Sidecar save debounce</label>
              <div class="hint">how long to wait after a change before writing the sidecar JSON</div>
            </div>
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

        <section>
          <h3>Highlights &amp; re.marks</h3>

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
            <label for="setting-hide-controls">Hide annotation controls</label>
            <input
              id="setting-hide-controls"
              type="checkbox"
              checked={$settings.hideAnnotationControls}
              onchange={(e) => updateSettings({ hideAnnotationControls: (e.currentTarget as HTMLInputElement).checked })}
            />
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

          <div class="row">
            <div>
              <label for="setting-remark-stop-listitem">Cap context to a single bullet</label>
              <div class="hint">re.marks anchored inside a list item show only that item, never adjacent bullets or earlier paragraphs</div>
            </div>
            <input
              id="setting-remark-stop-listitem"
              type="checkbox"
              checked={$settings.remarkContextStopAtListItem}
              onchange={(e) => updateSettings({ remarkContextStopAtListItem: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <div>
              <label for="setting-marginalia">Marginalia column <span class="badge">prototype</span></label>
              <div class="hint">show re.marks as cards in the right margin (visible at viewports ≥ 1440px)</div>
            </div>
            <input
              id="setting-marginalia"
              type="checkbox"
              checked={$settings.marginaliaEnabled}
              onchange={(e) => updateSettings({ marginaliaEnabled: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>
        </section>

        <section>
          <h3>Drawing</h3>

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
            <div>
              <label for="setting-auto-transform">Auto-transform drawings into shapes</label>
              <div class="hint">recognize circles / rectangles / underlines</div>
            </div>
            <input
              id="setting-auto-transform"
              type="checkbox"
              checked={$settings.autoTransformDrawings}
              onchange={(e) => updateSettings({ autoTransformDrawings: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <div class="row">
            <div>
              <label for="setting-drawing-roughness">Drawing roughness</label>
              <div class="hint">0 = clean / 3 = very sketchy</div>
            </div>
            <div class="slider-cell">
              <input
                id="setting-drawing-roughness"
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={$settings.drawingRoughness}
                oninput={(e) => updateSettings({ drawingRoughness: parseFloat((e.currentTarget as HTMLInputElement).value) })}
              />
              <span class="value">{$settings.drawingRoughness.toFixed(1)}</span>
            </div>
          </div>

          <div class="row">
            <label for="setting-draw-idle">Drawing idle finalize</label>
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
            <div>
              <label for="setting-drawing-confidence">Show drawing recognition confidence</label>
              <div class="hint">developer / threshold-tuning aid</div>
            </div>
            <input
              id="setting-drawing-confidence"
              type="checkbox"
              checked={$settings.showDrawingRecognitionConfidence}
              onchange={(e) => updateSettings({ showDrawingRecognitionConfidence: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>
        </section>

        <section>
          <h3>Updates</h3>

          <div class="row">
            <label for="setting-auto-update">Check for updates on launch</label>
            <input
              id="setting-auto-update"
              type="checkbox"
              checked={$settings.autoCheckForUpdates}
              onchange={(e) => updateSettings({ autoCheckForUpdates: (e.currentTarget as HTMLInputElement).checked })}
            />
          </div>

          <label class="row checkbox-row">
            <input
              type="checkbox"
              checked={$settings.receivePrereleaseUpdates}
              onchange={(e) => updateSettings({ receivePrereleaseUpdates: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span class="row-label">
              Receive pre-release updates
              <span class="hint">
                Show beta / RC builds in the Update modal's changelog. Auto-install
                of pre-releases is not yet supported — download manually from the
                <a href="https://github.com/kaislate/remarkdown/releases" target="_blank" rel="noopener">Releases page</a>.
              </span>
            </span>
          </label>
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
    /* Push the scrollbar further away from the controls so the thumb
       doesn't visually crowd values + sliders on the right edge. */
    padding-right: 16px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Each section after the first carries its own padding-top + a
       hairline separator. This reads as one cohesive panel rather than
       a bag of unrelated rows, and the divider gives the eye a clean
       resting line between groups. */
    padding-top: 22px;
    margin-top: 22px;
    border-top: 1px solid var(--glass-border);
  }
  section:first-child {
    padding-top: 0;
    margin-top: 0;
    border-top: 0;
  }
  h3 {
    margin: 0 0 6px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--fg-1);
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
  .hint {
    font-size: 12px;
    color: var(--fg-2);
    margin-top: 2px;
  }
  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
  }
  .hint a {
    color: var(--accent);
    text-decoration: none;
  }
  .hint a:hover {
    text-decoration: underline;
  }
  .checkbox-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: 10px;
    cursor: pointer;
  }

  /* Custom-styled form controls so the panel reads as one cohesive
     glass surface rather than a mix of OS chrome and our own.
     `appearance: none` strips the native dropdown arrow / spinners;
     we draw a custom chevron via background-image on selects so the
     trigger still announces "this opens a menu". */
  .row select,
  .row input[type="number"] {
    background-color: var(--bg-2);
    border: 1px solid var(--glass-border);
    color: var(--fg-0);
    padding: 5px 10px;
    border-radius: 6px;
    font-family: inherit;
    font-size: inherit;
    min-width: 120px;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    transition: border-color 0.12s ease, background-color 0.12s ease;
  }
  .row select:hover,
  .row input[type="number"]:hover {
    border-color: var(--accent-soft);
  }
  .row select:focus-visible,
  .row input[type="number"]:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  /* Chevron only on selects. Inline-encoded SVG of a downward chevron
     in fg-2 grey for the dark theme; the light-theme override below
     swaps in a darker tint. background-image takes only image values
     (mixing in a colour here would invalidate the whole declaration),
     so we keep the colour on background-color above. */
  .row select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23b7b4c7' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 12px 12px;
    padding-right: 30px;
  }
  :global(:root[data-theme='light']) .row select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%234a4658' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  }
  .row select option {
    background: var(--bg-1);
    color: var(--fg-0);
  }
  .row input[type="number"] {
    width: 80px;
    min-width: 0;
    text-align: right;
  }

  /* Editable variant of the slider value badge — tabular numerals,
     accent-coloured caret on focus. Used for sliders where typing a
     specific number is natural (e.g. max recent files). Spinners
     stripped so the cell stays compact. */
  .value-input {
    background: var(--bg-2);
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--fg-2);
    font-family: inherit;
    font-size: inherit;
    font-variant-numeric: tabular-nums;
    width: 56px;
    text-align: right;
    padding: 1px 6px;
    appearance: textfield;
    -webkit-appearance: textfield;
    transition: border-color 0.12s ease, color 0.12s ease;
    cursor: text;
    min-width: 0;
  }
  .value-input::-webkit-outer-spin-button,
  .value-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .value-input:hover {
    color: var(--fg-1);
  }
  .value-input:focus-visible {
    outline: none;
    color: var(--fg-0);
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

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
