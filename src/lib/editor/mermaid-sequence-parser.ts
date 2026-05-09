// Subset parser for mermaid sequenceDiagram. Supports the syntax the
// editor's visual UI can fully round-trip; anything else returns
// `{ ok: false, reason }` and the NodeView falls back to render-only.
//
// Supported:
//   - `sequenceDiagram` directive
//   - `participant ID` and `participant ID as Display`
//   - 4 message styles: A->B, A->>B, A-->B, A-->>B (all with optional ": text")
//   - Notes: `Note left of X: text`, `Note right of X: text`,
//     `Note over X: text`, `Note over X,Y: text`
//   - Implicit participants (auto-create on first reference in a message)
//   - Blank lines and `%%` comments
//
// Not supported (parser bails to ok:false):
//   - Control blocks (loop, alt/else, opt, par/and, critical, break, rect, box)
//   - actor (stick-figure variant)
//   - activate / deactivate / autonumber
//   - Activation suffixes (A->>+B, A->>-B)
//   - Other arrow variants (-x, --x, -), --))
//   - link/links/properties/details participant decorators
import {
  emptySequenceGraph,
  type SequenceGraph,
  type MessageStyle,
  type NotePosition,
} from './mermaid-sequence-graph';

type ParseResult =
  | { ok: true; graph: SequenceGraph }
  | { ok: false; reason: string };

const ID_RE_SRC = '[A-Za-z][A-Za-z0-9_]*';

// Try styles in priority order so longer prefixes win. `-->>` must beat
// `-->`, `->>` must beat `->`. (Same logic as the flowchart edge
// tokenizer, just with sequence-diagram delimiters.)
const MESSAGE_STYLES: Array<{ delim: string; style: MessageStyle }> = [
  { delim: '-->>', style: 'reply' },
  { delim: '-->',  style: 'dotted' },
  { delim: '->>',  style: 'arrow' },
  { delim: '->',   style: 'solid' },
];

// Regex helper: any of our 4 message arrow delimiters as a single
// alternation. Order matters here — longer prefixes first so `-->>`
// wins over `-->` and `->>` wins over `->`.
const MESSAGE_RE = new RegExp(
  `^\\s*(${ID_RE_SRC})\\s*(-->>|-->|->>|->)\\s*(${ID_RE_SRC})\\s*(?::\\s*(.*))?$`,
);

const NOTE_RE = new RegExp(
  // 1: position keyword, 2: ids, 3: optional text
  `^\\s*Note\\s+(left of|right of|over)\\s+(${ID_RE_SRC}(?:\\s*,\\s*${ID_RE_SRC})?)\\s*:\\s*(.*)$`,
  'i',
);

const PARTICIPANT_RE = new RegExp(
  // 1: id, 2: optional display (everything after `as`)
  `^\\s*participant\\s+(${ID_RE_SRC})(?:\\s+as\\s+(.+?))?\\s*$`,
);

// Things we explicitly reject by leading keyword.
const REJECTED_KEYWORDS = new Set([
  'loop', 'end', 'alt', 'else', 'opt', 'par', 'and',
  'critical', 'option', 'break',
  'rect', 'box', 'actor',
  'activate', 'deactivate',
  'autonumber',
  'link', 'links', 'properties', 'details',
]);

// Things we reject by substring match in a message-like line. Used to
// detect activation suffixes and unsupported arrow variants.
const REJECTED_PATTERNS: RegExp[] = [
  // Activation suffix: `->>+B`, `->>-B`, etc.
  /-+>+\s*[+\-]\s*[A-Za-z]/,
  // Unsupported arrows: -x, --x, -), --)
  /-+x\s*[A-Za-z]/i,
  /-+\)\s*[A-Za-z]/,
];

export function parseSequence(source: string): ParseResult {
  const lines = source.split(/\r?\n/);

  // 1. Find the directive — first non-blank, non-comment line.
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.length === 0 || t.startsWith('%%')) { i++; continue; }
    break;
  }
  if (i >= lines.length) {
    return { ok: false, reason: 'empty source' };
  }
  if (!/^sequenceDiagram\b/.test(lines[i].trim())) {
    return { ok: false, reason: `not a sequenceDiagram: ${lines[i].trim()}` };
  }
  i++;

  // 2. Walk the body.
  const graph: SequenceGraph = emptySequenceGraph();

  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length === 0 || t.startsWith('%%')) continue;

    // Reject explicitly-known unsupported keywords first.
    const firstWord = t.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (REJECTED_KEYWORDS.has(firstWord)) {
      return { ok: false, reason: `unsupported directive: ${t}` };
    }

    // Reject lines containing activation / unsupported-arrow patterns.
    for (const re of REJECTED_PATTERNS) {
      if (re.test(t)) {
        return { ok: false, reason: `unsupported syntax: ${t}` };
      }
    }

    // Try participant.
    const pMatch = PARTICIPANT_RE.exec(t);
    if (pMatch) {
      const id = pMatch[1];
      const display = pMatch[2]?.trim() ?? '';
      if (!graph.participants.has(id)) {
        graph.participants.set(id, { id, display });
      } else {
        // Already declared — keep first-wins for display.
        const existing = graph.participants.get(id)!;
        graph.participants.set(id, {
          ...existing,
          display: existing.display || display,
        });
      }
      continue;
    }

    // Try note.
    const nMatch = NOTE_RE.exec(t);
    if (nMatch) {
      const pos = nMatch[1].toLowerCase();
      const position: NotePosition =
        pos === 'left of' ? 'leftOf'
        : pos === 'right of' ? 'rightOf'
        : 'over';
      const ids = nMatch[2].split(',').map((s) => s.trim()).filter(Boolean);
      const text = nMatch[3];
      // Auto-create implicit participants referenced in a note.
      for (const id of ids) {
        if (!graph.participants.has(id)) {
          graph.participants.set(id, { id, display: '' });
        }
      }
      graph.events.push({
        kind: 'note',
        participants: ids,
        position,
        text,
      });
      continue;
    }

    // Try message.
    const mMatch = MESSAGE_RE.exec(t);
    if (mMatch) {
      const from = mMatch[1];
      const delim = mMatch[2];
      const to = mMatch[3];
      const text = mMatch[4] ?? '';
      const styleEntry = MESSAGE_STYLES.find((s) => s.delim === delim);
      if (!styleEntry) {
        return { ok: false, reason: `unrecognized arrow: ${delim}` };
      }
      // Auto-create implicit participants.
      if (!graph.participants.has(from)) {
        graph.participants.set(from, { id: from, display: '' });
      }
      if (!graph.participants.has(to)) {
        graph.participants.set(to, { id: to, display: '' });
      }
      graph.events.push({
        kind: 'message',
        from,
        to,
        text,
        style: styleEntry.style,
      });
      continue;
    }

    // Anything else is unparseable.
    return { ok: false, reason: `unparseable line: ${t}` };
  }

  return { ok: true, graph };
}
