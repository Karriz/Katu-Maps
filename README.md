<p align="center">
  <img src="apps/map-app/public/icon.svg" alt="Katu Maps icon" width="128">
</p>

# Katu Maps 🗺️

An open 3D map for exploring places, public transport, and routes—directly in the browser.

**[Open Katu Maps](https://karriz.github.io/Katu-Maps/)**

## What it does

- 🏙️ Explore 3D buildings, terrain, trees, and a globe view
- 🚋 Browse transit stops, departures, routes, and live vehicles
- 📷 View Finnish road weather cameras from Fintraffic Digitraffic
- 🚶 Plan walking and cycling routes
- 🔎 Search for addresses, businesses, and points of interest
- 📱 Install it as a PWA on mobile or desktop
- 🌍 Use global map and transit data without an application backend

Katu Maps is under active development. Features and data availability may vary by region.

## Run locally

```sh
cd apps/map-app
npm install
cp .env.example .env.local
npm run dev
```

Finnish Digitransit features require a subscription key in `.env.local`. The global keyless data sources work without one. See [the application documentation](apps/map-app/README.md) for details.

## Data and technology

Built with React, TypeScript, MapLibre GL JS, OpenFreeMap, OpenStreetMap, Mapterhorn, Transitous, Digitransit, Digitraffic, and Valhalla.

Map data and external services remain subject to their own licences, attribution requirements, availability, and usage policies.

## Contributing

Issues, bug reports, and focused pull requests are welcome. Please include clear reproduction steps for bugs and explain the intended user experience for feature proposals.

## Licence

The application code is available under the [MIT License](LICENSE).

The Katu Maps name, logo, and app icon identify the official project. Public forks should use their own name and branding to avoid confusion.
