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
//   weather.high ();
//
//      return the high temperature for the previous day.
//
//   weather.low ();
//
//      return the low temperature for the previous day.
//
//   weather.humidity ();
//
//      return the average humidity for the previous day.
//
//   weather.rain ();
//
//      return the total rain level for the last two days in inches.
//
//   weather.windspeed ();
//
//      return the average wind speed for the previous day.
//
//   weather.winddirection ();
//
//      return the wind direction for the previous day.
//
//   weather.pressure ();
//
//      return the average air pressure for the previous day.
//
//   weather.gust ();
//
//      return the maximum wind speed for the previous day.
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
//   zipcode             The local USPS zipcode, used if no weather station
//                       was specified.
//
//   weather             The weather module configuration object.
//                       If missing, the weather module is disabled.
//
//   weather.station     A specific weather station to query from.
//
//   weather.refresh     When to refresh weather information. This is
//                       an array of times of day (hour[:min]). One cannot
//                       schedule two refresh within the same hour. The
//                       minute part is used to control when, within each
//                       hour, the refresh occurs, This is typically used
//                       to control if the refresh occurs at the beginning
//                       or at the end of the hour period.
//
//   weather.key         The Weather Underground access key.
//                       If missing, the weather module is disabled.
//
//   weather.adjust      Parameters for the weather adjustment formula.
//                       This is a data structure with the following fields:
//                          min:         minimal adjustment (default: 30)
//                          max:         maximal adjustment (default: 150)
//                          temperature: base temperature (default: 70)
//                          humidity:    base humidity (default: 30)
//                          sensitivity  (percentage, default: 100)
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
var refreshSchedule = new Array();;

var url = null;
var enable = false;
var raintrigger = null;

var adjustParameters = new Object();

var debugLog = function (text) {}

function verboseLog (text) {
   console.log ('[DEBUG] Weather: '+text);
}

function errorLog (text) {
   console.log ('[ERROR] Weather: '+text);
}

function restoreDefaults () {

   url = null;
   enable = false;
   raintrigger = null;
   refreshSchedule = new Array();;

   adjustParameters.enable = true;
   adjustParameters.min = 30;
   adjustParameters.max = 150;
   adjustParameters.humidity = 30;
   adjustParameters.temperature = 70;
   adjustParameters.sensitivity = 100;
}
restoreDefaults();

exports.configure = function (config, options) {

   if (options && options.debug) {
      debugLog = verboseLog;
   }
   restoreDefaults();

   if (! config.weather) return;
   if (! config.weather.key) return;

   enable = config.weather.enable;
   if (!enable) {
      weatherConditions = null;
      return;
   }

   if (config.weather.station) {
      url = 'http://api.wunderground.com/api/'
                   + config.weather.key + '/yesterday/conditions/q/'
                   + 'pws:' + config.weather.station + '.json';
   } else {
      url = 'http://api.wunderground.com/api/'
                   + config.weather.key + '/yesterday/conditions/q/'
                   + config.zipcode + '.json';
   }
   debugLog('URL used is '+url);

   if (config.weather.refresh) {
      for (var i = 0; i < config.weather.refresh.length; i++) {
         var option = config.weather.refresh[i].split(':');
         if ((option.length > 0) && (option.length <= 2)) {
            var j = refreshSchedule.length;
            refreshSchedule[j] = new Object();
            refreshSchedule[j].hour = option[0] - 0;
            if (option.length > 1) {
               refreshSchedule[j].minute = option[1] - 0;
            } else {
               refreshSchedule[j].minute = 0;
            }
            refreshSchedule[j].armed = true;
         }
      }
   }

   if (config.weather.adjust) {
      if (config.weather.adjust.enable !== undefined) {
         adjustParameters.enable = config.weather.adjust.enable;
      }
      if (config.weather.adjust.min !== undefined) {
         adjustParameters.min = config.weather.adjust.min - 0;
      }
      if (config.weather.adjust.max !== undefined) {
         adjustParameters.max = config.weather.adjust.max - 0;
      }
      if (config.weather.adjust.temperature !== undefined) {
         adjustParameters.temperature = config.weather.adjust.temperature - 0;
      }
      if (config.weather.adjust.humidity !== undefined) {
         adjustParameters.humidity = config.weather.adjust.humidity - 0;
      }
      if (config.weather.adjust.sensitivity !== undefined) {
         adjustParameters.sensitivity = config.weather.adjust.sensitivity - 0;
      }
   }

   raintrigger = config.weather.raintrigger;

   if (weatherConditions) {
      // Force a refresh soon, but not immediately (to avoid consuming
      // the quota too fast if the user makes small changes to the config).
      // (Do it in 10 minutes.)
      lastUpdate = new Date().getTime() - updateInterval + 600000;
   } else {
      // That is the first time we ask. Do it now.
      getWeatherNow();
   }
}

function toBeRefreshed (now) {

   var hour = now.getHours();
   var minute = now.getMinutes();

   var result = false;

   for (var i = 0; i < refreshSchedule.length; i++) {

      if (refreshSchedule[i].hour == hour) {
         if (refreshSchedule[i].armed) {
            if (minute >= refreshSchedule[i].minute) {
               refreshSchedule[i].armed = false;
               result = true; // ---- One scheduled time has come.
            }
         }
      } else {
         refreshSchedule[i].armed = true;
      }
   }
   return result;
}

function getWeather () {

   var now = new Date();
   var time = now.getTime();

   // Throttle when to request for information, to avoid being blocked.
   // Two options: user-scheduled refresh times, or else periodic.
   if (refreshSchedule.length > 0) {
      if (toBeRefreshed(now)) {
         getWeatherNow();
      }
   } else if (time > lastUpdate + updateInterval) {
      getWeatherNow();
   }
}

function getWeatherNow () {

   lastUpdate = new Date().getTime();

   debugLog ('checking for update..');
   received = "";

   var webRequest = http.request(url, function(res) {
      res.on('data', function(d) {
         received = received + d.toString();
      });
      res.on('end', function(d) {
         var newreport = null;
         try {
            newreport = JSON.parse(received);
         }
         catch (err) {
            if (received.search (/<TITLE>Service Unavailable<\/TITLE>/) > 0) {
               errorLog('service unavailable');
            } else {
               errorLog('received invalid data = '+received);
            }
            received = null;
            return;
         }
         if ((newreport.history === undefined) ||
             (newreport.history.dailysummary === undefined) ||
             (newreport.current_observation === undefined)) {
            errorLog ('invalid response from '+url+': '+received);
         } else {
            weatherConditions = newreport;
            weatherConditions.updated = new Date();
            debugLog ('received update');
         }
         received = null;
      });
   });
   webRequest.on('error', function(e) {
      received = null;
      errorLog ('error response from '+url+': '+e);
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
      return adjustParameters.enable;
   }
   return false;
}

function temperature () {
   if (weatherConditions) {
      return +weatherConditions.history.dailysummary[0].meantempi;
   }
   return null;
}
exports.temperature = temperature;

exports.high = function () {
   if (weatherConditions) {
      return +weatherConditions.history.dailysummary[0].maxtempi;
   }
   return null;
}

exports.low = function () {
   if (weatherConditions) {
      return +weatherConditions.history.dailysummary[0].mintempi;
   }
   return null;
}

function humidity () {
   if (weatherConditions) {
      max = +weatherConditions.history.dailysummary[0].maxhumidity;
      min = +weatherConditions.history.dailysummary[0].minhumidity;
      return Math.floor((max + min ) / 2);
   }
   return null;
}
exports.humidity = humidity;

function windspeed () {
   if (weatherConditions) {
      return +weatherConditions.history.dailysummary[0].meanwindspdi;
   }
   return null;
}
exports.windspeed = windspeed;

function gust () {
   if (weatherConditions) {
      return +weatherConditions.history.dailysummary[0].maxwspdi;
   }
   return null;
}
exports.gust = gust;

function winddirection () {
   if (weatherConditions) {
      return weatherConditions.history.dailysummary[0].meanwdire;
   }
   return null;
}
exports.winddirection = winddirection;

function pressure () {
   if (weatherConditions) {
      var summary = weatherConditions.history.dailysummary[0];
      if (summary.meanpressurei === undefined) {
         // Calculate mean with 2 decimal digit precision.
         return Math.floor(100*((+summary.minpressurei) + (+summary.maxpressurei)) / 2) / 100;
      }
      return +summary.meanpressurei;
   }
   return null;
}
exports.pressure = pressure;

function dewpoint () {
   if (weatherConditions) {
      var summary = weatherConditions.history.dailysummary[0];
      if (summary.meandewpti === undefined) {
         return Math.floor(((+summary.mindewpti) + (+summary.maxdewpti)) / 2);
      }
      return +weatherConditions.history.dailysummary[0].meandewpti;
   }
   return null;
}
exports.dewpoint = dewpoint;

function rain () {
   if (weatherConditions) {
      var precipi = +weatherConditions.history.dailysummary[0].precipi;
      var today = +weatherConditions.current_observation.precip_today_in;
      return precipi + today;
   }
   return null;
}
exports.rain = rain;

exports.rainsensor = function () {
   if (raintrigger == null) return false;
   if (weatherConditions == null) return false;
   var today_in = +weatherConditions.current_observation.precip_today_in;
   return (today_in >= raintrigger);
}

// Adjustment formula derived from sprinklers_pi/weather.cpp
function adjustment () {

   if (weatherConditions == null) return 100;

   var humid_factor = adjustParameters.humidity - humidity();
   var temp_factor = (temperature() - adjustParameters.temperature) * 4;
   var rain_factor = 0.0 - (rain() * 200.0);

   var adjust = humid_factor + temp_factor + rain_factor;
   adjust = (adjustParameters.sensitivity * adjust) / 100;

   return Math.floor(Math.max(0,100+adjust));
}

exports.adjust = function (duration) {
   if (weatherConditions == null) return duration;
   if (! adjustParameters.enable) return duration;
   var minadjusted = ((duration * adjustParameters.min) + 50) / 100;
   var maxadjusted = ((duration * adjustParameters.max) + 50) / 100;
   var adjusted    = ((duration * adjustment()) + 50) / 100;
   return Math.floor(Math.min(Math.max(minadjusted, adjusted), maxadjusted));
}

exports.adjustment = adjustment;

