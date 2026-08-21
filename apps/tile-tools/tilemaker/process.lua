node_keys = { "place", "name", "amenity", "shop", "tourism", "natural", "power", "barrier" }
way_keys = {
  "building", "highway", "railway", "waterway", "natural", "landuse",
  "leisure", "amenity", "name", "building:part", "man_made", "aeroway",
  "power", "barrier"
}

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

function node_function()
  local place = Find("place")
  if place ~= "" then
    Layer("places", false)
    Attribute("class", place)
    add_name()
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
    Layer("buildings", true)
    AttributeNumeric("height", height)
    AttributeNumeric("base", base)
    Attribute("height_source", source)
    Attribute("building", building ~= "" and building or building_part)
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
    if natural == "wetland" then
      local wetland = Find("wetland")
      if wetland ~= "" then
        Attribute("wetland", wetland)
      end
    end
    add_name()
  end
end
