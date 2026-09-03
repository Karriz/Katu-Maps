import { useState } from 'react';
import { MapView } from './map/MapView';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ThemeProvider } from './theme';

export function App() {
  const [flightMode, setFlightMode] = useState(false);
  return (
    <ThemeProvider>
      <main className="app-shell">
        <section className="map-frame" aria-label="Interactive map">
          <MapView onFlightModeChange={setFlightMode} />
          {!flightMode && <PwaInstallPrompt />}
        </section>
      </main>
    </ThemeProvider>
  );
}
