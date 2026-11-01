// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { appCsp, metaPolicy, withCspMeta } from '../e2e/support/csp';

const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));

describe('the app CSP', () => {
  it('is set, and the dev one too', () => {
    expect(conf.app.security.csp).toBeTruthy();
    expect(conf.app.security.devCsp).toBeTruthy();
  });

  // What every page of the app may and may not do; see tauri.conf.json.
  it('blocks inline and eval script, plugins, frames and forms', () => {
    const p = appCsp();
    expect(p).toMatch(/(^|; )script-src 'self' 'wasm-unsafe-eval'(;|$)/);
    expect(p).not.toMatch(/'unsafe-eval'|script-src[^;]*'unsafe-inline'/);
    for (const d of ['object-src', 'base-uri', 'form-action', 'frame-src']) {
      expect(p).toMatch(new RegExp(`(^|; )${d} 'none'(;|$)`));
    }
  });

  // `tauri dev` serves the page from Vite, whose live reload talks over a
  // websocket. Otherwise the dev policy is the app's, so dev shows what a
  // release would block.
  it('is the same in dev, plus the live-reload socket', () => {
    const { 'connect-src': devConnect, ...dev } = conf.app.security.devCsp;
    const { 'connect-src': connect, ...prod } = conf.app.security.csp;
    expect(dev).toEqual(prod);
    expect(devConnect.split(' ').filter((s: string) => s !== 'ws://localhost:1566')).toEqual(connect.split(' '));
    expect(devConnect).toContain('ws://localhost:1566');
  });

  it('lets the page reach Tauri, its pictures and the release notes', () => {
    const p = appCsp();
    expect(p).toMatch(/connect-src [^;]*\bipc: http:\/\/ipc\.localhost\b/);
    expect(p).toMatch(/connect-src [^;]*https:\/\/api\.github\.com/);
    expect(p).toMatch(/img-src [^;]*asset: http:\/\/asset\.localhost/);
  });

  // Tauri gives every <style> in index.html a nonce and adds it to
  // style-src, and a nonce switches 'unsafe-inline' off: KaTeX's and
  // mermaid's inline styles would stop working in the app, though not
  // here (the e2e page carries the policy without Tauri's nonces).
  it('has no <style> in index.html to put a nonce in style-src', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/<style[\s>]/i);
  });
});

describe('metaPolicy', () => {
  it('serializes a directive map in order', () => {
    expect(metaPolicy({ 'default-src': "'self'", 'img-src': ["'self'", 'data:'] }))
      .toBe("default-src 'self'; img-src 'self' data:");
  });

  it('passes a policy string through', () => {
    expect(metaPolicy("default-src 'self'; img-src data:")).toBe("default-src 'self'; img-src data:");
  });

  // A <meta> policy can't carry these; browsers warn and ignore them.
  it('drops the directives a meta tag cannot carry', () => {
    expect(metaPolicy({
      'default-src': "'self'",
      'frame-ancestors': "'none'",
      'report-uri': '/r',
      'report-to': 'x',
      sandbox: '',
    })).toBe("default-src 'self'");
    expect(metaPolicy("default-src 'self'; frame-ancestors 'none'")).toBe("default-src 'self'");
  });
});

describe('withCspMeta', () => {
  const html = '<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n    <title>x</title>\n  </head>\n</html>';

  it('puts the policy right after the charset, before anything it governs', () => {
    const out = withCspMeta(html, "default-src 'self'");
    expect(out).toContain(
      '<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n    <title>',
    );
  });

  it('refuses a page with no charset to anchor it to', () => {
    expect(() => withCspMeta('<html><head></head></html>', "default-src 'self'")).toThrow();
  });
});

// support/test.ts is what fails a test whose page broke the policy, so a
// spec that takes `test` straight from Playwright would go unguarded.
describe('e2e specs', () => {
  const specs = readdirSync('tests/e2e').filter((f) => f.endsWith('.spec.ts'));

  it.each(specs)('%s takes test and expect from support/test', (spec) => {
    const text = readFileSync(`tests/e2e/${spec}`, 'utf8');
    expect(text).toMatch(/^import \{ test, expect \} from '\.\/support\/test';\r?$/m);
    expect(text).not.toMatch(/^import \{[^}]*\b(test|expect)\b[^}]*\} from '@playwright\/test'/m);
  });
});
