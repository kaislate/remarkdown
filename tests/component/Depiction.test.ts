import { it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Depiction from '../../src/components/settings/Depiction.svelte';
import { OPTIONS } from '../../src/lib/settings-catalog';

// Every option's picture draws a scene of its own, not just the empty card.
it('every setting has a picture with something in it', () => {
  for (const name of new Set(OPTIONS.map((o) => o.depiction))) {
    const { container, unmount } = render(Depiction, { name });
    const shapes = container.querySelectorAll('svg > :not(.ground)');
    expect(shapes.length, name).toBeGreaterThan(0);
    unmount();
  }
});
