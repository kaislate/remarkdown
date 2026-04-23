import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { doc } from '../../src/stores/doc';
import Viewer from '../../src/components/Viewer.svelte';

describe('Viewer', () => {
  it('shows an empty-state hint when doc is null', () => {
    doc.set(null);
    render(Viewer);
    expect(screen.getByText(/Open a markdown file/i)).toBeInTheDocument();
  });

  it('renders the doc html when a doc is set', () => {
    doc.set({
      path: '/tmp/a.md',
      dir: '/tmp',
      sha256: 'abc',
      bytes: 0,
      markdown: '',
      html: '<h1 data-block-id="h:1">Hello</h1>',
      plaintext: 'Hello',
      blocks: ['h:1'],
      sidecarRaw: null,
    });
    render(Viewer);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hello').getAttribute('data-block-id')).toBe('h:1');
  });
});
