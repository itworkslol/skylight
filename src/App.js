import './App.css';
import {
  LAT_LONG_ORIGINS, BuildingMap,
  latLongToRenderMetres, renderMetresToLatLong,
  MAP_RENDER_DIST, osmTileList, osmTileToLatLong, osmTileToBBox, osmTileSize, osmTileUrl,
} from './BuildingMap.js';
import WorldClock from './WorldClock.js';
import _ from 'lodash';
import React from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Modal, ModalHeader, ModalBody, ModalFooter, Button } from 'reactstrap';

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import shadowIcon from 'leaflet/dist/images/marker-shadow.png';

import * as THREE from 'three';
import ThreeStats from 'three/examples/jsm/libs/stats.module.js';
import { MyMapControls } from './MyMapControls';
import { Paper } from "react-three-paper";
import buildingTextureImage from './building texture.png';

import GUI from 'lil-gui';
import { Rnd } from 'react-rnd';

// Lazy loading for city data.
// Even lazy imports must be top-level for webpack to work, so we do it here.
// https://webpack.js.org/guides/lazy-loading/
const CITY_DATA = {
  sydney: () => { return {
    buildings: import('./sydney_city_buildings.json'),
    elevation_box: import('./elevation/sydney/ElevationMap.js'),
    elevation_texture: import('./elevation/sydney/ElevationMap.png'),
    elevation_normals: import('./elevation/sydney/ElevationNormal.png'),
  }; },
  hongkong: () => { return {
    buildings: import('./hongkong_city_buildings.json'),
    elevation_box: import('./elevation/hongkong/ElevationMap.js'),
    elevation_texture: import('./elevation/hongkong/ElevationMap.png'),
    elevation_normals: import('./elevation/hongkong/ElevationNormal.png'),
  }; },
};

/* This code is needed to properly load the images in the Leaflet CSS */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: shadowIcon,
});

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

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

  resetPick() {
    console.log(`resetPick(${this.pickedObject?.pickData?.building_id})`);
    // restore the color if there is a picked object
    if (this.pickedObject) {
      this.pickedObject.material = this.pickedObjectSavedColor;
      this.pickedObject = undefined;
    }
  }

  pick(normalizedPosition, scene, camera) {
    console.log(`pick(${normalizedPosition.x},${normalizedPosition.y},${normalizedPosition.z})`);
    this.resetPick();
    if (!normalizedPosition) return;

    // cast a ray through the frustum
    this.raycaster.setFromCamera(normalizedPosition, camera);
    // get the list of objects the ray intersected
    const intersectedObjects = this.raycaster.intersectObjects(scene.children);
    // pick from the nearest object
    for (let i = 0; i < intersectedObjects.length; i++) {
      if (intersectedObjects[i].object.opaqueToPick) return;
      if (intersectedObjects[i].object.pickData) {
        this.setPickedObject(intersectedObjects[i].object.pickData.pickObject);
        return this.pickedObject;
      }
    }
  }

  setPickedObject(obj) {
    console.log(`setPickedObject(${obj?.pickData?.building_id})`);
    this.resetPick();
    this.pickedObject = obj;
    // save its color
    this.pickedObjectSavedColor = this.pickedObject.material;
    // swap to pick color
    this.pickedObject.material = this.pickedObject.pickData.pickMaterial;
  }

  setPickPosition(canvas, event) {
    console.log('setPickPosition');
    const pos = getCanvasRelativePosition(canvas, event);
    this.pickPosition = {
      x: (pos.x / canvas.width ) *  2 - 1,
      y: (pos.y / canvas.height) * -2 + 1,  // note we flip Y
    }
  }

  clearPickPosition() {
    console.log('clearPickPosition');
    this.pickPosition = null;
  }
}

const PICK_ON_CLICK = true;

let neverWrittenHash = true; // initial load

function stateToHash(city, location, pickedObjectId, clock) {
  const {lat, long} = location;
  const s = new URLSearchParams({
    city: city, lat: lat.toFixed(5), long: long.toFixed(5),
    h: clock.hour.toString(), d: clock.day.toString(),
  })
  if (pickedObjectId !== null) {
    s.set('highlight', pickedObjectId.toString());
  }
  return s.toString();
}
function hashToState(h, city, mapCentre, clock, controls, onCityChange) {
  const s = new URLSearchParams(h);
  if (s.has('city')) {
    let hashCity = s.get('city');
    if (city !== hashCity) {
      onCityChange(hashCity);
      return {pickedObjectId: null};
    }
  }
  if (s.has('lat') && s.has('long')) {
    mapCentre.lat = Number.parseFloat(s.get('lat'));
    mapCentre.long = Number.parseFloat(s.get('long'));
    const [y, x] = latLongToRenderMetres(LAT_LONG_ORIGINS[city], mapCentre.lat, mapCentre.long);
    controls.target = new THREE.Vector3(x, y, 0);
  }
  if (s.has('h') && s.has('d')) {
    clock.setHour(Number.parseFloat(s.get('h')));
    clock.setDay(Number.parseInt(s.get('d')));
  }
  let pickedObjectId = null;
  if (s.has('highlight')) {
    pickedObjectId = Number.parseInt(s.get('highlight'));
  }
  return {pickedObjectId};
}

// Hack to work around Paper calling our init code multiple times
const DEBOUNCE_THREEJS_INIT_MS = 500;

function threeMainSetup(city, stateChangeCallbacks, threeSingleton) {
  const {onCityChange, onResetScene, onPickObject, onSunAngleChanged, onFrame, setSpinner} = stateChangeCallbacks;

  const lat_long_origin = LAT_LONG_ORIGINS[city];

  const { UserRenderSettings, worldClock, mvpGui_DebugFlag } = threeSingleton;

  async function threeMain(canvas)
  {
    console.log('threeMain');
    if (threeSingleton.initId > 1) {
      console.warn(`warning: threejs init called #${threeSingleton.initId} times, grumble grumble`);
    }

    const city_data = CITY_DATA[city]();
    const {
      buildings: buildings_lazy,
      elevation_box: elevation_box_lazy,
      elevation_texture: elevation_texture_lazy,
      elevation_normals: elevation_normals_lazy,
    } = city_data;

    let buildingMap = new BuildingMap(await buildings_lazy, lat_long_origin);

    const elevation_box = (await elevation_box_lazy).default;
    console.log(`elevation box: ${JSON.stringify(elevation_box)}`);
    const elevation_texture = (await elevation_texture_lazy).default;
    const elevation_normals = (await elevation_normals_lazy).default;

    const pickHelper = new PickHelper();

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
    camera.position.set(0, 0, 1000);
    camera.up = new THREE.Vector3( 0, 1, 0 );
    camera.lookAt(0, 0, 0);

    const controls = new MyMapControls(camera, renderer.domElement);
    controls.enableDamping = false; // Enables inertia on the camera making it come to a more gradual stop.
    controls.dampingFactor = 0.25; // Inertia factor
    controls.screenSpacePanning = false;
    controls.maxDistance = 2000;

    async function createScene(mapCentre, pickedObjectId) {
      console.log(`createScene(latlong=(${mapCentre.lat},${mapCentre.long}))`);
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

      // threejs material doesn't support different UVs for the elevation map.
      // Work around this by manually cropping elevation tiles.
      async function loadImageData(url) {
        const res = await fetch(url);
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob, {
          options: {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          }
        });
        return bitmap;
      }

      // ugh, threejs doesn't let us use ImageBitmap as a texture directly
      function bitmapToCanvas(bitmap) {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.canvas.width = bitmap.width;
        ctx.canvas.height = bitmap.height;
        ctx.fillStyle = '#000';
        ctx.drawImage(bitmap, 0, 0);
        return ctx;
      }
      function canvasToTexture(ctx) {
        return memManaged(new THREE.CanvasTexture(ctx.canvas));
      }
      function bitmapToTexture(bitmap) {
        return canvasToTexture(bitmapToCanvas(bitmap));
      }

      const elevationTextureData = memManaged(await loadImageData(elevation_texture));
      const elevationNormalsData = memManaged(await loadImageData(elevation_normals));

      function elevationTextureCoord(loc) {
        const {lat, long} = loc;
        const lat2tex = elevationTextureData.height / (elevation_box.maxLat - elevation_box.minLat);
        const long2tex = elevationTextureData.width / (elevation_box.maxLong - elevation_box.minLong);
        // note: raw (float) coords
        return {
          v: (elevation_box.maxLat - lat) * lat2tex,
          u: (long - elevation_box.minLong) * long2tex,
        };
      }

      const getElevationAt = (() => {
        const ctx = bitmapToCanvas(elevationTextureData);
        const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        const stride = Math.round(data.data.length / (ctx.canvas.width * ctx.canvas.height));
        console.log(`elevation canvas stride: ${stride}`);
        return function(loc) {
          const {u, v} = elevationTextureCoord(loc);
          // Interpolate nearest pixels
          let sum = 0, weight = 0;
          for (let x = 0; x <= 1; x++) {
            const iv = x === 0? Math.floor(v) : Math.min(Math.ceil(v), ctx.canvas.height-1);
            const wv = x === 0? 1 - (v - iv) : 1 - (iv - v);
            for (let y = 0; y <= 1; y++) {
              const iu = y === 0? Math.floor(u) : Math.min(Math.ceil(u), ctx.canvas.width-1);
              const wu = y === 0? 1 - (u - iu) : 1 - (iu - u);
              sum += data.data[stride * (iv * ctx.canvas.width + iu)] * wv * wu;
              weight += wv * wu;
            }
          }
          const h = (sum / weight) * elevation_box.elevationScale/255 + elevation_box.minElevation;
          //console.log(`building elevation: ${loc.lat},${loc.long} -> ${u},${v} = ${h} m`);
          return h;
        };
      })();

      async function elevationTile(tileInfo) {
        const {nw, se} = osmTileToBBox(tileInfo);
        const {u: wU_, v: nV_} = elevationTextureCoord(nw);
        const nV = Math.max(0, Math.round(nV_));
        const wU = Math.max(0, Math.round(wU_));
        const {u: eU_, v: sV_} = elevationTextureCoord(se);
        const sV = Math.min(elevationTextureData.height, Math.round(sV_) + 1);
        const eU = Math.min(elevationTextureData.width, Math.round(eU_) + 1);
        //console.log(`elevationTile crop: (${nw.long} - ${se.long}) × (${se.lat} - ${nw.lat}) -> (${wU}-${eU}) × (${nV}-${sV})`);
        const displacement = memManaged(await createImageBitmap(elevationTextureData, wU, sV, eU-wU, nV-sV));
        const normal = memManaged(await createImageBitmap(elevationNormalsData, wU, sV, eU-wU, nV-sV));
        //console.log(`elevationTile size: ${displacement.width} × ${displacement.height}`);
        return { displacement: bitmapToTexture(displacement), normal: bitmapToTexture(normal) };
      }

      const groundTiles = osmTileList(mapCentre.lat, mapCentre.long, 500);
      for (let tileInfo of groundTiles) {
        const {lat, long} = osmTileToLatLong(tileInfo);
        const [tileY, tileX] = latLongToRenderMetres(lat_long_origin, lat, long);
        const {x: tileWidth, y: tileHeight} = osmTileSize(lat_long_origin, tileInfo);
        const TILE_SEGMENT_METRES = 90; // current elevation map resolution
        const tileSegmentsX = Math.ceil(tileWidth / TILE_SEGMENT_METRES);
        const tileSegmentsY = Math.ceil(tileHeight / TILE_SEGMENT_METRES);
        const ground = memManaged(new THREE.PlaneGeometry(tileWidth, tileHeight, tileSegmentsX, tileSegmentsY));
        const tileUrl = osmTileUrl(tileInfo);
        console.log(`loading map tile: ${tileUrl} at world coords: (${lat}, ${long}), screen coords: (${tileX}, ${tileY}) + (${tileWidth}, ${tileHeight})`);
        const mapTexture = memManaged(textureLoader.load(tileUrl));
        const elevation = await elevationTile(tileInfo);
        const material = memManaged(new THREE.MeshPhongMaterial({
          map: (UserRenderSettings.DrawDebugGeometry ? elevation.displacement : mapTexture),
          displacementMap: elevation.displacement,
          displacementScale: elevation_box.elevationScale,
          displacementBias: elevation_box.minElevation,
          normalMap: elevation.normal,
          shininess: 0,
        }));
        const mesh = new THREE.Mesh(ground, material).translateZ(-0.1);
        mesh.translateX(tileX + tileWidth/2).translateY(tileY - tileHeight/2);
        mesh.castShadow = true;
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

      const [mapCentreY, mapCentreX] = latLongToRenderMetres(lat_long_origin, mapCentre.lat, mapCentre.long);
      let numBuildingsDrawn = 0;
      for (const [building_id] of buildingMap.buildings)
      {
        // Note: swaps x/y to render space
        const [footprint, {min_x: originY, min_y: originX, min_lat, min_long}] = buildingMap.buildingFootprint(building_id);
        if (!(Math.sqrt(Math.pow(originX - mapCentreX, 2) + Math.pow(originY - mapCentreY, 2)) < MAP_RENDER_DIST)) {
          continue;
        }

        const height = buildingMap.buildingHeight(building_id) ?? 0;
        let geometry;
        if (height > 0) {
          // define the geometry with 1 level/m so that the wall texture works with default UV
          const extrudeSettings = {
            steps: 1,
            depth: buildingMap.buildingLevels(building_id) ?? 1,
            bevelEnabled: false,
          };
          geometry = memManaged(new THREE.ExtrudeGeometry( footprint, extrudeSettings ));
          geometry.scale(1, 1, height / extrudeSettings.depth);
        } else {
          geometry = memManaged(new THREE.ShapeGeometry( footprint ));
        }

        const buildingElevation = getElevationAt({lat: min_lat, long: min_long});
        //console.log(`building elevation ${building_id} = ${buildingElevation} m`);

        // building faces
        const mesh = new THREE.Mesh(geometry, buildingMaterial);
        mesh.position.set(originX, originY, buildingElevation);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.pickData = {building_id, pickMaterial: pickBuildingMaterial, pickObject: mesh};
        scene.add( mesh );

        // building outline
        if (true) {
          const edges = memManaged(new THREE.EdgesGeometry( geometry ));
          const edgesMat = memManaged(new THREE.LineBasicMaterial({color: 0x000000 }));
          const edgesMesh = new THREE.LineSegments(edges, edgesMat);
          edgesMesh.position.set(originX, originY, buildingElevation);
          edgesMesh.pickData = {pickObject: mesh}; // redirect to main object
          scene.add(edgesMesh);
        }

        // Is this an initially picked object?
        if (pickedObjectId !== null && building_id === pickedObjectId) {
          pickHelper.setPickedObject(mesh);
          onPickObject(pickHelper.pickedObject);
        }

        numBuildingsDrawn++;
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
        const twilightLevel = Math.sqrt(Math.max(0, Math.sin((altitudeAngle + twilightHA) * Math.PI / (Math.PI + 2*twilightHA))));
        const nightLevel = Math.min(Math.exp(-4*(altitudeAngle + twilightHA)), 1);
        ambientLight.intensity = 0.3 * Math.max(twilightLevel, nightLevel);
        ambientLight.color.r = Math.min(1, Math.max(2*twilightLevel, 1 - nightLevel));
        ambientLight.color.g = 1 - (1 - twilightLevel)/2;
        ambientLight.color.b = Math.max(twilightLevel/2, nightLevel);
        //console.log(`ambient tw=${twilightLevel}, nt=${nightLevel}`);

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
          if (event.button === 0 && mouseDownAt && event.clientX === mouseDownAt.x && event.clientY === mouseDownAt.y) {
            pickHelper.setPickPosition(canvas, event);
            pickHelper.pick(pickHelper.pickPosition, scene, camera);
            sceneData.pickedObjectId = pickHelper.pickedObject?.pickData?.building_id ?? null;
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
      onResetScene(buildingMap, numBuildingsDrawn);
      return { mapCentre, pickedObjectId, scene, sceneMemory, updateSunPosition, removeCanvasListeners };
    }

    let sceneData = { mapCentre: _.clone(lat_long_origin), pickedObjectId: null, scene: undefined };
    // sceneToDestroy is set to sceneData.scene when switching scenes (and .scene needs to be unset)
    function destroyScene(sceneToDestroy) {
      if (sceneToDestroy === undefined) {
        sceneToDestroy = sceneData.scene;
      }
      if (sceneToDestroy === undefined) {
        console.log('destroyScene(noop)');
      } else {
        console.log('destroyScene()');
        for (let obj of sceneData.sceneMemory) {
          if (obj.dispose) obj.dispose();
          else if (obj.close) obj.close();
          else throw obj;
        }
        for (let remove of sceneData.removeCanvasListeners) {
          remove();
        }
        sceneData.removeCanvasListeners = [];
        sceneData.scene = undefined;
      }
    }

    function resetScene() {
      threeSingleton.initId++;
      const resetId = threeSingleton.initId;
      console.log(`resetScene(#${resetId})`);
      if (neverWrittenHash && window.location.hash) {
        let {pickedObjectId} = hashToState(window.location.hash.substring(1), city, sceneData.mapCentre, worldClock, controls, onCityChange);
        sceneData.pickedObjectId = pickedObjectId;
      }

      setSpinner(true);
      const sceneToDestroy = sceneData.scene;
      sceneData.scene = undefined;
      // reset in the next event cycle so that the spinner appears first
      setTimeout(async () => {
          destroyScene(sceneToDestroy);
          if (resetId !== threeSingleton.initId) {
            console.warn(`resetScene(#${resetId}) - stale, cancelled!`);
            return;
          }
          sceneData = await createScene(sceneData.mapCentre, sceneData.pickedObjectId);
          mvpGui_DebugFlag.onChange(() => { console.log('DebugFlag toggled'); resetScene(); });
        }, DEBOUNCE_THREEJS_INIT_MS);
    }
    console.log('initial resetScene');
    resetScene();

    let lastHash = window.location.hash; // for debounce to work, we must compare the actual last state
    const writeUrlHash = _.debounce((h) => { window.location.hash = h; neverWrittenHash = false; },
                                    500, {trailing: true});
    function updateStateHash() {
      const [lat, long] = renderMetresToLatLong(LAT_LONG_ORIGINS[city], controls.target.x, controls.target.y)
      const newHash = '#' + stateToHash(city, {lat, long}, sceneData.pickedObjectId, worldClock);
      if (newHash !== lastHash) {
        writeUrlHash(newHash);
      }
      lastHash = newHash;
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
            worldClock.setDay((worldClock.day + 1) % 365);
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

        // HACK: handle external scene navigation
        if (threeSingleton.navigateToNext) {
          const {lat, long} = threeSingleton.navigateToNext;
          sceneData.mapCentre = {lat, long};
          controls.target.set(...latLongToRenderMetres(lat_long_origin, lat, long), 0);
          console.log(`navigateToNext resetScene(${lat},${long})`);
          window.location.hash = '';
          resetScene();
          updateStateHash();
          threeSingleton.navigateToNext = null;
        }
        else {
          // Redraw on map pan. For now, just reset everything.
          const [mapCentreY, mapCentreX] = latLongToRenderMetres(lat_long_origin, sceneData.mapCentre.lat, sceneData.mapCentre.long);
          const panDistance = new THREE.Vector2(mapCentreX, mapCentreY).distanceTo(new THREE.Vector2(controls.target.x, controls.target.y));
          if (panDistance > MAP_RENDER_DIST) {
            const [lat, long] = renderMetresToLatLong(lat_long_origin, controls.target.x, controls.target.y);
            sceneData.mapCentre = {lat, long};
            console.log('map pan resetScene');
            resetScene();
          }
        }
      }

      updateStateHash();
    }

    return { render, destroyScene }
  }

  return threeMain;
}

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
    // TODO: this tiny metadata doesn't need to be lazy
    const {city} = this.props;
    const elevation_box = CITY_DATA[city]().elevation_box;

    this.state = {
      pickedObjectData: null,
      sunAngle: null,
      fpsCounter: new FPSCounter(),
      spinnerVisible: true, // initial load
      outOfRange: false,
      buildingMap: null, // async init
      showWelcome: window.localStorage.getItem('welcomed') === null,
      areaName: elevation_box.areaName,
    };

    const UserRenderSettings = {
      DrawDebugGeometry: false,
    };

    const lat_long_origin = {lat: LAT_LONG_ORIGINS[props.city].lat, long: LAT_LONG_ORIGINS[props.city].long};
    const worldClock = new WorldClock(lat_long_origin.lat, lat_long_origin.long);

    const mvpGui = new GUI();
    const mvpGui_Day = mvpGui.add(worldClock, 'day', 1, 365, 1);
    const mvpGui_DayName = mvpGui.add(worldClock, 'dayName');
    mvpGui_DayName.disable();
    const mvpGui_Hour = mvpGui.add(worldClock, 'hour', 0, 24, 0.1);
    mvpGui.add(worldClock, 'autoplay', ['', 'hour', 'day']);
    const mvpGui_DebugFlag = mvpGui.add(UserRenderSettings, 'DrawDebugGeometry', false);

    worldClock.setGuiControllers(mvpGui_Day, mvpGui_DayName, mvpGui_Hour);

    this.threeSingleton = {
      // Paper.js seems to call init twice. This is a hack to detect it and only render the most recent.
      initId: 0,

      // For the same reason, create global render state here instead of in threeMainSetup.
      UserRenderSettings,
      worldClock,
      mvpGui,
      mvpGui_DebugFlag,

      // Hack to control the scene from the outside. (TODO: should this be in this.state?)
      navigateToNext: null,
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
  
  closeWelcome() {
    window.localStorage.setItem('welcomed', '1');
    this.setState({showWelcome: false});
  }

  setSpinner(visible) {
    // HACK also immediately update DOM, don't wait for React
    document.getElementById('canvas-spinner').style.display = (visible? 'block' : 'none');
    this.setState({spinnerVisible: visible});
  }

  onResetScene(buildingMap, numBuildingsDrawn) {
    this.setState({buildingMap, outOfRange: numBuildingsDrawn === 0});
  }

  renderBuildingProps() {
    const building_id = this.state.pickedObjectData.building_id;
    const buildingMap = this.state.buildingMap;
    return (
      <>
        <p><abbr title="OpenStreetMaps">OSM</abbr> ID: {building_id}</p>
        <p>Building name: {buildingMap?.buildingName(building_id)} </p>
        <p>Building levels: {buildingMap?.buildingLevels(building_id) ?? 'unknown'} </p>
        <p>Building height: {(buildingMap?.buildingHeight(building_id) ?? 'unknown') + (buildingMap?.buildingProp(building_id, 'height')? '' : ' (est.)')} </p>
        <p>Address: {
          (buildingMap?.buildingProp(building_id, 'addr:housenumber')??'') + ' ' +
            (buildingMap?.buildingProp(building_id, 'addr:street')??'')
          }</p>
      </>
    )
  }

  resetLocation() {
    this.threeSingleton.navigateToNext = LAT_LONG_ORIGINS[this.props.city];
  }

  render() {
    const thisApp = this;
    // check if city is valid
    if (!CITY_DATA[this.props.city]) {
      return (
        <div>
          <h1>Invalid city</h1>
          <p>City not found: <pre>{this.props.city}</pre>. Please select a valid city from the dropdown.</p>
        </div>
      );
    }
    return (
      <>
        <Paper
            script={threeMainSetup(
              this.props.city,
              {
                onResetScene: (x, y) => thisApp.onResetScene(x, y),
                onPickObject: (x) => thisApp.onPickObject(x),
                onSunAngleChanged: (x) => thisApp.onSunAngleChanged(x),
                onFrame: () => thisApp.onFrame(),
                setSpinner: (visible) => thisApp.setSpinner(visible),
                onCityChange: (city) => thisApp.props.onCityChange(city),
              },
              thisApp.threeSingleton
            )}
            className="map-canvas"
        />

        <Modal isOpen={thisApp.state.showWelcome}>
          <ModalHeader>
            Intro to Skylight
          </ModalHeader>
          <ModalBody>
            <ul>
              <li>Pan the map to rotate the view.</li>
              <li>Scroll / pinch to zoom (depends on device).</li>
              <li>Drag the map to change location. Distant buildings will load on demand.</li>
            </ul>
          </ModalBody>
          <ModalFooter>
            <Button color="primary" onClick={()=>{thisApp.closeWelcome();return false;}}>Got it</Button>
          </ModalFooter>
        </Modal>

        <div id="license-info" style={{
            position: 'absolute',
            zIndex: 9,
            bottom: 0,
            right: 0,
            fontSize: '10pt',
            backgroundColor: 'lightgrey',
            color: 'black',
            opacity: 0.8,
          }}>
          <div><strong><a href="https://github.com/itworkslol/skylight" target="_blank">Skylight</a></strong> pre-pre-alpha</div>
          <div>Map data © <a href="https://osm.org/copyright" target="_blank">OpenStreetMap contributors</a></div>
          <div>Elevation data © <a href="https://srtm.csi.cgiar.org" target="_blank">CIAT SRTM</a></div>
        </div>

        <div id="out-of-range-popup" style={{
            display: (thisApp.state.outOfRange? 'block' : 'none'),
            position: 'absolute',
            zIndex: 9,
            left: '40vw',
            top: '40vh',
            right: '40vw',
            padding: '20px',
            border: '3px solid white',
            backgroundColor: '#ffc107',
          }}>
          <p>No building data for this area!</p>
          <p>Move the map or <button onClick={() => thisApp.resetLocation()}>reset location</button>.</p>
        </div>

        <div id="ui-overlay">
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
                (<p><em>{PICK_ON_CLICK? 'Click on a building' : 'Mouse over a building'}</em></p>) : this.renderBuildingProps()
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

export {
  App, CITY_DATA,
};
