import './App.css';
import React from 'react';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import shadowIcon from 'leaflet/dist/images/marker-shadow.png'

import * as THREE from 'three';
import { Paper } from "react-three-paper";

/* This code is needed to properly load the images in the Leaflet CSS */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: shadowIcon,
});

const sydneyCityBbox = [
  -33.920, 151.155, -33.850, 151.235
]

const initialPosition = [-33.885, 151.200]
//const initialPosition = [51.505, -0.09]


async function threeMain(canvas) // 👈 Your ThreeJS script
{
  //...Do ThreeJS stuff
  const renderer = new THREE.WebGLRenderer({
      canvas: canvas, // 👈 Use canvas as the ThreeJS canvas
  });

  // 👇 Use canavs dimentions insted of window
  const aspectRatio = canvas.clientWidth / canvas.clientHeight;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  const fov = 75;
  const near = 0.1;
  const far = 5;
  const camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
  camera.position.z = 2;

  const scene = new THREE.Scene();
  const boxWidth = 1;
  const boxHeight = 1;
  const boxDepth = 1;
  const geometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
  const material = new THREE.MeshBasicMaterial({color: 0x44aa88});
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  //...Render loop without requestAnimationFrame()
  function render() {
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
