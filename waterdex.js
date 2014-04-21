// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   waterdex - a module to access the water index from waterdex.com
//
// SYNOPSYS
//
//   This module implements an interface to the waterdex.com web site.
//   It returns an evapotranspiration-based watering index. This index
//   helps adjust the watering duration for all zones (the adjustment
//   is calculated as a percentage of the configured duration), and
//   simulate a rain sensor.
//
//   This module queries the waterdex web site at a scheduled time.
//   The update is asynchronous: it is recommended to refresh the
//   watering index information a few minutes before a program is activated.
//
// DESCRIPTION
//
//   var waterdex = require('./waterdex');
//
//   waterdex.configure (config, options);
//
//      Initialize the weather module from the user configuration.
//      This method can be called as often as necessary (typically
//      when the configuration has changed).
//
//   waterdex.refresh ();
//
//      Query the waterdex web site for updates. The refresh is
//      executed only at the scheduled time.
//
//   waterdex.status ();
//
//      Return the latest status of the weather data service: true if
//      an update was successfully completed on the last attempt, false
//      otherwise.
//
//   waterdex.updated ();
//
//      Return the time of the latest successful weather data update.
//
//   waterdex.enabled ();
//
//      Return true if the weather adjustment feature is both enabled
//      and data is available.
//
//   waterdex.adjust (duration);
//
//      return the weather-adjusted watering duration.
//
//   waterdex.adjustment ();
//
//      return the raw weather adjustment ratio (not subject to mix/max
//      limits).
//
// CONFIGURATION
//
//   zipcode             The local USPS zipcode.
//
//   waterdex            The weather module configuration object.
//                       If missing, the weather module is disabled.
//
//   waterdex.refresh    When to refresh weather information. This is
//                       an array of times of day (hour[:min]). One cannot
//                       schedule two refresh within the same hour. The
//                       minute part is used to control when, within each
//                       hour, the refresh occurs, This is typically used
//                       to control if the refresh occurs at the beginning
//                       or at the end of the hour period.
//
//   waterdex.adjust     Parameters for the weather adjustment formula.
//                       This is a data structure with the following fields:
//                          min:         minimal adjustment (default: 30)
//                          max:         maximal adjustment (default: 150)
//

var http = require('http');

var received = null;
var waterdexData = null;

var lastUpdate = 0
var updateInterval = 6 * 3600000; // 6 hours in milliseconds.
var refreshSchedule = new Array();;

var url = null;
var enable = false;
var raintrigger = null;
var webRequest = null;

var adjustParameters = new Object();

var debugLog = function (text) {}

function verboseLog (text) {
   console.log ('[DEBUG] Weather: '+text);
}

function restoreDefaults () {

   url = null;
   enable = false;
   raintrigger = null;
   refreshSchedule = new Array();;

   adjustParameters.min = 30;
   adjustParameters.max = 150;
}
restoreDefaults();

exports.configure = function (config, options) {

   if (options && options.debug) {
      debugLog = verboseLog;
   }
   restoreDefaults();

   if (! config.waterdex) return;

   url = 'http://wi.waterdex.com/waterdex/index?zipcode='
                + config.zipcode + '&tmpl=waterdex';

   if (config.waterdex.refresh) {
      for (var i = 0; i < config.waterdex.refresh.length; i++) {
         var option = config.waterdex.refresh[i].split(':');
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

   if (config.waterdex.adjust) {
      if (config.waterdex.adjust.min) {
         adjustParameters.min = config.waterdex.adjust.min - 0;
      }
      if (config.waterdex.adjust.max) {
         adjustParameters.max = config.waterdex.adjust.max - 0;
      }
   }

   enable = config.waterdex.enable;

   if (waterdexData) {
      // Force a refresh soon, but not immediately (to avoid overloading
      // the Waterdex web site).
      // (Do it in 10 minutes.)
      lastUpdate = new Date().getTime() - updateInterval + 600000;
   } else {
      // That is the first time we ask. Do it now.
      getWateringIndexNow();
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

function getWateringIndex () {

   if (! enable) return;

   var now = new Date();
   var time = now.getTime();

   // Throttle when to request for information, to avoid being blocked.
   // Two options: user-scheduled refresh times, or else periodic.
   if (refreshSchedule.length > 0) {
      if (toBeRefreshed(now)) {
         getWateringIndexNow();
      }
   } else if (time > lastUpdate + updateInterval) {
      getWateringIndexNow();
   }
}

function extractWateringIndex (text) {

   text = text.substring (text.search(/<[hH]4><[pP]>/),
                          text.search(/<\/[pP]><\/[hH]4>/));
   index = text.substring (text.search(/[0-9]{2,3}%/));
   index = index.substring (0, index.search(/%/));
   return parseInt(index, 10);
}

function getWateringIndexNow () {

   if (! enable) return;

   lastUpdate = new Date().getTime();

   debugLog ('checking for update..');
   received = "";

   webRequest = http.request(url, function(res) {
      res.on('data', function(d) {
         received = received + d.toString();
      });
      res.on('end', function(d) {
         waterdexData = new Object();
         waterdexData.waterindex = extractWateringIndex (received);
         waterdexData.updated = new Date();
         debugLog ('received update');
         received = null;
      });
   });
   webRequest.on('error', function(e) {
      received = null;
      waterdexData = null;
   });
   webRequest.end();
   webRequest = null;
}

exports.refresh = function () {

   if (url) {
      getWateringIndex();
   }
}

exports.status = function () {
   if (waterdexData) {
      return true;
   }
   return false;
}

exports.updated = function () {
   if (waterdexData) {
      return waterdexData.updated;
   }
   return {};
}

exports.enabled = function () {
   if (waterdexData) {
      return enable;
   }
   return false;
}

function adjustment () {

   if (waterdexData) {
      return waterdexData.waterindex;
   }
   return 100;
}

exports.adjust = function (duration) {
   if (waterdexData == null) return duration;
   var minadjusted = ((duration * adjustParameters.min) + 50) / 100;
   var maxadjusted = ((duration * adjustParameters.max) + 50) / 100;
   var adjusted    = ((duration * adjustment()) + 50) / 100;
   return Math.floor(Math.min(Math.max(minadjusted, adjusted), maxadjusted));
}

exports.adjustment = adjustment;

