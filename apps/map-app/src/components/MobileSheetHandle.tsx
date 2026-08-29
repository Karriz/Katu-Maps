import { ChevronDown, ChevronUp } from 'lucide-react';
import type { useMobileBottomSheet } from '../lib/useMobileBottomSheet';

type MobileSheetHandleProps = Pick<ReturnType<typeof useMobileBottomSheet>, 'handleProps' | 'setSnap' | 'snap'>;

export function MobileSheetHandle({ handleProps, setSnap, snap }: MobileSheetHandleProps) {
  return (
    <div className="mobile-sheet-handle" role="group" aria-label="Resize panel" {...handleProps}>
      <button type="button" aria-label="Collapse panel" disabled={snap === 'collapsed'} onClick={() => setSnap(snap === 'expanded' ? 'half' : 'collapsed')}>
        <ChevronDown aria-hidden="true" />
      </button>
      <span aria-hidden="true" />
      <button type="button" aria-label="Expand panel" disabled={snap === 'expanded'} onClick={() => setSnap(snap === 'collapsed' ? 'half' : 'expanded')}>
        <ChevronUp aria-hidden="true" />
      </button>
    </div>
  );
}
