# MVP Checklist

The MVP is complete when a user can open the application in a desktop browser,
view a limited Tampere area, tilt and rotate the camera, see OSM-derived
buildings extruded over DEM terrain, and toggle an experimental vegetation layer.

## First vertical slice

- [ ] TypeScript web project builds on desktop browsers.
- [ ] MapLibre GL JS is integrated.
- [ ] Tampere map opens with pan, zoom, pitch, and rotation.
- [ ] Tiny checked-in fixtures render without a network connection.
- [ ] Tampere OSM vector tiles render roads, water, land use, railways, paths,
      labels, and buildings.
- [ ] Building heights are normalized from OSM tags with a visible fallback.
- [ ] NLS DEM sample renders in terrain mode.
- [ ] Buildings and linear features align with terrain.
- [ ] Forest/park vegetation renders using instanced LOD geometry.
- [ ] Profiling results are recorded for representative desktop browsers.

## Definition of done for each slice

Every slice must have a reproducible input manifest, visible attribution, a
small automated fixture/test where practical, and a short note about memory and
frame-time impact. New data providers should be added through an adapter rather
than directly from QML.
