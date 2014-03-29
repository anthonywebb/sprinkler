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
//   This module depends on 'onoff' because that is one gpio interface
//   that is available on BeagleBone and Raspberry Pi (and probably others,
//   since it only relies on /sys/class/gpio).
//
//   This module do some tricks to workaround a Raspbian issue: access to
//   the gpio files is only granted after a short while, in the background.
//   The application needs to try again if it failed.
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
   var gpio = require('onoff').Gpio;
}
catch (err) {
   errorlog ('cannot access module onoff');
   var gpio = null;
}

var piodb = new Object(); // Make sure it exists (simplify validation).

// Raspbian issue: access to the gpio files is only granted
// after a short while, in the background.
// Need to try again if it failed.
function retry(i) {
   debuglog ('Setting up zone '+i+' failed, scheduling retry in 0.2 second');
   setTimeout (function() {
      debuglog ('Retrying zone '+i);
      try {
         piodb.zones[i].gpio = new gpio(piodb.zones[i].pin, 'out');
         piodb.zones[i].ready = true; // No error was raised this time.
         exports.setZone(i, piodb.zones[i].value);
      }
      catch (err) {
         retry(i);
      }
   }, 200);
}

exports.configure = function (config, user) {
   if ((! gpio) || (! user.production)) {
      debuglog ('using debug GPIO traces');
      gpio = null;
   }

   // Set hardware configuration defaults.
   piodb = new Object();

   piodb.zones = new Array();
   var zonecount = 0;

   if (user.zones) {
      var zonecount = user.zones.length;
      for (var i = 0; i < zonecount; i++) {
         piodb.zones[i] = new Object();

         piodb.zones[i].on = 0;
         piodb.zones[i].off = 1;

         if (user.zones[i].on) {
            if (user.zones[i].on == 'HIGH') {
               piodb.zones[i].on = 1;
               piodb.zones[i].off = 0;
            } else if (user.zones[i].on == 'LOW') {
               piodb.zones[i].on = 0;
               piodb.zones[i].off = 1;
            } else {
               errorLog ('invalid pin level '+user.zones[i].on+', assuming LOW');
               piodb.zones[i].on = 0;
               piodb.zones[i].off = 1;
            }
         }

         piodb.zones[i].ready = false;
         piodb.zones[i].value = false;
         piodb.zones[i].pin = user.zones[i].pin;

         if (gpio) {
            // Raspbian bug: access to the gpio files is only granted
            // after a short while, in the background.
            // Need to try again if it failed.
            try {
               piodb.zones[i].gpio = new gpio(piodb.zones[i].pin, 'out');
               piodb.zones[i].ready = true; // No error was raised.
               exports.setZone(i, piodb.zones[i].value);
            }
            catch (err) {
               retry(i);
            }
         } else {
            piodb.zones[i].ready = true;
         }
      }
   }
}

exports.info = function (attribute) {
   return {id:"relays",title:"Generic Relay Board",zones:{add:true,pin:true}};
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
   piodb.zones[zone].value = on;
   if (! piodb.zones[zone].ready) {
      return null; // This pin will be set later, when ready.
   }
   debuglog ('GPIO '+piodb.zones[zone].pin+' set to '+on);
   if (gpio) {
      if (on) {
         piodb.zones[zone].gpio.writeSync(piodb.zones[zone].on);
      } else {
         piodb.zones[zone].gpio.writeSync(piodb.zones[zone].off);
      }
   } else {
      if (on) {
         debuglog ('GPIO '+piodb.zones[zone].pin+' set to on ('+piodb.zones[zone].on+')');
      } else {
         debuglog ('GPIO '+piodb.zones[zone].pin+' set to off ('+piodb.zones[zone].off+')');
      }
   }
}

exports.apply = function () { }

