// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   hardware - a module to hide the interface to the Sprinkler Beagle-16.
//
// SYNOPSYS
//
//   This module implements an interface to the board that controls
//   the sprinkler (typically triacs or relays that control the solenoids).
//
//   Each sprinkler triac or relay is called a "zone" (because it generally
//   controls a watering valve, which waters a zone).
//
//   This module allows porting the sprinkler software to different
//   hardware interfaces. Only one hardware interface is supported at
//   a given time: you must have installed the right driver.
//
//   This specific implementation supports the Sprinkler Beagle-16 board.
//
//   To enable this driver, create 'hardware.js' as a symbolic link to
//   'hardware-beagle16.js'.
//
// DESCRIPTION
//
//   var hardware = require('./hardware');
//
//   hardware.configure (config);
//
//      Initialize the hardware module from the user configuration.
//      This method can be called as often as necessary (typically
//      when the configuration has changed).
//
//   hardware.setZone (zone, on);
//
//      Set one zone on (on == true) or off (on == false).
//      This may take effect immediately, or only the next time
//      function hardware.apply() is called. Each zone is identified
//      by a number (identifying zones by name is the responsibility
//      of the application layer).
//
//   hardware.apply ();
//
//      Push the current zone controls to the outside world.
//
//   hardware.rainsensor ();
//
//      Return true or false, true if rain is detected. Always return
//      false if there is no rain sensor.
//
//   hardware.button ();
//
//      Return true or false, true if button is pressed. Always return
//      false if there is no button.
//
//   hardware.rainInterrupt (callback);
//   hardware.buttonInterrupt (callback);
//
//      Set each callback to be called when the corresponding input
//      has changed. The parameter to the callback is a Javascript
//      structure guaranteed to contain an (oddly named) "output"
//      item that contains the value of the input pin.
//
// CONFIGURATION
//
//   rain                The name of the input pin for the rain sensor.
//                       Rain sensor is ignored if omitted. Superseeded
//                       by the beagle16.rain item, if present.
//
//   button              The name of the input pin for the button.
//                       Button is ignored if omitted. Superseeded
//                       by the beagle16.button item, if present.
//
//   zones               This array of structures defines the name of
//                       the output pin for each zone.
//
//   beagle16            Defines some specific pins (rain, button) and
//                       the actual value for each io level: on, off
//                       or edge ('edge' is actually a transition).
//                       If 'on' is not present, 'on' is set to HIGH
//                       and 'off' is set to LOW. If 'edge' is not
//                       present, FALLING is used.
//                       (The rain and button defined here take precedence
//                       over the toplevel rain and button configuration.)
//

function debuglog (text) {
   console.log ('Hardware: '+text);
}

function errorlog (text) {
   console.error ('Hardware: '+text);
}

try {
   var io = require('bonescript');
}
catch (err) {
   errorlog ('cannot access module bonescript');
   var io = null;
}

var piodb = new Object(); // Make sure it exists (simplify validation).

exports.configure = function (config) {
   if ((io == null) || (! config.production)) {
      debuglog ('using debug I/O module');
      io = require('./iodebug');
   }
   piodb = new Object();

   piodb.rain = config.rain;
   piodb.button = config.button;

   var zonecount = config.zones.length;
   piodb.zones = new Array();
   for(var i = 0; i < zonecount; i++) {
      piodb.zones[i] = new Object();
      piodb.zones[i].pin = config.zones[i].pin;
   }

   piodb.levels = new Object();
   piodb.levels.on = io.HIGH;
   piodb.levels.off = io.LOW;
   piodb.levels.edge = io.FALLING;

   if (config.beagle16 != null) {
      if (config.beagle16.rain != null) {
         piodb.rain = config.beagle16.rain;
      }
      if (config.beagle16.button != null) {
         piodb.button = config.beagle16.button;
      }
      if (config.beagle16.on != null) {
         piodb.levels.on = config.beagle16.on;
      }
      if (config.beagle16.off != null) {
         piodb.levels.off = config.beagle16.off;
      }
      if (config.beagle16.edge != null) {
         piodb.levels.edge = config.beagle16.edge;
      }
   }

   if (piodb.rain != null) {
      io.pinMode(piodb.rain, io.INPUT);
   }
   if (piodb.button != null) {
      io.pinMode(piodb.button, io.INPUT);
   }
   for(var i = 0; i < zonecount; i++) {
      io.pinMode(piodb.zones[i].pin, io.OUTPUT);
   }
}

exports.rainSensor = function () {
   if (piodb.rain == null) {
      return false;
   }
   if (io.digitalRead(piodb.rain) > 0) {
      return false;
   }
   return true;
}

exports.button = function () {
   if (piodb.button == null) {
      return false;
   }
   if (io.digitalRead(piodb.button) == 0) {
      return false;
   }
   return true;
}

exports.rainInterrupt = function (callback) {
   if (piodb.rain == null) {
      return null;
   }
   io.attachInterrupt(piodb.rain, true, piodb.levels.edge, callback);
}

exports.buttonInterrupt = function (callback) {
   if (piodb.button == null) {
      return null;
   }
   io.attachInterrupt(piodb.button, true, piodb.levels.edge, callback);
}

exports.setZone = function (zone, on) {
   if (piodb.zones == null) {
      return null;
   }
   if (on) {
      io.digitalWrite(piodb.zones[zone].pin, piodb.levels.on);
   } else {
      io.digitalWrite(piodb.zones[zone].pin, piodb.levels.off);
   }
}

exports.apply = function () { }

