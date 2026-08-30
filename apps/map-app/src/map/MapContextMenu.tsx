import { Info, MapPin, Navigation, Ruler, Star } from 'lucide-react';

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
  return (
    <div
      className="map-context-menu"
      role="menu"
      aria-label="Route options"
      style={{ left: position.x, top: position.y }}
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
