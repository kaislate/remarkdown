// Round-trip helpers wrapping prosemirror-markdown's default schema +
// parser + serializer. Phase 1 uses the library defaults — Phase 2+
// will extend the schema with custom node specs (e.g. for HTML
// embedded inside paragraphs and mermaid blocks).
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema,
} from 'prosemirror-markdown';
import type { Node } from 'prosemirror-model';

export const editorSchema = schema;

export function parseMarkdown(md: string): Node {
  const result = defaultMarkdownParser.parse(md);
  if (!result) {
    // The parser only returns null on internal errors — for us, treat
    // it as an empty document so the editor mounts cleanly even on a
    // pathological input.
    return schema.node('doc', null, [schema.node('paragraph')]);
  }
  return result;
}

export function serializeToMarkdown(doc: Node): string {
  // POSIX convention: text files end with `\n`. The default PM-markdown
  // serializer doesn't append one, so we ensure exactly one trailing
  // newline ourselves — otherwise round-tripping a file would strip
  // the final newline on every save.
  const out = defaultMarkdownSerializer.serialize(doc);
  return out.endsWith('\n') ? out : out + '\n';
}
