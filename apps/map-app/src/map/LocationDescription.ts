import type { LocationMetadata } from './LocationMedia';

export type LocationDescription = {
  text: string;
  source: 'osm' | 'wikipedia';
  articleUrl?: string;
};

type WikipediaReference = { language: string; title: string };
type WikidataEntity = { sitelinks?: Record<string, { title?: string }> };

const descriptionCache = new Map<string, LocationDescription>();
const entityCache = new Map<string, Promise<WikidataEntity | undefined>>();

function normalizedLanguage(value: string) {
  return value.trim().toLowerCase().replaceAll('_', '-');
}

export function languageFallbacks(uiLanguages: readonly string[], localLanguages: readonly string[] = []) {
  const candidates = [...uiLanguages, ...localLanguages, 'en'].flatMap((language) => {
    const normalized = normalizedLanguage(language);
    const base = normalized.split('-')[0];
    return normalized === base ? [base] : [normalized, base];
  });
  return [...new Set(candidates.filter((language) => /^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(language)))];
}

export function parseWikipediaTag(tag?: string): WikipediaReference | undefined {
  if (!tag) return undefined;
  const separator = tag.indexOf(':');
  if (separator < 1) return undefined;
  const language = normalizedLanguage(tag.slice(0, separator));
  const title = tag.slice(separator + 1).trim();
  return /^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(language) && title ? { language, title } : undefined;
}

async function wikidataEntity(id: string, signal: AbortSignal) {
  if (!/^Q\d+$/.test(id)) return undefined;
  if (!entityCache.has(id)) {
    const params = new URLSearchParams({ origin: '*', action: 'wbgetentities', format: 'json', ids: id, props: 'sitelinks' });
    const request = fetch(`https://www.wikidata.org/w/api.php?${params}`, { signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Wikidata request failed');
        const data = await response.json() as { entities?: Record<string, WikidataEntity & { missing?: string }> };
        const entity = data.entities?.[id];
        return entity && !('missing' in entity) ? entity : undefined;
      });
    entityCache.set(id, request);
    request.catch(() => entityCache.delete(id));
  }
  return entityCache.get(id)!;
}

export function selectWikipediaSitelink(
  sitelinks: WikidataEntity['sitelinks'],
  uiLanguages: readonly string[],
  localLanguages: readonly string[] = [],
): WikipediaReference | undefined {
  for (const language of languageFallbacks(uiLanguages, localLanguages)) {
    const title = sitelinks?.[`${language}wiki`]?.title;
    if (title) return { language, title };
  }
}

async function wikipediaSummary(reference: WikipediaReference, signal: AbortSignal): Promise<LocationDescription | undefined> {
  const articleUrl = `https://${reference.language}.wikipedia.org/wiki/${encodeURIComponent(reference.title.replaceAll(' ', '_'))}`;
  const url = `https://${reference.language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(reference.title.replaceAll(' ', '_'))}`;
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) return undefined;
  const summary = await response.json() as {
    extract?: string;
    type?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  if (!summary.extract?.trim() || summary.type === 'disambiguation' || (summary.type && summary.type !== 'standard')) return undefined;
  return {
    text: summary.extract.trim(),
    source: 'wikipedia',
    articleUrl: summary.content_urls?.desktop?.page ?? articleUrl,
  };
}

export async function loadLocationDescription(
  metadata: LocationMetadata,
  identity: string,
  signal: AbortSignal,
  uiLanguages: readonly string[] = typeof navigator === 'undefined' ? ['en'] : navigator.languages,
): Promise<LocationDescription | undefined> {
  if (metadata.description?.trim()) return { text: metadata.description.trim(), source: 'osm' };
  const cached = descriptionCache.get(identity);
  if (cached) return cached;

  try {
    let reference = parseWikipediaTag(metadata.wikipedia);
    if (!reference && metadata.wikidata) {
      const entity = await wikidataEntity(metadata.wikidata, signal);
      reference = selectWikipediaSitelink(entity?.sitelinks, uiLanguages, metadata.localLanguages);
    }
    if (!reference || signal.aborted) return undefined;
    const description = await wikipediaSummary(reference, signal);
    if (signal.aborted) return undefined;
    if (description) descriptionCache.set(identity, description);
    return description;
  } catch {
    return undefined;
  }
}

export function clearLocationDescriptionCache() {
  descriptionCache.clear();
  entityCache.clear();
}
