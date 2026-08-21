node_keys = { "place", "name", "amenity", "shop", "tourism", "natural" }
way_keys = {
  "building", "highway", "railway", "waterway", "natural", "landuse",
  "leisure", "amenity", "name", "building:part", "man_made"
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
  if amenity ~= "" or shop ~= "" then
    Layer("pois", false)
    Attribute("class", amenity ~= "" and amenity or shop)
    add_name()
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

  local waterway = Find("waterway")
  if waterway ~= "" then
    Layer("water", false)
    Attribute("class", waterway)
    add_name()
    return
  end

  local natural = Find("natural")
  local landuse = Find("landuse")
  local leisure = Find("leisure")
  if natural == "water" or landuse == "basin" or landuse == "reservoir" then
    Layer("water", true)
    Attribute("class", natural ~= "" and natural or landuse)
    return
  end

  if natural ~= "" or landuse ~= "" or leisure ~= "" then
    Layer("landuse", true)
    Attribute("class", natural ~= "" and natural or (landuse ~= "" and landuse or leisure))
    add_name()
  end
end
