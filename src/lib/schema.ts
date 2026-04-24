import { z } from 'zod';

export const AnchorSchema = z.object({
  text: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  blockHint: z.string(),
});

export const HighlightSchema = z.object({
  id: z.string(),
  type: z.literal('highlight'),
  color: z.string(),
  anchor: AnchorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const NoteSchema = z.object({
  id: z.string(),
  type: z.literal('note'),
  anchor: AnchorSchema,
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const StrokeSchema = z.object({
  color: z.string(),
  width: z.number(),
  points: z.array(z.tuple([z.number(), z.number()]).rest(z.number())),
});

export const DrawingSchema = z.object({
  id: z.string(),
  type: z.literal('drawing'),
  anchorBlock: z.string(),
  caption: z.string().optional(),
  strokes: z.array(StrokeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AnnotationSchema = z.discriminatedUnion('type', [
  HighlightSchema,
  NoteSchema,
  DrawingSchema,
]);

export const DocumentMetaSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  lastSeenBytes: z.number().int().nonnegative(),
});

// passthrough() preserves unknown fields for forward compatibility.
export const SidecarSchema = z
  .object({
    _comment: z.string().optional(),
    $schema: z.string(),
    document: DocumentMetaSchema,
    annotations: z.array(AnnotationSchema),
  })
  .passthrough();

export type Anchor = z.infer<typeof AnchorSchema>;
export type Highlight = z.infer<typeof HighlightSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type Drawing = z.infer<typeof DrawingSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
export type Sidecar = z.infer<typeof SidecarSchema>;

export type Tool = 'cursor' | 'highlight' | 'note' | 'draw' | 'eraser';
