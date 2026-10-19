// Parser for mermaid sequenceDiagram. It reads what mermaid 11 reads —
// participant / actor declarations (with `as` aliases, `create`,
// `destroy`), every arrow (`->` `->>` `-->` `-->>` `-x` `--x` `-)` `--)`
// `<<->>` `<<-->>`, and the newer half-arrows, kept as written),
// activation suffixes (`->>+`, `-->>-`) and `activate` / `deactivate`,
// notes, every block (loop, alt / else, opt, par / and, par_over,
// critical / option, break, rect), `autonumber`, `box` groups, `title`,
// `%%` and `#` comments — checked against mermaid's own parse
// (tests/unit/editor/mermaid-sequence-parser.test.ts). Anything else
// returns `{ ok: false, reason }` and the node view shows the diagram
// read-only.
//
// Text (message / note text, participant display, block labels) is
// read the way mermaid shows it: an unencoded `#` starts a comment, and
// entity codes (`#59;`, `#quot;`, …) are decoded. The serializer writes
// user text with `;` / `#` encoded (encodeSequenceText), so whatever a
// user types reads back unchanged.
//
// parseSequenceSource also returns a source map — which line each
// statement sits on and where its parts are — for the source-preserving
// visual edits in mermaid-sequence-edit.ts. Every statement also knows
// its position in mermaid's own message list (activation, block and
// autonumber statements count there too): the rendered SVG names
// messages, notes and blocks `i<N>` after it.
import {
  emptySequenceGraph,
  type BlockKind,
  type MessageStyle,
  type NotePosition,
  type SequenceGraph,
} from './mermaid-sequence-graph';
import { decodeMermaidEntities, type Span } from './mermaid-parser';
import { findPreamble } from './mermaid/source-text';

type ParseResult =
  | { ok: true; graph: SequenceGraph }
  | { ok: false; reason: string };

export type MessageSource = {
  kind: 'message';
  line: number;
  // mermaid's message-list index of this message.
  mermaidIndex: number;
  arrow: Span;
  // The `+` / `-` activation mark after the arrow, when there is one.
  activation: Span | null;
  // Column just past the `to` id (where ": text" starts or would go).
  toEnd: number;
  // Span of the text after the colon (trailing spaces excluded); null
  // when the message has no ": text" part.
  text: Span | null;
  // Innermost enclosing block (index into graph.blocks), and branch.
  block: number | null;
};

export type NoteSource = {
  kind: 'note';
  line: number;
  mermaidIndex: number;
  // `left of A` / `over A,B` — the position keyword through the ids.
  head: Span;
  text: Span;
  block: number | null;
};

export interface ParticipantDecl {
  line: number;
  // The `participant` / `actor` keyword.
  keyword: Span;
  // Column just past the id (where " as Display" starts or would go).
  idEnd: number;
  // Column just past the display text (before any `# comment`); equals
  // idEnd when there's no display.
  tailEnd: number;
  hasDisplay: boolean;
  created: boolean;
  // The box it's declared in (index into graph.boxes).
  box: number | null;
}

export interface BlockSource {
  // Line of the opening keyword, each branch keyword, and the `end`.
  start: number;
  // The label after the keyword (empty span at the keyword's end when
  // there is none).
  label: Span;
  keyword: Span;
  branches: Array<{ line: number; keyword: Span; label: Span }>;
  end: number;
  // mermaid's message index of the `end` — what the SVG's
  // control-structure group is named after.
  endIndex: number;
}

export interface BoxSource {
  start: number;
  end: number;
  color: Span | null;
  label: Span | null;
  // Column just past `box`.
  keywordEnd: number;
}

// A statement naming a participant that isn't an event (activate,
// deactivate, destroy, link / links / properties / details).
export interface ReferenceSource {
  line: number;
  kind: 'activate' | 'deactivate' | 'destroy' | 'link';
  id: string;
}

export interface SequenceSourceMap {
  lines: string[];
  eol: string;
  directiveLine: number;
  // Every statement line (declarations, events, blocks, …), in order.
  statementLines: number[];
  declarations: Map<string, ParticipantDecl[]>;
  // Line where each participant is first mentioned (declaration or event).
  firstMention: Map<string, number>;
  // events[i] of the graph ↔ where it sits in the source.
  events: Array<MessageSource | NoteSource>;
  blocks: BlockSource[];
  boxes: BoxSource[];
  references: ReferenceSource[];
  // `autonumber` statements (lines).
  autonumber: number[];
  title: { line: number; text: Span } | null;
}

export type SequenceSourceParseResult =
  | { ok: true; graph: SequenceGraph; map: SequenceSourceMap }
  | { ok: false; reason: string };

const ID_RE_SRC = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_.]*';

// Delimiter ↔ style. Longest first so `-->>` beats `-->`, `<<-->>`
// beats `<<->>`.
export const MESSAGE_STYLES: Array<{ delim: string; style: MessageStyle }> = [
  { delim: '<<-->>', style: 'dottedBoth' },
  { delim: '<<->>', style: 'both' },
  { delim: '-->>', style: 'reply' },
  { delim: '->>', style: 'arrow' },
  { delim: '-->', style: 'dotted' },
  { delim: '--x', style: 'dottedCross' },
  { delim: '--)', style: 'dottedAsync' },
  { delim: '->', style: 'solid' },
  { delim: '-x', style: 'cross' },
  { delim: '-)', style: 'async' },
];

// mermaid 11's half-arrows: read and kept as written ('other').
const HALF_ARROWS = [
  '--|\\', '--|/', '--\\\\', '--//', '/|--', '\\|--', '//--', '\\\\--',
  '-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const ARROW_ALT = [...MESSAGE_STYLES.map((s) => s.delim), ...HALF_ARROWS].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

// Groups: 1 indent, 2 from, 3 ws, 4 arrow, 5 ws, 6 activation, 7 ws,
// 8 to, 9 ws, 10 ": …" part, 11 ws after colon, 12 text.
const MESSAGE_RE = new RegExp(
  `^(\\s*)(${ID_RE_SRC})(\\s*)(${ARROW_ALT})(\\s*)([+-]?)(\\s*)(${ID_RE_SRC})(\\s*)(:(\\s*)(.*))?$`,
  'u',
);

// Groups: 1 lead-in ("  Note "), 2 position, 3 ws, 4 ids, 5 colon part, 6 text.
const NOTE_RE = new RegExp(
  `^(\\s*Note\\s+)(left of|right of|over)(\\s+)(${ID_RE_SRC}(?:\\s*,\\s*${ID_RE_SRC})?)(\\s*:\\s*)(.*)$`,
  'iu',
);

// Groups: 1 indent, 2 `create `, 3 keyword, 4 ws, 5 id, 6 `@{…}`, 7 display.
const PARTICIPANT_RE = new RegExp(
  `^(\\s*)(create\\s+)?(participant|actor)(\\s+)(${ID_RE_SRC})(@\\{[^}]*\\})?(?:\\s+as\\s+(.+?))?\\s*$`,
  'u',
);

const REFERENCE_RE = new RegExp(`^\\s*(activate|deactivate|destroy)\\s+(${ID_RE_SRC})\\s*$`, 'u');
const LINK_RE = new RegExp(`^\\s*(link|links|properties|details)\\s+(${ID_RE_SRC})\\s*:`, 'u');

const BLOCK_KEYWORDS: Record<string, BlockKind> = {
  loop: 'loop',
  alt: 'alt',
  opt: 'opt',
  par: 'par',
  par_over: 'par',
  critical: 'critical',
  break: 'break',
  rect: 'rect',
};

export const BRANCH_KEYWORD: Partial<Record<BlockKind, string>> = { alt: 'else', par: 'and', critical: 'option' };

// CSS colour names mermaid (via the browser's CSS.supports) reads as a
// box's colour when one starts its label.
const CSS_COLORS = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen transparent').split(' '),
);

// A leading colour in a box header: `rgb(…)` / `hsl(…)` / `#hex` / a
// CSS colour name. Returns its length in `text`, or 0.
export function leadingColor(text: string): number {
  const fn = /^(rgba?|hsla?)\([^)]*\)/i.exec(text);
  if (fn) return fn[0].length;
  const hex = /^#[0-9a-f]{3,8}(?=\s|$)/i.exec(text);
  if (hex) return hex[0].length;
  const word = /^[a-z]+(?=\s|$)/i.exec(text);
  if (word && CSS_COLORS.has(word[0].toLowerCase())) return word[0].length;
  return 0;
}

// Text as mermaid displays it: cut at an unencoded `#` (mermaid's
// sequence lexer treats it as a comment), trim, decode entity codes.
export function decodeSequenceText(raw: string): string {
  const hash = raw.search(/#(?!\w+;)/);
  const visible = hash === -1 ? raw : raw.slice(0, hash);
  return decodeMermaidEntities(visible.trim());
}

// Text a user typed, made safe for a single-line sequence statement:
//   - newlines become spaces (mermaid ends a statement at each newline)
//   - `;` (statement separator) and `#` (comment start) become entity
//     codes, which mermaid decodes back for display — so the diagram
//     shows exactly what was typed. `&` and `<` too — the two
//     characters that can start an entity or markup — so such text
//     never reaches mermaid's HTML handling as markup (same rule as
//     flowchart labels). `>` alone can't, and stays raw so arrows in
//     text ("x -> y") stay readable in the file.
// Nothing is truncated: arrow-shaped text ("a->b", even a glued
// '"x"B->>A') renders fine in mermaid 11 and is kept verbatim.
const SEQUENCE_ENTITY: Record<string, string> = {
  '#': '#35;',
  ';': '#59;',
  '&': '#amp;',
  '<': '#lt;',
};

export function encodeSequenceText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[#;&<]/g, (c) => SEQUENCE_ENTITY[c]);
}

function unencodedSemicolon(line: string): boolean {
  const hash = line.search(/#(?!\w+;)/);
  const code = hash === -1 ? line : line.slice(0, hash);
  return code.replace(/#\w+;/g, '').includes(';');
}

// The visible text from `start`: up to an unencoded `#` (a comment to
// mermaid, kept out of the span so edits leave it in place), trailing
// spaces excluded.
function trimmedSpan(lineText: string, start: number): Span {
  const rest = lineText.slice(start);
  const hash = rest.search(/#(?!\w+;)/);
  const visible = hash === -1 ? rest : rest.slice(0, hash);
  return { start, end: start + visible.trimEnd().length };
}

class SequenceParseError extends Error {}

function fail(reason: string): never {
  throw new SequenceParseError(reason);
}

export function parseSequenceSource(source: string): SequenceSourceParseResult {
  try {
    return parseOrThrow(source);
  } catch (e) {
    if (e instanceof SequenceParseError) return { ok: false, reason: e.message };
    throw e;
  }
}

function parseOrThrow(source: string): SequenceSourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);

  // 1. The directive — first line past frontmatter, blanks, comments.
  const { headerLine } = findPreamble(lines);
  if (headerLine === -1) return { ok: false, reason: 'empty source' };
  if (!/^sequenceDiagram\s*$/.test(lines[headerLine].trim())) {
    return { ok: false, reason: `not a sequenceDiagram: ${lines[headerLine].trim()}` };
  }
  const directiveLine = headerLine;

  // 2. Walk the body.
  const graph: SequenceGraph = emptySequenceGraph();
  const map: SequenceSourceMap = {
    lines,
    eol,
    directiveLine,
    statementLines: [],
    declarations: new Map(),
    firstMention: new Map(),
    events: [],
    blocks: [],
    boxes: [],
    references: [],
    autonumber: [],
    title: null,
  };
  // mermaid's message-list index of the next message.
  let mermaidIndex = 0;
  // Open blocks and boxes, innermost last.
  const stack: Array<{ kind: 'block' | 'box'; index: number }> = [];
  const openBlock = () => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'block') return stack[k].index;
    return null;
  };
  const openBox = () => {
    const top = stack[stack.length - 1];
    return top?.kind === 'box' ? top.index : null;
  };

  const mention = (id: string, line: number) => {
    if (!graph.participants.has(id)) graph.participants.set(id, { id, display: '' });
    if (!map.firstMention.has(id)) map.firstMention.set(id, line);
  };

  for (let i = directiveLine + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.length === 0 || t.startsWith('%%') || t.startsWith('#')) continue;

    // mermaid lexes an unencoded `;` as a line break, so a line holding
    // one is several statements to mermaid. Reading it as one would
    // misalign our event indexes with mermaid's i<N> ids (a click would
    // edit the wrong message). Leave such diagrams render-only.
    // Entity codes (`#59;`) and `#` comments may contain `;` freely.
    if (unencodedSemicolon(t)) fail(`statement separator in: ${t}`);

    const firstWord = /^[A-Za-z_]+/.exec(t)?.[0] ?? '';
    const lower = firstWord.toLowerCase();
    map.statementLines.push(i);
    const indent = /^\s*/.exec(raw)![0].length;

    // Participant / actor declaration. mermaid: a declaration with an
    // alias overwrites the display; a bare re-declaration keeps it.
    const pMatch = PARTICIPANT_RE.exec(raw);
    if (pMatch && (lower === 'participant' || lower === 'actor' || lower === 'create')) {
      const id = pMatch[5];
      mention(id, i);
      const prev = graph.participants.get(id)!;
      const display = pMatch[7] !== undefined ? decodeSequenceText(pMatch[7]) : prev.display;
      const kind = pMatch[3] === 'actor' ? 'actor' : undefined;
      graph.participants.set(id, { id, display, ...(kind ? { kind } : {}) });
      const kwStart = pMatch[1].length + (pMatch[2]?.length ?? 0);
      const idEnd = kwStart + pMatch[3].length + pMatch[4].length + id.length + (pMatch[6]?.length ?? 0);
      const box = openBox();
      if (box !== null) graph.boxes[box].participants.push(id);
      const decls = map.declarations.get(id) ?? [];
      decls.push({
        line: i,
        keyword: { start: kwStart, end: kwStart + pMatch[3].length },
        idEnd,
        tailEnd: pMatch[7] !== undefined ? trimmedSpan(raw, idEnd).end : idEnd,
        hasDisplay: pMatch[7] !== undefined,
        created: !!pMatch[2],
        box,
      });
      map.declarations.set(id, decls);
      continue;
    }

    const ref = REFERENCE_RE.exec(raw);
    if (ref) {
      const kind = ref[1].toLowerCase() as ReferenceSource['kind'];
      mention(ref[2], i);
      map.references.push({ line: i, kind, id: ref[2] });
      if (kind !== 'destroy') mermaidIndex++;
      continue;
    }
    const link = LINK_RE.exec(raw);
    if (link) {
      mention(link[2], i);
      map.references.push({ line: i, kind: 'link', id: link[2] });
      continue;
    }

    if (lower === 'autonumber') {
      if (!/^autonumber(\s+(off|\d+(\s+\d+)?))?$/i.test(t)) fail(`unreadable autonumber: ${t}`);
      map.autonumber.push(i);
      if (!/\boff$/i.test(t)) graph.autonumber = true;
      mermaidIndex++;
      continue;
    }

    if (lower === 'title') {
      const m = /^(\s*title:?\s+)(.*)$/i.exec(raw);
      if (!m) fail(`unreadable title: ${t}`);
      const text = trimmedSpan(raw, m[1].length);
      graph.title = decodeSequenceText(raw.slice(text.start, text.end));
      map.title = { line: i, text };
      continue;
    }
    if (/^acc(Title|Descr)\b/.test(t)) {
      // accDescr { … } spans lines; we leave those diagrams alone.
      if (/^accDescr\s*\{/.test(t)) fail('multi-line accessibility description');
      continue;
    }

    if (lower === 'box') {
      const kwEnd = indent + 3;
      let p = kwEnd;
      while (p < raw.length && /\s/.test(raw[p])) p++;
      const rest = raw.slice(p);
      const cl = leadingColor(rest);
      const color = cl ? { start: p, end: p + cl } : null;
      let q = p + cl;
      while (q < raw.length && /\s/.test(raw[q])) q++;
      const labelSpan = trimmedSpan(raw, q);
      const label = labelSpan.end > labelSpan.start ? labelSpan : null;
      graph.boxes.push({
        label: label ? decodeSequenceText(raw.slice(label.start, label.end)) : '',
        color: color ? raw.slice(color.start, color.end) : null,
        participants: [],
      });
      map.boxes.push({ start: i, end: -1, color, label, keywordEnd: kwEnd });
      stack.push({ kind: 'box', index: graph.boxes.length - 1 });
      continue;
    }

    if (lower in BLOCK_KEYWORDS && /^[A-Za-z_]+(\s|$)/.test(t)) {
      const kind = BLOCK_KEYWORDS[lower];
      const kwStart = indent;
      const kwEnd = kwStart + firstWord.length;
      let ls = kwEnd;
      while (ls < raw.length && /\s/.test(raw[ls])) ls++;
      const label = trimmedSpan(raw, ls);
      const parent = openBlock();
      graph.blocks.push({
        kind,
        label: decodeSequenceText(raw.slice(label.start, label.end)),
        branches: [],
        parent,
        start: graph.events.length,
        end: -1,
        branchStarts: [],
      });
      map.blocks.push({ start: i, label, keyword: { start: kwStart, end: kwEnd }, branches: [], end: -1, endIndex: -1 });
      stack.push({ kind: 'block', index: graph.blocks.length - 1 });
      mermaidIndex++;
      continue;
    }

    if ((lower === 'else' || lower === 'and' || lower === 'option') && /^[A-Za-z_]+(\s|$)/.test(t)) {
      const top = stack[stack.length - 1];
      if (top?.kind !== 'block') fail(`${lower} outside a block`);
      const b = graph.blocks[top.index];
      if (BRANCH_KEYWORD[b.kind] !== lower) fail(`${lower} inside ${b.kind}`);
      const kwEnd = indent + firstWord.length;
      let ls = kwEnd;
      while (ls < raw.length && /\s/.test(raw[ls])) ls++;
      const label = trimmedSpan(raw, ls);
      b.branches.push(decodeSequenceText(raw.slice(label.start, label.end)));
      b.branchStarts.push(graph.events.length);
      map.blocks[top.index].branches.push({ line: i, keyword: { start: indent, end: kwEnd }, label });
      mermaidIndex++;
      continue;
    }

    if (lower === 'end' && t === firstWord) {
      const top = stack.pop();
      if (!top) fail('end without a block');
      if (top.kind === 'box') {
        map.boxes[top.index].end = i;
      } else {
        graph.blocks[top.index].end = graph.events.length;
        map.blocks[top.index].end = i;
        map.blocks[top.index].endIndex = mermaidIndex;
        mermaidIndex++;
      }
      continue;
    }

    // Note.
    const nMatch = NOTE_RE.exec(raw);
    if (nMatch) {
      const pos = nMatch[2].toLowerCase();
      const position: NotePosition = pos === 'left of' ? 'leftOf' : pos === 'right of' ? 'rightOf' : 'over';
      const ids = nMatch[4].split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of ids) mention(id, i);
      const headStart = nMatch[1].length;
      const headEnd = headStart + nMatch[2].length + nMatch[3].length + nMatch[4].length;
      const textStart = headEnd + nMatch[5].length;
      graph.events.push({ kind: 'note', participants: ids, position, text: decodeSequenceText(nMatch[6]) });
      map.events.push({
        kind: 'note',
        line: i,
        mermaidIndex: mermaidIndex++,
        head: { start: headStart, end: headEnd },
        text: trimmedSpan(raw, textStart),
        block: openBlock(),
      });
      continue;
    }

    // Message.
    const mMatch = MESSAGE_RE.exec(raw);
    if (mMatch) {
      const [, ind, from, ws1, delim, ws2, act, ws3, to, ws4, colonPart, ws5] = mMatch;
      const style = MESSAGE_STYLES.find((s) => s.delim === delim)?.style ?? 'other';
      mention(from, i);
      mention(to, i);
      const arrowStart = ind.length + from.length + ws1.length;
      const actStart = arrowStart + delim.length + ws2.length;
      const toEnd = actStart + act.length + ws3.length + to.length;
      const textStart = toEnd + ws4.length + 1 + (ws5?.length ?? 0);
      graph.events.push({
        kind: 'message',
        from,
        to,
        text: colonPart !== undefined ? decodeSequenceText(mMatch[12] ?? '') : '',
        style,
        ...(act === '+' ? { activation: 'activate' as const } : act === '-' ? { activation: 'deactivate' as const } : {}),
      });
      map.events.push({
        kind: 'message',
        line: i,
        mermaidIndex,
        arrow: { start: arrowStart, end: arrowStart + delim.length },
        activation: act ? { start: actStart, end: actStart + 1 } : null,
        toEnd,
        text: colonPart !== undefined ? trimmedSpan(raw, textStart) : null,
        block: openBlock(),
      });
      // An activation mark is a message of its own to mermaid.
      mermaidIndex += act ? 2 : 1;
      continue;
    }

    // Anything else is unparseable.
    fail(`unparseable line: ${t}`);
  }
  if (stack.length) fail('block without end');

  return { ok: true, graph, map };
}

export function parseSequence(source: string): ParseResult {
  const r = parseSequenceSource(source);
  return r.ok ? { ok: true, graph: r.graph } : r;
}
