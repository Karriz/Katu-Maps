import { useEffect, useState, type KeyboardEvent } from 'react';

export function nextAutocompleteIndex(current: number, count: number, direction: 1 | -1) {
  if (count === 0) return -1;
  if (direction === 1) return current >= count - 1 ? -1 : current + 1;
  return current <= -1 ? count - 1 : current - 1;
}

/** Keeps focus in a combobox input while navigating its listbox options. */
export function useAutocompleteNavigation({
  count,
  open,
  onSelect,
  onEscape,
  resetKey,
}: {
  count: number;
  open: boolean;
  onSelect: (index: number) => void;
  onEscape: () => void;
  resetKey?: unknown;
}) {
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => setHighlightedIndex(-1), [count, open, resetKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open || count === 0) return;
      event.preventDefault();
      setHighlightedIndex((index) => nextAutocompleteIndex(index, count, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      onSelect(highlightedIndex);
      setHighlightedIndex(-1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      onEscape();
      setHighlightedIndex(-1);
    }
  };

  return { highlightedIndex, setHighlightedIndex, onKeyDown };
}
