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
//   weather.configure (config, options);
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
//   weather.status ();
//
//      Return the latest status of the weather data service: true if
//      an update was successfully completed on the last attempt, false
//      otherwise.
//
//   weather.updated ();
//
//      Return the time of the latest successful weather data update.
//
//   weather.enabled ();
//
//      Return true if the weather adjustment feature is both enabled
//      and data is available.
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
//   weather.adjust (duration);
//
//      return the weather-adjusted watering duration.
//
//   weather.adjustment ();
//
//      return the raw weather adjustment ratio (not subject to mix/max
//      limits).
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
var enable = false;
var raintrigger = null;
var webRequest = null;

var debugLog = function (text) {}

function verboseLog (text) {
   console.log ('[DEBUG] Weather: '+text);
}

function restoreDefaults () {

   url = null;
   minadjust = 30;
   maxadjust = 150;
   enable = false;
   raintrigger = null;
}
restoreDefaults();

exports.configure = function (config, options) {

   if (options && options.debug) {
      debugLog = verboseLog;
   }
   restoreDefaults();

   if (! config.weather) return;
   if (! config.weather.key) return;

   url = 'http://api.wunderground.com/api/'
                + config.weather.key + '/yesterday/conditions/q/'
                + config.zipcode + '.json';

   if (config.weather.adjust) {
      if (config.weather.adjust.min) {
         minadjust = config.weather.adjust.min;
      }
      if (config.weather.adjust.max) {
         maxadjust = config.weather.adjust.max;
      }
   }

   raintrigger = config.weather.raintrigger;
   enable = config.weather.enable;

   if (weatherConditions) {
      // Force a refresh soon, but not immediately (to avoid consuming
      // the quota too fast if the user makes small changes to the config).
      // (Do it in 10 minutes.)
      lastUpdate = new Date().getTime() - updateInterval + 600000;
   } else {
      // That is the first time we ask. Do it now.
      lastUpdate = 0;
      getWeather();
   }
}

function getWeather () {

   var time = new Date().getTime();

   // Throttle when to request for information, to avoid being blocked.
   if (time < lastUpdate + updateInterval) return;
   lastUpdate = time;

   debugLog ('checking for update..');
   received = "";

   webRequest = http.request(url, function(res) {
      res.on('data', function(d) {
         received = received + d.toString();
      });
      res.on('end', function(d) {
         weatherConditions = JSON.parse(received);
         received = null;
         weatherConditions.updated = new Date();
         debugLog ('received update');
      });
   });
   webRequest.on('error', function(e) {
      received = null;
      weatherConditions = null;
   });
   webRequest.end();
   webRequest = null;
}

exports.refresh = function () {

   if (url) {
      getWeather();
   }
}

exports.status = function () {
   if (weatherConditions) {
      return true;
   }
   return false;
}

exports.updated = function () {
   if (weatherConditions) {
      return weatherConditions.updated;
   }
   return {};
}

exports.enabled = function () {
   if (weatherConditions) {
      return enable;
   }
   return false;
}

exports.temperature = function () {
   if (weatherConditions) {
      return weatherConditions.history.dailysummary[0].meantempi - 0;
   }
   return null;
}

exports.humidity = function () {
   if (weatherConditions) {
      max = weatherConditions.history.dailysummary[0].maxhumidity - 0;
      min = weatherConditions.history.dailysummary[0].minhumidity - 0;
      return (max + min ) / 2;;
   }
   return null;
}

exports.rain = function () {
   if (weatherConditions) {
      var precipi = weatherConditions.history.dailysummary[0].precipi - 0;
      var today = weatherConditions.current_observation.precip_today_in - 0;
      return precipi + today;
   }
   return null;
}

exports.rainsensor = function () {
   if (raintrigger == null) return false;
   if (weatherConditions == null) return false;
   var today_in = weatherConditions.current_observation.precip_today_in - 0;
   return (today_in >= raintrigger);
}

// Adjustment formula derived from sprinklers_pi/weather.cpp
function adjustment () {

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

   var humid_factor = 30 - ((maxhumidity + minhumidity) / 2);
   var temp_factor = (meantempi - 70) * 4;
   var rain_factor = 0.0 - ((precipi + precip_today_in) * 200.0);

   return Math.floor(Math.max(0,100+humid_factor+temp_factor+rain_factor));
}

exports.adjust = function (duration) {
   if (weatherConditions == null) return duration;
   var minadjusted = (duration * minadjust) / 100;
   var maxadjusted = (duration * maxadjust) / 100;
   var adjusted    = ((duration * adjustment()) + 50) / 100;
   return Math.floor(Math.min(Math.max(minadjusted, adjusted), maxadjusted));
}

exports.adjustment = adjustment;

