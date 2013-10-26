// Copyrigth (C) Pascal Martin, 2013.
//
// NAME
//
//   weather - a module to gather weather information
//
// SYNOPSYS
//
//   This module implements an interface to a weather data source
//   (currently: Weather Underground). It has two main purposes:
//   help adjust the watering duration for all zones (the adjustment
//   is calculated as a percentage of the configured duration), and
//   simulate a rain sensor.
//
//   The module also provides some basic weather data, mostly to allow
//   the sprinkler software to record them along with the actual zone
//   run times.
//
//   This module queries the Weather Underground servers not more
//   often than every 6 hours. The update is asynchronous: it is
//   recommended to refresh the weather information a few minutes
//   before a program is activated.
//
// DESCRIPTION
//
//   var weather = require('./weather');
//
//   weather.configure (config);
//
//      Initialize the weather module from the user configuration.
//      This method can be called as often as necessary (typically
//      when the configuration has changed).
//
//   weather.refresh ();
//
//      Query the weather data service for updates. No refresh is
//      executed if the last one was performed less than a defined
//      interval (6 hours).
//
//   weather.temperature ();
//
//      return the average temperature for the previous day.
//
//   weather.humidity ();
//
//      return the average humidity for the previous day.
//
//   weather.rain ();
//
//      return the total rain level for the last two days in inches.
//
//   weather.rainsensor ();
//
//      return true if the current rain has reached the configured
//      trigger level, false otherwise.
//
//   weather.adjustment ();
//
//      return the watering duration's weather adjustment.
//
// CONFIGURATION
//
//   zipcode             The local USPS zipcode.
//
//   weather             The weather module configuration object.
//                       If missing, the weather module is disabled.
//
//   weather.key         The Weather Underground access key.
//                       If missing, the weather module is disabled.
//
//   weather.adjust.min  The minimum value for the weather adjustment.
//                       (Default value: 30.)
//
//   weather.adjust.max  The maximum value for the weather adjustment.
//                       (Default value: 150.)
//
//   weather.raintrigger The rain level in inches that triggers the
//                       simulated rain sensor. The rain sensor feature
//                       of this weather module is disabled if that item
//                       is not present.

var http = require('http');

var received = null;
var weatherConditions = null;

var lastUpdate = 0
var updateInterval = 6 * 3600000; // 6 hours in milliseconds.

var url = null;
var minadjust = 30;
var maxadjust = 150;
var raintrigger = null;

function restoreDefaults () {

   url = null;
   weatherConditions = null;
   minadjust = 30;
   maxadjust = 150;
   raintrigger = null;
}
restoreDefaults();

exports.configure = function (config) {

   restoreDefaults();

   if (config.weather == null) return;
   if (config.weather.key == null) return;

   url = 'http://api.wunderground.com/api/'
                + config.weather.key + '/yesterday/conditions/q/'
                + config.zipcode + '.json';

   if (config.weather.adjust != null) {
      if (config.weather.adjust.min != null) {
         minadjust = config.weather.adjust.min;
      }
      if (config.weather.adjust.max != null) {
         maxadjust = config.weather.adjust.max;
      }
   }

   raintrigger = config.weather.raintrigger;

   getWeather();
}

function decode (text) {

   if (received != null) {
      text = received + text;
   }

   var braces = text.split('{').length;

   if ((braces > 0) && (braces == text.split('}').length)) {
      weatherConditions = JSON.parse(text);
      received = null;
      return true;
   }

   received = text; // Wait for more.

   return false;
}

function getWeather () {

   var time = new Date().getTime();

   // Throttle when to request for information, to avoid being blocked.
   if (time < lastUpdate + updateInterval) return;
   lastUpdate = time;

   console.log ('Weather: checking for update..');
   http.get(url, function(res) {
      res.on('data', function(d) {
         if (decode (d.toString())) {
            console.log ('Weather: received update');
         }
      });
   }).on('error', function(e) {
      received = null;
      weatherConditions = null;
   });
}

exports.refresh = function () {

   if (url == null) return;
   getWeather();
}

exports.temperature = function () {
   if (weatherConditions == null) return null;
   return weatherConditions.history.dailysummary[0].meantempi - 0;
}

exports.humidity = function () {
   if (weatherConditions == null) return null;
   max = weatherConditions.history.dailysummary[0].maxhumidity - 0;
   min = weatherConditions.history.dailysummary[0].minhumidity - 0;
   return (max + min ) / 2;;
}

exports.rain = function () {
   if (weatherConditions == null) return null;
   var precipi = weatherConditions.history.dailysummary[0].precipi - 0;
   var today = weatherConditions.current_observation.precip_today_in - 0;
   return precipi + today;
}

exports.rainsensor = function () {
   if (raintrigger == null) return false;
   if (weatherConditions == null) return false;
   var today_in = weatherConditions.current_observation.precip_today_in - 0;
   return (today_in >= raintrigger);
}

// Adjustment formula derived from sprinklers_pi/weather.cpp
exports.adjustment = function () {

   if (weatherConditions == null) return 100;

   var current = weatherConditions.current_observation;
   var history = weatherConditions.history.dailysummary[0];

   // We do the following to convert everything to numeric.
   // Otherwise the data is string by default and the + operator
   // behaves in non-mathematical ways.
   var maxhumidity = history.maxhumidity - 0;
   var minhumidity = history.minhumidity - 0;
   var meantempi = history.meantempi - 0;
   var precipi = history.precipi - 0;
   var precip_today_in = current.precip_today_in - 0;

   // console.log ("Weather: current adjustment");
   // console.log ("Weather: history.maxhumidity = "+history.maxhumidity);
   // console.log ("Weather: history.minhumidity = "+history.minhumidity);
   // console.log ("Weather: history.meantempi = "+history.meantempi);
   // console.log ("Weather: history.precipi = "+history.precipi);
   // console.log ("Weather: current.precip_today_in = "+current.precip_today_in);

   var humid_factor = 30 - ((maxhumidity + minhumidity) / 2);
   var temp_factor = (meantempi - 70) * 4;
   var rain_factor = 0.0 - ((precipi + precip_today_in) * 200.0);

   var adjust =
       Math.min(Math.max(minadjust, 100+humid_factor+temp_factor+rain_factor), maxadjust);

   return adjust;
}

