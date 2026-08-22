node_keys = {
  "place", "name", "amenity", "shop", "tourism", "natural", "power", "barrier",
  "leaf_type", "leaf_cycle", "species", "genus"
}
way_keys = {
  "building", "highway", "railway", "waterway", "natural", "landuse",
  "leisure", "amenity", "name", "building:part", "man_made", "aeroway",
  "power", "barrier", "leaf_type", "leaf_cycle", "species", "genus",
  "height", "min_height", "building:levels", "building:colour", "building:color",
  "public_transport", "roof:shape", "roof:height", "roof:levels", "roof:colour",
  "roof:color", "roof:material", "roof:orientation", "roof:direction", "tower:type",
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
  return string.format(
    "#%02x%02x%02x",
    mix(red, target_red),
    mix(green, target_green),
    mix(blue, target_blue)
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
    add_name()
    return
  end

  local barrier = Find("barrier")
  if barrier ~= "" then
    Layer("barriers", false)
    Attribute("class", barrier)
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

  local amenity = Find("amenity")
  local public_transport = Find("public_transport")
  if amenity == "parking" then
    Layer("parking", true)
    Attribute("class", "parking")
    add_surface()
    add_name()
    return
  end

  local aeroway = Find("aeroway")
  if aeroway ~= "" then
    Layer("aeroway", aeroway ~= "runway" and aeroway ~= "taxiway")
    Attribute("class", aeroway)
    add_name()
    return
  end

  local power = Find("power")
  if power ~= "" then
    Layer("power", false)
    Attribute("class", power)
    return
  end

  local barrier = Find("barrier")
  if barrier ~= "" then
    Layer("barriers", false)
    Attribute("class", barrier)
    return
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

  local highway = Find("highway")
  if highway ~= "" then
    if highway == "pedestrian" and IsClosed() then
      Layer("pedestrian_areas", true)
      Attribute("class", highway)
      add_surface()
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
    add_name()
    return
  end

  local railway = Find("railway")
  if railway ~= "" then
    Layer("railways", false)
    Attribute("class", railway)
    add_name()
    return
  end

  local natural = Find("natural")
  local landuse = Find("landuse")
  local leisure = Find("leisure")
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
    Layer("waterways", false)
    Attribute("class", waterway)
    add_name()
    return
  end

  if natural ~= "" or landuse ~= "" or leisure ~= "" then
    Layer("landuse", true)
    local land_class = natural ~= "" and natural or (landuse ~= "" and landuse or leisure)
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
