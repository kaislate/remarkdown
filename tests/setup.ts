import '@testing-library/jest-dom/vitest';

// jsdom does not implement CSS Custom Highlight API. Provide a minimal shim so
// HighlightLayer can run in the test environment; tests assert via this shim.

class MockHighlight {
  ranges: Set<Range>;
  constructor(...ranges: Range[]) {
    this.ranges = new Set(ranges);
  }
  add(range: Range) { this.ranges.add(range); }
  clear() { this.ranges.clear(); }
  delete(range: Range) { this.ranges.delete(range); }
}

if (typeof window !== 'undefined') {
  // @ts-expect-error adding to global
  window.Highlight = MockHighlight;
  const g: any = window.CSS ?? {};
  if (!g.highlights) g.highlights = new Map();
  if (!g.escape) g.escape = (s: string) => s.replace(/[^\w-]/g, '\\$&');
  // @ts-expect-error adding to global
  window.CSS = g;
}
