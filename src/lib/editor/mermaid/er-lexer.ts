// A port of mermaid 11.14's erDiagram jison lexer
// (src/diagrams/er/parser/erDiagram.jison): same states, same rules,
// same order, case-insensitive like the original. See class-lexer.ts.
import type { Tok } from './class-lexer';

type Action = (lx: Lexer, text: string) => string | null;

class Lexer {
  states: string[] = ['INITIAL'];
  begin(s: string): void {
    this.states.push(s);
  }
  pop(): void {
    if (this.states.length > 1) this.states.pop();
  }
  get state(): string {
    return this.states[this.states.length - 1];
  }
}

const tok = (t: string): Action => () => t;
const skip: Action = () => null;
// Rules returning `yytext[0]`: the character itself is the token.
const char: Action = (_lx, text) => text[0];

const R: Array<[string, Action]> = [
  /* 0 */ ['accTitle\\s*:\\s*', (lx) => (lx.begin('acc_title'), 'acc_title')],
  /* 1 */ ['(?!\\n||)*[^\\n]*', (lx) => (lx.pop(), 'acc_title_value')],
  /* 2 */ ['accDescr\\s*:\\s*', (lx) => (lx.begin('acc_descr'), 'acc_descr')],
  /* 3 */ ['(?!\\n||)*[^\\n]*', (lx) => (lx.pop(), 'acc_descr_value')],
  /* 4 */ ['accDescr\\s*\\{\\s*', (lx) => (lx.begin('acc_descr_multiline'), null)],
  /* 5 */ ['[\\}]', (lx) => (lx.pop(), null)],
  /* 6 */ ['[^\\}]*', tok('acc_descr_multiline_value')],
  /* 7 */ ['.*direction\\s+TB[^\\n]*', tok('direction_tb')],
  /* 8 */ ['.*direction\\s+BT[^\\n]*', tok('direction_bt')],
  /* 9 */ ['.*direction\\s+RL[^\\n]*', tok('direction_rl')],
  /* 10 */ ['.*direction\\s+LR[^\\n]*', tok('direction_lr')],
  /* 11 */ ['[\\n]+', tok('NEWLINE')],
  /* 12 */ ['\\s+', skip],
  /* 13 */ ['[\\s]+', tok('SPACE')],
  /* 14 */ ['"[^"%\\r\\n\\v\\b\\\\]+"', tok('ENTITY_NAME')],
  /* 15 */ ['"[^"]*"', tok('WORD')],
  /* 16 */ ['erDiagram\\b', tok('ER_DIAGRAM')],
  /* 17 */ ['\\{', (lx) => (lx.begin('block'), 'BLOCK_START')],
  /* 18 */ ['#', tok('BRKT')],
  /* 19 */ ['#', tok('BRKT')],
  /* 20 */ [',', tok('COMMA')],
  /* 21 */ [':::', tok('STYLE_SEPARATOR')],
  /* 22 */ [':', tok('COLON')],
  /* 23 */ ['\\s+', skip],
  /* 24 */ ['\\b((?:PK)|(?:FK)|(?:UK))\\b', tok('ATTRIBUTE_KEY')],
  /* 25 */ ['([^\\s]*)[~].*[~]([^\\s]*)', tok('ATTRIBUTE_WORD')],
  /* 26 */ ['([\\*A-Za-z_\\u00C0-\\uFFFF][A-Za-z0-9\\-\\_\\[\\]\\(\\)\\u00C0-\\uFFFF\\*]*)', tok('ATTRIBUTE_WORD')],
  /* 27 */ ['"[^"]*"', tok('COMMENT')],
  /* 28 */ ['[\\n]+', skip],
  /* 29 */ ['\\}', (lx) => (lx.pop(), 'BLOCK_STOP')],
  /* 30 */ ['.', char],
  /* 31 */ ['\\[', tok('SQS')],
  /* 32 */ ['\\]', tok('SQE')],
  /* 33 */ ['style\\b', (lx) => (lx.begin('style'), 'STYLE')],
  /* 34 */ ['[\\n]+', (lx) => (lx.pop(), 'NEWLINE')],
  /* 35 */ ['\\s+', skip],
  /* 36 */ [':', tok('COLON')],
  /* 37 */ [',', tok('COMMA')],
  /* 38 */ ['#', tok('BRKT')],
  /* 39 */ ['classDef\\b', (lx) => (lx.begin('style'), 'CLASSDEF')],
  /* 40 */ ['class\\b', tok('CLASS')],
  /* 41 */ ['one or zero\\b', tok('ZERO_OR_ONE')],
  /* 42 */ ['one or more\\b', tok('ONE_OR_MORE')],
  /* 43 */ ['one or many\\b', tok('ONE_OR_MORE')],
  /* 44 */ ['1\\+', tok('ONE_OR_MORE')],
  /* 45 */ ['\\|o\\b', tok('ZERO_OR_ONE')],
  /* 46 */ ['zero or one\\b', tok('ZERO_OR_ONE')],
  /* 47 */ ['zero or more\\b', tok('ZERO_OR_MORE')],
  /* 48 */ ['zero or many\\b', tok('ZERO_OR_MORE')],
  /* 49 */ ['0\\+', tok('ZERO_OR_MORE')],
  /* 50 */ ['\\}o\\b', tok('ZERO_OR_MORE')],
  /* 51 */ ['many\\(0\\)', tok('ZERO_OR_MORE')],
  /* 52 */ ['many\\(1\\)', tok('ONE_OR_MORE')],
  /* 53 */ ['many\\b', tok('ZERO_OR_MORE')],
  /* 54 */ ['\\}\\|', tok('ONE_OR_MORE')],
  /* 55 */ ['one\\b', tok('ONLY_ONE')],
  /* 56 */ ['only one\\b', tok('ONLY_ONE')],
  /* 57 */ ['[0-9]+\\.[0-9]+', tok('DECIMAL_NUM')],
  /* 58 */ ['1(?=\\s+[A-Za-z_"\'])', tok('ONLY_ONE')],
  /* 59 */ ['1(?=\\s+[0-9])', tok('ONLY_ONE')],
  /* 60 */ ['1(?=(--|\\.\\.|\\.-|-\\.))', tok('ONLY_ONE')],
  /* 61 */ ['1\\b', tok('ENTITY_ONE')],
  /* 62 */ ['[0-9]+', tok('NUM')],
  /* 63 */ ['\\|\\|', tok('ONLY_ONE')],
  /* 64 */ ['o\\|', tok('ZERO_OR_ONE')],
  /* 65 */ ['o\\{', tok('ZERO_OR_MORE')],
  /* 66 */ ['\\|\\{', tok('ONE_OR_MORE')],
  /* 67 */ ['u(?=[\\.\\-\\|])', tok('MD_PARENT')],
  /* 68 */ ['\\.\\.', tok('NON_IDENTIFYING')],
  /* 69 */ ['--', tok('IDENTIFYING')],
  /* 70 */ ['to\\b', tok('IDENTIFYING')],
  /* 71 */ ['optionally to\\b', tok('NON_IDENTIFYING')],
  /* 72 */ ['\\.-', tok('NON_IDENTIFYING')],
  /* 73 */ ['-\\.', tok('NON_IDENTIFYING')],
  /* 74 */ ['([^\\x00-\\x7F]|\\w|-|\\*)+', tok('STYLE_TEXT')],
  /* 75 */ [';', tok('SEMI')],
  /* 76 */ ['([^\\x00-\\x7F]|\\w|-|\\*|\\.)+', tok('UNICODE_TEXT')],
  /* 77 */ ['.', char],
  /* 78 */ ['$', tok('EOF')],
];

// Anchored at the start of the remaining input, like jison.
const RULES = R.map(([src, act]) => ({ re: new RegExp(`^(?:${src})`, 'i'), act }));

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const STATES: Record<string, number[]> = {
  style: [34, 35, 36, 37, 38, 74, 75],
  acc_descr_multiline: [5, 6],
  acc_descr: [3],
  acc_title: [1],
  block: range(23, 30),
  INITIAL: [0, 2, 4, ...range(7, 22), 31, 32, 33, 39, ...range(40, 73), 76, 77, 78],
};

export function lexEr(text: string, start: number): { ok: true; tokens: Tok[] } | { ok: false; at: number } {
  const lx = new Lexer();
  const tokens: Tok[] = [];
  let pos = start;
  let guard = 0;
  for (;;) {
    if (++guard > 1_000_000) return { ok: false, at: pos };
    const rest = text.slice(pos);
    let matched = false;
    for (const idx of STATES[lx.state]) {
      const rule = RULES[idx];
      const m = rule.re.exec(rest);
      if (!m) continue;
      const before = lx.states.length;
      const type = rule.act(lx, m[0]);
      const t = { type: type ?? '', text: m[0], start: pos, end: pos + m[0].length };
      pos += m[0].length;
      matched = true;
      if (type) {
        tokens.push(t);
        if (type === 'EOF') return { ok: true, tokens };
      } else if (m[0].length === 0 && lx.states.length === before) {
        return { ok: false, at: pos };
      }
      break;
    }
    if (!matched) {
      // jison: no rule matched on empty input is the end.
      if (pos >= text.length) {
        tokens.push({ type: 'EOF', text: '', start: pos, end: pos });
        return { ok: true, tokens };
      }
      return { ok: false, at: pos };
    }
  }
}
