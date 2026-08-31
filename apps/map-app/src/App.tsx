import { MapView } from './map/MapView';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ThemeProvider } from './theme';

export function App() {
  return (
    <ThemeProvider>
      <main className="app-shell">
        <section className="map-frame" aria-label="Interactive map">
          <MapView />
          <PwaInstallPrompt />
        </section>
      </main>
    </ThemeProvider>
  );
}
