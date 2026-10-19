// The diagram title, shared by the pie / gantt / timeline engines.
//
// A title can come from YAML frontmatter (`title: …`) or from `title …`
// statements in the body; mermaid applies the frontmatter one first and
// lets every body statement overwrite it, so the LAST body title is the
// one shown. The frontmatter title is also never entity-decoded and goes
// through mermaid's HTML sanitizer raw, so a `&` there shows as "&amp;".
// Hence the rules:
//   - a body title exists → rewrite only the value of the last one
//   - only a frontmatter title → edit it in place when the text survives
//     the sanitizer; otherwise move the title into the body (the
//     frontmatter key goes, a `title` line is added)
//   - no title → add a `title` line right below the header
//   - empty title → remove every title statement and the frontmatter key
// Timelines ignore the frontmatter title altogether (mermaid's timeline
// db has no setDiagramTitle); for them it is never read or written.
import {
  findPreamble,
  indentFor,
  joinLines,
  replaceSpan,
  setFrontmatterTitle,
  splitLines,
  type Span,
} from './source-text';
import { collapseSpace, normalizeUserText } from './display-text';

export interface TitleStatement {
  line: number;
  // The raw title text (empty span right after `title` when it has none).
  value: Span;
  // What to cut when the title goes; null = the whole line.
  cut: Span | null;
}

// Displayed title for a frontmatter value (never entity-decoded).
export function frontmatterTitleText(value: string): string {
  return collapseSpace(value);
}

// Text the sanitizer leaves alone, so it can stay in the frontmatter.
function frontmatterSafe(text: string): boolean {
  return !/[&<>]/.test(text);
}

export function applyTitle(
  source: string,
  titles: TitleStatement[],
  title: string,
  // Writes the user's text as this diagram type's title value.
  encode: (text: string) => string,
  // Does this diagram type show the frontmatter title?
  useFrontmatter = true,
): string {
  const text = normalizeUserText(title);
  const src = splitLines(source);
  const lines = [...src.lines];
  const preamble = findPreamble(lines);
  const headerLine = preamble.headerLine;
  const frontmatter = useFrontmatter ? preamble.frontmatter : null;
  if (text === '') {
    // Bottom-up, so earlier line numbers stay valid.
    for (const t of [...titles].sort((a, b) => b.line - a.line || (b.cut?.start ?? 0) - (a.cut?.start ?? 0))) {
      if (t.cut) lines[t.line] = replaceSpan(lines[t.line], t.cut, '');
      else lines.splice(t.line, 1);
    }
    const out = joinLines(src, lines);
    return frontmatter?.title ? setFrontmatterTitle(out, '') : out;
  }
  if (titles.length) {
    const last = titles[titles.length - 1];
    const before = lines[last.line].slice(0, last.value.start);
    // A bare `title` gets the space mermaid needs between keyword and text.
    const sep = last.value.start === last.value.end && !/[\t ]$/.test(before) ? ' ' : '';
    lines[last.line] = replaceSpan(lines[last.line], last.value, sep + encode(text));
    return joinLines(src, lines);
  }
  if (frontmatter?.title && frontmatterSafe(text)) return setFrontmatterTitle(source, text);
  lines.splice(headerLine + 1, 0, `${indentFor(lines, headerLine + 1, headerLine)}title ${encode(text)}`);
  const out = joinLines(src, lines);
  return frontmatter?.title ? setFrontmatterTitle(out, '') : out;
}
