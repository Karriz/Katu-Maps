export type LocationMetadata = {
  wikipedia?: string;
  wikidata?: string;
  wikimediaCommons?: string;
  image?: string;
  socialLinks?: Array<{ label: string; url: string }>;
};

export type LocationImage = {
  thumbnailUrl: string;
  sourceUrl: string;
  title: string;
  author?: string;
  license?: string;
};

export function safeHttpUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const socialTags: Array<[string, string[]]> = [
  ['Facebook', ['contact:facebook', 'contact_facebook', 'facebook']],
  ['Instagram', ['contact:instagram', 'contact_instagram', 'instagram']],
  ['YouTube', ['contact:youtube', 'contact_youtube', 'youtube']],
  ['Mastodon', ['contact:mastodon', 'contact_mastodon', 'mastodon']],
];

function property(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof properties[key] === 'string' && properties[key].trim()) return properties[key].trim();
  }
}

export function parseLocationMetadata(properties: Record<string, unknown>): LocationMetadata {
  return {
    wikipedia: property(properties, ['wikipedia']),
    wikidata: property(properties, ['wikidata']),
    wikimediaCommons: property(properties, ['wikimedia_commons', 'wikimedia:commons']),
    image: property(properties, ['image']),
    socialLinks: socialTags.flatMap(([label, keys]) => {
      const url = safeHttpUrl(property(properties, keys));
      return url ? [{ label, url }] : [];
    }),
  };
}

export function wikipediaUrl(tag?: string, preferredLanguage = typeof navigator === 'undefined' ? 'en' : navigator.language) {
  if (!tag) return undefined;
  const separator = tag.indexOf(':');
  const taggedLanguage = separator > 0 ? tag.slice(0, separator) : preferredLanguage.split('-')[0];
  const title = separator > 0 ? tag.slice(separator + 1) : tag;
  return safeHttpUrl(`https://${taggedLanguage || 'en'}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`);
}

type CommonsPage = {
  title: string;
  imageinfo?: Array<{
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
  }>;
};

const cache = new Map<string, Promise<LocationImage[]>>();
const stripMarkup = (value?: string) => value?.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim() || undefined;

async function commonsImages(titles: string[], signal: AbortSignal) {
  if (!titles.length) return [];
  const params = new URLSearchParams({
    origin: '*', action: 'query', format: 'json', prop: 'imageinfo',
    iiprop: 'url|extmetadata', iiurlwidth: '900', titles: titles.slice(0, 8).join('|'),
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
  if (!response.ok) throw new Error('Commons request failed');
  const data = await response.json() as { query?: { pages?: Record<string, CommonsPage> } };
  return Object.values(data.query?.pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    return info?.thumburl && info.descriptionurl ? [{
      thumbnailUrl: info.thumburl,
      sourceUrl: info.descriptionurl,
      title: page.title.replace(/^File:/, ''),
      author: stripMarkup(info.extmetadata?.Artist?.value),
      license: stripMarkup(info.extmetadata?.LicenseShortName?.value),
    }] : [];
  });
}

async function categoryTitles(category: string, signal: AbortSignal) {
  const title = category.startsWith('Category:') ? category : `Category:${category}`;
  const params = new URLSearchParams({ origin: '*', action: 'query', format: 'json', list: 'categorymembers', cmtitle: title, cmtype: 'file', cmlimit: '8' });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
  if (!response.ok) throw new Error('Commons category request failed');
  const data = await response.json() as { query?: { categorymembers?: Array<{ title: string }> } };
  return data.query?.categorymembers?.map((item) => item.title) ?? [];
}

async function wikidataImage(id: string, signal: AbortSignal) {
  const params = new URLSearchParams({ origin: '*', action: 'wbgetentities', format: 'json', ids: id, props: 'claims' });
  const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { signal });
  if (!response.ok) throw new Error('Wikidata request failed');
  const data = await response.json() as { entities?: Record<string, { claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> } }> };
  const value = data.entities?.[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return value ? `File:${value}` : undefined;
}

export function loadLocationImages(metadata: LocationMetadata, key: string, signal: AbortSignal) {
  if (cache.has(key)) return cache.get(key)!;
  const request = (async () => {
    const titles: string[] = [];
    if (metadata.image?.startsWith('File:')) titles.push(metadata.image);
    else if (metadata.image?.includes('commons.wikimedia.org/wiki/')) titles.push(decodeURIComponent(metadata.image.split('/wiki/')[1]));
    if (metadata.wikimediaCommons?.startsWith('File:')) titles.push(metadata.wikimediaCommons);
    if (metadata.wikidata) {
      try { const title = await wikidataImage(metadata.wikidata, signal); if (title) titles.push(title); } catch { /* partial failures are non-fatal */ }
    }
    if (metadata.wikimediaCommons && !metadata.wikimediaCommons.startsWith('File:')) {
      try { titles.push(...await categoryTitles(metadata.wikimediaCommons, signal)); } catch { /* partial failures are non-fatal */ }
    }
    try {
      const images = await commonsImages([...new Set(titles)], signal);
      return [...new Map(images.map((item) => [item.sourceUrl, item])).values()].slice(0, 8);
    } catch { return []; }
  })();
  cache.set(key, request);
  request.catch(() => cache.delete(key));
  request.finally(() => { if (signal.aborted) cache.delete(key); });
  return request;
}
