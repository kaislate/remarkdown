import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { linkAction, DOCUMENT_EXTS } from '../../src/lib/link-action';

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

  // \\?\UNC\server\share is the same share as \\server\share, spelled
  // long; read as server '?' and share 'UNC', a link could climb from it
  // to another server.
  it('reads a long-form network path as the share it names', () => {
    for (const dir of ['\\\\?\\UNC\\srv\\share\\d', '\\\\.\\UNC\\srv\\share\\d', '//?/UNC/srv/share/d']) {
      expect(linkAction('../../../x.md', dir), dir).toEqual(NONE);
      expect(linkAction('../../../evil/s/x.md', dir), dir).toEqual(NONE);
    }
    expect(linkAction('../other.md', '\\\\?\\UNC\\srv\\share\\d')).toEqual({ kind: 'open', path: '\\\\srv\\share\\other.md' });
  });

  it('reads a long-form drive path as the drive', () => {
    expect(linkAction('../other.md', '\\\\?\\C:\\docs\\sub')).toEqual({ kind: 'open', path: 'C:\\docs\\other.md' });
    expect(linkAction('../../../x.md', '\\\\.\\C:\\docs')).toEqual({ kind: 'open', path: 'C:\\x.md' });
  });

  it('refuses any other long-form or device path', () => {
    for (const dir of ['\\\\?\\Volume{1234}\\docs', '\\\\.\\pipe\\x', '\\\\?\\GLOBALROOT\\Device\\x']) {
      expect(linkAction('other.md', dir), dir).toEqual(NONE);
    }
  });

  // A colon is a drive or an NTFS stream on Windows, but just a character
  // in a macOS or Linux filename.
  it('opens a name with a colon next to a macOS or Linux document', () => {
    expect(linkAction('Meeting%3A%20notes.md', '/home/me/docs')).toEqual({ kind: 'open', path: '/home/me/docs/Meeting: notes.md' });
    expect(linkAction('Meeting%3A%20notes.md', 'C:/Users/me/docs')).toEqual(NONE);
    expect(linkAction('Meeting%3A%20notes.md', 'C:\\docs')).toEqual(NONE);
    expect(linkAction('Meeting%3A%20notes.md', '\\\\srv\\share')).toEqual(NONE);
  });

  // A backslash is just a character in a macOS or Linux name, not a
  // separator, and doesn't make the folder a Windows one.
  it('keeps a backslash in a macOS or Linux folder name', () => {
    expect(linkAction('x.md', '/home/me/a\\b')).toEqual({ kind: 'open', path: '/home/me/a\\b/x.md' });
    expect(linkAction('../y.md', '/home/me/a\\b/c')).toEqual({ kind: 'open', path: '/home/me/a\\b/y.md' });
    expect(linkAction('Meeting%3A%20notes.md', '/home/me/a\\b')).toEqual({ kind: 'open', path: '/home/me/a\\b/Meeting: notes.md' });
  });

  // macOS mounts another machine's exports the moment anything looks
  // under /net/<host> (and /Network/Servers/<host>): a link that climbs
  // there would have the Mac reach out to a host the document names.
  it("refuses a link that climbs into macOS's network mounts", () => {
    for (const href of [
      '../../../../../../../../net/evil.example/export/x.md',
      '..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2Fnet%2Fevil.example%2Fexport%2Fx.md',
      '../../../../../../../../NET/evil.example/x.md',
      '../../../../../../../../net/evil.md',
      '../../../../../../../../Network/Servers/evil.example/x.md',
      '../../../../../../../../network/x.md',
    ]) {
      expect(linkAction(href, '/Users/me/docs'), href).toEqual(NONE);
    }
    // A document already on a mounted export keeps its links on that host.
    expect(linkAction('../other.md', '/net/srv/export/docs')).toEqual({ kind: 'open', path: '/net/srv/export/other.md' });
    expect(linkAction('../../../evil/x.md', '/net/srv/export/docs')).toEqual(NONE);
    // A folder that is merely called net is any other folder.
    expect(linkAction('../net/x.md', '/Users/me/docs')).toEqual({ kind: 'open', path: '/Users/me/net/x.md' });
  });

  it('needs the document folder', () => {
    expect(linkAction('other.md', null)).toEqual(NONE);
    expect(linkAction('other.md', undefined)).toEqual(NONE);
  });

  it('opens a document in any of the kinds the app opens', () => {
    for (const ext of ['md', 'markdown', 'mkd', 'MDOWN', 'mkdn', 'mdwn']) {
      expect(linkAction(`part2.${ext}`, 'C:\\docs'), ext).toEqual({ kind: 'open', path: `C:\\docs\\part2.${ext}` });
    }
  });

  it('knows the same kinds as the file commands', () => {
    const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/doc_paths.rs'), 'utf-8');
    const list = /DOCUMENT_EXTS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)?.[1];
    expect(list && [...list.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...DOCUMENT_EXTS]);
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
