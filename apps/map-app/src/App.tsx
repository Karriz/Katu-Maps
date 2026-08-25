import { MapView } from './map/MapView';

export function App() {
  return (
    <main className="app-shell">
      <section className="map-frame" aria-label="Interactive map">
        <MapView />
        <div className="map-hint">Drag to pan · scroll to zoom · right-drag to tilt</div>
      </section>
    </main>
  );
}
