import * as THREE from 'three';

const OSM_ZOOM = 17;
const MAP_RENDER_DIST = 300; // m

const buildingLodFadeIn = 200.0 // m
const buildingLodFadeOut = 400.0 // m

const LAT_LONG_ORIGIN = {lat: -33.887, long: 151.179}; // Sydney
const BUILDING_LEVEL_HEIGHT = 4.0;

const DEBUG_BUILDINGS = false;

const RAD = Math.PI / 180;

function latLongToRenderMetres(lat, long) {
  const R = 6370000;
  const {lat: lat0, long: long0} = LAT_LONG_ORIGIN;
  return [(lat-lat0) * RAD * R, (long-long0) * RAD * R * Math.cos(lat0 * RAD)];
}

function renderMetresToLatLong(x, y) {
  const R = 6370000;
  const {lat: lat0, long: long0} = LAT_LONG_ORIGIN;
  return [y / R / RAD + lat0, x / Math.cos(lat0 * RAD) / R / RAD + long0];
}

// List of Slippy tile IDs (zoom, x, y)
// Within a <dist> circle around <lat, long>
function osmTileList(lat, long, dist) {
  // https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
  const n = Math.pow(2, OSM_ZOOM);
  const xTile = Math.floor(n * (long + 180) / 360);
  const yTile = Math.floor(n * (1 - (Math.log(Math.tan(lat * RAD) + 1/Math.cos(lat * RAD)) / Math.PI)) / 2)

  // TODO use dist
  let tiles = [];
  for (let xd = -1; xd <= 1; xd++) {
    for (let yd = -1; yd <= 1; yd++) {
      tiles.push({zoom: OSM_ZOOM, x: xTile+xd, y: yTile+yd});
    }
  }
  return tiles;
}

function osmTileToLatLong(tileInfo) {
  const {zoom, x, y} = tileInfo;
  const n = Math.pow(2, zoom);
  const band = Math.PI - 2*Math.PI*y/n;
  return {lat: 180 / Math.PI * Math.atan(0.5*(Math.exp(band)-Math.exp(-band))),
          long: (x / n * 360 - 180)};
}

function osmTileToBBox(tileInfo) {
  const {zoom, x, y} = tileInfo;
  return {nw: osmTileToLatLong(tileInfo), se: osmTileToLatLong({zoom, x: x+1, y: y+1})};
}

function osmTileSize(tileInfo) {
  const {nw: {lat: nwLat, long: nwLong}, se: {lat: seLat, long: seLong}} = osmTileToBBox(tileInfo);
  const [nwy, nwx] = latLongToRenderMetres(nwLat, nwLong);
  const [sey, sex] = latLongToRenderMetres(seLat, seLong);
  return {x: sex - nwx, y: nwy - sey};
}

function osmTileUrl(tileInfo) {
  const {zoom, x, y} = tileInfo;
  // FIXME mirror!
  if (!(Number.isFinite(zoom) && Number.isFinite(x) && Number.isFinite(y))) {
    throw Error('osmTileUrl: invalid coords');
  }
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
}

function describeBuilding(building) {
  let name;
  if (building['tags'] !== undefined) {
    if (building['tags']['name']) name = building['tags']['name'];
    else if (building['tags']['building'] && building['tags']['building'] !== 'yes') name = building['tags']['building'];
  }
  return name ?? '';
}

function screenCoords(c) {
  const [x, y] = c;
  return [y, x];
}

class BuildingMap {
  constructor(osm_data) {
    this.nodes = new Map();
    this.buildings = new Map();

    for (const elem of osm_data['elements']) {
      if (elem['type'] === 'node') {
        this.nodes.set(elem['id'], elem)
      }
      if (elem['type'] === 'way' && elem['tags'] !== undefined && elem['tags']['building'] !== undefined) {
        this.buildings.set(elem['id'], elem)
      }
    }

    if (DEBUG_BUILDINGS) console.log(`Loaded ${this.buildings.size} buildings`);
  }

  buildingFootprint(building_id) {
    const nodes = this.buildings.get(building_id)['nodes'];
    let min_lat = null, min_long = null;
    for (const node of nodes) {
      const {lat, lon: long} = this.nodes.get(node);
      if (min_lat === null || lat < min_lat) min_lat = lat;
      if (min_long === null || long < min_long) min_long = long;
    }
    const [min_latM, min_longM] = screenCoords(latLongToRenderMetres(min_lat, min_long));

    const shape = new THREE.Shape();
    if (DEBUG_BUILDINGS) console.log(`Outlining building: ${describeBuilding(this.buildings.get(building_id))}`);
    if (DEBUG_BUILDINGS) console.log(`* Origin: ${min_latM}, ${min_longM}`);
    for (let i = 0; i <= nodes.length; i++) {
      let {lat, lon: long} = this.nodes.get(nodes[i % nodes.length]);
      let [latM, longM] = screenCoords(latLongToRenderMetres(lat, long));
      latM -= min_latM;
      longM -= min_longM;
      if (i === 0) {
        if (DEBUG_BUILDINGS) console.log(`* ${latM}, ${longM}`);
        shape.moveTo(latM, longM);
      } else {
        if (DEBUG_BUILDINGS) console.log(`* ${latM}, ${longM}`);
        shape.lineTo(latM, longM);
      }
    }
    return [shape, [min_latM, min_longM]];
  }

  buildingLevels(building_id) {
    const info = this.buildings.get(building_id)['tags'];
    if (info !== undefined) {
      if (info['building:levels'] !== undefined) {
        return parseFloat(info['building:levels']);
      }
    }
    return null;
  }

  buildingHeight(building_id) {
    const info = this.buildings.get(building_id)['tags'];
    if (info !== undefined) {
      let levelHeight, exactHeight;
      if (info['building:levels'] !== undefined) {
        levelHeight = parseFloat(info['building:levels']) * BUILDING_LEVEL_HEIGHT;
      }
      if (info['height'] !== undefined) {
        exactHeight = parseFloat(info['height']);
      }
      if (levelHeight && exactHeight) {
        // prefer height if both are consistent, otherwise prefer levels (more reliably tagged)
        if (levelHeight > 0.5 * exactHeight && exactHeight > 0.5 * levelHeight) return exactHeight;
        return levelHeight;
      }
      return exactHeight ?? levelHeight ?? null;
    }
    return null;
  }

  buildingName(building_id) {
    return describeBuilding(this.buildings.get(building_id));
  }

  buildingProp(building_id, prop_name) {
    const info = this.buildings.get(building_id);
    if (info !== undefined && info['tags'] !== undefined && info['tags'][prop_name] !== undefined) {
      return info['tags'][prop_name];
    }
    return null;
  }
}

export {
  LAT_LONG_ORIGIN, MAP_RENDER_DIST, BuildingMap,
  latLongToRenderMetres, renderMetresToLatLong,
  osmTileList, osmTileToLatLong, osmTileToBBox, osmTileSize, osmTileUrl,
};
