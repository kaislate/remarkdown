<script lang="ts">
  import { persistentSaveError } from '../lib/save';
</script>

{#if $persistentSaveError}
  <div class="banner" role="alert">
    <span>{$persistentSaveError}</span>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(200, 60, 60, 0.95);
    color: #fff;
    padding: 10px 18px;
    border-radius: 8px;
    font-family: var(--font-sans);
    font-size: 13px;
    z-index: 250;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    max-width: 80vw;
  }
</style>
