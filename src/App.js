import './App.css';
import React from 'react';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import shadowIcon from 'leaflet/dist/images/marker-shadow.png'

import * as THREE from 'three';
import { MyMapControls } from './MyMapControls';
import { Paper } from "react-three-paper";

import GUI from 'lil-gui';
import { Rnd } from 'react-rnd';

import * as Plot from "@observablehq/plot";
import { PlotFigure } from 'plot-react';

import mapData from './Camperdown small.json'
import mapBaseImage from './Camperdown small.png'

/* This code is needed to properly load the images in the Leaflet CSS */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: shadowIcon,
});

const initialPosition = [-33.887, 151.179] // Sydney
//const initialPosition = [51.505, -0.09] // London
const sydneyCityBbox = [
  -33.920, 151.155, -33.850, 151.235
]

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
    return 'unknown';
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
      return exactHeight ?? levelHeight;
    }
    return 0;
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

const buildingMap = new BuildingMap(mapData);

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

class WorldClock {
  constructor(latDeg, longDeg) {
    this.latDeg = latDeg;
    this.longDeg = longDeg;

    this.day = 1; // 1 ... 365
    this.hour = 12.0; // 0 ... 24

    this.dayName = 'Jan 01'; // fake - GUI only

    this.autoplay = ''; // '', 'day', 'hour'
  }

  setGuiControllers(guiDay, guiDayName, guiHour) {
    this.guiDay = guiDay;
    this.guiDayName = guiDayName;
    this.guiHour = guiHour;
    this.guiDay.onChange(newDay => { this.updateDayName(newDay); });
  }

  updateDayName(newDay) {
    // stringify - use 1970 for max precision (note this year has 365 days)
    const newDate = new Date(1970, 0, 1);
    newDate.setTime(new Date(1970, 0, 1).getTime() + (newDay - 1) * 86400000);
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    this.dayName = MONTH_NAMES[newDate.getMonth()] + ' ' + String(newDate.getDate()).padStart(2, '0');

    this.guiDayName?.updateDisplay();
  }

  setDay(newDay) {
    this.day = newDay;
    this.guiDay?.updateDisplay();
    this.updateDayName(newDay);
  }

  setHour(newHour) {
    this.hour = newHour;
    this.guiHour?.updateDisplay();
  }

  sunAngle(day, hour)
  {
    day = day?? this.day;
    hour = hour?? this.hour;
    // Ref: https://www.itacanet.org/the-sun-as-a-source-of-energy/
    const declination = 23.45*DEG * Math.sin(2*Math.PI * (284 + day + hour / 24.0) / 365.25);
    const hourAngle = (12 - hour) * 15*DEG; // approx
    const altitudeAngle = Math.asin(Math.sin(declination) * Math.sin(this.latDeg*DEG) + Math.cos(declination) * Math.cos(hourAngle) * Math.cos(this.latDeg*DEG));
    const azimuth = Math.acos(Math.min(1.0, (Math.sin(declination) * Math.cos(this.latDeg*DEG) - Math.cos(declination) * Math.sin(this.latDeg*DEG) * Math.cos(hourAngle)) / Math.cos(altitudeAngle)));
    return {hourAngle, altitudeAngle, azimuth: (hourAngle > 0 ? azimuth : -azimuth)};
  }
};
const worldClock = new WorldClock(LAT_LONG_ORIGIN[0], LAT_LONG_ORIGIN[1]);

const mvpGui = new GUI();
const mvpGui_Day = mvpGui.add(worldClock, 'day', 1, 365, 1);
const mvpGui_DayName = mvpGui.add(worldClock, 'dayName');
mvpGui_DayName.disable();
const mvpGui_Hour = mvpGui.add(worldClock, 'hour', 0, 24, 0.1);
mvpGui.add(worldClock, 'autoplay', ['', 'hour', 'day']);

worldClock.setGuiControllers(mvpGui_Day, mvpGui_DayName, mvpGui_Hour);


function getCanvasRelativePosition(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width  / rect.width,
    y: (event.clientY - rect.top ) * canvas.height / rect.height,
  };
}

class PickHelper {
  constructor() {
    this.raycaster = new THREE.Raycaster();
    this.pickedObject = null;
    this.pickedObjectSavedColor = 0;
    this.pickPosition = null; // or {x, y}
  }

  pick(normalizedPosition, scene, camera) {
    // restore the color if there is a picked object
    if (this.pickedObject) {
      this.pickedObject.material.emissive.setHex(this.pickedObjectSavedColor);
      this.pickedObject = undefined;
    }

    if (!normalizedPosition) return;

    // cast a ray through the frustum
    this.raycaster.setFromCamera(normalizedPosition, camera);
    // get the list of objects the ray intersected
    const intersectedObjects = this.raycaster.intersectObjects(scene.children);
    if (intersectedObjects.length) {
      // pick the first object. It's the closest one
      // First, check if it is pickable
      if (!intersectedObjects[0].object.pickData) return;

      this.pickedObject = intersectedObjects[0].object.pickData.pickObject;
      // save its color
      this.pickedObjectSavedColor = this.pickedObject.material.emissive.getHex();
      // add some emissive color (our existing buildings are not emissive so this is OK for now)
      this.pickedObject.material.emissive.setHex(0x666666);
    }
  }

  setPickPosition(canvas, event) {
    const pos = getCanvasRelativePosition(canvas, event);
    this.pickPosition = {
      x: (pos.x / canvas.width ) *  2 - 1,
      y: (pos.y / canvas.height) * -2 + 1,  // note we flip Y
    }
  }

  clearPickPosition() {
    this.pickPosition = null;
  }
}

const pickHelper = new PickHelper();
const PICK_ON_CLICK = true;

function threeMainSetup(stateChangeCallbacks) {
  const {onPickObject, onSunAngleChanged, onFrame} = stateChangeCallbacks;

  async function threeMain(canvas)
  {
    // Setup canvas
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialiasing: true,
    });

    const aspectRatio = canvas.clientWidth / canvas.clientHeight;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    renderer.shadowMap.enabled = true;

    // Setup camera
    const fov = 90;
    const near = 0.1;
    const far = 1000;
    const camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
    camera.position.set(0, 0, 400);
    camera.up = new THREE.Vector3( 0, 1, 0 );
    camera.lookAt(0, 0, 0);

    const controls = new MyMapControls(camera, renderer.domElement);
    controls.enableDamping = false; // Enables inertia on the camera making it come to a more gradual stop.
    controls.dampingFactor = 0.25; // Inertia factor
    controls.screenSpacePanning = false;

    // Setup scene
    const scene = new THREE.Scene();
    const textureLoader = new THREE.TextureLoader();
    {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshLambertMaterial({color: 0x44aa88});
      const cube = new THREE.Mesh(geometry, material);
      scene.add(cube);
    }

    {
      const ground = new THREE.PlaneGeometry(1000, 1000);
      console.log(`loading base texture: ${mapBaseImage}`);
      const material = new THREE.MeshLambertMaterial({map: textureLoader.load(mapBaseImage)});
      const mesh = new THREE.Mesh(ground, material).translateZ(-0.1);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    for (const [building_id] of buildingMap.buildings)
    {
      const [footprint, [originX, originY]] = buildingMap.buildingFootprint(building_id);
      const height = buildingMap.buildingHeight(building_id);
      let geometry;
      if (height > 0) {
        const extrudeSettings = {
          steps: 1,
          depth: height,
          bevelEnabled: false,
          bevelThickness: 0.5,
          bevelSize: 0.5,
          bevelSegments: 1,
        };
        geometry = new THREE.ExtrudeGeometry( footprint, extrudeSettings );
      } else {
        geometry = new THREE.ShapeGeometry( footprint );
      }

      // building material
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh( geometry, material ) ;
      mesh.position.set(originX, originY, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.pickData = {building_id, pickObject: mesh};
      scene.add( mesh );

      // building outline
      if (true) {
        const edges = new THREE.EdgesGeometry( geometry );
        const edgesMat = new THREE.LineBasicMaterial({color: 0x000000 });
        const edgesMesh = new THREE.LineSegments(edges, edgesMat);
        edgesMesh.position.set(originX, originY, 0);
        edgesMesh.pickData = {pickObject: mesh}; // redirect to main object
        scene.add(edgesMesh);
      }
    }

    // Lighting
    if(true)
    {
      const color = 0xFFFFFF;
      const intensity = 0.2;
      const light = new THREE.AmbientLight(color, intensity);
      scene.add(light);
    }

    const debugSunDisk = [];
    const sunLights = [];
    function updateSunPosition() {
      const {hourAngle, altitudeAngle, azimuth} = worldClock.sunAngle();
      onSunAngleChanged({hourAngle, altitudeAngle, azimuth});

      const lightDistance = 200; // FIXME: should be just outside scene
      for (const light of sunLights) {
        light.position.set(0, 0, lightDistance);
        const zenith = altitudeAngle - Math.PI/2;
        light.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), zenith);
        light.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), -azimuth);
        if (altitudeAngle < 0) {
          light.intensity = 0;
        } else {
          light.intensity = 1;
        }
      }

      // debug sun disk
      let sunDiskPoint = new THREE.Vector3();
      for (let h = 0; h < 24; h++) {
        const {altitudeAngle, azimuth} = worldClock.sunAngle(worldClock.day, h);
        sunDiskPoint.set(0, 0, lightDistance);
        const zenith = altitudeAngle - Math.PI/2;
        sunDiskPoint.applyAxisAngle(new THREE.Vector3(1, 0, 0), zenith);
        sunDiskPoint.applyAxisAngle(new THREE.Vector3(0, 0, 1), -azimuth);
        if (debugSunDisk.length < 24) {
          const endpoints = new Float32Array(2 * 3);
          new THREE.Vector3(0, 0, 0).toArray(endpoints, 0 * 3);
          const lineGeom = new THREE.BufferGeometry();
          lineGeom.setAttribute('position', new THREE.BufferAttribute(endpoints, 3));
          const lineMat = new THREE.LineBasicMaterial({color: 0xffcccc});
          const line = new THREE.Line(lineGeom, lineMat);
          scene.add(line);
          debugSunDisk.push(line);
        }
        {
          const line = debugSunDisk[h];
          sunDiskPoint.toArray(line.geometry.attributes.position.array, 1 * 3);
          line.geometry.attributes.position.needsUpdate = true;
        }
      }
    }

    const sky_light_offset = 50;
    for (const [dx, dy, color] of [
        [0, 0, 0xFFFFCC],
        //[1, 1, 0x102040], [1, -1, 0x102040], [-1, 1, 0x102040], [-1, -1, 0x102040]
      ])
    {
      const intensity = 1;
      const light = new THREE.DirectionalLight(color, intensity);
      light.target.position.set(dx*sky_light_offset, dy*sky_light_offset, 0);
      light.castShadow = true;

      {
        const sphere = new THREE.SphereGeometry(5, 16, 8);
        const lightMat = new THREE.MeshBasicMaterial({color: 0xffffdd, emissive: 0xffffdd});
        const lightBulb = new THREE.Mesh(sphere, lightMat);
        light.add(lightBulb);
      }

      scene.add(light);
      scene.add(light.target);
      sunLights.push(light);

      const helper = new THREE.DirectionalLightHelper(light, 10);
      scene.add(helper);

      light.shadow.camera.left = -200;
      light.shadow.camera.right = 200;
      light.shadow.camera.bottom = -200;
      light.shadow.camera.top = 200;
      const cameraHelper = new THREE.CameraHelper(light.shadow.camera);
      scene.add(cameraHelper);
    }
    updateSunPosition(); // initialise

    // Setup picking
    if (PICK_ON_CLICK) {
      let mouseDownAt = null;
      // Ignore drag events (from camera controller). Yuck!
      canvas.addEventListener('mousedown', (event) => {
        if (event.button === 0) mouseDownAt = {x: event.clientX, y: event.clientY}
      });
      canvas.addEventListener('mouseup', (event) => {
        if (event.button === 0 && mouseDownAt && event.clientX == mouseDownAt.x && event.clientY == mouseDownAt.y) {
          pickHelper.setPickPosition(canvas, event);
          pickHelper.pick(pickHelper.pickPosition, scene, camera);
          onPickObject(pickHelper.pickedObject);
          mouseDownAt = null;
        }
      });
    } else {
      canvas.addEventListener('mousemove', (event) => pickHelper.setPickPosition(canvas, event));
      canvas.addEventListener('mouseout', (event) => pickHelper.clearPickPosition());
      canvas.addEventListener('mouseleave', (event) => pickHelper.clearPickPosition());
    }

    // Other rendering helpers
    function resizeRendererToDisplaySize(renderer) {
      const canvas = renderer.domElement;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const needResize = canvas.width !== width || canvas.height !== height;
      if (needResize) {
        renderer.setSize(width, height, false);
      }
      return needResize;
    }

    const axesHelper = new THREE.AxesHelper(50);
    scene.add( axesHelper );

    //...Render loop without requestAnimationFrame()
    function render(timeMs) {
      if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
      }

      if (!PICK_ON_CLICK) {
        const lastPicked = pickHelper.pickedObject;
        pickHelper.pick(pickHelper.pickPosition, scene, camera);
        if (lastPicked !== pickHelper.pickedObject) {
          onPickObject(pickHelper.pickedObject);
        }
      }

      controls.update();

      if (worldClock.autoplay === 'day') {
        worldClock.setDay((worldClock.day + 1) % 365 + 1);
      } else if (worldClock.autoplay === 'hour') {
        for (let i = 0; i < 20; i++) { // fast forward night
          worldClock.setHour((Math.round(worldClock.hour*10) + 1) % 240 / 10.0);
          if (worldClock.hour < 0.0001) {
            worldClock.setHour(0);
            worldClock.setDay((worldClock.day + 1) % 365 + 1);
          }
          const {altitudeAngle} = worldClock.sunAngle();
          if (altitudeAngle > 0) break;
        }
      }

      updateSunPosition();

      renderer.render(scene, camera);
      onFrame();
    }

    //...Any cleanup youd like (optional)
    function cleanup() {

    }

    return { render, cleanup }
  }

  return threeMain;
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

const sampleSunAngle = [];
for (let minute = 0; minute <= 1440; minute++) {
  const hour = minute/60.0;
  const {altitudeAngle, hourAngle} = worldClock.sunAngle(1, hour);
  sampleSunAngle.push({hour, altitudeAngle: altitudeAngle*RAD, hourAngle: hourAngle*RAD});
}
const sunPlot = Plot.dot(sampleSunAngle, {x: 'hourAngle', y: 'altitudeAngle'});

class FPSCounter {
  constructor() {
    this.history = [];
    this.timeWindow = 5;
    this.windowPtr = 0;
    this.now = Date.now() / 1000;

    this.avgSum = 0;
    this.avgCount = 0;
  }

  newFrameTime() {
    const last = this.now;
    this.now = Date.now() / 1000;
    return this.now - last;
  }

  onFrame() {
    const frameTime = this.newFrameTime();
    this.history.push(frameTime);
    this.avgSum += frameTime;
    this.avgCount++;
    while (this.windowPtr < this.history.length && this.avgSum > this.timeWindow) {
      this.avgSum -= this.history[this.windowPtr];
      this.avgCount--;
      this.windowPtr++;
    }
    if (this.windowPtr > this.history.length / 2) {
      this.history = this.history.slice(this.windowPtr);
      this.windowPtr = 0;
    }
  }

  fps() {
    return this.avgSum > 0? this.avgCount / this.avgSum : 0;
  }
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      pickedObjectData: null,
      sunAngle: null,
      fpsCounter: new FPSCounter(),
    };
  }

  onPickObject(pickedObject) {
    this.setState({pickedObjectData: pickedObject? pickedObject.pickData : null});
  }

  onSunAngleChanged(sunAngle) {
    this.setState({sunAngle});
  }

  onFrame() {
    this.state.fpsCounter.onFrame();
  }

  renderBuildingProps() {
    const building_id = this.state.pickedObjectData.building_id;
    return (
      <>
        <p><abbr title="OpenStreetMaps">OSM</abbr> ID: {building_id}</p>
        <p>Building name: {buildingMap.buildingName(building_id)} </p>
        <p>Building levels: {buildingMap.buildingLevels(building_id)} </p>
        <p>Building height: {buildingMap.buildingHeight(building_id) + (buildingMap.buildingProp(building_id, 'height')? '' : ' (est.)')} </p>
        <p>Address: {
          (buildingMap.buildingProp(building_id, 'addr:housenumber')??'') + ' ' +
            (buildingMap.buildingProp(building_id, 'addr:street')??'')
          }</p>
      </>
    )
  }

  render() {
    const thisApp = this;
    return (
      <>
        <Paper
            script={threeMainSetup({
              onPickObject: (x) => thisApp.onPickObject(x),
              onSunAngleChanged: (x) => thisApp.onSunAngleChanged(x),
              onFrame: () => this.onFrame(),
            })}
            className="map-canvas"
        />

        <div id="ui-overlay">
          <Rnd
            className="ui-pane"
            default={{
              x: 0,
              y: 0,
              width: 320,
              height: 400,
            }}
            bounds="parent"
            minHeight="200"
            minWidth="200"
            dragHandleClassName="ui-pane-drag-title"
          >
            <div className="ui-pane-drag-title">
              <h3>Building properties</h3>
            </div>
            <div className="ui-pane-content">
              {!this.state.pickedObjectData || !this.state.pickedObjectData.building_id?
                (<p>{PICK_ON_CLICK? 'Click on a building' : 'Mouse over a building'}</p>) : this.renderBuildingProps()
              }
            </div>
            <div className="ui-pane-bottom"></div>
          </Rnd>

          <Rnd
            className="ui-pane"
            default={{
              x: 0,
              y: 400,
              width: 200,
              height: 200,
            }}
            bounds="parent"
            minHeight="200"
            minWidth="200"
            dragHandleClassName="ui-pane-drag-title"
          >
            <div className="ui-pane-drag-title">
              <h4>Sun angle</h4>
            </div>
            <div className="ui-pane-content">
              {!this.state.sunAngle ? <p>Initializing...</p> :
                <>
                  <p>Hour angle: {(this.state.sunAngle.hourAngle * RAD).toFixed(1)}&deg;</p>
                  <p>Altitude: {(this.state.sunAngle.altitudeAngle * RAD).toFixed(1)}&deg;</p>
                  <p>Azimuth: {(this.state.sunAngle.azimuth * RAD).toFixed(1)}&deg;</p>
                </>
              }
            </div>
            <div className="ui-pane-bottom"></div>
          </Rnd>

          <Rnd
            className="ui-pane"
            default={{
              x: 320,
              y: 0,
              width: 100,
              height: 100,
            }}
            bounds="parent"
            minHeight="100"
            minWidth="100"
            dragHandleClassName="ui-pane-drag-title"
          >
            <div className="ui-pane-drag-title">
              <p><strong>FPS: </strong>{this.state.fpsCounter.fps().toFixed(1)}</p>
            </div>
          </Rnd>
        </div>

        {/*
        <PlotFigure
          options={
            {marks: [sunPlot]}
          }
        />
        */}
      </>
    );
  }
}

export default App;
