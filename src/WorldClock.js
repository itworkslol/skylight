import GUI from 'lil-gui';

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

export default WorldClock;
