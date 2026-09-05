import {
  digitrafficJson,
  finiteNumber,
  isRecord,
  pointCoordinates,
  text,
} from './Digitraffic';

export type RoadTrafficMessageKind = 'roadwork' | 'incident';

export type RoadTrafficMessageGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] };

export type RoadTrafficMessageFeature = {
  name: string;
  quantity?: number;
  unit?: string;
};

export type RoadTrafficMessage = {
  id: string;
  kind: RoadTrafficMessageKind;
  name: string;
  title: string;
  location?: string;
  comment?: string;
  coordinates: [number, number];
  geometry: RoadTrafficMessageGeometry;
  municipality?: string;
  province?: string;
  roadNumber?: number;
  roadName?: string;
  direction?: string;
  startTime?: string;
  endTime?: string;
  scheduled: boolean;
  features: RoadTrafficMessageFeature[];
  workTypes: string[];
  workingHours: string[];
  contactPhone?: string;
  contactEmail?: string;
  sender?: string;
};

const MESSAGES_TTL_MS = 2 * 60_000;

const FEATURE_LABELS: Record<string, string> = {
  'Nopeusrajoitus': 'Speed limit',
  'Ajokaista suljettu liikenteeltä': 'Lane closed',
  'Ajokaistoja on kavennettu': 'Lanes narrowed',
  'Liikenne pysäytetään ajoittain': 'Traffic stopped at times',
  'Liikenne pysäytetään': 'Traffic stopped',
  'Liikenne ohjataan vuorotellen tapahtumapaikan ohi': 'Alternating one-way traffic',
  'Paikalla tilapäinen liikennevalo-ohjaus': 'Temporary traffic lights',
  'Ajoneuvon suurin sallittu leveys': 'Maximum width',
  'Ajoneuvon suurin sallittu korkeus': 'Maximum height',
  'Ajoneuvon suurin sallittu pituus': 'Maximum length',
  'Tapahtumapaikalla on käytössä kiertotie': 'Diversion in place',
  'Paikalla on kiertotieopastus': 'Diversion signing',
  'Tie on suljettu liikenteeltä': 'Road closed',
  'Toinen ajorata on suljettu liikenteeltä': 'One carriageway closed',
  'Liikenne on palautumassa normaaliksi': 'Traffic returning to normal',
  'Liikennejärjestelyt ovat muuttuneet': 'Traffic arrangements changed',
  'Liikenne saattaa ruuhkautua': 'Traffic may queue',
  'Lautan kantavuus on muuttunut': 'Ferry capacity changed',
  'Lauttaliikenne keskeytetään huoltotyön ajaksi': 'Ferry service paused for maintenance',
};

const WORK_TYPE_LABELS: Record<string, string> = {
  junction: 'Junction and lane works',
  stabilization: 'Milling / stabilization',
  resurfacing: 'Resurfacing',
  other: 'Roadworks',
};

const DIRECTION_LABELS: Record<string, string> = {
  both: 'Both directions',
  pos: 'One direction',
  neg: 'Opposite direction',
};

const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let messagesCache: { messages: RoadTrafficMessage[]; fetchedAt: number } | null = null;

export function resetRoadTrafficMessageCaches() {
  messagesCache = null;
}

export function situationKind(value: unknown): RoadTrafficMessageKind | undefined {
  const raw = text(value)?.toLowerCase();
  if (raw === 'road work' || raw === 'road_work') return 'roadwork';
  if (raw === 'traffic announcement' || raw === 'traffic_announcement') return 'incident';
  return undefined;
}

export function formatTrafficMessageTitle(title: string, kind: RoadTrafficMessageKind) {
  const cleaned = title
    .replace(/\s*Tietyö\.?\s*$/i, '')
    .replace(/\s*Liikennetiedote(?: onnettomuudesta)?\.?\s*$/i, '')
    .replace(/\s*Tilanne ohi\.?\s*$/i, '')
    .replace(/\s*Tilanne jatkuu\.?\s*$/i, '')
    .replace(/^Tie\s+(\d+)/i, 'Road $1')
    .replace(/,\s*eli\s+/gi, ', ')
    .replace(/\.\s*$/, '')
    .trim();
  return cleaned || (kind === 'roadwork' ? 'Roadworks' : 'Incident');
}

export function formatTrafficMessageFeature(feature: RoadTrafficMessageFeature) {
  const quantity = feature.quantity !== undefined
    ? [String(feature.quantity), feature.unit].filter(Boolean).join(' ')
    : undefined;
  return [feature.name, quantity].filter(Boolean).join(' ');
}

export function formatTrafficMessageWhen(startTime?: string, endTime?: string) {
  const start = formatDateTime(startTime);
  const end = formatDateTime(endTime);
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return undefined;
}

export function representativePoint(geometry: RoadTrafficMessageGeometry): [number, number] | undefined {
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'LineString') {
    const mid = geometry.coordinates[Math.floor((geometry.coordinates.length - 1) / 2)];
    return mid ? [mid[0], mid[1]] : undefined;
  }
  const first = geometry.coordinates[0];
  const mid = first?.[Math.floor((first.length - 1) / 2)];
  return mid ? [mid[0], mid[1]] : undefined;
}

function formatDateTime(value: string | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time));
}

function compactCoordinates(value: unknown): [number, number] | undefined {
  const pair = pointCoordinates(value);
  return pair;
}

function parseGeometry(value: unknown): RoadTrafficMessageGeometry | undefined {
  if (!isRecord(value)) return undefined;
  const type = text(value.type);
  if (type === 'Point') {
    const coordinates = compactCoordinates(value.coordinates);
    return coordinates ? { type: 'Point', coordinates } : undefined;
  }
  if (type === 'LineString' && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.flatMap((point) => {
      const pair = compactCoordinates(point);
      return pair ? [pair] : [];
    });
    return coordinates.length >= 2 ? { type: 'LineString', coordinates } : undefined;
  }
  if (type === 'MultiLineString' && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.flatMap((line) => {
      if (!Array.isArray(line)) return [];
      const pairs = line.flatMap((point) => {
        const pair = compactCoordinates(point);
        return pair ? [pair] : [];
      });
      return pairs.length >= 2 ? [pairs] : [];
    });
    return coordinates.length ? { type: 'MultiLineString', coordinates } : undefined;
  }
  return undefined;
}

function pickAnnouncement(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const announcements = raw.filter(isRecord);
  return announcements.find((item) => text(item.language)?.toLowerCase() === 'en')
    ?? announcements.find((item) => text(item.language)?.toLowerCase() === 'fi')
    ?? announcements[0];
}

function featureLabel(name: string) {
  return FEATURE_LABELS[name] ?? name;
}

function parseFeatures(raw: unknown): RoadTrafficMessageFeature[] {
  if (!Array.isArray(raw)) return [];
  const features: RoadTrafficMessageFeature[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = text(item.name);
    if (!name) continue;
    features.push({
      name: featureLabel(name),
      quantity: finiteNumber(item.quantity),
      unit: text(item.unit),
    });
  }
  return features;
}

function parseWorkTypes(announcement: Record<string, unknown>) {
  const phases = Array.isArray(announcement.roadWorkPhases) ? announcement.roadWorkPhases : [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const phase of phases) {
    if (!isRecord(phase) || !Array.isArray(phase.workTypes)) continue;
    for (const work of phase.workTypes) {
      if (!isRecord(work)) continue;
      const type = text(work.type);
      const description = text(work.description);
      if (type === 'other' && !description) continue;
      const label = (type && type !== 'other' ? WORK_TYPE_LABELS[type] : undefined)
        ?? description
        ?? (type ? WORK_TYPE_LABELS[type] : undefined);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

function parseWorkingHours(announcement: Record<string, unknown>) {
  const phases = Array.isArray(announcement.roadWorkPhases) ? announcement.roadWorkPhases : [];
  const rows: { weekday: string; startTime?: string; endTime?: string }[] = [];
  const seen = new Set<string>();
  for (const phase of phases) {
    if (!isRecord(phase) || !Array.isArray(phase.workingHours)) continue;
    for (const hours of phase.workingHours) {
      if (!isRecord(hours)) continue;
      const weekday = text(hours.weekday);
      const startTime = text(hours.startTime);
      const endTime = text(hours.endTime);
      if (!weekday) continue;
      const key = `${weekday}|${startTime ?? ''}|${endTime ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ weekday, startTime, endTime });
    }
  }
  rows.sort((left, right) => WEEKDAY_ORDER.indexOf(left.weekday) - WEEKDAY_ORDER.indexOf(right.weekday));
  return rows.map((row) => {
    const span = [row.startTime, row.endTime].filter(Boolean).join('–');
    return span ? `${row.weekday.slice(0, 3)} ${span}` : row.weekday;
  });
}

function parseRoadAddress(announcement: Record<string, unknown>) {
  const locationDetails = isRecord(announcement.locationDetails) ? announcement.locationDetails : undefined;
  const roadAddressLocation = locationDetails && isRecord(locationDetails.roadAddressLocation)
    ? locationDetails.roadAddressLocation
    : undefined;
  const primary = roadAddressLocation && isRecord(roadAddressLocation.primaryPoint)
    ? roadAddressLocation.primaryPoint
    : undefined;
  const roadAddress = primary && isRecord(primary.roadAddress) ? primary.roadAddress : undefined;
  return {
    municipality: primary ? text(primary.municipality) : undefined,
    province: primary ? text(primary.province) : undefined,
    roadNumber: roadAddress ? finiteNumber(roadAddress.road) : undefined,
    roadName: primary ? text(primary.roadName) : undefined,
    direction: roadAddressLocation ? DIRECTION_LABELS[text(roadAddressLocation.direction) ?? ''] : undefined,
  };
}

function isCurrentMessage(
  announcementType: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
  now: number,
) {
  if (announcementType === 'ended') return false;
  if (endTime) {
    const end = Date.parse(endTime);
    if (Number.isFinite(end) && end < now) return false;
  }
  return true;
}

export function parseRoadTrafficMessages(payload: unknown, kind: RoadTrafficMessageKind, now = Date.now()): RoadTrafficMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return [];
  const messages: RoadTrafficMessage[] = [];
  for (const feature of payload.features) {
    if (!isRecord(feature)) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const id = text(properties.situationId);
    const geometry = parseGeometry(feature.geometry);
    const announcement = pickAnnouncement(properties.announcements);
    if (!id || !geometry || !announcement) continue;
    const time = isRecord(announcement.timeAndDuration) ? announcement.timeAndDuration : {};
    const startTime = text(time.startTime);
    const endTime = text(time.endTime);
    if (!isCurrentMessage(text(properties.trafficAnnouncementType), startTime, endTime, now)) continue;
    const coordinates = representativePoint(geometry);
    if (!coordinates) continue;
    const title = text(announcement.title) ?? id;
    const address = parseRoadAddress(announcement);
    const start = startTime ? Date.parse(startTime) : Number.NaN;
    messages.push({
      id,
      kind,
      name: formatTrafficMessageTitle(title, kind),
      title: formatTrafficMessageTitle(title, kind),
      location: text(isRecord(announcement.location) ? announcement.location.description : undefined),
      comment: text(announcement.comment),
      coordinates,
      geometry,
      ...address,
      startTime,
      endTime,
      scheduled: Number.isFinite(start) && start > now,
      features: parseFeatures(announcement.features),
      workTypes: parseWorkTypes(announcement),
      workingHours: parseWorkingHours(announcement),
      contactPhone: text(isRecord(properties.contact) ? properties.contact.phone : undefined),
      contactEmail: text(isRecord(properties.contact) ? properties.contact.email : undefined),
      sender: text(announcement.sender),
    });
  }
  return messages;
}

export async function fetchRoadTrafficMessages(signal?: AbortSignal, options?: { bypassCache?: boolean }) {
  const now = Date.now();
  if (!options?.bypassCache && messagesCache && now - messagesCache.fetchedAt < MESSAGES_TTL_MS) {
    return messagesCache.messages;
  }
  const [roadworks, announcements] = await Promise.all([
    digitrafficJson('/api/traffic-message/v2/roadworks', signal),
    digitrafficJson('/api/traffic-message/v2/traffic-announcements', signal),
  ]);
  const messages = [
    ...parseRoadTrafficMessages(roadworks, 'roadwork', now),
    ...parseRoadTrafficMessages(announcements, 'incident', now),
  ];
  messagesCache = { messages, fetchedAt: now };
  return messages;
}
