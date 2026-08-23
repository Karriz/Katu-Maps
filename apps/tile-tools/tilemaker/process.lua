node_keys = {
  "place", "name", "amenity", "shop", "tourism", "natural", "power", "barrier",
  "man_made", "height", "tower:type", "tower:construction",
  "communication:radio", "communication:television",
  "generator:source", "generator:type",
  "leaf_type", "leaf_cycle", "species", "genus"
}
way_keys = {
  "building", "highway", "railway", "waterway", "natural", "landuse",
  "leisure", "amenity", "place", "name", "building:part", "man_made", "aeroway",
  "power", "barrier", "leaf_type", "leaf_cycle", "species", "genus",
  "height", "min_height", "building:levels", "building:colour", "building:color",
  "bridge", "bridge:structure", "bridge:name", "name:bridge", "layer", "tunnel", "covered", "embankment", "cutting", "surface",
  "width", "lanes", "oneway", "lane_markings", "sidewalk", "sidewalk:left", "sidewalk:right",
  "cycleway", "cycleway:left", "cycleway:right",
  "water", "dock", "pier", "quay", "breakwater", "groyne",
  "generator:source", "generator:type",
  "public_transport", "roof:shape", "roof:height", "roof:levels", "roof:colour",
  "roof:color", "roof:material", "roof:orientation", "roof:direction", "tower:type",
  "tower:construction", "communication:radio", "communication:television",
  "religion", "denomination"
}

local named_building_colours = {
  black = "000000",
  blue = "3366aa",
  brown = "8b5a3c",
  beige = "d8c9a7",
  gray = "808080",
  grey = "808080",
  green = "4f8a5b",
  lightgray = "d3d3d3",
  lightgrey = "d3d3d3",
  maroon = "7f3038",
  orange = "e58a3a",
  pink = "e69aaa",
  red = "b94a48",
  silver = "c0c0c0",
  white = "ffffff",
  yellow = "e5c34b"
}

-- OSM commonly maps campuses and graveyards as amenity polygons without a
-- separate landuse tag. Treat the area-like amenities as land use so they do
-- not fall through to the neutral map background.
local amenity_land_classes = {
  grave_yard = "cemetery",
  school = "education",
  college = "education",
  university = "education",
  kindergarten = "education",
  hospital = "healthcare",
  clinic = "healthcare",
  place_of_worship = "religious",
  community_centre = "civic",
  marketplace = "marketplace",
  social_facility = "civic",
  public_building = "civic",
  townhall = "civic"
}

local function parse_building_colour(value)
  local normalized = string.lower(value or ""):gsub("%s+", "")
  local hex = named_building_colours[normalized] or normalized:match("^#?(%x%x%x%x%x%x)$")
  if not hex then
    local short = normalized:match("^#?(%x)(%x)(%x)$")
    if short then
      local red, green, blue = normalized:match("^#?(%x)(%x)(%x)$")
      hex = red .. red .. green .. green .. blue .. blue
    end
  end
  if not hex then
    return nil
  end
  return tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
end

local function pastel_building_colour(value, blend)
  local red, green, blue = parse_building_colour(value)
  if not red then
    return nil
  end
  local target_red, target_green, target_blue = 246, 244, 239
  local function mix(channel, target)
    return math.floor(channel * (1 - blend) + target * blend + 0.5)
  end
  -- OSM colour tags are often vivid or inconsistently named. Keep their
  -- general hue as a cue, but reduce chroma so one tagged building cannot
  -- dominate the otherwise quiet map palette.
  local mixed_red = mix(red, target_red)
  local mixed_green = mix(green, target_green)
  local mixed_blue = mix(blue, target_blue)
  local average = (mixed_red + mixed_green + mixed_blue) / 3
  local function mute(channel)
    return math.floor(average + (channel - average) * 0.42 + 0.5)
  end
  return string.format(
    "#%02x%02x%02x",
    mute(mixed_red),
    mute(mixed_green),
    mute(mixed_blue)
  )
end

local function add_name()
  local name = Find("name")
  if name ~= "" then
    Attribute("name", name)
  end
end

local function add_surface()
  local surface = Find("surface")
  if surface ~= "" then
    Attribute("surface", surface)
  end
end

local function add_optional_height()
  local height = tonumber(Find("height"))
  if height and height > 0 then
    AttributeNumeric("height", height)
  end
end

local function add_generator_metadata()
  local source = Find("generator:source")
  if source ~= "" then
    Attribute("generator_source", source)
  end
  local generator_type = Find("generator:type")
  if generator_type ~= "" then
    Attribute("generator_type", generator_type)
  end
end

local function is_landmark(man_made)
  return man_made == "chimney" or man_made == "water_tower"
    or man_made == "silo" or man_made == "storage_tank"
    or man_made == "gasometer" or man_made == "tower"
    or man_made == "communications_tower"
end

-- Most communication masts in the extract are ordinary mobile-phone poles.
-- Keep the landmark layer focused on structures that should be visible in a
-- city-scale 3D view: tall tagged masts, radio/TV masts, and guyed lattice
-- masts (which are typically the large long-range installations).
local function is_large_communication_mast(man_made)
  if man_made ~= "mast" or Find("tower:type") ~= "communication" then
    return false
  end
  local height = tonumber(Find("height"))
  return (height and height >= 30)
    or Find("tower:construction") == "guyed_lattice"
    or Find("communication:radio") == "yes"
    or Find("communication:television") == "yes"
end

local function add_landmark_metadata(man_made)
  Attribute("class", man_made)
  add_optional_height()
  local tower_type = Find("tower:type")
  if tower_type ~= "" then
    Attribute("tower_type", tower_type)
  end
  local tower_construction = Find("tower:construction")
  if tower_construction ~= "" then
    Attribute("tower_construction", tower_construction)
  end
  add_name()
end

local function add_terrain_metadata()
  local tunnel = Find("tunnel")
  if tunnel ~= "" and tunnel ~= "no" then
    Attribute("tunnel", tunnel)
  end
  local covered = Find("covered")
  if covered ~= "" and covered ~= "no" then
    Attribute("covered", covered)
  end
  local embankment = Find("embankment")
  if embankment ~= "" and embankment ~= "no" then
    Attribute("embankment", embankment)
  end
  local cutting = Find("cutting")
  if cutting ~= "" and cutting ~= "no" then
    Attribute("cutting", cutting)
  end
end

local function add_transport_width()
  local width = tonumber(Find("width"))
  if width and width > 0 then
    AttributeNumeric("width", width)
  end
end

local function add_road_metadata()
  add_transport_width()
  local lanes = tonumber(Find("lanes"))
  if lanes and lanes > 0 then
    AttributeNumeric("lanes", lanes)
  end
  local oneway = Find("oneway")
  if oneway ~= "" then
    Attribute("oneway", oneway)
  end
  local lane_markings = Find("lane_markings")
  if lane_markings ~= "" then
    Attribute("lane_markings", lane_markings)
  end
  for _, key in ipairs({
    "sidewalk", "sidewalk:left", "sidewalk:right",
    "cycleway", "cycleway:left", "cycleway:right"
  }) do
    local value = Find(key)
    if value ~= "" then
      Attribute(key:gsub(":", "_"), value)
    end
  end
end

local function add_bridge_metadata()
  local bridge = Find("bridge")
  if bridge == "" then
    return false
  end
  Attribute("bridge", bridge)
  local structure = Find("bridge:structure")
  if structure ~= "" then
    Attribute("bridge_structure", structure)
  end
  local bridge_name = Find("name:bridge")
  if bridge_name == "" then
    bridge_name = Find("bridge:name")
  end
  if bridge_name ~= "" then
    Attribute("bridge_name", bridge_name)
  end
  local layer = tonumber(Find("layer"))
  if layer then
    AttributeNumeric("layer", layer)
  end
  return true
end

local function building_height()
  local height = tonumber(Find("height"))
  if height and height > 0 then
    return height, "height"
  end

  local levels = tonumber(Find("building:levels"))
  if levels and levels > 0 then
    return levels * 3, "building:levels"
  end

  return 9, "fallback"
end

local function building_base()
  local min_height = tonumber(Find("min_height"))
  if min_height and min_height >= 0 then
    return min_height
  end

  return 0
end

local function building_levels(height, base, roof_height)
  local levels = tonumber(Find("building:levels"))
  if levels and levels > 0 then
    return levels
  end
  local wall_height = height - base - (roof_height or 0)
  return math.max(1, math.floor(math.max(wall_height, 3) / 3 + 0.5))
end

local function is_single_story_transit_building(building, amenity, public_transport)
  return (building == "roof" and (amenity == "shelter" or public_transport == "platform"))
    or building == "transportation"
    or building == "bus_station"
    or building == "tram_stop"
    or building == "subway_entrance"
    or amenity == "shelter"
    or public_transport == "platform"
end

function node_function()
  local place = Find("place")
  if place ~= "" then
    Layer("places", false)
    Attribute("class", place)
    add_name()
    return
  end

  local natural = Find("natural")
  if natural == "tree" then
    Layer("trees", false)
    local leaf_type = Find("leaf_type")
    local species = Find("species")
    if leaf_type ~= "" then
      Attribute("leaf_type", leaf_type)
    end
    if species ~= "" then
      Attribute("species", species)
    end
    local height = tonumber(Find("height"))
    if height and height > 0 then
      AttributeNumeric("height", height)
    end
    return
  end

  local amenity = Find("amenity")
  local shop = Find("shop")
  local tourism = Find("tourism")
  if amenity ~= "" or shop ~= "" or tourism ~= "" then
    Layer("pois", false)
    Attribute("class", amenity ~= "" and amenity or (shop ~= "" and shop or tourism))
    add_name()
  end

  local power = Find("power")
  if power ~= "" then
    Layer("power", false)
    Attribute("class", power)
    add_optional_height()
    if power == "generator" then
      add_generator_metadata()
    end
    add_name()
    return
  end

  local man_made = Find("man_made")
  if is_landmark(man_made) or is_large_communication_mast(man_made) then
    Layer("landmarks", false)
    add_landmark_metadata(man_made)
    return
  end

  local barrier = Find("barrier")
  if barrier ~= "" then
    Layer("barriers", false)
    Attribute("class", barrier)
    local height = tonumber(Find("height"))
    if height and height > 0 then
      AttributeNumeric("height", height)
    end
    return
  end
end

function way_function()
  local man_made = Find("man_made")
  if man_made == "bridge" then
    Layer("bridges", true)
    Attribute("class", "bridge")
    add_name()
    return
  end

  if man_made == "pier" or man_made == "dock" or man_made == "quay"
    or man_made == "breakwater" or man_made == "groyne" then
    Layer("water_structures", IsClosed())
    Attribute("class", man_made)
    add_surface()
    add_name()
    return
  end

  local amenity = Find("amenity")
  local place = Find("place")
  local public_transport = Find("public_transport")
  -- Parking garages are commonly tagged with both amenity=parking and
  -- building=garage. Let those continue through the building branch so they
  -- receive 3D extrusion; standalone parking polygons remain flat surfaces.
  if amenity == "parking" and Find("building") == "" and Find("building:part") == "" then
    Layer("parking", true)
    Attribute("class", "parking")
    add_surface()
    add_name()
    return
  end

  local aeroway = Find("aeroway")
  -- Terminal buildings are often tagged with both aeroway=terminal and
  -- building=terminal. Let those continue through the building branch so
  -- they receive the normal 3D building treatment.
  if aeroway ~= "" and Find("building") == "" and Find("building:part") == "" then
    Layer("aeroway", aeroway ~= "runway" and aeroway ~= "taxiway")
    Attribute("class", aeroway)
    add_transport_width()
    add_surface()
    add_name()
    return
  end

  local power = Find("power")
  if power ~= "" then
    Layer("power", false)
    Attribute("class", power)
    add_optional_height()
    if power == "generator" then
      add_generator_metadata()
    end
    return
  end

  local barrier = Find("barrier")
  if barrier ~= "" then
    Layer("barriers", false)
    Attribute("class", barrier)
    -- Closed boundaries often carry a second area meaning, for example
    -- Kalevankangas is both barrier=wall and landuse=cemetery. Keep processing
    -- those ways so the boundary and its filled land-use polygon are emitted.
    local has_area_classification = IsClosed() and (
      Find("natural") ~= ""
      or Find("landuse") ~= ""
      or Find("leisure") ~= ""
      or amenity_land_classes[amenity] ~= nil
    )
    if not has_area_classification then
      return
    end
  end

  local building = Find("building")
  local building_part = Find("building:part")
  if building ~= "" or building_part ~= "" then
    local height, source = building_height()
    local base = building_base()
    if is_single_story_transit_building(building, amenity, public_transport) then
      height = math.max(base + 3.2, math.min(height, base + 4.2))
      source = "single-story-transit"
    end
    local source_colour = Find("building:colour")
    if source_colour == "" then
      source_colour = Find("building:color")
    end
    local roof_shape = Find("roof:shape")
    local roof_height = tonumber(Find("roof:height"))
    local roof_levels = tonumber(Find("roof:levels"))
    if not roof_height and roof_levels and roof_levels > 0 then
      roof_height = roof_levels * 3
    end
    if not roof_height and roof_shape ~= "" and roof_shape ~= "flat" and roof_shape ~= "none" then
      roof_height = 2.6
    end
    -- building:levels excludes roof levels in OSM Simple 3D Buildings. A
    -- level-derived height is therefore the wall height, while an explicit
    -- height already includes the roof.
    if roof_height and roof_height > 0 and source == "building:levels" then
      height = height + roof_height
    end
    local levels = building_levels(height, base, roof_height)
    if is_single_story_transit_building(building, amenity, public_transport) then
      levels = 1
    end
    Layer("buildings", true)
    AttributeNumeric("height", height)
    AttributeNumeric("base", base)
    AttributeNumeric("levels", levels)
    Attribute("height_source", source)
    Attribute("building", building ~= "" and building or building_part)
    if roof_height and roof_height > 0 then
      roof_height = math.min(roof_height, math.max(height - base - 0.1, 0))
      if roof_height > 0 then
        AttributeNumeric("roof_height", roof_height)
      end
    end
    if roof_shape ~= "" then
      Attribute("roof_shape", roof_shape)
    end
    local roof_orientation = Find("roof:orientation")
    if roof_orientation ~= "" then
      Attribute("roof_orientation", roof_orientation)
    end
    local roof_direction = Find("roof:direction")
    if roof_direction ~= "" then
      Attribute("roof_direction", roof_direction)
    end
    if man_made ~= "" then
      Attribute("man_made", man_made)
    end
    local tower_type = Find("tower:type")
    if tower_type ~= "" then
      Attribute("tower_type", tower_type)
    end
    if amenity ~= "" then
      Attribute("amenity", amenity)
    end
    local source_roof_colour = Find("roof:colour")
    if source_roof_colour == "" then
      source_roof_colour = Find("roof:color")
    end
    if source_roof_colour ~= "" then
      local roof_colour = pastel_building_colour(source_roof_colour, 0.48)
      if roof_colour then
        Attribute("roof_color", roof_colour)
      end
    end
    if source_colour ~= "" then
      local building_colour = pastel_building_colour(source_colour, 0.56)
      local building_colour_alt = pastel_building_colour(source_colour, 0.66)
      if building_colour then
        Attribute("building_color", building_colour)
        Attribute("building_color_alt", building_colour_alt)
      end
    end
    add_name()
    return
  end

  if is_landmark(man_made) or is_large_communication_mast(man_made) then
    Layer("landmarks", IsClosed())
    add_landmark_metadata(man_made)
    return
  end

  local highway = Find("highway")
  if highway ~= "" then
    if highway == "pedestrian" and IsClosed() then
      Layer("pedestrian_areas", true)
      Attribute("class", highway)
      add_surface()
      -- Preserve OSM bridge decks in the basemap even when the optional 3D
      -- bridge model is disabled. The style keeps these polygons visible at
      -- close zoom while ordinary pedestrian plazas transition to custom
      -- transport surfaces.
      add_bridge_metadata()
      add_name()
      return
    end
    if highway == "path" or highway == "footway" or highway == "cycleway" or highway == "track" then
      Layer("paths", false)
    else
      Layer("roads", false)
    end
    Attribute("class", highway)
    add_surface()
    add_road_metadata()
    add_terrain_metadata()
    add_bridge_metadata()
    add_name()
    return
  end

  local railway = Find("railway")
  if railway ~= "" then
    Layer("railways", false)
    Attribute("class", railway)
    add_transport_width()
    add_terrain_metadata()
    add_bridge_metadata()
    add_name()
    return
  end

  local natural = Find("natural")
  local landuse = Find("landuse")
  local leisure = Find("leisure")
  local amenity_land_class = amenity_land_classes[amenity]
  if natural == "water" or landuse == "basin" or landuse == "reservoir" then
    local water = Find("water")
    -- Some OSM imports represent rivers as long, narrow water polygons.
    -- Filled versions of these polygons are prone to malformed triangle
    -- artifacts when tilemaker clips them at tile boundaries. Render the
    -- corresponding waterway line instead.
    local is_linear_water = water == "river" or water == "stream"
      or water == "ditch" or water == "canal" or water == "drain"
    if is_linear_water then
      if water == "river" then
        Layer("river_areas", true)
        Attribute("class", "river")
        Attribute("water", water)
        add_name()
      end
      return
    end
    local is_overview_water = water == "lake" or water == "reservoir"
      or (water == "" and Find("name") ~= "")
    Layer(is_overview_water and "water" or "water_detail", true)
    if not is_overview_water then
      MinZoom(13)
    end
    Attribute("class", natural ~= "" and natural or landuse)
    if water ~= "" then
      Attribute("water", water)
    end
    add_name()
    return
  end

  local waterway = Find("waterway")
  if waterway ~= "" then
    if waterway == "dam" then
      Layer("water_structures", false)
      Attribute("class", "dam")
      add_name()
      return
    end
    Layer("waterways", false)
    Attribute("class", waterway)
    add_name()
    return
  end

  if natural ~= "" or landuse ~= "" or leisure ~= ""
    or amenity_land_class ~= nil or place == "square" then
    Layer("landuse", true)
    local land_class = natural ~= "" and natural
      or (landuse ~= "" and landuse
      or (leisure ~= "" and leisure
      or (amenity_land_class ~= nil and amenity_land_class or place)))
    Attribute("class", land_class)
    local leaf_type = Find("leaf_type")
    local leaf_cycle = Find("leaf_cycle")
    local species = Find("species")
    local genus = Find("genus")
    if leaf_type ~= "" then
      Attribute("leaf_type", leaf_type)
    end
    if leaf_cycle ~= "" then
      Attribute("leaf_cycle", leaf_cycle)
    end
    if species ~= "" then
      Attribute("species", species)
    end
    if genus ~= "" then
      Attribute("genus", genus)
    end
    if natural == "wetland" then
      local wetland = Find("wetland")
      if wetland ~= "" then
        Attribute("wetland", wetland)
      end
    end
    add_name()
  end
end
