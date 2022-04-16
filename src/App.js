import './App.css';
import {
  LAT_LONG_ORIGIN, BuildingMap,
  latLongToRenderMetres, renderMetresToLatLong,
  MAP_RENDER_DIST, osmTileList, osmTileToLatLong, osmTileSize, osmTileUrl,
} from './BuildingMap.js';
import WorldClock from './WorldClock.js';
import React from 'react';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import shadowIcon from 'leaflet/dist/images/marker-shadow.png'

import * as THREE from 'three';
import { MyMapControls } from './MyMapControls';
import { Paper } from "react-three-paper";
import buildingTextureImage from './building texture.png'

import GUI from 'lil-gui';
import { Rnd } from 'react-rnd';

import * as Plot from "@observablehq/plot";
import { PlotFigure } from 'plot-react';

import fullMapData from './sydney_city_buildings.json' // TODO split

/* This code is needed to properly load the images in the Leaflet CSS */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: shadowIcon,
});

let buildingMap = new BuildingMap(fullMapData);

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const worldClock = new WorldClock(LAT_LONG_ORIGIN.lat, LAT_LONG_ORIGIN.long);

const UserRenderSettings = {
  DrawDebugGeometry: false,
};

const mvpGui = new GUI();
const mvpGui_Day = mvpGui.add(worldClock, 'day', 1, 365, 1);
const mvpGui_DayName = mvpGui.add(worldClock, 'dayName');
mvpGui_DayName.disable();
const mvpGui_Hour = mvpGui.add(worldClock, 'hour', 0, 24, 0.1);
mvpGui.add(worldClock, 'autoplay', ['', 'hour', 'day']);
const mvpGui_DebugFlag = mvpGui.add(UserRenderSettings, 'DrawDebugGeometry', false);

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
    this.pickedObjectSavedColor = null;
    this.pickPosition = null; // or {x, y}
  }

  pick(normalizedPosition, scene, camera) {
    // restore the color if there is a picked object
    if (this.pickedObject) {
      this.pickedObject.material = this.pickedObjectSavedColor;
      this.pickedObject = undefined;
    }

    if (!normalizedPosition) return;

    // cast a ray through the frustum
    this.raycaster.setFromCamera(normalizedPosition, camera);
    // get the list of objects the ray intersected
    const intersectedObjects = this.raycaster.intersectObjects(scene.children);
    // pick from the nearest object
    for (let i = 0; i < intersectedObjects.length; i++) {
      if (intersectedObjects[i].object.opaqueToPick) return;
      if (intersectedObjects[i].object.pickData) {
        this.pickedObject = intersectedObjects[i].object.pickData.pickObject;
        // save its color
        this.pickedObjectSavedColor = this.pickedObject.material;
        // swap to pick color
        this.pickedObject.material = this.pickedObject.pickData.pickMaterial;
        return this.pickedObject;
      }
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
  const {onPickObject, onSunAngleChanged, onFrame, setSpinner} = stateChangeCallbacks;

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
    const far = 5000;
    const camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
    camera.position.set(0, 0, 400);
    camera.up = new THREE.Vector3( 0, 1, 0 );
    camera.lookAt(0, 0, 0);

    const controls = new MyMapControls(camera, renderer.domElement);
    controls.enableDamping = false; // Enables inertia on the camera making it come to a more gradual stop.
    controls.dampingFactor = 0.25; // Inertia factor
    controls.screenSpacePanning = false;
    controls.maxDistance = 2000;

    function createScene(mapCentre) {
      // Setup scene
      const scene = new THREE.Scene();
      const sceneMemory = [];
      const removeCanvasListeners = [];
      function memManaged(obj) {
        sceneMemory.push(obj);
        return obj;
      }
      const textureLoader = new THREE.TextureLoader();
      {
        const geometry = memManaged(new THREE.BoxGeometry(1, 1, 1));
        const material = memManaged(new THREE.MeshLambertMaterial({color: 0x44aa88}));
        const cube = new THREE.Mesh(geometry, material);
        scene.add(cube);
      }

      const groundTiles = osmTileList(mapCentre.lat, mapCentre.long, 500);
      for (let tileInfo of groundTiles) {
        const {lat, long} = osmTileToLatLong(tileInfo);
        const [tileY, tileX] = latLongToRenderMetres(lat, long);
        const {x: tileWidth, y: tileHeight} = osmTileSize(tileInfo);
        const ground = memManaged(new THREE.PlaneGeometry(tileWidth, tileHeight));
        const tileUrl = osmTileUrl(tileInfo);
        console.log(`loading map tile: ${tileUrl} at world coords: (${lat}, ${long}), screen coords: (${tileX}, ${tileY}) + (${tileWidth}, ${tileHeight})`);
        const material = memManaged(new THREE.MeshLambertMaterial({map: textureLoader.load(tileUrl)}));
        const mesh = new THREE.Mesh(ground, material).translateZ(-0.1);
        mesh.translateX(tileX + tileWidth/2).translateY(tileY - tileHeight/2);
        mesh.receiveShadow = true;
        mesh.opaqueToPick = true;
        scene.add(mesh);

        if (UserRenderSettings.DrawDebugGeometry) {
          const wireframe = memManaged(new THREE.WireframeGeometry(ground));
          const line = new THREE.LineSegments(wireframe);
          line.material = memManaged(new THREE.MeshLambertMaterial({color: 0xffffff}));;
          scene.add(line);
        }
      }

      // building materials
      const wallTexture = memManaged(textureLoader.load(buildingTextureImage));
      wallTexture.wrapS = THREE.RepeatWrapping;
      wallTexture.wrapT = THREE.RepeatWrapping;
      const wallMaterial = memManaged(new THREE.MeshLambertMaterial({ map: wallTexture }));
      const roofMaterial = memManaged(new THREE.MeshLambertMaterial({ color: 0xffffff }));
      const buildingMaterial = [roofMaterial, wallMaterial];

      const pickWallMaterial = memManaged(new THREE.MeshLambertMaterial({ map: wallTexture, emissive: 0x333399 }));
      const pickRoofMaterial = memManaged(new THREE.MeshLambertMaterial({ color: 0xcccccc, emissive: 0x333399 }));
      const pickBuildingMaterial = [pickRoofMaterial, pickWallMaterial];

      const [mapCentreY, mapCentreX] = latLongToRenderMetres(mapCentre.lat, mapCentre.long);
      for (const [building_id] of buildingMap.buildings)
      {
        const [footprint, [originX, originY]] = buildingMap.buildingFootprint(building_id);
        if (!(Math.sqrt(Math.pow(originX - mapCentreX, 2) + Math.pow(originY - mapCentreY, 2)) < MAP_RENDER_DIST)) {
          continue;
        }

        const height = buildingMap.buildingHeight(building_id) ?? 0;
        let geometry;
        let heightScale = 1;
        if (height > 0) {
          // define the geometry with 1 level/m so that the wall texture works with default UV
          const extrudeSettings = {
            steps: 1,
            depth: buildingMap.buildingLevels(building_id) ?? 1,
            bevelEnabled: false,
            bevelThickness: 0.5,
            bevelSize: 0.5,
            bevelSegments: 1,
          };
          geometry = memManaged(new THREE.ExtrudeGeometry( footprint, extrudeSettings ));
          geometry.scale(1, 1, height / extrudeSettings.depth);
        } else {
          geometry = memManaged(new THREE.ShapeGeometry( footprint ));
        }

        // building faces
        const mesh = new THREE.Mesh(geometry, buildingMaterial);
        mesh.position.set(originX, originY, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.pickData = {building_id, pickMaterial: pickBuildingMaterial, pickObject: mesh};
        scene.add( mesh );

        // building outline
        if (true) {
          const edges = memManaged(new THREE.EdgesGeometry( geometry ));
          const edgesMat = memManaged(new THREE.LineBasicMaterial({color: 0x000000 }));
          const edgesMesh = new THREE.LineSegments(edges, edgesMat);
          edgesMesh.position.set(originX, originY, 0);
          edgesMesh.pickData = {pickObject: mesh}; // redirect to main object
          scene.add(edgesMesh);
        }
      }

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
      scene.add(ambientLight);
      const lightDistance = MAP_RENDER_DIST; // FIXME: should be just outside scene

      const debugSunDisk = [];
      const sunLights = [];
      function updateSunPosition() {
        const {hourAngle, altitudeAngle, azimuth} = worldClock.sunAngle();
        onSunAngleChanged({hourAngle, altitudeAngle, azimuth});

        for (const light of sunLights) {
          light.position.set(0, 0, lightDistance);
          const zenith = altitudeAngle - Math.PI/2;
          light.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), zenith);
          light.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), -azimuth);
          light.translateX(mapCentreX).translateY(mapCentreY);
          if (altitudeAngle < 0) {
            light.intensity = 0;
          } else {
            light.intensity = 1;
          }
        }
        // twilight hack
        const twilightHA = 0.5 * 15*DEG;
        ambientLight.intensity = 0.1 + 0.2 * Math.sqrt(Math.max(0, Math.sin((altitudeAngle + twilightHA) * Math.PI / (Math.PI + 2*twilightHA))));
        ambientLight.color.b = ambientLight.intensity;
        ambientLight.color.g = 1 - (1 - ambientLight.intensity)/2;

        if (UserRenderSettings.DrawDebugGeometry) {
          // debug sun disk
          let sunDiskPoint = new THREE.Vector3();
          const lineMat = memManaged(new THREE.LineBasicMaterial({color: 0xffcccc}));
          for (let h = 0; h < 24; h++) {
            const {altitudeAngle, azimuth} = worldClock.sunAngle(worldClock.day, h);
            sunDiskPoint.set(0, 0, lightDistance);
            const zenith = altitudeAngle - Math.PI/2;
            sunDiskPoint.applyAxisAngle(new THREE.Vector3(1, 0, 0), zenith);
            sunDiskPoint.applyAxisAngle(new THREE.Vector3(0, 0, 1), -azimuth);
            if (debugSunDisk.length < 24) {
              const endpoints = new Float32Array(2 * 3);
              new THREE.Vector3(0, 0, 0).toArray(endpoints, 0 * 3);
              const lineGeom = memManaged(new THREE.BufferGeometry());
              lineGeom.setAttribute('position', new THREE.BufferAttribute(endpoints, 3));
              const line = new THREE.Line(lineGeom, lineMat);
              line.translateX(mapCentreX).translateY(mapCentreY);
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

        if (UserRenderSettings.DrawDebugGeometry)
        {
          const sphere = memManaged(new THREE.SphereGeometry(5, 16, 8));
          const lightMat = memManaged(new THREE.MeshBasicMaterial({color: 0xffffdd}));
          const lightBulb = new THREE.Mesh(sphere, lightMat);
          light.add(lightBulb);
        }

        light.translateX(mapCentreX).translateY(mapCentreY);
        light.target.translateX(mapCentreX).translateY(mapCentreY);

        scene.add(light);
        scene.add(light.target);
        sunLights.push(light);

        if (UserRenderSettings.DrawDebugGeometry) {
          const helper = new THREE.DirectionalLightHelper(light, 10);
          scene.add(helper);
        }

        light.shadow.camera.left = -lightDistance;
        light.shadow.camera.right = lightDistance;
        light.shadow.camera.bottom = -lightDistance;
        light.shadow.camera.top = lightDistance;
        light.shadow.camera.far = 2 * lightDistance; // FIXME reach whole surface
        light.shadow.mapSize = new THREE.Vector2(1024, 1024);
        //light.shadow.camera.translateX(mapCentreX).translateY(mapCentreY);
        light.shadow.camera.updateProjectionMatrix();
        if (UserRenderSettings.DrawDebugGeometry) {
          const cameraHelper = new THREE.CameraHelper(light.shadow.camera);
          scene.add(cameraHelper);
        }
      }
      updateSunPosition(); // initialise

      function addRemovableEventListener(eventName, handler) {
        canvas.addEventListener(eventName, handler);
        removeCanvasListeners.push(() => canvas.removeEventListener(eventName, handler));
      }

      // Setup picking
      if (PICK_ON_CLICK) {
        let mouseDownAt = null;
        // Ignore drag events (from camera controller). Yuck!
        function mousedownHandler(event) {
          if (event.button === 0) mouseDownAt = {x: event.clientX, y: event.clientY};
        }
        addRemovableEventListener('mousedown', mousedownHandler);
        function mouseupHandler(event) {
          if (event.button === 0 && mouseDownAt && event.clientX == mouseDownAt.x && event.clientY == mouseDownAt.y) {
            pickHelper.setPickPosition(canvas, event);
            pickHelper.pick(pickHelper.pickPosition, scene, camera);
            onPickObject(pickHelper.pickedObject);
            mouseDownAt = null;
          }
        }
        addRemovableEventListener('mouseup', mouseupHandler);
      } else {
        function mousemoveHandler(event) { pickHelper.setPickPosition(canvas, event); }
        addRemovableEventListener('mousemove', mousemoveHandler);
        function clearPickHandler(event) { pickHelper.clearPickPosition(); }
        addRemovableEventListener('mouseout', clearPickHandler);
        addRemovableEventListener('mouseleave', clearPickHandler);
      }

      if (UserRenderSettings.DrawDebugGeometry) {
        const axesHelper = new THREE.AxesHelper(50);
        scene.add( axesHelper );
      }

      // done creating scene
      return { mapCentre, scene, sceneMemory, updateSunPosition, removeCanvasListeners };
    }

    let sceneData = { mapCentre: LAT_LONG_ORIGIN, scene: undefined };
    function resetScene() {
      setSpinner(true);
      sceneData.scene = undefined;
      // reset in the next event cycle so that the spinner appears first
      setTimeout(() => {
          if (sceneData.scene !== undefined) {
            for (let obj of sceneData.sceneMemory) {
              obj.dispose();
            }
            for (let remove of sceneData.removeCanvasListeners) {
              remove();
            }
          }
          sceneData = createScene(sceneData.mapCentre);
          mvpGui_DebugFlag.onChange(() => { resetScene(); });
        }, 1);
    }
    resetScene();

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

    //...Render loop without requestAnimationFrame()
    function render(timeMs) {
      if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
      }

      if (!PICK_ON_CLICK) {
        const lastPicked = pickHelper.pickedObject;
        pickHelper.pick(pickHelper.pickPosition, sceneData.scene, camera);
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

      if (sceneData.updateSunPosition) sceneData.updateSunPosition();

      if (sceneData.scene) {
        renderer.render(sceneData.scene, camera);
        onFrame();
        setSpinner(false);

        // Redraw on map pan. For now, just reset everything.
        const [mapCentreY, mapCentreX] = latLongToRenderMetres(sceneData.mapCentre.lat, sceneData.mapCentre.long);
        const panDistance = new THREE.Vector2(mapCentreX, mapCentreY).distanceTo(new THREE.Vector2(controls.target.x, controls.target.y));
        if (panDistance > MAP_RENDER_DIST) {
          const [lat, long] = renderMetresToLatLong(controls.target.x, controls.target.y);
          sceneData.mapCentre = {lat, long};
          resetScene();
        }
      }
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
    <MapContainer center={[LAT_LONG_ORIGIN.lat, LAT_LONG_ORIGIN.long]} zoom={16} scrollWheelZoom={true}>
      <TileLayer
        attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[LAT_LONG_ORIGIN.lat, LAT_LONG_ORIGIN.long]}>
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
      spinnerVisible: true, // initial load
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
  
  setSpinner(visible) {
    // HACK also immediately update DOM, don't wait for React
    document.getElementById('canvas-spinner').style.display = (visible? 'block' : 'none');
    this.setState({spinnerVisible: visible});
  }

  renderBuildingProps() {
    const building_id = this.state.pickedObjectData.building_id;
    return (
      <>
        <p><abbr title="OpenStreetMaps">OSM</abbr> ID: {building_id}</p>
        <p>Building name: {buildingMap.buildingName(building_id)} </p>
        <p>Building levels: {buildingMap.buildingLevels(building_id) ?? 'unknown'} </p>
        <p>Building height: {(buildingMap.buildingHeight(building_id) ?? 'unknown') + (buildingMap.buildingProp(building_id, 'height')? '' : ' (est.)')} </p>
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
              onFrame: () => thisApp.onFrame(),
              setSpinner: (visible) => thisApp.setSpinner(visible),
            })}
            className="map-canvas"
        />

        <div id="ui-overlay">
          <div>
            <div id="canvas-spinner" style={{
                display: (thisApp.state.spinnerVisible? 'block' : 'none'),
                position: 'absolute',
                zIndex: 9,
                fontSize: '10vw', // lol works?
                left: '45vw',
                top: '45vh',
                padding: '20px',
                backgroundColor: 'darkgrey',
                color: 'white',
              }}>⏳</div>
          </div>

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
