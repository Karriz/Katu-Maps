# Globe biomes

Source: RESOLVE Ecoregions 2017, Dinerstein et al. (2017), distributed by
OpenLayers: https://openlayers.org/data/vector/ecoregions.json

Source documentation and attribution:
https://github.com/openlayers/data#httpsopenlayersorgdatavectorecoregionsjson
https://doi.org/10.1093/biosci/bix014

License: Creative Commons Attribution 4.0 International
https://creativecommons.org/licenses/by/4.0/

Derived from the already simplified OpenLayers GeoJSON. Kept the biome name
as `biome`, removed other properties and the one unclassified feature, and
rounded coordinates to three decimals. No geometry was invented. The palette
is specific to Katu Maps. These regions describe broad ecological biomes,
not current land use or seasonal vegetation.

The layer softens from 90% opacity at globe scale to 65% at zoom 10 and above,
below detailed hosted map layers. It provides a regional base where OSM areas
are absent; its simplified boundaries are not parcel-level land-cover data.
The application serves this asset directly; no tile server or runtime third-party
download is needed. Visible source attribution is defined in GlobalMapStyle.ts.
