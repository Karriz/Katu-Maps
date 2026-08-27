export type TransitProviderId = 'digitransit' | 'transitous';

export type TransitBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type TransitStop = {
  stopId: string;
  name: string;
  coordinates: [number, number];
  mode: string;
  parentId?: string;
  importance: number;
  provider: TransitProviderId;
};

export type TransitStopSelection = Pick<
  TransitStop,
  'stopId' | 'name' | 'coordinates' | 'mode' | 'provider'
>;

export type TransitDeparture = {
  departure: string;
  mode?: string;
  routeId?: string;
  tripId?: string;
  routeShortName?: string;
  displayName?: string;
  routeLongName?: string;
  headsign?: string;
  routeColor?: string;
  routeTextColor?: string;
  cancelled?: boolean;
  realTime?: boolean;
  serviceDate?: string;
  provider: TransitProviderId;
};

export type TransitTripPlace = {
  name?: string;
  stopName?: string;
  lat?: number;
  lon?: number;
  scheduledArrival?: string | number;
  scheduledDeparture?: string | number;
  arrival?: string | number;
  departure?: string | number;
};

export type TransitTripLeg = {
  tripId?: string;
  startTime?: string;
  endTime?: string;
  realTime?: boolean;
  from?: TransitTripPlace;
  to?: TransitTripPlace;
  intermediateStops?: TransitTripPlace[];
  coordinates: [number, number][];
};

export type TransitTrip = {
  legs: TransitTripLeg[];
};

export type TransitRouteResult = {
  geometry: GeoJSON.LineString;
  distanceKm: number;
  durationSeconds: number;
  departureTime?: string;
  arrivalTime?: string;
  transfers: number;
  provider: TransitProviderId;
  transitLegs: Array<{
    mode: string;
    tripId?: string;
    realTime?: boolean;
    cancelled?: boolean;
    delaySeconds?: number;
    route?: string;
    headsign?: string;
    from?: string;
    to?: string;
    startTime?: string;
    endTime?: string;
    serviceDate?: string;
    provider: TransitProviderId;
  }>;
};

export type TransitRouteOptions = {
  originStopId?: string;
  originStopProvider?: TransitProviderId;
  destinationStopId?: string;
  destinationStopProvider?: TransitProviderId;
  time?: string;
  arriveBy?: boolean;
  signal?: AbortSignal;
};

export interface TransitProvider {
  readonly id: TransitProviderId;
  readonly label: string;
  fetchStops(bounds: TransitBounds, signal?: AbortSignal): Promise<TransitStop[]>;
  searchStops(query: string, bounds: TransitBounds, signal?: AbortSignal): Promise<TransitStop[]>;
  fetchDepartures(stop: TransitStopSelection, signal?: AbortSignal): Promise<TransitDeparture[]>;
  fetchTrip(tripId: string, serviceDate?: string, signal?: AbortSignal): Promise<TransitTrip>;
  fetchRoutes(
    origin: [number, number],
    destination: [number, number],
    options?: TransitRouteOptions,
  ): Promise<TransitRouteResult[]>;
}
