import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { doc } from '../../src/stores/doc';
import { currentViewerRoot } from '../../src/stores/annots';
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

  it('publishes viewer root element to currentViewerRoot store after mount', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 0, markdown: '',
      html: '<p data-block-id="p:1">hello</p>', plaintext: 'hello', blocks: ['p:1'],
      sidecarRaw: null,
    });
    render(Viewer);
    // Wait a tick for the $effect to run.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(get(currentViewerRoot)).not.toBeNull();
  });
});
