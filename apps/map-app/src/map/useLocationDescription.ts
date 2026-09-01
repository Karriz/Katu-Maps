import { useEffect, useState } from 'react';
import { loadLocationDescription, type LocationDescription } from './LocationDescription';
import type { LocationMetadata } from './LocationMedia';

export function useLocationDescription(metadata: LocationMetadata, identity: string) {
  const [description, setDescription] = useState<LocationDescription>();
  const metadataKey = JSON.stringify(metadata);

  useEffect(() => {
    const controller = new AbortController();
    setDescription(metadata.description?.trim() ? { text: metadata.description.trim(), source: 'osm' } : undefined);
    if (!metadata.description && !metadata.wikipedia && !metadata.wikidata) return () => controller.abort();
    loadLocationDescription(metadata, identity, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDescription(result);
    });
    return () => controller.abort();
  // metadataKey makes enrichment react to delayed Nominatim details.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, metadataKey]);

  return description;
}
