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
//   hardware.configure (hardwareConfig, userConfig);
//
//      Initialize the hardware module from the configuration.
//      This method can be called as often as necessary (typically
//      when the user configuration has changed).
//
//   hardware.info ();
//
//      Return a data structure that describes the hardware managed by
//      this driver. The data structure contains the following elements:
//         id           A short unique identification string for the driver.
//         title        A human-readable string that describes the hardware.
//         zones.add    If true, the end-user may add (or remove) zones.
//         zones.pin    If true, the end-user may set the pin name and active
//                      state ('on' state).
//         zones.max    If set, defines the maximum number of zones supported
//                      by the hardware. If zones.max is defined and zones.add
//                      is set to false, then the number of zones is fixed.
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
//         "zones"   The maximum number of zones. (Used only if not user
//                   defined).
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
//   osbo.pins.data      The I/O pin to use for the data signal.
//
//   osbo.pins.clock     The I/O pin to use for the clock signal.
//
//   osbo.pins.enable    The I/O pin to use for the output enable signal.
//
//   osbo.pins.latch     The I/O pin to use for the data latch signal.
//
//   osbo.pins.rain      The I/O pin to use for the rain sensor.
//
//   osbo.pins.edge      The active edge of the rain sensor (RISING, FALLING).
//
// USER CONFIGURATION
//
//   production          This flag determines if we use the real hardware
//                       (true) or else a simulation for debug (false).
//
//   zones               The name of each zone (an array of structures
//                       containing item 'name'). This module only considers
//                       the number of zones that have been configured by
//                       the user, in order to decide how many extensions
//                       are present.
//

function debuglog (text) {
   console.log ('Hardware(osbo): '+text);
}

function errorlog (text) {
   console.error ('Hardware(osbo): '+text);
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
   piodb = new Object();
   piodb.pins = new Object();

   piodb.pins.data = "P9_11";
   piodb.pins.clock = "P9_13";
   piodb.pins.enable = "P9_14";
   piodb.pins.latch = "P9_15";

   piodb.pins.rain = "P9_15";
   piodb.pins.edge = io.FALLING;

   if (config.osbo) {
      // We need to go item by item so to not overwrite defaults.
      if (config.osbo.data) {
         piodb.pins.data = config.osbo.data;
      }
      if (config.osbo.clock) {
         piodb.pins.clock = config.osbo.clock;
      }
      if (config.osbo.enable) {
         piodb.pins.enable = config.osbo.enable;
      }
      if (config.osbo.latch) {
         piodb.pins.latch = config.osbo.latch;
      }
      if (config.osbo.rain) {
         piodb.pins.rain = config.osbo.rain;
      }
      if (config.osbo.edge) {
         piodb.pins.edge = config.osbo.edge;
      }
   }

   io.pinMode(piodb.pins.rain, io.INPUT);
   io.pinMode(piodb.pins.clock, io.OUTPUT);
   io.pinMode(piodb.pins.enable, io.OUTPUT);
   io.digitalWrite(piodb.pins.enable, io.HIGH);
   io.pinMode(piodb.pins.data, io.OUTPUT);
   io.pinMode(piodb.pins.latch, io.OUTPUT);

   var zonecount = user.zones.length;
   piodb.zones = new Array();
   for(var i = 0; i < zonecount; i++) {
      piodb.zones[i] = new Object();
      piodb.zones[i].value = io.LOW;
   }
   piodb.changed = true; // We do not know the status, assume the worst.
}

exports.info = function (attribute) {
   return {id:"osbo",title:"Open Sprinkler OSBo Board",zones:{add:true,pin:false}};
}

exports.rainSensor = function () {
   if (! piodb.pins) {
      return false;
   }
   if (! piodb.pins.rain) {
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
   if (! piodb.pins) {
      return false;
   }
   if (! piodb.pins.rain) {
      return null;
   }
   io.attachInterrupt(piodb.pins.rain, true, piodb.pins.edge, callback);
}

exports.buttonInterrupt = function (callback) {
   // No button on the OpenSprinkler OSBo board.
   return null;
}

exports.setZone = function (zone, on) {
   if (! piodb.zones) {
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
   if (! piodb.pins) {
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

