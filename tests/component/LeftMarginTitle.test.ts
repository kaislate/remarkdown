import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
}));

import { doc } from '../../src/stores/doc';
import { settings, resetSettings, updateSettings } from '../../src/stores/settings';
import LeftMarginTitle from '../../src/components/LeftMarginTitle.svelte';

beforeEach(() => {
  doc.set(null);
  resetSettings();
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

  it('renders nothing when watermarkEnabled is false', () => {
    setDoc('/tmp/foo.md');
    updateSettings({ watermarkEnabled: false });
    render(LeftMarginTitle);
    expect(document.querySelector('.left-title')).toBeNull();
  });

  it('applies watermarkOpacity from settings as a CSS variable', () => {
    setDoc('/tmp/foo.md');
    updateSettings({ watermarkOpacity: 0.17 });
    render(LeftMarginTitle);
    const el = document.querySelector('.left-title') as HTMLElement;
    expect(el.style.getPropertyValue('--watermark-opacity')).toBe('0.17');
  });
});
