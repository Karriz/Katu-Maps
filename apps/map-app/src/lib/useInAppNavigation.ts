import { useEffect, useRef } from 'react';

const HISTORY_KEY = '__mapsUiView';

/**
 * Mirrors meaningful, dismissible UI views into browser history. Returning to
 * the immediately preceding view through an on-screen control consumes the
 * corresponding entry instead of creating a duplicate one.
 */
export function useInAppNavigation(view: string | null, dismissCurrentView: (parentView: string | null) => void) {
  const viewRef = useRef(view);
  const dismissRef = useRef(dismissCurrentView);
  const stackRef = useRef<Array<string | null>>([null]);
  const syncingRef = useRef(false);

  viewRef.current = view;
  dismissRef.current = dismissCurrentView;

  useEffect(() => {
    const existing = window.history.state as Record<string, unknown> | null;
    if (!existing?.[HISTORY_KEY]) {
      window.history.replaceState({ ...existing, [HISTORY_KEY]: 'map' }, '');
    }

    const onPopState = () => {
      if (syncingRef.current) {
        syncingRef.current = false;
        stackRef.current.pop();
        return;
      }
      if (!viewRef.current) return;
      stackRef.current.pop();
      dismissRef.current(stackRef.current.at(-1) ?? null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const stack = stackRef.current;
    const current = stack.at(-1) ?? null;
    if (view === current) return;

    // A visible Back/Close control has already restored the parent view. Move
    // the browser cursor with it, and ignore the resulting popstate callback.
    if (stack.length > 1 && stack.at(-2) === view) {
      syncingRef.current = true;
      window.history.back();
      return;
    }

    if (!view) return;
    stack.push(view);
    const existing = window.history.state as Record<string, unknown> | null;
    window.history.pushState({ ...existing, [HISTORY_KEY]: view }, '');
  }, [view]);
}
