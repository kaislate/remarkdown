import { describe, it, expect } from 'vitest';
import { linkAction } from '../../src/lib/link-action';

const NONE = { kind: 'none' };

describe('links within the page', () => {
  it('scrolls to a footnote and back', () => {
    expect(linkAction('#fn1', 'C:\\docs')).toEqual({ kind: 'scroll', id: 'fn1' });
    expect(linkAction('#fnref1:1', 'C:\\docs')).toEqual({ kind: 'scroll', id: 'fnref1:1' });
  });

  it('decodes a percent-encoded id', () => {
    expect(linkAction('#caf%C3%A9', null)).toEqual({ kind: 'scroll', id: 'café' });
  });

  it('does nothing for a bare #', () => {
    expect(linkAction('#', '/docs')).toEqual(NONE);
  });
});

describe('links to other documents', () => {
  it('resolves a sibling against the document folder (Windows)', () => {
    expect(linkAction('other.md', 'C:\\Users\\me\\docs')).toEqual({ kind: 'open', path: 'C:\\Users\\me\\docs\\other.md' });
  });

  it('resolves a sibling against the document folder (POSIX)', () => {
    expect(linkAction('other.md', '/home/me/docs')).toEqual({ kind: 'open', path: '/home/me/docs/other.md' });
  });

  it('follows ./ and ../ and keeps the drive', () => {
    expect(linkAction('./sub/../../notes/Plan.markdown', 'C:/Users/me/docs')).toEqual({
      kind: 'open',
      path: 'C:/Users/me/notes/Plan.markdown',
    });
    expect(linkAction('../../../../x.md', 'C:\\a')).toEqual({ kind: 'open', path: 'C:\\x.md' });
  });

  it('decodes the path and drops the fragment and query', () => {
    expect(linkAction('My%20Notes/caf%C3%A9.md#fn1', '/home/me')).toEqual({ kind: 'open', path: '/home/me/My Notes/café.md' });
    expect(linkAction('a.MD?x=1', '/home/me')).toEqual({ kind: 'open', path: '/home/me/a.MD' });
  });

  it('stays on the share for a document on a network share', () => {
    expect(linkAction('other.md', '\\\\server\\share\\docs')).toEqual({ kind: 'open', path: '\\\\server\\share\\docs\\other.md' });
    expect(linkAction('../../evil/s/x.md', '\\\\server\\share\\docs')).toEqual(NONE);
  });

  it('needs the document folder', () => {
    expect(linkAction('other.md', null)).toEqual(NONE);
    expect(linkAction('other.md', undefined)).toEqual(NONE);
  });

  it('opens only markdown files', () => {
    for (const href of ['report.html', 'image.png', 'notes', 'run.exe', 'a.md.exe', 'folder/']) {
      expect(linkAction(href, 'C:\\docs'), href).toEqual(NONE);
    }
  });

  it('refuses absolute, UNC and drive paths, written or encoded', () => {
    for (const href of [
      '/etc/notes.md',
      '//evil.example/s/x.md',
      '\\\\evil.example\\s\\x.md',
      '%5C%5Cevil.example%5Cs%5Cx.md',
      '%2F%2Fevil.example/s/x.md',
      'C:\\Users\\me\\x.md',
      'C:x.md',
      '%43:/x.md',
      'notes.txt%3Ahidden.md',
      'a%00.md',
      '%E0%A4%A.md',
    ]) {
      expect(linkAction(href, 'C:\\docs'), href).toEqual(NONE);
    }
  });
});

describe('links out of the app', () => {
  it('sends web links to the browser', () => {
    expect(linkAction('https://example.com/a b', '/d')).toEqual({ kind: 'external', url: 'https://example.com/a%20b' });
    expect(linkAction('http://example.com', null)).toEqual({ kind: 'external', url: 'http://example.com/' });
    expect(linkAction('HTTPS://Example.com/x', null)).toEqual({ kind: 'external', url: 'https://example.com/x' });
  });

  it('sends mail links to the mail app', () => {
    expect(linkAction('mailto:me@example.com', null)).toEqual({ kind: 'external', url: 'mailto:me@example.com' });
    expect(linkAction('mailto:', null)).toEqual(NONE);
  });

  it("refuses the webview's own hosts", () => {
    for (const href of [
      'http://asset.localhost/%5C%5Cevil%5Cs%5Cr.html',
      'http:asset.localhost/x',
      'https://ipc.localhost/write_document',
      'http://tauri.localhost/index.html',
    ]) {
      expect(linkAction(href, 'C:\\docs'), href).toEqual(NONE);
    }
  });

  it('does nothing for every other scheme', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,hi',
      'file:///C:/Windows/System32/calc.exe',
      'file://evil.example/s/x.md',
      'asset://localhost/C:/x.md',
      'ms-settings:defaultapps',
      'search-ms:query=x',
      'vscode://file/C:/x.md',
      'smb://evil.example/s/x.md',
      'tauri://localhost/',
      'https:',
      '',
      '   ',
    ]) {
      expect(linkAction(href, 'C:\\docs'), href).toEqual(NONE);
    }
    expect(linkAction(null, 'C:\\docs')).toEqual(NONE);
  });
});
