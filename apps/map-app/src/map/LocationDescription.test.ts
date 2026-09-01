import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLocationDescriptionCache,
  languageFallbacks,
  loadLocationDescription,
  parseWikipediaTag,
  selectWikipediaSitelink,
} from './LocationDescription';

describe('location descriptions', () => {
  beforeEach(() => clearLocationDescriptionCache());
  afterEach(() => vi.unstubAllGlobals());

  it('uses deterministic UI, local, and English language fallbacks', () => {
    expect(languageFallbacks(['pt-BR', 'fi'], ['sv'])).toEqual(['pt-br', 'pt', 'fi', 'sv', 'en']);
    expect(selectWikipediaSitelink({ svwiki: { title: 'Platsen' }, enwiki: { title: 'Place' } }, ['de-DE'], ['sv']))
      .toEqual({ language: 'sv', title: 'Platsen' });
  });

  it('accepts exact Wikipedia tags and rejects malformed ones', () => {
    expect(parseWikipediaTag('fi:Tampereen tuomiokirkko')).toEqual({ language: 'fi', title: 'Tampereen tuomiokirkko' });
    expect(parseWikipediaTag('not an exact article')).toBeUndefined();
    expect(parseWikipediaTag('evil.example:Tampere')).toBeUndefined();
  });

  it('prioritizes an OSM description without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadLocationDescription({ description: '  Exact OSM text  ', wikipedia: 'fi:Ignored' }, 'osm-1', new AbortController().signal))
      .resolves.toEqual({ text: 'Exact OSM text', source: 'osm' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads and caches a plain-text summary from a direct article', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'standard', extract: 'A factual summary.', content_urls: { desktop: { page: 'https://fi.wikipedia.org/wiki/Paikka' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    const expected = { text: 'A factual summary.', source: 'wikipedia', articleUrl: 'https://fi.wikipedia.org/wiki/Paikka' };
    await expect(loadLocationDescription({ wikipedia: 'fi:Paikka' }, 'node-1', signal)).resolves.toEqual(expected);
    await expect(loadLocationDescription({ wikipedia: 'fi:Paikka' }, 'node-1', signal)).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves Wikidata sitelinks and ignores failures and disambiguation pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entities: { Q42: { sitelinks: { fiwiki: { title: 'Douglas Adams' } } } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ type: 'disambiguation', extract: 'Ambiguous.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadLocationDescription({ wikidata: 'Q42' }, 'node-42', new AbortController().signal, ['fi']))
      .resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not publish a result after selection cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      controller.abort();
      return { ok: true, json: async () => ({ type: 'standard', extract: 'Stale summary.' }) };
    }));
    await expect(loadLocationDescription({ wikipedia: 'en:Old place' }, 'old', controller.signal)).resolves.toBeUndefined();
  });
});
