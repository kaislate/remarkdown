import { describe, it, expect } from 'vitest';
import { computeMinimapLayout, minimapClickToScrollTop, indicatorRange } from '../../src/lib/minimap-math';

describe('computeMinimapLayout', () => {
  it('uniform scale when content fits within minimap height', () => {
    // Short doc: 400px tall content in a 720px wide viewer; minimap 100x500.
    const l = computeMinimapLayout(
      /* scrollTop */ 0,
      /* scrollHeight */ 400,
      /* clientHeight */ 400,
      /* contentWidth */ 720,
      /* minimapWidth */ 100,
      /* minimapHeight */ 500,
    );
    expect(l.scale).toBeCloseTo(100 / 720, 5);
    expect(l.translateY).toBe(0);
    expect(l.indicatorTop).toBe(0);
    // indicatorHeight = max(20, clientHeight * scale) = max(20, 400 * 0.1388) ≈ 55
    expect(l.indicatorHeight).toBeGreaterThan(20);
  });

  it('indicator moves down as viewer scrolls in a short doc', () => {
    const l0 = computeMinimapLayout(0, 800, 400, 720, 100, 500);
    const l1 = computeMinimapLayout(200, 800, 400, 720, 100, 500);
    expect(l1.indicatorTop).toBeGreaterThan(l0.indicatorTop);
  });

  it('content translates and indicator follows when scaled content exceeds map height', () => {
    // Long doc: 10000px content → scaled = 10000 * (100/720) ≈ 1389px, map is 500 tall.
    const l0 = computeMinimapLayout(0, 10000, 600, 720, 100, 500);
    expect(l0.translateY).toBe(0);
    expect(l0.indicatorTop).toBe(0);

    // Middle of doc (50% scroll).
    const middle = computeMinimapLayout(4700, 10000, 600, 720, 100, 500);
    expect(middle.translateY).toBeLessThan(0); // content shifts up
    // Indicator is somewhere in the middle of the minimap (not at top or bottom).
    expect(middle.indicatorTop).toBeGreaterThan(50);
    expect(middle.indicatorTop + middle.indicatorHeight).toBeLessThan(450);

    // Bottom of doc: scroll at max.
    const bottom = computeMinimapLayout(9400, 10000, 600, 720, 100, 500);
    // Indicator should sit at the bottom edge of the minimap.
    expect(bottom.indicatorTop + bottom.indicatorHeight).toBeCloseTo(500, 0);
  });

  it('clamps when viewerScrollTop exceeds maxScroll', () => {
    const l = computeMinimapLayout(99999, 10000, 600, 720, 100, 500);
    // Indicator bottom should still be pinned to map bottom.
    expect(l.indicatorTop + l.indicatorHeight).toBeCloseTo(500, 0);
  });

  it('enforces a minimum indicator height of 20px on very tall docs', () => {
    // 100000px doc → scaled viewer * tiny scale = very small indicator; should clamp to 20.
    const l = computeMinimapLayout(0, 100000, 400, 720, 100, 500);
    // 400 * (100/720) ≈ 55; still above 20, so no clamp.
    // Try with smaller client:
    const l2 = computeMinimapLayout(0, 100000, 10, 720, 100, 500);
    expect(l2.indicatorHeight).toBe(20);
  });

  it('does not divide by zero on degenerate inputs', () => {
    const l = computeMinimapLayout(0, 0, 0, 720, 100, 500);
    expect(Number.isFinite(l.scale)).toBe(true);
    expect(Number.isFinite(l.indicatorTop)).toBe(true);
  });
});

describe('minimapClickToScrollTop', () => {
  it('clicking the top of the minimap scrolls to the top of the viewer', () => {
    const scale = 100 / 720;
    const scrollTop = minimapClickToScrollTop(0, 0, scale, 600, 3000);
    expect(scrollTop).toBe(0);
  });

  it('clicking the middle of a short-doc minimap centers the viewer there', () => {
    // 2000px content, 600px client, 100px minimap width → scale ≈ 0.139
    // Scaled content ≈ 278px; fits in a 500px minimap → translateY=0.
    const scale = 100 / 720;
    // Click at y=139 in minimap → real content pos = 139 * (720/100) = 1000.8.
    // Center viewer on 1000.8: newScroll = 1000.8 - 300 = 700.8.
    const scrollTop = minimapClickToScrollTop(139, 0, scale, 600, 2000);
    expect(scrollTop).toBeCloseTo(700.8, 1);
  });

  it('clamps when click lands below the content', () => {
    const scale = 100 / 720;
    // Click way below the scaled content.
    const scrollTop = minimapClickToScrollTop(9999, 0, scale, 600, 2000);
    // Max scroll = 2000 - 600 = 1400. Should clamp to that.
    expect(scrollTop).toBe(1400);
  });

  it('clamps when click is at the very top', () => {
    const scrollTop = minimapClickToScrollTop(-100, 0, 100 / 720, 600, 2000);
    expect(scrollTop).toBe(0);
  });

  it('accounts for translateY on long docs', () => {
    // Long doc — minimap content is scrolled. translateY = -300 (content moved up 300px).
    // Click at y=200 in the minimap → effective position in scaled content = 200 - (-300) = 500.
    const scale = 100 / 720;
    const scrollTop = minimapClickToScrollTop(200, -300, scale, 600, 20000);
    // posInContent = 500 * (720/100) = 3600; newScroll = 3600 - 300 = 3300
    expect(scrollTop).toBeCloseTo(3300, 0);
  });
});

describe('viewport box accuracy', () => {
  // The box, mapped back through the clone's scale and shift, must cover
  // exactly the scroll container's visible range — for every scroll
  // position, with the article starting below the top of the scroll
  // content, and whether or not the scaled article fits in the map.
  const cases = [
    { name: 'short article, flush', scrollHeight: 2000, clientHeight: 700, articleTop: 0, articleHeight: 2000 },
    { name: 'tall article, flush', scrollHeight: 12000, clientHeight: 740, articleTop: 0, articleHeight: 12000 },
    { name: 'tall article, offset', scrollHeight: 12040, clientHeight: 700, articleTop: 40, articleHeight: 11900 },
    { name: 'article shorter than the scroll content', scrollHeight: 3000, clientHeight: 740, articleTop: 0, articleHeight: 2600 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const max = c.scrollHeight - c.clientHeight;
      for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const scrollTop = max * f;
        const l = computeMinimapLayout(scrollTop, c.scrollHeight, c.clientHeight, 816, 122, 600, c.articleTop, c.articleHeight);
        const [top, bottom] = indicatorRange(l, c.articleTop);
        expect(top).toBeCloseTo(scrollTop, 6);
        expect(bottom).toBeCloseTo(scrollTop + c.clientHeight, 6);
      }
    });
  }

  it('the article clone is shifted by the scroll position only as far as the map needs', () => {
    const l = computeMinimapLayout(11340, 12040, 700, 816, 122, 600, 40, 11900);
    // At the very bottom the clone's bottom edge meets the map's.
    expect(11900 * l.scale + l.translateY).toBeCloseTo(600, 6);
  });

  it('clicking centres the page on the clicked spot of an offset article', () => {
    const l = computeMinimapLayout(0, 12040, 700, 816, 122, 600, 40, 11900);
    const y = 300; // map px
    const target = minimapClickToScrollTop(y, l.translateY, l.scale, 700, 12040, 40);
    expect(target).toBeCloseTo(40 + (y - l.translateY) / l.scale - 350, 6);
  });
});
