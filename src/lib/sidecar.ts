import { SidecarSchema, type Sidecar, type DocumentMeta } from './schema';
import { migrateDrawing } from './drawing-migration';

// Every annotation is found again in the article on each change, so a
// crafted sidecar with a huge number of them could freeze the app. Nobody
// marks up one document 20,000 times. A sidecar over the limit is refused
// whole rather than trimmed: the caller offers to back it up, and nothing
// in the file is lost.
export const MAX_ANNOTATIONS = 20_000;

export type LoadError =
  | { kind: 'parse'; message: string }
  | { kind: 'schema'; message: string }
  | { kind: 'too-many'; message: string };

export type LoadResult =
  | { ok: true; value: Sidecar }
  | { ok: false; error: LoadError };

export function loadSidecar(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: (e as Error).message } };
  }
  // Counted before migrating and validating, which cost time per annotation.
  const list = (parsed as { annotations?: unknown } | null)?.annotations;
  if (Array.isArray(list) && list.length > MAX_ANNOTATIONS) {
    return {
      ok: false,
      error: { kind: 'too-many', message: `${list.length} annotations (the limit is ${MAX_ANNOTATIONS})` },
    };
  }
  // Migrate legacy drawings before schema validation.
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { annotations?: unknown[] }).annotations)) {
    const obj = parsed as { annotations: unknown[] };
    obj.annotations = obj.annotations.map((a) => {
      if (a && typeof a === 'object' && (a as { type?: string }).type === 'drawing') {
        return migrateDrawing(a as Record<string, unknown>);
      }
      return a;
    });
  }
  const validated = SidecarSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: { kind: 'schema', message: validated.error.message },
    };
  }
  return { ok: true, value: validated.data };
}

export function serializeSidecar(sidecar: Sidecar): string {
  return JSON.stringify(sidecar, null, 2) + '\n';
}

export function emptySidecar(doc: DocumentMeta): Sidecar {
  return {
    _comment: `remarkdown annotations for: ${doc.path}`,
    $schema: 'remarkdown/v1',
    document: doc,
    annotations: [],
  };
}
