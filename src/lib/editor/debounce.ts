// Generic debouncer used by the editor's autosave path. Coalesces a
// burst of edits into a single delayed write, with flush() so we can
// force a final save when the user toggles edit mode off.

export interface Debounced<TArgs extends unknown[]> {
  (...args: TArgs): void;
  flush(): void;
  cancel(): void;
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): Debounced<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  const wrapped = (...args: TArgs) => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pendingArgs;
      pendingArgs = null;
      if (a) fn(...a);
    }, ms);
  };

  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingArgs) {
      const a = pendingArgs;
      pendingArgs = null;
      fn(...a);
    }
  };

  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  return wrapped as Debounced<TArgs>;
}
