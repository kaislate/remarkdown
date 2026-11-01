// Some of mermaid's lexer rules start with `.*` (`.*direction\s+LR[^\n]*`,
// `.*<<fork>>`): they match wherever the rest of the line holds the
// pattern, also in the middle of a label. Tried as a regex at every
// token, each one runs to the end of the line and back, so one long
// line lexed in quadratic time (a 40 KB line took seconds). The lexers
// ask this first, and only try the rule where it can match.

// Whether `pattern` starts at `pos` or later on the same line, as `.*`
// sees lines: a `.` stops at \n, \r, U+2028 and U+2029. `pattern` must
// be one that can't overlap itself (a keyword and its value), so a
// single left-to-right scan finds every place it starts.
export function aheadOnLine(text: string, pattern: string, flags = ''): (pos: number) => boolean {
  const starts = [...text.matchAll(new RegExp(pattern, `g${flags}`))].map((m) => m.index!);
  const breaks = [...text.matchAll(/[\n\r\u2028\u2029]/g)].map((m) => m.index!);
  return (pos) => firstFrom(starts, pos) < firstFrom(breaks, pos);
}

// The first offset in the sorted `list` that is at or after `pos`.
function firstFrom(list: number[], pos: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? list[lo] : Infinity;
}
