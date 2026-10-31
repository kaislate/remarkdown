// Which text position is under a screen point. The standard
// caretPositionFromPoint is off by default in WebKitGTK before 2.52 and
// missing from Safari before 26.2, so on the Mac and Linux webviews we fall
// back to caretRangeFromPoint, which every WebKit has had for years.
export function caretFromPoint(
  x: number,
  y: number,
  doc: Document = document,
): { node: Node; offset: number } | null {
  const pos = (doc as any).caretPositionFromPoint?.(x, y);
  if (pos?.offsetNode) return { node: pos.offsetNode, offset: pos.offset };
  const range = (doc as any).caretRangeFromPoint?.(x, y);
  if (range?.startContainer) return { node: range.startContainer, offset: range.startOffset };
  return null;
}
