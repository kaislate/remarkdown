// tests/component/ErrorBanner.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ErrorBanner from '../../src/components/ErrorBanner.svelte';
import { persistentSaveError } from '../../src/lib/save';

beforeEach(() => { persistentSaveError.set(null); });

describe('ErrorBanner', () => {
  it('does not render when there is no error', () => {
    render(ErrorBanner);
    expect(document.querySelector('.banner')).toBeNull();
  });

  it('renders the error message when persistentSaveError is set', () => {
    render(ErrorBanner);
    flushSync(() => persistentSaveError.set('disk full'));
    expect(screen.getByRole('alert')).toHaveTextContent(/disk full/);
  });
});
