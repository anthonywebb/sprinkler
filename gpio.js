// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   hardware - a module to hide the interface to the I/O pins.
//
// SYNOPSYS
//
//   This module implements a simplified interface to access I/O pins.
//   The goal is to be portable, and to workaround specific target issues.
//
// DESCRIPTION
//
//   var Gpio = require('./gpio').Gpio;
//
//   new Gpio (pin, direction[, value]);
//
//      Initialize the specified pin as an input or output. This returns
//      an object which can be read from (input) or written to (output).
//      The value is written as soon as the pin has been configured. The
//      default value is 1.
//
//   pin.read();
//
//      Read the current value of the pin. Valid only if pin was created
//      as an input.
//
//   pin.write(value);
//
//      Write value to the pin. Valid only if pin was created as an output.
//
// HARDWARE CONFIGURATION
//
//   (None.)
//
// USER CONFIGURATION
//
//   (None.)
//

function debuglog (text) {
   console.log ('gpio: '+text);
}

function errorlog (text) {
   console.error ('gpio: '+text);
}

var gpio = null;
try {
   gpio = require('onoff').Gpio;
}
catch (err) {
   errorlog ('cannot access module onoff, using simulation mode');
}


function setupPin () {
   this.gpio = new gpio(this.pin, this.direction);
   this.ready = true; // No error was raised.
   if (this.write) {
      this.write(this.value);
   }
}

function readPin() {
   if (this.gpio) {
      if (this.ready) {
         return this.gpio.readSync();
      }
   }
   return 0;
}

function writePin(value) {
   this.value = value;
   if (! this.gpio) {
      debugLog ('Writing '+value+' to pin '+this.pin);
      return;
   }
   if (this.ready) {
      this.gpio.writeSync(value);
   }
}

// Raspbian issue: access to the gpio files is only granted after a short
// while, in the background. Need to try again if it failed.
//
function retry() {
   debuglog ('Failed to setup pin '+this.pin+', retrying in 0.2 second');
   setTimeout (function() {
      debuglog ('Retrying pin '+this.pin);
      try {
         setupPin();
      }
      catch (err) {
         retry();
      }
   }, 200);
}

exports.Gpio = function (pin, direction, value) {

   this.pin = pin;
   this.direction = direction;

   if (value == null) {
      value = 1;
   }
   this.value = value;

   if (direction == 'in') {
      this.read = readPin;
   }
   if (direction == 'out') {
      this.write = writePin;
   }

   if (gpio) {
      // Raspbian bug: access to the gpio files is only granted after a short
      // while, in the background. Need to try again if it failed.
      this.ready = false;
      try {
         setupPin();
      }
      catch (err) {
         retry();
      }
   }
}

