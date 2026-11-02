// A number that changes whenever anything that finding text in an element
// depends on changes inside it: its text, its nodes, and the attributes
// anchors read (block ids; the class that marks a diagram). Work done
// against an element (where an anchor is, a re.mark's sentence of context)
// can be kept while the number stays the same, and is exactly what doing
// it again would give.
//
// Read synchronously: pending mutation records are taken on each read, so
// a change made just before is seen at once, not a microtask later.

interface Watch { observer: MutationObserver; version: number }

const watches = new WeakMap<Node, Watch>();

export function domVersion(root: Node): number {
  let w = watches.get(root);
  if (!w) {
    const watch: Watch = {
      version: 0,
      observer: new MutationObserver(() => { watch.version += 1; }),
    };
    watch.observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-block-id', 'class'],
    });
    watches.set(root, watch);
    return 0;
  }
  if (w.observer.takeRecords().length) w.version += 1;
  return w.version;
}
