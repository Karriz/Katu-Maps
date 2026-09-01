import { describe, expect, it } from 'vitest';
import { parseLocationMetadata, safeHttpUrl, wikipediaUrl } from './LocationMedia';

describe('location media metadata', () => {
  it('retains Wikimedia identifiers and normalizes recognized social links', () => {
    expect(parseLocationMetadata({
      wikipedia: 'fi:Näsinneula', wikidata: 'Q11899420', wikimedia_commons: 'Category:Näsinneula',
      'contact:instagram': 'instagram.com/nasinneula', image: 'File:Näsinneula.jpg',
    })).toEqual({
      description: undefined,
      wikipedia: 'fi:Näsinneula', wikidata: 'Q11899420', wikimediaCommons: 'Category:Näsinneula',
      image: 'File:Näsinneula.jpg', localLanguages: [], socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/nasinneula' }],
    });
  });

  it('only reads description links attached directly to the selected feature', () => {
    expect(parseLocationMetadata({
      description: 'A city observation tower.',
      'name:fi': 'Näsinneula',
      'brand:wikipedia': 'en:Särkänniemi',
      'operator:wikidata': 'Q123',
    })).toMatchObject({ description: 'A city observation tower.', localLanguages: ['fi'], wikipedia: undefined, wikidata: undefined });
  });

  it('rejects unsafe and malformed external URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('https://example.com/place')).toBe('https://example.com/place');
    expect(parseLocationMetadata({ facebook: 'javascript:alert(1)' }).socialLinks).toEqual([]);
  });

  it('uses the tagged Wikipedia language', () => {
    expect(wikipediaUrl('fi:Tampereen tuomiokirkko', 'en-US')).toBe('https://fi.wikipedia.org/wiki/Tampereen_tuomiokirkko');
  });
});
