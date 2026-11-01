// The window never follows a link, wherever the link is: the reader routes
// its own, and everywhere else (footnote and source previews, the update
// changelog) a link can only go to the browser or mail app.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installLinkGuard } from '../../src/lib/link-guard';

const XLINK = 'http://www.w3.org/1999/xlink';

let external: ReturnType<typeof vi.fn>;
let uninstall: () => void;

beforeEach(() => {
  external = vi.fn();
  uninstall = installLinkGuard(window, external);
});

afterEach(() => {
  uninstall();
  document.body.innerHTML = '';
});

function link(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector('[data-t]')!;
}

// Whether the browser would still have followed it.
function click(el: Element, init: MouseEventInit = {}, type = 'click'): boolean {
  return el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

describe('installLinkGuard', () => {
  it('keeps a relative link from reloading the app', () => {
    for (const href of ['CONTRIBUTING.md', '?a', '/', 'other.md#x', '#fn1']) {
      const a = link(`<p class="preview"><a data-t href="${href}">x</a></p>`);
      expect(click(a), href).toBe(false);
    }
    expect(external).not.toHaveBeenCalled();
  });

  it('sends web and mail links to the browser or mail app', () => {
    expect(click(link('<a data-t href="https://github.com/o/r/pull/1">pr</a>'))).toBe(false);
    expect(click(link('<a data-t href="mailto:me@example.com">mail</a>'))).toBe(false);
    expect(external.mock.calls).toEqual([['https://github.com/o/r/pull/1'], ['mailto:me@example.com']]);
  });

  it('follows a click on something inside the link', () => {
    const a = link('<a data-t href="https://example.com/"><strong><em>deep</em></strong></a>');
    expect(click(a.querySelector('em')!)).toBe(false);
    expect(external).toHaveBeenCalledWith('https://example.com/');
  });

  it('does nothing for every other kind of link', () => {
    for (const href of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'asset://localhost/C:/x.html', 'http://tauri.localhost/x']) {
      expect(click(link(`<a data-t href="${href}">x</a>`)), href).toBe(false);
    }
    expect(external).not.toHaveBeenCalled();
  });

  it('holds SVG links too, by href or xlink:href', () => {
    const a = link('<svg><a data-t><text>n</text></a><a data-u href="https://example.com/b"><text>m</text></a></svg>');
    a.setAttributeNS(XLINK, 'xlink:href', 'https://example.com/a');
    expect(click(a.querySelector('text')!)).toBe(false);
    expect(click(document.querySelector('[data-u] text')!)).toBe(false);
    expect(external.mock.calls).toEqual([['https://example.com/a'], ['https://example.com/b']]);
  });

  it('takes a middle click the same way, and leaves the other buttons alone', () => {
    const a = link('<a data-t href="https://example.com/">x</a>');
    expect(click(a, { button: 1 }, 'auxclick')).toBe(false);
    expect(click(a, { button: 2 }, 'auxclick')).toBe(true);
    expect(external).toHaveBeenCalledTimes(1);
  });

  it("leaves the reader's links to the reader, and sends a diagram's or the editor's nowhere", () => {
    for (const html of [
      '<article data-own-links><a data-t href="https://example.com/">x</a></article>',
      '<div class="mermaid-block"><svg><a data-t href="https://example.com/"><text>n</text></a></svg></div>',
      '<div class="mermaid-block-editor"><svg><a data-t href="https://example.com/"><text>n</text></a></svg></div>',
      '<div contenteditable="true"><a data-t href="https://example.com/">x</a></div>',
    ]) {
      expect(click(link(html)), html).toBe(false);
    }
    expect(external).not.toHaveBeenCalled();
  });

  it('holds before anything else sees the click', () => {
    const a = link('<a data-t href="https://example.com/">x</a>');
    a.addEventListener('click', (e) => e.stopPropagation());
    expect(click(a)).toBe(false);
  });

  it('leaves clicks that are not on a link alone', () => {
    expect(click(link('<button data-t>b</button>'))).toBe(true);
    expect(click(link('<a data-t>no href</a>'))).toBe(true);
  });

  // A diagram label may carry a form: mermaid keeps form, button and input
  // under strict security, and a click on the button sends the window to
  // the form's action. No form in the app submits by navigating.
  it('never lets a form submit the window anywhere', () => {
    const form = link(
      '<div class="mermaid-block"><form data-t action="http://xn--a.attacker.example/"><button>Update</button></form></div>',
    ) as HTMLFormElement;
    form.addEventListener('submit', (e) => e.stopPropagation());
    expect(form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))).toBe(false);
    const post = link('<form data-t method="post" action="/"><input name="q"></form>');
    expect(post.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))).toBe(false);
  });

  it('stops when uninstalled', () => {
    uninstall();
    const a = link('<a data-t href="https://example.com/">x</a>');
    a.addEventListener('click', (e) => e.preventDefault());
    click(a);
    expect(external).not.toHaveBeenCalled();
    const form = link('<form data-t action="/"></form>');
    expect(form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))).toBe(true);
    uninstall = () => {};
  });
});
