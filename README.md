**Skylight** is an app for checking shadows from nearby buildings at different times of day/year.

The building data currently only covers Sydney. This can be replaced with data for any other place.

# Development

This project was ejected from [Create React App](https://github.com/facebook/create-react-app).

## Update or replace buildings

Run `building_query.py >foo.json` to re-download latest OSM building data from the Overpass API.

The coordinates can be changed to another city to download buildings there instead.\
Also update `LAT_LONG_ORIGIN` in the app to default to the new city location.

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
