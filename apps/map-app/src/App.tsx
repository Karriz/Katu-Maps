import { isPreview, previewLabel } from './lib/Deployment';
import { useState } from 'react';
import { MapView } from './map/MapView';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ThemeProvider } from './theme';

export function App() {
  const [flightMode, setFlightMode] = useState(false);
  return (
    <ThemeProvider>
      <main className="app-shell" style={isPreview ? { paddingTop: 26 } : undefined}>
        {isPreview && <div className="preview-build-label">{previewLabel}</div>}
        <section className="map-frame" aria-label="Interactive map">
          <MapView onFlightModeChange={setFlightMode} />
          {!isPreview && !flightMode && <PwaInstallPrompt />}
        </section>
      </main>
    </ThemeProvider>
  );
}
