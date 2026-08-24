import { MapView } from './map/MapView';

export function App() {
  const usingLocalData = import.meta.env.VITE_MAP_DATA_PROVIDER === 'local';

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">
            {usingLocalData ? 'OpenStreetMap · Tampere' : 'OpenFreeMap · Global terrain'}
          </p>
          <h1>3D Map Prototype</h1>
        </div>
        <span className="status-pill">
          {usingLocalData ? 'Local data' : 'Global globe · browser only'}
        </span>
      </header>

      <section className="map-frame" aria-label="Interactive map">
        <MapView />
        <div className="map-hint">Drag to pan · scroll to zoom · right-drag to tilt</div>
      </section>
    </main>
  );
}
