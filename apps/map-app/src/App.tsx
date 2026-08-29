import { MapView } from './map/MapView';

export function App() {
  return (
    <main className="app-shell">
      <section className="map-frame" aria-label="Interactive map">
        <MapView />
      </section>
    </main>
  );
}
