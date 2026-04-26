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

const TextAnchorSchema = AnchorSchema; // Same shape as highlight/note anchors.

const BlockAnchorSchema = z.object({ blockId: z.string() });

const BlockEmAnchorSchema = z.object({
  blockId: z.string(),
  xEm: z.number(),
  yEm: z.number(),
});

export const DrawingShapeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('circle'),
    anchor: TextAnchorSchema,
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('circle-empty'),
    anchor: BlockEmAnchorSchema,
    radiusXEm: z.number(),
    radiusYEm: z.number(),
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('rectangle'),
    anchor: TextAnchorSchema,
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('underline'),
    anchor: TextAnchorSchema,
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('strikethrough'),
    anchor: TextAnchorSchema,
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('margin-bar'),
    anchor: BlockAnchorSchema,
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('freehand'),
    anchor: BlockAnchorSchema,
    points: z.array(z.tuple([z.number(), z.number()])),
    color: z.string(),
    width: z.number(),
  }),
  z.object({
    kind: z.literal('freehand-legacy'),
    anchorBlock: z.string(),
    captureZoom: z.number().default(1.0),
    strokes: z.array(StrokeSchema),
  }),
]);

export const DrawingSchema = z.object({
  id: z.string(),
  type: z.literal('drawing'),
  shape: DrawingShapeSchema,
  recognitionConfidence: z.number().min(0).max(1).optional(),
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
export type DrawingShape = z.infer<typeof DrawingShapeSchema>;
export type Drawing = z.infer<typeof DrawingSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
export type Sidecar = z.infer<typeof SidecarSchema>;

export type Tool = 'cursor' | 'highlight' | 'note' | 'draw' | 'eraser';
