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
//   calendar.configure (config, options);
//
//      Initialize the calendar module from the user configuration.
//      This method can be called as often as necessary (typically
//      when the configuration has changed).
//
//   calendar.refresh ();
//
//      Query the calendar servers for updates. A refresh is executed
//      only if the last one was performed more than a defined interval
//      (every hour), or if the configuration was changed.
//
//   calendar.status ();
//
//      Return the status of the latest calendar update. The status is an
//      array of structures. Each structure contains the calendar name,
//      a boolean status and an update time.
//
//   calendar.programs ();
//
//      Return the list of watering programs built from the last refresh.
//
// CONFIGURATION
//
//   timezone              The default time zone used by this controller.
//
//   location              The name of the location used for this sprinkler
//                         controller. An event will be loaded only if it's
//                         location matches the controller's location. This
//                         match is not case sensitive. (Default: 'home'.)
//
//   calendars             The calendar module configuration array.
//
//   calendars[n].format   Format of calendar data received. This module
//                         only support format "iCalendar" for now, which
//                         is also the default.
//
//   calendars[n].name     Base name for this calendar. The name is combined
//                         with the name of each event to generate a unique
//                         watering program name.
//
//   calendars[n].season   The season when this calendar is active.
//
//   calendars[n].source   The address of the calendar server. This is
//                         typically an URL.
//
//   calendars[n].disabled A boolean. The calendar entry is not used if true.
//                         This is used to desactivate a calendar without
//                         removing its (typically long) URL. The default
//                         is false.

var fs = require('graceful-fs');
var moment = require('moment-timezone');
var http = require('http');
var https = require('https');

function errorLog (text) {
   console.error('[ERROR] Calendar: '+text);
}

function infoLog (text) {
   console.log('[INFO] Calendar: '+text);
}

var debugLog = function (text) {}

function verboseLog (text) {
   console.log('[DEBUG] Calendar: '+text);
}

function UnsupportedCalendar (format) {
   this.format = format;
   this.status = 'disabled';
}

var defaultTimezone = null;

var imported = new Object();
imported.calendar = new Array();
imported.programs = new Array();
imported.received = null;
imported.updated = null;

var pendingCalendar = null;

var lastUpdateHour = null;

var webRequest = null;

// --------------------------------------------------------------------------
// Build the calendar source DB from the sprinkler's configuration.
// (The difference is that we maintain the status for each source in the DB,
// which status we do not want to see reflected in the config saved to disk.)
//
exports.configure = function (config, options) {

   if (options && options.debug) {
      debugLog = verboseLog;
   }
   debugLog ("analyzing calendar sources in configuration");

   buildZoneIndex(config);

   pendingCalendar = null;
   imported.calendar = new Array();

   if (config.calendars == null) {
      imported.programs = new Array();
      return;
   }

   defaultTimezone = config.timezone;

   for (var i = 0; i < config.calendars.length; i++) {

      var format = config.calendars[i].format;
      if (! format)
         format = "iCalendar";

      if (config.calendars[i].disabled) {
         imported.calendar[i] = new UnsupportedCalendar(format);
         continue;
      }

      switch (format) {

      case "iCalendar":
         imported.calendar[i] = new ICalendar();
         break;

      case "XML":
         errorLog ('XML format is not supported yet (in '+config.calendars[i].name+')');
         imported.calendar[i] = new UnsupportedCalendar("XML");
         break;

      default:
         errorLog ('format '+format+' is not supported (in '+config.calendars[i].name+')');
         imported.calendar[i] = new UnsupportedCalendar(format);
         break;
      }
      imported.calendar[i].name = config.calendars[i].name;
      if (config.calendars[i].season) {
         imported.calendar[i].season = config.calendars[i].season;
      }
      imported.calendar[i].source = config.calendars[i].source;
   }
   if (config.location) {
      imported.location = config.location.toLowerCase();
   } else {
      imported.location = 'home';
   }

   // Force access to the calendar on configuration change.
   lastUpdateHour = new Date().getHours();
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

   // Restore long lines per RFC5545, section 3.1
   text = text.replace(/\r\n[ \t]/g,"");

   var lines = text.split('\r\n');
   var events = new Array();
   var event;
   var inVevent = false;
   var inVtimezone = false;
   var timezone = defaultTimezone;

   for (var i = 0; i < lines.length; i++) {

      var operands = lines[i].split(':');
      var attributes = operands[0].split(';');

      switch (attributes[0]) {

      case 'BEGIN':
         switch (operands[1]) {
         case 'VTIMEZONE':
            if (inVtimezone) {
              errorLog("BEGIN VTIMEZONE inside TIMEZONE at line " + i + ": " + text);
            }
            inVtimezone = true;
            break;
         case 'VEVENT':
            if (inVevent) {
              errorLog("BEGIN VEVENT inside EVENT at line " + i + ": " + text);
            }
            event = new Object();
            inVevent = true;
            break;
         }
         break;

      case 'TZID':
         if (!inVtimezone) break;
         timezone = operands[1];
         break;

      case 'RECURRENCE-ID':
         if (!inVevent) break;
         event.recurrence = new Object();
         if (attributes.length > 1) {
            for (var k = 1; k < attributes.length; k++) {
               var attribute = attributes[k].split('=');
               if (attribute.length > 1) {
                  event.recurrence[attribute[0].toLowerCase()] = attribute[1];
               }
            }
         }
         event.recurrence.time = operands[1];
         break;

      case 'SEQUENCE':
         if (!inVevent) break;
         event.sequence = operands[1];
         break;

      case 'UID':
         if (!inVevent) break;
         event.uid = operands[1];
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
         if (event.start.value == 'DATE') {
            event.start = null; // We do not care about an all day event.
         } else {
            event.start.time = operands[1];
         }
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
            if (values.length >= 1) {
               for (var k = 0; k < values.length; k++) {
                  var value = values[k].split('=');
                  if (value.length > 1) {
                     event.rrule[value[0].toLowerCase()] = value[1];
                  }
               }
            }
         }
         break;

      case 'EXDATE':
         if (!inVevent) break;
         if (operands.length > 1) {
            var tzid = null;
            if (attributes.length > 1) {
               for (var k = 1; k < attributes.length; k++) {
                  var attribute = attributes[k].split('=');
                  if (attribute.length > 1) {
                     if (attribute[0] == 'TZID') {
                        tzid = attribute[1];
                     }
                  }
               }
            }
            var values = operands[1].split(';');
            event.exdate = new Array();
            for (var k = 0; k < values.length; k++) {
               var exclusion = new Object();
               if (tzid) exclusion.tzid = tzid;
               exclusion.time = values[k];
               event.exdate[event.exdate.length] = exclusion;
            }
         }
         break;

      case 'END':
         switch (operands[1]) {
         case 'VTIMEZONE':
            if (inVtimezone) {
               inVtimezone = false;
            }
            break;
         case 'VEVENT':
            if (inVevent) {
               if (event.start) {
                  if (timezone) {
                     event.timezone = timezone;
                  }
                  events[events.length] = event;
               } else {
                  debugLog ('ignoring all day event '+event.summary);
               }
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
         if (zone.zone == null) {
             errorLog ('unsupported zone name '+operands[0]);
             return null;
         }
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
// Decode date and time in a timezone-aware way
//
function dateToMoment(date, defaulttimezone) {
   var time = date.time.slice(0,8)+date.time.slice(9,15);
   var result;
   if (date.time.match(/Z$/)) {
      result = moment(time+'+0000', 'YYYYMMDDHHmmSSZ');
   } else if (date.tzid) {
      result = moment.tz(time, "YYYYMMDDHHmmSS", date.tzid);
   } else {
      result = moment.tz(time, 'YYYYMMDDHHmmSS', defaulttimezone);
   }
   // Switch from the calendar's timezone to the local timezone.
   return moment(result.valueOf());
}

// --------------------------------------------------------------------------
// Translate an iCalendar event into a sprinkler program
//
var iCalendarDaysDictionary = ['SU', 'MO', 'TU','WE', 'TH', 'FR', 'SA'];

function iCalendarToProgram (calendar_name, event) {

   var now = moment();
   var start = dateToMoment(event.start, event.timezone);
   if (!start.isValid()) {
      infoLog ('ignoring event '+event.summary+' (invalid start '+event.start+')');
      return null;
   }

   var program = new Object();
   program.active = true;
   program.parent = calendar_name;
   program.name = event.summary+'@'+calendar_name;
   program.start = start.format('HH:mm');
   program.date = start.format('YYYYMMDD');

   program.repeat = 'none'; // Default.
   program.exclusions = new Array();

   if (event.rrule) {
      // RFC 5545, section 3.3.10: UNTIL
      if (event.rrule.until != undefined) {
         var until = dateToMoment({time:event.rrule.until,tzid:event.start.tzid}, event.timezone);
         if (now.diff(until) >= 60000) { // Up to a minute leeway.
            infoLog ('ignoring recurring event '+program.name+' (expired)');
            return null;
         }
         program.until = until;
      }
      // Set the time of day, interval and day filter.
      switch (event.rrule.freq) {
      case 'DAILY':
         program.repeat = 'daily';
         program.interval = event.rrule.interval;
         if (! program.interval) {
            program.interval = 1;
         }
         break;

      case 'WEEKLY':
         var days = event.rrule.byday.split(',');
         program.repeat = 'weekly';
         program.days = [false, false, false, false, false, false, false];
         for (var k = 0; k < days.length; k++) {
            thisDay = iCalendarDaysDictionary.indexOf(days[k])
            if (thisDay >= 0) {
               program.days[thisDay] = true;
            } else {
               errorLog (days[k]+' is not a valid iCalendar day of the week');
            }
         }
         break;

      default:
         errorLog ('ignoring recurring event '+program.name+' (unsupported frequence '+event.rrule.freq+')');
         program = null;
         return null;
      }

      // Record the exceptions.

      if (event.exceptions) {
         // An exception is a modified event that replace an existing
         // occurrence: this is both an additional event and an exclusion
         // of the original event occurrence.
         program.exceptions = new Array();
         for (var item in event.exceptions) {
            var exception = event.exceptions[item];
            var update = new Object();
            var replaces = dateToMoment (exception.recurrence, event.timezone);
            var start = dateToMoment(exception.start, event.timezone);
            if ((now.diff(start) > 60000) &&
                (now.diff(replaces) > 60000)) continue; // Expired.
            update.zones = descriptionToZones (exception.description);
            update.options = descriptionToOptions (exception.description);
            update.repeat = 'none';
            update.date = start.format('YYYYMMDD');
            update.start = start.format('HH:mm');
            update.name = program.name; // Same as parent.
            program.exceptions[program.exceptions.length] = update;
            program.exclusions[program.exclusions.length] = replaces;
         }
      }

   } else {
      if (now.diff(start) >= 60000) { // Up to a minute leeway.
         infoLog ('ignoring single event '+program.name+' (expired)');
         return null;
      }
   }

   if (event.exdate) {
      for (var i = 0; i < event.exdate.length; i++) {
         program.exclusions[program.exclusions.length] =
            dateToMoment(event.exdate[i], event.timezone);
      }
   }

   program.uid = event.uid;
   program.zones = descriptionToZones (event.description);
   program.options = descriptionToOptions (event.description);

   if (! program.zones) {
      errorLog('ignoring  event '+program.name+' (unsupported zone name)');
      return null;
   }

   infoLog ('importing event '+program.name+' at '+program.start+' starting on '+program.date);
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
ICalendar.prototype.import = function (text) {

   debugLog ('received '+text);

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

   // Link together related events (same UID). The original (main) event
   // are the root elements, the other events are updates to main events.
   // Since the events are listed in arbitrary order, we need two phases:
   // map all the main events and then map the update events as exceptions
   // to their respective main events. After that we only need to consider
   // the main events.

   var eventmap = new Object();
   var mainevents = new Array();

   for (var i = 0; i < events.length; i++) {
      if (events[i].recurrence == undefined) {
         debugLog ('processing event '+events[i].summary+' (main event)');
         eventmap[events[i].uid] = events[i];
         mainevents[mainevents.length] = events[i];
      }
   }

   for (var i = 0; i < events.length; i++) {
      if (events[i].recurrence) {
         debugLog ('processing event '+events[i].summary+' (event update)');
         if (eventmap[events[i].uid]) {
            var parent = eventmap[events[i].uid];
            if (parent.exceptions == undefined) {
               parent.exceptions = new Object();
            }
            var item = events[i].recurrence.time;
            if (parent.exceptions[item]) {
               // Only remember the most recent update.
               if (events[i].sequence > parent.exceptions[item].sequence) {
                  parent.exceptions[item] = events[i];
               }
            } else {
               parent.exceptions[item] = events[i];
            }
         }
      }
   }

   events = mainevents;
   eventmap = null;

   // Now we have the information needed to generate the watering programs.

   for (var i = 0; i < events.length; i++) {

      debugLog ('processing event '+events[i].summary+' (create program)');
      for (var item in events[i].exceptions) {
         debugLog ('event '+events[i].summary+' updated at '+item);
      }

      // Ignore all-day events and events for other controllers
      if (!events[i].start) {
         infoLog ('ignoring event '+events[i].summary+' (all day event)');
         continue;
      }
      if (events[i].location.toLowerCase() != imported.location) {
         infoLog ('ignoring event '+events[i].summary+' (not this location)');
         continue;
      }

      var program = iCalendarToProgram (pendingCalendar.name, events[i]);
      if (program != null) {
         if (pendingCalendar.season) {
            program.season = pendingCalendar.season;
         }
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

   infoLog ('loaded '+imported.programs.length+' programs from '+pendingCalendar.name);
   pendingCalendar.status = 'ok';
   pendingCalendar.updated = new Date();
   pendingCalendar = null;
   events = null;
   text = null;
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
   errorLog (pendingCalendar.name + ': ' + e.message);
   pendingCalendar = null;
}

// --------------------------------------------------------------------------
// Access a web calendar.
function loadWebCalendar (proto) {

     imported.received = "";

     webRequest = proto.request(pendingCalendar.source, function(res) {
        res.on('data', function(d) {
           if (pendingCalendar == null) return;
           imported.received = imported.received + d.toString();
        });
        res.on('end', function(d) {
           if (pendingCalendar == null) return;
           pendingCalendar.import(imported.received);
           imported.received = null; // We do not need this buffer anymore.
           loadNextCalendar(); // recursive. Are we confusing the GC?
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
       errorLog ('file '+imported.calendar[i].source.slice(5)+' not found');
    }
    if (data != null) {
       pendingCalendar.import(data.toString());
       data = null;
    }
}

// --------------------------------------------------------------------------
// Start the process of updating all calendars.
//
// Don't do anything if there is any pending request.
//
function loadCalendars () {

   if (pendingCalendar != null) {
      errorLog ('too early, calendar '+pendingCalendar+' is pending');
      return;
   }

   for (var i = 0; i < imported.calendar.length; i++) {

      if (imported.calendar[i].status == 'pending') {
         errorLog ('too early, calendar '+pendingCalendar+' found pending');
         return;
      }
   }

   for (var i = 0; i < imported.calendar.length; i++) {
      if (imported.calendar[i].status != 'disabled') {
         imported.calendar[i].status = 'idle';
      }
   }
   loadNextCalendar();
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
      errorLog ('too early, calendar '+pendingCalendar+' is pending');
      return;
   }

   for (var i = 0; i < imported.calendar.length; i++) {

      if (imported.calendar[i].status == 'pending') {
         errorLog ('too early, calendar '+pendingCalendar+' found pending');
         return;
      }
      if (imported.calendar[i].status != 'idle') continue;

      infoLog ('importing calendar ' + imported.calendar[i].name);
      pendingCalendar = imported.calendar[i];
      pendingCalendar.status = 'pending';

      if (pendingCalendar.source.match ("file:.*")) {

         debugLog ('accessing file '+pendingCalendar.source.slice(5));
         loadFileCalendar();
         continue; // Load next calendar.
      }

      debugLog ('accessing '+imported.calendar[i].source);

      if (imported.calendar[i].source.match ("https://.*")) {
         loadWebCalendar(https);
         return; // Must wait for this calendar load be complete.
      }

      if (imported.calendar[i].source.match ("http://.*")) {
         loadWebCalendar(http);
         return; // Must wait for this calendar load be complete.
      }

      // The calendar source URL does not match any supported protocol.

      errorLog ('unsupported protocol for '+imported.calendar[i].name +" in '"+ imported.calendar[i].source + "'");
      imported.calendar[i].status = 'disabled';
      imported.received = null;
   }

   // We are done processing all calendars.
   webRequest = null;
   pendingCalendar = null;
   pruneObsoletePrograms();
   infoLog ("import complete");
}


// --------------------------------------------------------------------------
// Method for periodic calendar refresh.
exports.refresh = function () {

   if (imported.calendar.length == 0) return;

   var now = new Date();
   var hour = now.getHours();

   // Throttle when to request for information, to limit traffic.
   // We try to get an update at the end of the hour, because most
   // programs tend to start at the beginning of the hour.
   //
   if (hour == lastUpdateHour) return;
   if (now.getMinutes() < 55) return;

   lastUpdateHour = hour;
   loadCalendars();
}

// --------------------------------------------------------------------------
// Method for calendar status.
exports.status = function () {

   var result = new Array();
   for (var i = 0; i < imported.calendar.length; i++) {
      result[i] = new Object();
      result[i].name = imported.calendar[i].name;
      result[i].status = (imported.calendar[i].status == 'ok');
      result[i].updated = imported.calendar[i].updated;
   }
   return result;
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

