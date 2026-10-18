// The minimap renders a clone of the article. Without rewriting, every
// id in the article (each diagram svg carries dozens: the svg itself,
// markers, gradients, edge paths) exists twice in the document, and the
// clone's url(#…) references resolve to the ORIGINAL elements.
import { describe, it, expect } from 'vitest';
import { prefixIds } from '../../src/lib/prefix-ids';

const SVG = `
<div class="mermaid-block">
  <svg id="rmd-mermaid-1x" aria-labelledby="chart-title-rmd-mermaid-1x" aria-roledescription="flowchart-v2">
    <title id="chart-title-rmd-mermaid-1x">T</title>
    <style>#rmd-mermaid-1x{font-family:x;}#rmd-mermaid-1x .node rect{fill:#ECECFF;}#rmd-mermaid-1x_marker{}</style>
    <defs>
      <marker id="rmd-mermaid-1x_flowchart-v2-pointEnd"><path d="M0,0"></path></marker>
      <linearGradient id="grad"></linearGradient>
    </defs>
    <path id="rmd-mermaid-1x-L_A_B_0" marker-end="url(#rmd-mermaid-1x_flowchart-v2-pointEnd)" style="fill:url(&quot;#grad&quot;)"></path>
    <use href="#grad"></use>
    <use xlink:href="#grad" xmlns:xlink="http://www.w3.org/1999/xlink"></use>
  </svg>
</div>
<p><a href="#fn1" id="fnref1">1</a></p>
<ol><li id="fn1">note <a href="#nowhere">unknown target stays</a></li></ol>
<p><a href="https://example.com/#rmd-mermaid-1x">external</a></p>`;

function build(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = SVG;
  return root;
}

describe('prefixIds', () => {
  it('prefixes every id', () => {
    const root = build();
    prefixIds(root, 'mm-');
    const ids = Array.from(root.querySelectorAll('[id]')).map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith('mm-')).toBe(true);
  });

  it('rewrites references so they resolve inside the clone', () => {
    const root = build();
    prefixIds(root, 'mm-');
    const path = root.querySelector('path[marker-end]')!;
    expect(path.getAttribute('marker-end')).toBe('url(#mm-rmd-mermaid-1x_flowchart-v2-pointEnd)');
    expect(path.getAttribute('style')).toContain('#mm-grad');
    expect(root.querySelector('use[href]')!.getAttribute('href')).toBe('#mm-grad');
    expect(
      root.querySelector('use[*|href]:not([href])')!.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
    ).toBe('#mm-grad');
    expect(root.querySelector('svg')!.getAttribute('aria-labelledby')).toBe('mm-chart-title-rmd-mermaid-1x');
    expect(root.querySelector('a[href^="#"]')!.getAttribute('href')).toBe('#mm-fn1');
    expect(root.querySelector('li a')!.getAttribute('href')).toBe('#nowhere');
    // Every referenced id exists in the clone.
    for (const m of root.innerHTML.matchAll(/url\(&quot;#([^&)]+)&quot;\)|url\(#([^)]+)\)/g)) {
      const id = m[1] ?? m[2];
      expect(root.querySelector(`[id="${id}"]`), id).not.toBeNull();
    }
  });

  it('rewrites id selectors in inline <style> without touching hex colours or longer ids', () => {
    const root = build();
    prefixIds(root, 'mm-');
    const css = root.querySelector('style')!.textContent!;
    expect(css).toContain('#mm-rmd-mermaid-1x{');
    expect(css).toContain('#mm-rmd-mermaid-1x .node rect{fill:#ECECFF;}');
    // `#rmd-mermaid-1x_marker` isn't an id in the clone — left alone,
    // and not mangled into `#mm-rmd-mermaid-1x_marker` by a prefix match.
    expect(css).toContain('#rmd-mermaid-1x_marker{}');
  });

  it('leaves external links alone', () => {
    const root = build();
    prefixIds(root, 'mm-');
    expect(root.querySelector('a[href^="https"]')!.getAttribute('href')).toBe(
      'https://example.com/#rmd-mermaid-1x',
    );
  });
});
