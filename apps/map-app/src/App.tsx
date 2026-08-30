import { MapView } from './map/MapView';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';

export function App() {
  return (
    <main className="app-shell">
      <section className="map-frame" aria-label="Interactive map">
        <MapView />
        <PwaInstallPrompt />
      </section>
    </main>
  );
}
