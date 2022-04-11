import * as THREE from 'three';

const initialPosition = [-33.887, 151.179] // Sydney

const buildingLodFadeIn = 200.0 // m
const buildingLodFadeOut = 400.0 // m

const LAT_LONG_ORIGIN = initialPosition;
const BUILDING_LEVEL_HEIGHT = 4.0;

function latLongToMetres(lat, long) {
  const R = 6370000;
  const RAD = Math.PI / 180;
  const [lat0, long0] = LAT_LONG_ORIGIN;
  return [(lat-lat0) * RAD * R, (long-long0) * RAD * R * Math.cos(lat0 * RAD)];
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

    console.log(`Loaded ${this.buildings.size} buildings`);
  }

  buildingFootprint(building_id) {
    const nodes = this.buildings.get(building_id)['nodes'];
    let min_lat = null, min_long = null;
    for (const node of nodes) {
      const {lat, lon: long} = this.nodes.get(node);
      if (min_lat === null || lat < min_lat) min_lat = lat;
      if (min_long === null || long < min_long) min_long = long;
    }
    const [min_latM, min_longM] = screenCoords(latLongToMetres(min_lat, min_long));

    const shape = new THREE.Shape();
    console.log(`Outlining building: ${describeBuilding(this.buildings.get(building_id))}`);
    console.log(`* Origin: ${min_latM}, ${min_longM}`);
    for (let i = 0; i <= nodes.length; i++) {
      let {lat, lon: long} = this.nodes.get(nodes[i % nodes.length]);
      let [latM, longM] = screenCoords(latLongToMetres(lat, long));
      latM -= min_latM;
      longM -= min_longM;
      if (i === 0) {
        console.log(`* ${latM}, ${longM}`);
        shape.moveTo(latM, longM);
      } else {
        console.log(`* ${latM}, ${longM}`);
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

export { initialPosition, LAT_LONG_ORIGIN, BuildingMap };
