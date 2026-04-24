import { describe, it, expect } from 'vitest';
import { computeMinimapLayout, minimapClickToScrollTop } from '../../src/lib/minimap-math';

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
