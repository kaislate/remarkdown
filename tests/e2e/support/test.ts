// Every spec takes `test` and `expect` from here rather than from
// @playwright/test. The e2e build runs under the app's Content Security
// Policy (support/csp.ts), and this fails any test whose pages broke it: a
// blocked script, stylesheet, picture or request would otherwise only show
// up as something quietly missing.

import { test as base, expect, type BrowserContext } from '@playwright/test';

const MARK = '[csp-violation]';

// Runs in the page before its own scripts, in every page of a context.
function reportViolations(mark: string): void {
  window.addEventListener('securitypolicyviolation', (e) => {
    const blocked = e.blockedURI || 'inline';
    console.error(`${mark} ${e.effectiveDirective} blocked ${blocked}${e.sample ? `: ${e.sample}` : ''}`);
  }, true);
}

// `cspViolations` is what the pages reported, one line each; the test fails
// unless it's empty at the end. csp.spec.ts reads (and clears) it to check
// the reporting works.
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [async ({ browser, context }, use) => {
    const violations: string[] = [];
    const watch = async (ctx: BrowserContext) => {
      ctx.on('console', (msg) => {
        if (msg.text().startsWith(MARK)) violations.push(msg.text().slice(MARK.length + 1));
      });
      await ctx.addInitScript(reportViolations, MARK);
    };
    await watch(context);
    // Some tests open pages of their own (browser.newPage, newContext).
    const newContext = browser.newContext;
    browser.newContext = async function (this: typeof browser, ...args: Parameters<typeof newContext>) {
      const ctx = await newContext.apply(this, args);
      await watch(ctx);
      return ctx;
    };
    try {
      await use(violations);
    } finally {
      browser.newContext = newContext;
    }
    expect(violations, 'the page broke the Content Security Policy').toEqual([]);
  }, { auto: true }],
});

export { expect };
