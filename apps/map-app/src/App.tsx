import { isPreview, previewLabel } from './lib/Deployment';
import { useState } from 'react';
import { MapView } from './map/MapView';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ThemeProvider } from './theme';

export function App() {
  const [immersiveMode, setImmersiveMode] = useState(false);
  return (
    <ThemeProvider>
      <main className="app-shell" style={isPreview ? { paddingTop: 26 } : undefined}>
        {isPreview && <div className="preview-build-label">{previewLabel}</div>}
        <section className="map-frame" aria-label="Interactive map">
          <MapView onImmersiveModeChange={setImmersiveMode} />
          {!isPreview && !immersiveMode && <PwaInstallPrompt />}
        </section>
      </main>
    </ThemeProvider>
  );
}
