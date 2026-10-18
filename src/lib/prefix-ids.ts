// Give every id inside `root` a prefix and rewrite the references that
// point at them, so a DOM clone can live in the same document as its
// original without duplicate ids.
//
// Used by the minimap, which mirrors the article. Diagram svgs are the
// reason this exists: each carries dozens of ids (the svg, its markers,
// gradients, edge paths, aria title), and its inline <style> and
// url(#…) references are keyed on them. A clone with untouched ids
// duplicates every one of them and its arrowheads/gradients resolve to
// the original's elements — which live inside the hidden article in
// edit mode, where they don't paint.
//
// References rewritten (only when they name an id that exists in root,
// matched exactly — never as a prefix of a longer id):
//   - url(#id) in any attribute (marker-end, fill, style="…", …)
//   - href / xlink:href="#id"
//   - aria-labelledby / aria-describedby / aria-controls / for tokens
//   - #id selectors inside <style> elements
const IDREF_ATTRS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for'];
const XLINK = 'http://www.w3.org/1999/xlink';

export function prefixIds(root: Element, prefix: string): void {
  const withId = Array.from(root.querySelectorAll('[id]'));
  if (withId.length === 0) return;
  const ids = new Set(withId.map((el) => el.id).filter(Boolean));
  for (const el of withId) {
    if (el.id) el.id = prefix + el.id;
  }

  const mapRef = (id: string): string => (ids.has(id) ? prefix + id : id);
  // url(#id) / url("#id") / url('#id'). The id runs to the closing
  // quote or paren, so a longer id is never matched by its prefix.
  const urlRe = /url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g;
  const rewriteUrls = (value: string): string =>
    value.replace(urlRe, (m, q: string, id: string) =>
      ids.has(id) ? `url(${q}#${prefix}${id}${q})` : m,
    );

  for (const el of root.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      const v = attr.value;
      if (attr.localName === 'href' && v.startsWith('#')) {
        const next = '#' + mapRef(v.slice(1));
        if (next !== v) {
          if (attr.namespaceURI === XLINK) el.setAttributeNS(XLINK, attr.name, next);
          else el.setAttribute(attr.name, next);
        }
        continue;
      }
      if (IDREF_ATTRS.includes(attr.name)) {
        const next = v.split(/\s+/).map(mapRef).join(' ');
        if (next !== v) el.setAttribute(attr.name, next);
        continue;
      }
      if (v.includes('url(')) {
        const next = rewriteUrls(v);
        if (next !== v) el.setAttributeNS(attr.namespaceURI, attr.name, next);
      }
    }
  }

  // #id selectors in inline stylesheets. Each `#ident` token is taken
  // whole (maximal run of identifier characters) and rewritten only if
  // it names an id in root — so `#a` never eats the front of `#a_b`,
  // and hex colours (#ECECFF) stay put.
  const selRe = /#([A-Za-z_][\w-]*)/g;
  for (const style of root.querySelectorAll('style')) {
    const css = style.textContent ?? '';
    const next = rewriteUrls(css).replace(selRe, (m, id: string) =>
      ids.has(id) ? `#${prefix}${id}` : m,
    );
    if (next !== css) style.textContent = next;
  }
}
