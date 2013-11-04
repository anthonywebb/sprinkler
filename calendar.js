// Copyrigth (C) Pascal Martin, 2013.
//
// NAME
//
//   calendar - a module to read watering programs from Google calendar
//
// SYNOPSYS
//
//   This module implements an interface to Google calendar and
//   converts calendar events into watering programs. The description
//   of each calendar event must match a defined syntax to be valid.
//
//   This module can read more than one calendar.
//
//   This module queries the Google servers not more often than every
//   12 hours, unless the configuration has been changed. The update is
//   asynchronous.
//
// DESCRIPTION
//
//   var calendar = require('./calendar');
//
//   calendar.configure (config);
//
//      Initialize the calendar module from the user configuration.
//      This method can be called as often as necessary (typically
//      when the configuration has changed).
//
//   calendar.refresh ();
//
//      Query the calendar servers for updates. A refresh is executed
//      only if the last one was performed more than a defined interval
//      (12 hours) ago, or if the configuration was changed.
//
//   calendar.programs ();
//
//      Return the list of watering programs built from the last refresh.
//
// CONFIGURATION
//
//   location              The name of the location used for this sprinkler
//                         controller. An event will be loaded only if it's
//                         location matches the controller's location.
//                         (Default: 'home'.)
//
//   calendars             The calendar module configuration array.
//
//   calendars[n].format   Format of calendar data received. This module
//                         only support format "iCalendar" for now.
//
//   calendars[n].name     Base name for this calendar. The name is combined
//                         with the name of each event to generate a unique
//                         watering program name.
//
//   calendars[n].source   The address of the calendar server. This is
//                         typically an URL.

var fs = require('graceful-fs');
var http = require('http');
var https = require('https');

function UnsupportedCalendar (format) {
   this.format = format;
   this.status = "error";
}

var imported = new Object();
imported.calendar = new Array();
imported.programs = new Array();
imported.received = null;

var pendingCalendar = null;

var lastUpdate = 0
var updateInterval = 12 * 3600000; // 12 hours in milliseconds.

var webRequest = null;

// --------------------------------------------------------------------------
// Build the calendar source DB from the sprinkler's configuration.
// (The difference is that we maintain the status for each source in the DB,
// which status we do not want to see reflected in the config saved to disk.)
//
exports.configure = function (config) {

   console.log ("Calendar: analyzing calendar sources in configuration");

   buildZoneIndex(config);

   pendingCalendar = null;
   imported.calendar = new Array();

   if (config.calendars == null) {
      imported.programs = new Array();
      return;
   }

   for (var i = 0; i < config.calendars.length; i++) {

      switch (config.calendars[i].format) {

      case "iCalendar":
         imported.calendar[i] = new ICalendar();
         break;

      case "XML":
         console.error ('Calendar: XML format is not supported yet (in '+config.calendars[i].name+')');
         imported.calendar[i] = new UnsupportedCalendar("XML");
         break;

      default:
         console.error ('Calendar: format '+config.calendars[i].format+' is not supported (in '+config.calendars[i].name+')');
         imported.calendar[i] =
            new UnsupportedCalendar(config.calendars[i].format);
         break;
      }
      imported.calendar[i].name = config.calendars[i].name;
      imported.calendar[i].source = config.calendars[i].source;
   }
   imported.location = config.location;
   if (imported.location == null) {
      imported.location = 'home';
   }

   // Force access to the calendar on configuration change.
   lastUpdate = new Date().getTime();
   loadNextCalendar();
}

// --------------------------------------------------------------------------
// Build a reverse index: from name to zone array index.
// This is done through a function because the configuration may change:
// we must recompute the index before each downloading of the calendar data.
//
var zoneIndex;
function buildZoneIndex(config) {
   zoneIndex = new Array();
   if (config.zones == null) return;
   for (var i = 0; i < config.zones.length; i++) {
      zoneIndex[config.zones[i].name] = i;
   }
}

// --------------------------------------------------------------------------
// Transform an iCalendar event into a Javascript structure.
//
function decodeEventsFromICalendar (text) {

   var lines = text.split('\r\n');
   var events = new Array();
   var event;
   var inVevent = false;

   for (var i = 0; i < lines.length; i++) {

      var operands = lines[i].split(':');
      var attributes = operands[0].split(';');

      switch (attributes[0]) {

      case 'BEGIN':
         switch (operands[1]) {
         case 'VEVENT':
            if (inVevent) {
              console.error("Calendar: BEGIN VEVENT inside EVENT at line " + i + ": " + text);
            }
            event = new Object();
            event.repeat = false;
            event.hasStart = false;
            inVevent = true;
            break;
         }
         break;

      case 'LOCATION':
         if (!inVevent) break;
         event.location = operands[1];
         break;

      case 'SUMMARY':
         if (!inVevent) break;
         event.summary = operands[1];
         break;

      case 'DESCRIPTION':
         if (!inVevent) break;
         event.description = operands[1];
         break;

      case 'DTSTART':
         if (!inVevent) break;
         event.start = new Object();
         if (attributes.length > 1) {
            for (var k = 1; k < attributes.length; k++) {
               var attribute = attributes[k].split('=');
               if (attribute.length > 1) {
                  event.start[attribute[0].toLowerCase()] = attribute[1];
               }
            }
         }
         event.start.time = operands[1];
         event.hasStart = true;
         break;

      case 'RRULE':
         if (!inVevent) break;
         event.rrule = new Object();
         if (attributes.length > 1) {
            for (var k = 1; k < attributes.length; k++) {
               var attribute = attributes[k].split('=');
               if (attribute.length > 1) {
                  event.rrule[attribute[0].toLowerCase()] = attribute[1];
               }
            }
         }
         if (operands.length > 1) {
            var values = operands[1].split(';');
            if (values.length > 1) {
               for (var k = 0; k < values.length; k++) {
                  var value = values[k].split('=');
                  if (value.length > 1) {
                     event.rrule[value[0].toLowerCase()] = value[1];
                  }
               }
            }
         }
         event.repeat = true;
         break;

      case 'END':
         switch (operands[1]) {
         case 'VEVENT':
            if (inVevent) {
               events[events.length] = event;
               inVevent = false;
            }
            break;
         }
         break;
      }
   }

   return events;
};

// --------------------------------------------------------------------------
// Compile the event description into a list of zones.
// Supported syntax:
//
//    name '=' value ' ' ...  or  name ':' value ',' ...
//
function descriptionToZones (text) {
   var zones = new Array();
   var items = text.split(/[ ,]/);
   for (var i = 0; i < items.length; i++) {
      var operands = items[i].split(/[=:]/);
      if (operands.length > 1) {
         var zone = new Object();
         zone.zone = zoneIndex[operands[0]]; // exception?
         zone.seconds = operands[1] * 60;
         zones[zones.length] = zone;
      }
   }
   return zones;
}

// --------------------------------------------------------------------------
// Retrieve options from the event description.
//
// an option is a simple name (no value).
//
function descriptionToOptions (text) {
   var options = new Object();
   options.append = false;
   var items = text.split(/[ ,]/);
   for (var i = 0; i < items.length; i++) {
      if (items[i] == 'append') {
         options.append = true;
      }
   }
   return options;
}

// --------------------------------------------------------------------------
// Translate an iCalendar event into a sprinkler program
//
var iCalendarDaysDictionary = ['SU', 'MO', 'TU','WE', 'TH', 'FR', 'SA'];

function iCalendarToProgram (calendar_name, event) {

   var program = new Object();
   program.active = true;
   program.parent = calendar_name;
   program.name = calendar_name + '/' + event.summary;
   program.start = event.start.time.slice(9,11) +
                      ':' + event.start.time.slice(11,13);
   if (event.repeat) {
      // Set the time of day, interval and day filter.
      switch (event.rrule.freq) {
      case 'DAILY':
         console.log('Calendar: '+program.name + ': DAILY mode is not yet supported');
         return null;
      case 'WEEKLY':
         var days = event.rrule.byday.split(',');
         program.days = new Array();
         for (var k = 0; k < days.length; k++) {
            thisDay = iCalendarDaysDictionary.indexOf(days[k])
            if (thisDay >= 0) {
               program.days[program.days.length] = thisDay;
            } else {
               console.log('Calendar: '+days[k]+' is not a valid iCalendar day of the week');
            }
         }
         program.zones = descriptionToZones (event.description);
         program.options = descriptionToOptions (event.description);
         break;
      }
   } else {
     program.date = event.start.time.slice(0,8);
   }

   return program;
}

// --------------------------------------------------------------------------
// The iCalendar class.
//
function ICalendar () {
   this.format = "iCalendar";
   this.status = 'idle';
}

// --------------------------------------------------------------------------
// Import iCalendar events from one calendar into sprinkler programs.
//
// We may receive the data in multiple chunks. We must accumulate all data
// received until the end of the iCalendar data before we start decoding.
//
ICalendar.prototype.import = function (text) {

   if (imported.received != null) {
      //console.log("Calendar: received additional iCalendar data:\n" + text + "\n");
      text = imported.received + text;
   }

   if (text.search(/END:VCALENDAR/) < 0) {
      //console.log("Calendar: received incomplete iCalendar data:\n" + text + "\n");
      imported.received = text;
      return false; // Waiting for the end of the calendar data.
   }
   imported.received = null; // We do not need this buffer anymore.

   var events = decodeEventsFromICalendar(text);

   // Disable all existing programs for that calendar, now that
   // the new calendar events are available.
   // This makes it possible to detect events that disappeared
   // (see function pruneObsoletePrograms).

   for (var i = 0; i < imported.programs.length; i++) {
      if (imported.programs[i].parent == pendingCalendar.name) {
         imported.programs[i].active = false;
      }
   }

   var count = 0;
   for (var i = 0; i < events.length; i++) {

      // Ignore all-day events and events for other controllers
      if (!events[i].hasStart) continue;
      if (events[i].location != imported.location) continue;

      count += 1;

      var program = iCalendarToProgram (pendingCalendar.name, events[i]);
      if (program != null) {
         var is_new_program = true;
         for (var j = 0; j < imported.programs.length; j++) {
            if (imported.programs[j].name == program.name) {
               imported.programs[j] = program;
               is_new_program = false;
               break;
            }
         }
         if (is_new_program) {
            imported.programs[imported.programs.length] = program;
         }
      }
   }

   console.log ('Calendar: loaded '+count+' programs from '+pendingCalendar.name);
   pendingCalendar.status = 'ok';
   pendingCalendar = null;
   events = null;
   text = null;

   return true;
}

// --------------------------------------------------------------------------
// Remove unused or obsolete programs
// There are two cases:
// - program's parent is no longer present.
// - program was de-activated before decoding the parent's data and was not
//   reactivated because we did not find it anymore.
//
function pruneObsoletePrograms() {

   var present = new Array();
   var programs = new Array();

   for (var i = 0; i < imported.calendar.length; i++) {
      present[imported.calendar[i].name] = 1;
   }

   for (var i = 0; i < imported.programs.length; i++) {

      if (imported.programs[i].active == null) continue;
      if (present[imported.programs[i].parent] == null) continue;

      programs[programs.length] = imported.programs[i];
   }
   imported.programs = programs;
   present = null;
   programs = null;
}

// --------------------------------------------------------------------------
// Cancel the load of a calendar due to network error.
//
function cancelCalendarLoad (e) {

   if (pendingCalendar == null) return;

   imported.received = null; // Forget all data in transit.
   pendingCalendar.status = 'failed';
   console.error('Calendar: '+pendingCalendar.name + ': ' + e.message);
   pendingCalendar = null;
}

// --------------------------------------------------------------------------
// Access a web calendar.
function loadWebCalendar (proto) {

     webRequest = proto.request(pendingCalendar.source, function(res) {
        res.on('data', function(d) {
           if (pendingCalendar == null) return;
           if (pendingCalendar.import(d.toString())) {
              loadNextCalendar(); // recursive. Are we confusing the GC?
           }
        });
   
     });
     webRequest.on('error', function(e) {
        cancelCalendarLoad (e);
        loadNextCalendar(); // recursive. Are we confusing the GC?
     });
     webRequest.end();
     proto = null;
}

// --------------------------------------------------------------------------
// Access a calendar file.
function loadFileCalendar () {

    var data = null;

    try {
       data = fs.readFileSync(imported.calendar[i].source.slice(5));
    }
    catch(err) {
       console.error ('Calendar: file '+imported.calendar[i].source.slice(5)+' not found');
    }
    if (data != null) {
       if (! pendingCalendar.import(data.toString())) {
          console.error ('Calendar: invalid data in file '+pendingCalendar.source.slice(5));
       }
       data = null;
    }
}

// --------------------------------------------------------------------------
// Initiate the GET request for the first 'idle' calendar.
//
// This is a recursive function that calls itself when processing is
// complete for the current (pending) calendar.
//
// The status of a calendar is changed as soon as the GET request has
// been initiated. This status will no be put back to 'idle'.
// As a consequence, this function will scan through the whole list
// of calendars, one by one.
//
// We process all calendar accesses sequentially because of an apparent
// limitation of the http/https framework: seems to be no way to identify
// the request context when processing the response (http.IncomingMessage).
// So there is no choice but to keep a reference to the current calendar
// as a global, i.e. process only one calendar at a time.
//
function loadNextCalendar () {

   if (pendingCalendar != null) {
      console.log ('Calendar: too early, calendar '+pendingCalendar+' is pending');
      return;
   }

   for (var i = 0; i < imported.calendar.length; i++) {

      if (imported.calendar[i].status == 'pending') return; // Too early.
      if (imported.calendar[i].status != 'idle') continue;

      console.log("Calendar: importing calendar " + imported.calendar[i].name);
      pendingCalendar = imported.calendar[i];
      pendingCalendar.status = 'pending';

      if (pendingCalendar.source.match ("file:.*")) {

         console.log ('Calendar: accessing file '+pendingCalendar.source.slice(5));
         loadFileCalendar();
         continue; // Load next calendar.
      }

      console.log ('Calendar: accessing '+imported.calendar[i].source);

      if (imported.calendar[i].source.match ("https://.*")) {
         loadWebCalendar(https);
         return; // Must wait for this calendar load be complete.
      }

      if (imported.calendar[i].source.match ("http://.*")) {
         loadWebCalendar(http);
         return; // Must wait for this calendar load be complete.
      }

      // The calendar source URL does not match any supported protocol.

      console.error ('Calendar: unsupported protocol for '+imported.calendar[i].name +" in '"+ imported.calendar[i].source + "'");
      imported.calendar[i].status = 'error';
      imported.received = null;
   }

   // We are done processing all calendars.
   webRequest = null;
   pendingCalendar = null;
   pruneObsoletePrograms();
   console.log("Calendar: import complete");
}


// --------------------------------------------------------------------------
// Method for periodic calndar refresh.
exports.refresh = function () {

   var time = new Date().getTime();

   // Throttle when to request for information, to limit traffic.
   if (time < lastUpdate + updateInterval) return;
   lastUpdate = time;

   loadNextCalendar();
}

// --------------------------------------------------------------------------
// Method to get the list of watering programs from calendars.
exports.programs = function () {
   var active_programs = new Array();
   for (var i = 0; i < imported.programs.length; i++) {
      if (imported.programs[i].active) {
         active_programs[active_programs.length] = imported.programs[i];
      }
   }
   return active_programs;
}

