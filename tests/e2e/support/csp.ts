// The e2e build runs under the app's own Content Security Policy, so a
// change that the policy would break in the real app (an inline script, a
// stylesheet or request from somewhere new) breaks the e2e suite too.
//
// Tauri sends the policy from tauri.conf.json as a header on the app's
// pages. Vite's preview server doesn't, so the e2e build carries it in a
// <meta> tag instead, and support/test.ts fails any test that trips it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

type Csp = string | Record<string, string | string[]>;

// Directives a <meta> policy can't carry; browsers warn and ignore them.
const HEADER_ONLY = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

// tauri.conf.json's app.security.csp, either form Tauri accepts (a policy
// string or a map of directive → sources), as a policy for a <meta> tag.
export function metaPolicy(csp: Csp): string {
  const directives =
    typeof csp === 'string'
      ? csp.split(';').map((d) => d.trim()).filter(Boolean)
      : Object.entries(csp).map(([name, sources]) =>
          [name, ...(Array.isArray(sources) ? sources : [sources])].join(' ').trim());
  return directives.filter((d) => !HEADER_ONLY.has(d.split(/\s+/)[0])).join('; ');
}

// The app's production policy, from tauri.conf.json.
export function appCsp(): string {
  const conf = JSON.parse(readFileSync(fileURLToPath(new URL('../../../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'));
  return metaPolicy(conf.app.security.csp as Csp);
}

// `html` with the policy in a <meta> right after the charset: a meta policy
// only governs what comes after it in the document.
export function withCspMeta(html: string, policy: string): string {
  const charset = /<meta charset=[^>]*>/i.exec(html);
  if (!charset) throw new Error('index.html has no <meta charset> to put the CSP after');
  const indent = /\n([ \t]*)$/.exec(html.slice(0, charset.index))?.[1] ?? '';
  const content = policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const at = charset.index + charset[0].length;
  return `${html.slice(0, at)}\n${indent}<meta http-equiv="Content-Security-Policy" content="${content}">${html.slice(at)}`;
}

export function e2eCsp(): Plugin {
  return {
    name: 'remarkdown-e2e-csp',
    transformIndexHtml: (html) => withCspMeta(html, appCsp()),
  };
}
