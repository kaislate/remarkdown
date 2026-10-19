// The per-diagram-type editing contract.
//
// MermaidNodeView (mermaid-node-view.ts) owns what every diagram type
// shares: the wrapper DOM, PM's hidden source, rendering through the
// shared mermaid runtime, the "coming soon" note, the error box, and
// the one sanctioned way to change the source (commit). Everything that
// depends on the KIND of diagram — parsing, which SVG element is which
// item, what a click opens, the floating toolbars — lives in a
// DiagramController, one per type (flowchart-controller.ts,
// sequence-controller.ts, …). The node view creates the controller for
// the detected type and swaps it when the type changes.
//
// Lifecycle, driven by the node view on every render:
//   load(source)   → is this source visually editable? (false = render-
//                    only fallback; the controller then stays dormant)
//   emptyState()   → a placeholder button instead of an (empty) SVG
//   rendered()     → the SVG for the loaded source is in place: inject
//                    hit targets, restore selection, refresh toolbars
//   cleared()      → no SVG to act on (placeholder, render error):
//                    drop selection and hide anything anchored to it
//   click(target)  → a click inside the rendered diagram
import type { MermaidDiagramType } from '../mermaid-detect';

export interface Point {
  x: number;
  y: number;
}

export interface DiagramHost {
  // The node view's wrapper. Popover coordinates are relative to it.
  readonly dom: HTMLElement;
  // Container the SVG is rendered into (contentEditable=false).
  readonly renderedEl: HTMLElement;
  // The block's current source, straight from the document.
  source(): string | null;
  // Replace the block's source — the only sanctioned way to change a
  // diagram (tagged for mermaid-source-guard). No-op when unchanged.
  commit(source: string): void;
  // A host element for floating UI (popover, toolbar, banner). Clicks in
  // it are UI events, not editor input, and PM ignores its mutations.
  createUiHost(className: string): HTMLElement;
  // Where to put a popover for `el`, in wrapper coordinates: to its
  // right ('right') or at its centre ('center').
  anchor(el: Element | null, placement: 'right' | 'center'): Point;
  // The one document-level Escape handler (connect / pick modes);
  // null removes it.
  setEscapeHandler(handler: (() => void) | null): void;
}

export interface EmptyState {
  label: string;
  onActivate: () => void;
}

export interface DiagramController {
  load(source: string): boolean;
  emptyState(): EmptyState | null;
  rendered(): void;
  cleared(): void;
  // Return true when the click was handled (the node view then stops
  // its propagation).
  click(target: Element, event: MouseEvent): boolean;
  destroy(): void;
}

export type ControllerFactory = (host: DiagramHost) => DiagramController;

interface Registration {
  create: ControllerFactory;
  // The same parse the controller's load() does, without a DOM — so
  // "is this diagram editable?" has one answer everywhere.
  canEdit: (source: string) => boolean;
}

const registry = new Map<MermaidDiagramType, Registration>();

export function registerController(type: MermaidDiagramType, create: ControllerFactory, canEdit: (source: string) => boolean): void {
  registry.set(type, { create, canEdit });
}

export function createController(type: MermaidDiagramType, host: DiagramHost): DiagramController | null {
  return registry.get(type)?.create(host) ?? null;
}

export function canEditDiagram(type: MermaidDiagramType, source: string): boolean {
  return registry.get(type)?.canEdit(source) ?? false;
}
