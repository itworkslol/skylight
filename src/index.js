import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import { App, CITY_DATA } from './App';
import reportWebVitals from './reportWebVitals';

// wrapper to switch cities with a floating dropdown
function CitySwitcher() {
  // get initial city from the url hash e.g. city=sydney
  // FIXME: refactor this with hashToState
  const hash = window.location.hash;
  const cityMatch = hash.match(/city=([^&]+)/);
  const initialCity = cityMatch ? cityMatch[1] : 'sydney';
  const [city, setCity] = React.useState(initialCity);
  const cities = Object.keys(CITY_DATA);
  const idx = cities.indexOf(city);

  const changeCity = (newCity) => {
    setCity(newCity);
    // clear the url hash so we're not stuck in the previous location
    window.history.replaceState(null, null, '#');
  };

  return (
    <div className="city-switcher">
      <select
        value={city}
        onChange={e => changeCity(e.target.value)}
        style={{ position: 'fixed', bottom: 0, left: 0, zIndex: 99 }}
      >
        {cities.map(city => (
          <option key={city} value={city}>
            {city}
          </option>
        ))}
      </select>
      <App city={city} onCityChange={changeCity} key={city} />
    </div>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <CitySwitcher />
  </React.StrictMode>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
