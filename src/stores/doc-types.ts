// Shape of a loaded document. Lives in its own module so sessions.ts can
// reference it without importing doc.ts (which imports sessions.ts).
export interface DocState {
  path: string;
  dir: string;
  sha256: string;
  bytes: number;
  markdown: string;
  html: string;
  plaintext: string;
  blocks: string[];
  sidecarRaw: string | null;
}
