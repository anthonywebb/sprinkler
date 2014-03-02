// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   hardware - a module to hide the interface to generic relay boards.
//
// SYNOPSYS
//
//   This module implements an interface to generic relay boards used as
//   sprinkler controllers.
//
//   Each sprinkler triac or relay is called a "zone" (because it generally
//   controls a watering valve, which waters a zone).
//
//   This module allows porting the sprinkler software to different
//   hardware interfaces. Only one hardware interface is supported at
//   a given time: you must have installed the right driver.
//
//   This specific implementation supports generic relay boards.
//
//   To enable this driver, create 'hardware.js' as a symbolic link to
//   'hardware-relays.js'.
//
// DESCRIPTION
//
//   var hardware = require('./hardware');
//
//   hardware.configure (hardwareConfig, userConfig);
//
//      Initialize the hardware module from the configuration.
//      This method can be called as often as necessary (typically
//      when the user configuration has changed).
//
//   hardware.userDefined (attribute);
//
//      Return true when the user may change the given attribute.
//      The supported attributes are:
//         "zones"      The number of zones.
//         "zones.pin"  The I/O pin, and the active pin level, for each zone.
//
//   hardware.get (attribute);
//
//      Return the current value of the given attribute.
//      The supported attributes are:
//         "zones"      The maximum number of zones. (Used only if not user
//                      defined).
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
//   hardware.rainSensor ();
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
// HARDWARE CONFIGURATION
//
//   (None.)
//
// USER CONFIGURATION
//
//   production          This flag determines if we use the real hardware
//                       (true) or else a simulation for debug (false).
//
//   zones               This array of structures defines the name of
//                       the output pin for each zone.
//

function debuglog (text) {
   console.log ('Hardware(relays): '+text);
}

function errorlog (text) {
   console.error ('Hardware(relays): '+text);
}

try {
   var io = require('bonescript');
}
catch (err) {
   errorlog ('cannot access module bonescript');
   var io = null;
}

var piodb = new Object(); // Make sure it exists (simplify validation).

exports.configure = function (config, user) {
   if ((! io) || (! user.production)) {
      debuglog ('using debug I/O module');
      io = require('./iodebug');
   }

   // Set hardware configuration defaults.
   piodb = new Object();

   piodb.zones = new Array();
   var zonecount = 0;

   if (user.zones) {
      var zonecount = user.zones.length;
      for (var i = 0; i < zonecount; i++) {
         piodb.zones[i] = new Object();
         piodb.zones[i].pin = user.zones[i].pin;

         piodb.zones[i].on = io.LOW;
         piodb.zones[i].off = io.HIGH;

         if (user.zones[i].on) {
            if (user.zones[i].on == 'HIGH') {
               piodb.zones[i].on = io.HIGH;
               piodb.zones[i].off = io.LOW;
            } else if (user.zones[i].on == 'LOW') {
               piodb.zones[i].on = io.LOW;
               piodb.zones[i].off = io.HIGH;
            } else {
               errorLog ('invalid pin level '+user.zones[i].on+', assuming LOW');
               piodb.zones[i].on = io.LOW;
               piodb.zones[i].off = io.HIGH;
            }
         }
      }
   }
   for(var i = 0; i < zonecount; i++) {
      if (piodb.zones[i].pin) {
         io.pinMode(piodb.zones[i].pin, io.OUTPUT);
      }
   }
}

exports.userDefined = function (attribute) {
   if (attribute == 'zones') {
      return true;
   } else if (attribute == 'zones.pin') {
      return true;
   }
   return false;
}

exports.get = function  (attribute) {
   if (attribute == 'zones') {
      return piodb.zones.count;
   }
   return null;
}

exports.rainSensor = function () {
   return false;
}

exports.button = function () {
   return false;
}

exports.rainInterrupt = function (callback) {
   return null;
}

exports.buttonInterrupt = function (callback) {
   return null;
}

exports.setZone = function (zone, on) {
   if (! piodb.zones) {
      return null;
   }
   if (! piodb.zones[zone].pin) {
      return null;
   }
   if (on) {
      io.digitalWrite(piodb.zones[zone].pin, piodb.zones[zone].on);
   } else {
      io.digitalWrite(piodb.zones[zone].pin, piodb.zones[zone].off);
   }
}

exports.apply = function () { }

