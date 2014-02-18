// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   hardware - a module to hide the interface to the OpenSprinkler OSBo.
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
//   This specific implementation supports the OpenSprinkler OSBo board.
//
//   This module does not support the real-time clock or the relay (yet).
//
//   To enable this driver, create 'hardware.js' as a symbolic link to
//   'hardware-osbo.js'.
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
//
//      CAUTION! This takes effect only the next time that the
//      function hardware.apply() is called.
//
//      Each zone is identified by a number (identifying zones by name
//      is the responsibility of the application layer).
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
//   zones               The name of each zone (an array of structures
//                       containing item 'name').
//
//   osbo                An optional structure to redefine the standard
//                       OSBo pins: data, clock, enable, latch, rain.
//                       It also defines the active edge of the rain pin.
//                       (This driver does not use the Beagle-16's toplevel
//                       rain config item in the hope of avoiding havoc
//                       that could be caused when forgetting to edit that
//                       item when switching from one driver to another.)
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
   piodb.pins = new Object();

   piodb.pins.data = "P9_11";
   piodb.pins.clock = "P9_13";
   piodb.pins.enable = "P9_14";
   piodb.pins.latch = "P9_15";

   piodb.pins.rain = "P9_15";
   piodb.pins.edge = io.FALLING;

   if (config.osbo != null) {
      // We need to go item by item so to not overwrite defaults.
      if (config.osbo.data != null) {
         piodb.pins.data = config.osbo.data;
      }
      if (config.osbo.clock != null) {
         piodb.pins.clock = config.osbo.clock;
      }
      if (config.osbo.enable != null) {
         piodb.pins.enable = config.osbo.enable;
      }
      if (config.osbo.latch != null) {
         piodb.pins.latch = config.osbo.latch;
      }
      if (config.osbo.rain != null) {
         piodb.pins.rain = config.osbo.rain;
      }
      if (config.osbo.edge != null) {
         piodb.pins.edge = config.osbo.edge;
      }
   }

   io.pinMode(piodb.pins.rain, io.INPUT);
   io.pinMode(piodb.pins.clock, io.OUTPUT);
   io.pinMode(piodb.pins.enable, io.OUTPUT);
   io.digitalWrite(piodb.pins.enable, io.HIGH);
   io.pinMode(piodb.pins.data, io.OUTPUT);
   io.pinMode(piodb.pins.latch, io.OUTPUT);

   var zonecount = config.zones.length;
   piodb.zones = new Array();
   for(var i = 0; i < zonecount; i++) {
      piodb.zones[i] = new Object();
      piodb.zones[i].value = io.LOW;
   }
   piodb.changed = true; // We do not know the status, assume the worst.
}

exports.rainSensor = function () {
   if (piodb.pins == null) {
      return false;
   }
   if (piodb.pins.rain == null) {
      return false;
   }
   if (io.digitalRead(piodb.pins.rain) > 0) {
      return false;
   }
   return true;
}

exports.button = function () {
   // No button on the OpenSprinkler OSBo board.
   return false;
}

exports.rainInterrupt = function (callback) {
   if (piodb.pins == null) {
      return false;
   }
   if (piodb.pins.rain == null) {
      return null;
   }
   io.attachInterrupt(piodb.pins.rain, true, piodb.pins.edge, callback);
}

exports.buttonInterrupt = function (callback) {
   // No button on the OpenSprinkler OSBo board.
   return null;
}

exports.setZone = function (zone, on) {
   if (piodb.zones == null) {
      return null;
   }
   if (on) {
      value = io.HIGH;
   } else {
      value = io.LOW;
   }
   if (piodb.zones[zone].value != value) {
      debuglog ('Zone '+zone+' set to '+value);
      piodb.zones[zone].value = value;
      piodb.changed = true;
   }
}

exports.apply = function () {
   if (piodb.pins == null) {
      return null;
   }
   if (! piodb.changed) {
      return null;
   }
   io.digitalWrite(piodb.pins.enable, io.HIGH);

   io.digitalWrite(piodb.pins.clock, io.LOW);
   io.digitalWrite(piodb.pins.latch, io.LOW);

   var zonecount = piodb.zones.length;
   var filler = (8 - (zonecount % 8)) % 8; // All bits missing in last byte.

   if (filler > 0) {
      io.digitalWrite(piodb.pins.data,  io.LOW);
      for(var i = filler; i > 0; i--) {
         io.digitalWrite(piodb.pins.clock, io.LOW);
         io.digitalWrite(piodb.pins.clock, io.HIGH);
      }
   }
   for(var i = zonecount - 1; i >= 0; i--) {
      io.digitalWrite(piodb.pins.clock, io.LOW);
      io.digitalWrite(piodb.pins.data,  piodb.zones[i].value);
      io.digitalWrite(piodb.pins.clock, io.HIGH);
   }
   io.digitalWrite(piodb.pins.latch, io.HIGH);

   io.digitalWrite(piodb.pins.enable, io.LOW);

   piodb.changed = false;
}

