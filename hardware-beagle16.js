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
//   hardware.configure (hardwareConfig, userConfig, options);
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
//   beagle16.rain       The name of the input pin for the rain sensor.
//                       The rain sensor is not active if this item is absent.
//
//   beagle16.button     The name of the input pin for the button.
//                       The button is not active if this item is absent.
//
//   beagle16.zones      This array of structures defines the name of
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
// USER CONFIGURATION
//
//   production          This flag determines if we use the real hardware
//                       (true) or else a simulation for debug (false).

var debugLog = function (text) {}

function verboseLog (text) {
   console.log ('[DEBUG] Hardware(beagle16): '+text);
}

function errorLog (text) {
   console.error ('[ERROR] Hardware(beagle16): '+text);
}

try {
   var io = require('bonescript');
}
catch (err) {
   errorLog ('cannot access module bonescript');
   var io = null;
}

var piodb = new Object(); // Make sure it exists (simplify validation).

exports.configure = function (config, user, options) {
   if (options && options.debug) {
      debugLog = verboseLog;
   }
   if ((! io) || (! user.production)) {
      debugLog ('using debug I/O module');
      io = require('./iodebug');
   }

   // Set hardware configuration defaults.
   piodb = new Object();

   piodb.rain = "P9_29";
   piodb.button = "P9_30";

   piodb.levels = new Object();
   piodb.levels.on = io.HIGH;
   piodb.levels.off = io.LOW;
   piodb.levels.edge = io.FALLING;

   piodb.zones = [
            {pin:"P9_11"},
            {pin:"P9_13"},
            {pin:"P9_15"},
            {pin:"P9_17"},
            {pin:"P9_21"},
            {pin:"P9_23"},
            {pin:"P9_25"},
            {pin:"P9_27"},
            {pin:"P9_28"},
            {pin:"P9_26"},
            {pin:"P9_24"},
            {pin:"P9_22"},
            {pin:"P9_18"},
            {pin:"P9_16"},
            {pin:"P9_14"},
            {pin:"P9_12"}
        ];

   if (config) {
      if (config.beagle16) {

         var zonecount = config.beagle16.zones.length;
         piodb.zones = new Array();
         for(var i = 0; i < zonecount; i++) {
            piodb.zones[i] = new Object();
            piodb.zones[i].pin = config.beagle16.zones[i].pin;
         }

         if (config.beagle16.rain) {
            piodb.rain = config.beagle16.rain;
         }
         if (config.beagle16.button) {
            piodb.button = config.beagle16.button;
         }
         if (config.beagle16.on) {
            if (config.beagle16.on == 'HIGH') {
               piodb.levels.on = io.HIGH;
               piodb.levels.off = io.LOW;
            } else if (config.beagle16.on == 'LOW') {
               piodb.levels.on = io.LOW;
               piodb.levels.off = io.HIGH;
            } else {
               errorLog ('invalid pin level '+config.beagle16.on+', ignored');
            }
         }
         if (config.beagle16.edge) {
            if (config.beagle16.edge == 'RISING') {
               piodb.levels.edge = io.RISING;
            } else if (config.beagle16.edge == 'FALLING') {
               piodb.levels.edge = io.FALLING;
            } else {
               errorLog ('invalid edge '+config.beagle16.edge+', ignored');
            }
         }
      }
   }

   if (piodb.rain) {
      io.pinMode(piodb.rain, io.INPUT);
   }
   if (piodb.button) {
      io.pinMode(piodb.button, io.INPUT);
   }
   for(var i = 0; i < zonecount; i++) {
      io.pinMode(piodb.zones[i].pin, io.OUTPUT);
   }
}

exports.info = function (attribute) {
   return {id:"beagle16",title:"Sprinkler Beagle Board",zones:{add:false,pin:false,max:16}};
}

exports.rainSensor = function () {
   if (! piodb.rain) {
      return false;
   }
   if (io.digitalRead(piodb.rain) > 0) {
      return false;
   }
   return true;
}

exports.button = function () {
   if (! piodb.button) {
      return false;
   }
   if (io.digitalRead(piodb.button) == 0) {
      return false;
   }
   return true;
}

exports.rainInterrupt = function (callback) {
   if (! piodb.rain) {
      return null;
   }
   io.attachInterrupt(piodb.rain, true, piodb.levels.edge, callback);
}

exports.buttonInterrupt = function (callback) {
   if (! piodb.button) {
      return null;
   }
   io.attachInterrupt(piodb.button, true, piodb.levels.edge, callback);
}

exports.setZone = function (zone, on) {
   if (! piodb.zones) {
      return null;
   }
   if (on) {
      io.digitalWrite(piodb.zones[zone].pin, piodb.levels.on);
   } else {
      io.digitalWrite(piodb.zones[zone].pin, piodb.levels.off);
   }
}

exports.apply = function () { }

