import { SidecarSchema, type Sidecar, type DocumentMeta } from './schema';
import { migrateDrawing } from './drawing-migration';

export type LoadError =
  | { kind: 'parse'; message: string }
  | { kind: 'schema'; message: string };

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
