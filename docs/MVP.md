# MVP Checklist

The MVP is complete when a user can open the hosted browser application, explore
the global 3D map, search for places, inspect public-transit departures, and
toggle the major visual layers without running local map infrastructure.

## Product

- [x] TypeScript and Vite production build.
- [x] Hosted OpenFreeMap vector map with adaptive globe projection.
- [x] Mapterhorn terrain with regional detail probing and fallback.
- [x] Extruded buildings and deterministic instanced vegetation.
- [x] Place search and OpenStreetMap place details.
- [x] Transit stops, departure times, selected routes, and vehicle progress.
- [x] Pedestrian, bicycle, and car routing.
- [x] Layer controls for terrain, buildings, trees, transit, and scene details.
- [ ] Responsive floating departures and place-information cards.
- [ ] Final brightened map palette and camera-composition pass.

## Definition of done

- A clean checkout builds without a local tile server, data download, or API key.
- Map attribution remains visible.
- Desktop and mobile controls are keyboard accessible and do not obscure core
  map interactions.
- Network-service errors produce recoverable user-facing states.
- Visual changes are compared at consistent coordinates, zoom, pitch, and bearing.
