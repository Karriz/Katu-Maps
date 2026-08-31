import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Navigation, Share2, Star } from 'lucide-react';
import { InfoActionRow } from './InfoActionRow';

describe('InfoActionRow', () => {
  it('renders the common action contract with consistent button semantics', () => {
    const markup = renderToStaticMarkup(
      <InfoActionRow actions={[
        { label: 'Save', icon: Star, onClick: vi.fn() },
        { label: 'Share', icon: Share2, onClick: vi.fn() },
        { label: 'Directions', icon: Navigation, onClick: vi.fn(), tone: 'primary' },
      ]} />,
    );

    expect(markup).toContain('class="info-action-row"');
    expect(markup).toContain('class="info-action-button secondary"');
    expect(markup).toContain('class="info-action-button primary"');
    expect(markup).toContain('>Save</button>');
    expect(markup).toContain('>Share</button>');
    expect(markup).toContain('>Directions</button>');
  });

  it('keeps favorite icon actions accessible and supports disabled actions', () => {
    const markup = renderToStaticMarkup(
      <InfoActionRow actions={[
        { label: 'Edit favourite', icon: Star, onClick: vi.fn(), iconOnly: true },
        { label: 'Save', icon: Star, onClick: vi.fn(), disabled: true },
      ]} />,
    );

    expect(markup).toContain('aria-label="Edit favourite"');
    expect(markup).toContain('title="Edit favourite"');
    expect(markup).toContain('class="info-action-button secondary icon-only"');
    expect(markup).toContain('disabled=""');
  });
});
