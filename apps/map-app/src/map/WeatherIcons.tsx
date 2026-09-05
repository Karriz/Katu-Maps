import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, type LucideIcon } from 'lucide-react';
import type { WeatherIconKind } from './Weather';

export const WEATHER_ICONS: Record<WeatherIconKind, LucideIcon> = {
  clear: Sun,
  'partly-cloudy': CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudRain,
  rain: CloudRain,
  snow: CloudSnow,
  thunder: CloudLightning,
};

export function WeatherGlyph({ icon, size = 20 }: { icon: WeatherIconKind; size?: number }) {
  const Icon = WEATHER_ICONS[icon];
  return <Icon size={size} strokeWidth={2.2} aria-hidden="true" />;
}
