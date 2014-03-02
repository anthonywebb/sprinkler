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
//   zones               An array of structures containing one item named
//                       'name' (the name of the zone).
//

var piodb = null;

function debuglog (text) {
   console.log ('Hardware: '+text);
}

exports.configure = function (config, user) {
   piodb = new Object();

   var zonecount = user.zones.length;
   piodb.zones = new Array();
   for(var i = 0; i < zonecount; i++) {
      piodb.zones[i] = new Object();
      piodb.zones[i].name = user.zones[i].name;
      debuglog ('configuring zone '+piodb.zones[i].name+' (#'+i+')');
   }
}

exports.info = function (attribute) {
   return {id:"null",title:"Null Debug Driver",zones:{add:true,pin:true}};
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
   if (! piodb) {
      return null;
   }
   if (on) {
      debuglog ('zone '+piodb.zones[zone].name+' (#'+zone+') set to on');
   } else {
      debuglog ('zone '+piodb.zones[zone].name+' (#'+zone+') set to off');
   }
}

exports.apply = function () {
   debuglog ('apply');
}

