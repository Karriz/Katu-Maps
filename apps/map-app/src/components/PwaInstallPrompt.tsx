import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createBrowserInstallOffer, type PwaInstallOffer } from '../lib/PwaInstallOffer';

export function PwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const offerRef = useRef<PwaInstallOffer | null>(null);

  useEffect(() => {
    const offer = createBrowserInstallOffer(setVisible);
    offerRef.current = offer;
    offer.start();
    return () => {
      offer.stop();
      offerRef.current = null;
    };
  }, []);

  if (!visible) return null;

  return (
    <aside className="pwa-install-card" aria-label="Install Katu Maps">
      <span className="pwa-install-icon" aria-hidden="true"><Download /></span>
      <div className="pwa-install-copy">
        <strong>Install Katu Maps</strong>
        <span>Keep the map close at hand.</span>
      </div>
      <div className="pwa-install-actions">
        <button className="pwa-install-primary" type="button" onClick={() => void offerRef.current?.install()}>
          Install
        </button>
        <button type="button" onClick={() => offerRef.current?.dismiss()}>Not now</button>
      </div>
    </aside>
  );
}
