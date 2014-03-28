// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   hardware - a module to hide the interface to the OpenSprinkler OSPi
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
//   This specific implementation supports the OpenSprinkler OSPi board.
//
//   This module does not support the real-time clock or the A/D D/A chip.
//
//   To enable this driver, create 'hardware.js' as a symbolic link to
//   'hardware-ospi.js'.
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
//   ospi.pins.data      The I/O pin to use for the data signal.
//
//   ospi.pins.clock     The I/O pin to use for the clock signal.
//
//   ospi.pins.enable    The I/O pin to use for the output enable signal.
//
//   ospi.pins.latch     The I/O pin to use for the data latch signal.
//
//   ospi.pins.rain      The I/O pin to use for the rain sensor (not on OSPi).
//
//   ospi.pins.button    The I/O pin to use for a button (not on OSPi).
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
   console.log ('Hardware(ospi): '+text);
}

function errorlog (text) {
   console.error ('Hardware(ospi): '+text);
}

gpio = require('./gpio').Gpio;

var piodb = new Object(); // Make sure it exists (simplify validation).

exports.configure = function (config, user) {
   if (! user.production) {
      debuglog ('using debug I/O module');
      gpio = null;
   }
   piodb = new Object();
   piodb.pins = new Object();
   piodb.gpio = new Object();

   piodb.pins.clock  =  4;
   piodb.pins.data   = 27;
   piodb.pins.enable = 17;
   piodb.pins.latch  = 22;

   piodb.pins.rain = null;   // Not present on OSPi.
   piodb.pins.button = null; // Not present on OSPi.

   if (config.ospi) {
      // We need to go item by item so to not overwrite defaults.
      if (config.ospi.data) {
         piodb.pins.data = config.ospi.data;
      }
      if (config.ospi.clock) {
         piodb.pins.clock = config.ospi.clock;
      }
      if (config.ospi.enable) {
         piodb.pins.enable = config.ospi.enable;
      }
      if (config.ospi.latch) {
         piodb.pins.latch = config.ospi.latch;
      }
      if (config.ospi.rain) {
         piodb.pins.rain = config.ospi.rain;
      }
      if (config.ospi.button) {
         piodb.pins.button = config.ospi.button;
      }
   }

   piodb.gpio.clock = new gpio (piodb.pins.clock, 'out');
   piodb.gpio.enable = new gpio (piodb.pins.enable, 'out', 1);
   piodb.gpio.data = new gpio (piodb.pins.data, 'out');
   piodb.gpio.latch = new gpio (piodb.pins.latch, 'out');

   if (piodb.pins.rain != null) {
      piodb.gpio.rain = new gpio (piodb.pins.rain, 'in');
   }
   if (piodb.pins.button != null) {
      piodb.gpio.button = new gpio (piodb.pins.button, 'in');
   }

   var zonecount = user.zones.length;
   piodb.zones = new Array();
   for(var i = 0; i < zonecount; i++) {
      piodb.zones[i] = new Object();
      piodb.zones[i].value = 0;
   }
   piodb.changed = true; // We do not know the status, assume the worst.
}

exports.info = function (attribute) {
   return {id:"ospi",title:"Open Sprinkler OSPi Board (or compatible)",zones:{add:true,pin:false}};
}

exports.rainSensor = function () {
   if (! piodb.gpio) {
      return false;
   }
   if (piodb.gpio.rain == null) {
      return false;
   }
   if (piodb.gpio.rain.read() > 0) {
      return false;
   }
   return true;
}

exports.button = function () {
   if (! piodb.gpio) {
      return false;
   }
   if (piodb.gpio.button == null) {
      return false;
   }
   if (piodb.gpio.button.read() > 0) {
      return false;
   }
   return true;
}

exports.rainInterrupt = function (callback) {
   return null; // Useless.
}

exports.buttonInterrupt = function (callback) {
   return null; // Useless.
}

exports.setZone = function (zone, on) {
   if (! piodb.zones) {
      return null;
   }
   if (on) {
      value = 1;
   } else {
      value = 0;
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
   piodb.gpio.enable.write (1);

   piodb.gpio.clock.write (0);
   piodb.gpio.latch.write (0);

   var zonecount = piodb.zones.length;
   var filler = (8 - (zonecount % 8)) % 8; // All bits missing in last byte.

   if (filler > 0) {
      piodb.gpio.data.write (0);
      for(var i = filler; i > 0; i--) {
         piodb.gpio.clock.write (0);
         piodb.gpio.clock.write (1);
      }
   }
   for(var i = zonecount - 1; i >= 0; i--) {
      piodb.gpio.clock.write (0);
      piodb.gpio.data.write (piodb.zones[i].value);
      piodb.gpio.clock.write (1);
   }
   piodb.gpio.latch.write (1);

   piodb.gpio.enable.write (0);

   piodb.changed = false;
}

