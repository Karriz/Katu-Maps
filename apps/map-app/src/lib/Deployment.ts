export const isPreview = import.meta.env.VITE_APP_PREVIEW === 'true';
export const previewLabel = import.meta.env.VITE_PREVIEW_LABEL || 'Preview';

export function deploymentStorageKey(key: string, preview = isPreview) {
  return preview ? `katu-preview:${key}` : key;
}
