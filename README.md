**Skylight** is an app for checking shadows from nearby buildings at different times of day/year.

The building data currently only covers Sydney. This can be replaced with data for any other place.

[**Live Demo**](https://it.works.lol/skylight/)

# License

[MIT license](https://opensource.org/licenses/MIT)

Data sources have their own licenses:
* Map and building data: [OpenStreetMap](https://osm.org/copyright)
* Elevation data: [SRTMv4](https://srtm.csi.cgiar.org)

# Development

This project was ejected from [Create React App](https://github.com/facebook/create-react-app).

## Update building data

Run `building_query.py >foo.json` to re-download latest OSM building data from the [Overpass API](https://overpass-api.de).

The coordinates can be changed to another city to download buildings there instead.\
Also update `LAT_LONG_ORIGIN` in the app to default to the new city location.

## Update map tiles

No work required. The app queries [OSM tile server](https://wiki.openstreetmap.org/wiki/Tiles) for map tiles at any location.

## Elevation data

Elevation data is derived from the [SRTMv4 dataset](https://srtm.csi.cgiar.org/srtmdata/), which is free for non-commercial use.

To cover another area:
1. Download the GeoTIFF heightmap for your world region.
1. Change the color depth to 8-bits (make sure to rescale the values as well, e.g. 0xff=255m or 2550m, the default scale covers 65536m!). Update [`ELEVATION_MAP.elevationScale`](./src/elevation/ElevationMap.js) with your new max-height.
1. Crop the heightmap to your area of interest. Update [`ELEVATION_MAP`](./src/elevation/ElevationMap.js) lat/long values.
1. _Optional:_ Clean any funny pixels or missing data in the heightmap.
1. Save the heightmap to `ElevationMap.png`. Make sure this is **8-bit grayscale** otherwise the code may do weird things.
1. Update the normal map at `ElevationNormal.png`. Make sure you render this with the correct scale. SRTMv4 data scale is 6000 pixel : 5° lat/long.

## Available Scripts

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `yarn test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `yarn build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

# Related projects

* [shadowmap.org](https://shadowmap.org) - polished, global data, topographic, $$
* [Mogul.sg](https://www.mogul.sg/) - Singapore only
