import { useEffect, useState } from 'react';
import { loadLocationImages, type LocationImage, type LocationMetadata } from './LocationMedia';

export function useLocationMedia(metadata: LocationMetadata, identity: string) {
  const [images, setImages] = useState<LocationImage[]>([]);
  const metadataKey = JSON.stringify(metadata);
  useEffect(() => {
    const controller = new AbortController();
    setImages([]);
    if (!metadata.image && !metadata.wikimediaCommons && !metadata.wikidata) return () => controller.abort();
    loadLocationImages(metadata, identity, controller.signal).then((result) => {
      if (!controller.signal.aborted) setImages(result);
    });
    return () => controller.abort();
  // metadataKey makes enrichment react to the delayed Nominatim details.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, metadataKey]);
  return images;
}
