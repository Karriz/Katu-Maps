import { Info, MapPin, Navigation, Ruler, Star } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

export type MapContextMenuProps = {
  position: { x: number; y: number };
  onPositionInformation: () => void;
  onMeasureDistance: () => void;
  onSaveFavourite: () => void;
  onRouteToHere: () => void;
  onRouteFromHere: () => void;
};

export function MapContextMenu({
  position,
  onPositionInformation,
  onMeasureDistance,
  onSaveFavourite,
  onRouteToHere,
  onRouteFromHere,
}: MapContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const container = menu?.parentElement;
    if (!menu || !container) return;

    const padding = 12;
    const maxLeft = Math.max(padding, container.clientWidth - menu.offsetWidth - padding);
    const maxTop = Math.max(padding, container.clientHeight - menu.offsetHeight - padding);
    const nextPosition = {
      x: Math.min(Math.max(position.x, padding), maxLeft),
      y: Math.min(Math.max(position.y, padding), maxTop),
    };
    setMenuPosition((current) => (
      current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition
    ));
  }, [position.x, position.y]);

  return (
    <div
      ref={menuRef}
      className="map-context-menu"
      role="menu"
      aria-label="Route options"
      style={{ left: menuPosition.x, top: menuPosition.y }}
    >
      <strong><MapPin aria-hidden="true" /> Map point</strong>
      <button type="button" role="menuitem" onClick={onPositionInformation}><Info aria-hidden="true" /> Position information</button>
      <button type="button" role="menuitem" onClick={onMeasureDistance}><Ruler aria-hidden="true" /> Measure distance</button>
      <div className="map-context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={onSaveFavourite}><Star aria-hidden="true" /> Save as favourite</button>
      <div className="map-context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={onRouteToHere}><Navigation aria-hidden="true" /> Route to here</button>
      <button type="button" role="menuitem" onClick={onRouteFromHere}><Navigation aria-hidden="true" /> Route from here</button>
    </div>
  );
}
