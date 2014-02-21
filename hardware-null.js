// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   hardware - a module to hide the absence of hardware interface.
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
//   This module implements a null driver, used for debugging purposes.
//
//   To enable this driver, create 'hardware.js' as a symbolic link to
//   'hardware-null.js'.
//
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
//                       Rain sensor is ignored if omitted.
//
//   button              The name of the input pin for the button.
//                       Button is ignored if omitted.
//
//   zones               An array of structures containing one item named
//                       'pin' (the name of the output pin for each zone).
//

var piodb = null;

function debuglog (text) {
   console.log ('Hardware: '+text);
}

exports.configure = function (config) {
   piodb = new Object();

   piodb.rain = config.rain;
   piodb.button = config.button;

   var zonecount = config.zones.length;
   piodb.zones = new Array();
   for(var i = 0; i < zonecount; i++) {
      piodb.zones[i] = new Object();
      piodb.zones[i].name = config.zones[i].name;
      piodb.zones[i].pin = config.zones[i].pin;
      debuglog ('configuring zone '+piodb.zones[i].name+' (#'+i+') as pin '+piodb.zones[i].pin);
   }

   if (piodb.rain != null) {
      debuglog ('configuring rain sensor as pin '+piodb.rain);
   }
   if (piodb.button != null) {
      debuglog ('configuring button as pin '+piodb.rain);
   }
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
   if (piodb == null) {
      return null;
   }
   if (on) {
      debuglog ('zone '+piodb.zones[zone].name+' (#'+zone+', pin '+piodb.zones[zone].pin+') set to on');
   } else {
      debuglog ('zone '+piodb.zones[zone].name+' (#'+zone+', pin '+piodb.zones[zone].pin+') set to off');
   }
}

exports.apply = function () {
   debuglog ('apply');
}

