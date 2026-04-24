import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { doc } from '../../src/stores/doc';
import LeftMarginTitle from '../../src/components/LeftMarginTitle.svelte';

beforeEach(() => {
  doc.set(null);
  document.body.innerHTML = '';
});

function setDoc(path: string) {
  doc.set({
    path,
    dir: path.replace(/[\\/][^\\/]+$/, ''),
    sha256: 'x',
    bytes: 0,
    markdown: '',
    html: '',
    plaintext: '',
    blocks: [],
    sidecarRaw: null,
  });
}

describe('LeftMarginTitle', () => {
  it('renders nothing when no document is loaded', () => {
    render(LeftMarginTitle);
    expect(document.querySelector('.left-title')).toBeNull();
  });

  it('renders the basename without the .md extension when a doc is loaded', () => {
    setDoc('/tmp/research-notes.md');
    render(LeftMarginTitle);
    const text = document.querySelector('.left-title .text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('research-notes');
  });

  it('strips a .markdown extension as well', () => {
    setDoc('/tmp/long-form.markdown');
    render(LeftMarginTitle);
    expect(document.querySelector('.left-title .text')!.textContent).toBe('long-form');
  });

  it('handles Windows-style backslash paths', () => {
    setDoc('C:\\Users\\me\\Documents\\book-chapter.md');
    render(LeftMarginTitle);
    expect(document.querySelector('.left-title .text')!.textContent).toBe('book-chapter');
  });

  it('marks the watermark aria-hidden so screen readers ignore it', () => {
    setDoc('/tmp/foo.md');
    render(LeftMarginTitle);
    expect(document.querySelector('.left-title')!.getAttribute('aria-hidden')).toBe('true');
  });
});
