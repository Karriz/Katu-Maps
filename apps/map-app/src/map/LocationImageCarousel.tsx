import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { LocationImage } from './LocationMedia';

export function LocationImageCarousel({ images }: { images: LocationImage[] }) {
  const [index, setIndex] = useState(0);
  if (!images.length) return null;
  const current = images[Math.min(index, images.length - 1)];
  const move = (amount: number) => setIndex((value) => (value + amount + images.length) % images.length);
  return <section className="location-media" aria-label="Wikimedia images" onKeyDown={(event) => {
    if (event.key === 'ArrowLeft') move(-1);
    if (event.key === 'ArrowRight') move(1);
  }} tabIndex={0}>
    <img src={current.thumbnailUrl} alt={current.title} loading="lazy" width="900" height="600" />
    {images.length > 1 && <>
      <button type="button" className="previous" aria-label="Previous image" onClick={() => move(-1)}><ChevronLeft /></button>
      <button type="button" className="next" aria-label="Next image" onClick={() => move(1)}><ChevronRight /></button>
    </>}
    <div className="location-media-caption">
      <span>{index + 1}/{images.length}{current.author ? ` · ${current.author}` : ''}{current.license ? ` · ${current.license}` : ''}</span>
      <a href={current.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="View image and attribution on Wikimedia Commons"><ExternalLink size={14} /> Commons</a>
    </div>
  </section>;
}
