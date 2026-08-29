import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { useMobileBottomSheet } from '../lib/useMobileBottomSheet';

type MobileSheetHandleProps = Pick<ReturnType<typeof useMobileBottomSheet>, 'handleProps' | 'setSnap' | 'snap'> & {
  closeLabel: string;
  onClose: () => void;
};

export function MobileSheetHandle({ closeLabel, handleProps, onClose, setSnap, snap }: MobileSheetHandleProps) {
  return (
    <div className="mobile-sheet-handle" role="group" aria-label="Resize panel" {...handleProps}>
      <button type="button" aria-label="Collapse panel" disabled={snap === 'collapsed'} onClick={() => setSnap(snap === 'expanded' ? 'half' : 'collapsed')}>
        <ChevronDown aria-hidden="true" />
      </button>
      <span aria-hidden="true" />
      <button type="button" aria-label="Expand panel" disabled={snap === 'expanded'} onClick={() => setSnap(snap === 'collapsed' ? 'half' : 'expanded')}>
        <ChevronUp aria-hidden="true" />
      </button>
      <button className="mobile-sheet-close" type="button" aria-label={closeLabel} onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
