import './App.css';
import React from 'react';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import shadowIcon from 'leaflet/dist/images/marker-shadow.png'

import * as THREE from 'three';
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Paper } from "react-three-paper";

import mapData from './Camperdown small.json'

/* This code is needed to properly load the images in the Leaflet CSS */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: shadowIcon,
});

const initialPosition = [-33.885, 151.178] // Sydney
//const initialPosition = [51.505, -0.09] // London
const sydneyCityBbox = [
  -33.920, 151.155, -33.850, 151.235
]

const LAT_LONG_ORIGIN = initialPosition;
const BUILDING_LEVEL_HEIGHT = 3.0;

function latLongToMetres(lat, long) {
  const R = 6370000;
  const RAD = Math.PI / 180;
  const [lat0, long0] = LAT_LONG_ORIGIN;
  return [(lat-lat0) * RAD * R, (long-long0) * RAD * R * Math.cos(lat0 * RAD)];
}

function describeBuilding(building) {
  if (building['tags'] !== undefined) {
    return building['tags']['name'] ?? building['tags']['building'] ?? '';
  }
  return '';
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

  buildingHeight(building_id) {
    const info = this.buildings.get(building_id)['tags'];
    if (info !== undefined) {
      if (info['height'] !== undefined) return parseFloat(info['height']);
      if (info['building:levels'] !== undefined) return parseFloat(info['building:levels']) * BUILDING_LEVEL_HEIGHT;
    }
    return 0;
  }
}

const buildingMap = new BuildingMap(mapData);

async function threeMain(canvas)
{
  // Setup canvas
  const renderer = new THREE.WebGLRenderer({
      canvas,
      antialiasing: true,
  });

  const aspectRatio = canvas.clientWidth / canvas.clientHeight;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  // Setup camera
  const fov = 90;
  const near = 0.1;
  const far = 1000;
  const camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
  camera.position.set(0, 0, 100);
  camera.up = new THREE.Vector3( 0, 1, 0 );
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; // Enables inertia on the camera making it come to a more gradual stop.
  controls.dampingFactor = 0.25; // Inertia factor

  // Setup scene
  const scene = new THREE.Scene();
  {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({color: 0x44aa88});
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
  }

  for (const [building_id, _] of buildingMap.buildings)
  {
    const [footprint, [originX, originY]] = buildingMap.buildingFootprint(building_id);
    const height = buildingMap.buildingHeight(building_id);
    let geometry;
    if (height > 0) {
      const extrudeSettings = {
        steps: 1,
        depth: height,
        bevelEnabled: true,
        bevelThickness: 0.5,
        bevelSize: 0.5,
        bevelOffset: 0,
        bevelSegments: 1
      };
      geometry = new THREE.ExtrudeGeometry( footprint, extrudeSettings );
    } else {
      geometry = new THREE.ShapeGeometry( footprint );
    }
    const material = new THREE.MeshBasicMaterial( { color: 0xffdddd } );
    const mesh = new THREE.Mesh( geometry, material ) ;
    mesh.position.set(originX, originY, 0);
    scene.add( mesh );
  }

  if (false)
  {
    const heartShape = new THREE.Shape();
    const x = 0, y = 0;
    heartShape.moveTo( 5, 5 );
    heartShape.bezierCurveTo( 5, 5, 4, y, x, y );
    heartShape.bezierCurveTo( - 6, y, x - 6, 7,x - 6, 7 );
    heartShape.bezierCurveTo( - 6, 11, x - 3, 15.4, 5, 19 );
    heartShape.bezierCurveTo( 12, 15.4, 16, 11, 16, 7 );
    heartShape.bezierCurveTo( 16, 7, 16, y, 10, y );
    heartShape.bezierCurveTo( 7, y, 5, 5, 5, 5 );

    const geometry = new THREE.ShapeGeometry( heartShape );
    const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
    const mesh = new THREE.Mesh( geometry, material ) ;
    scene.add( mesh );
  }

  //...Render loop without requestAnimationFrame()
  function render(time) {
    controls.update()
    renderer.render(scene, camera);
  }

  //...Any cleanup youd like (optional)
  function cleanup() {

  }

  return { render, cleanup }
}

function OSM() {
  return (
    <MapContainer center={initialPosition} zoom={16} scrollWheelZoom={true}>
      <TileLayer
        attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={initialPosition}>
        <Popup>
          A pretty CSS3 popup. <br /> Easily customizable.
        </Popup>
      </Marker>
    </MapContainer>
  )
}

function App() {
  return (
    <div className="container">
      <div className="App">
        <h1>Hi</h1>
      </div>

      <Paper
          script={threeMain}
          style={{height: '800px', width: '1000px'}}
      />
    </div>
  );
}

export default App;
