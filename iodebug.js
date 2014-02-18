// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   iodebug - a module to hide the absence of hardware interface.
//
// SYNOPSYS
//
//   This module implements a subset of the bonescript interface for the
//   purpose of debug. It is used if the bonescript module is not accessible.
//
//
// DESCRIPTION
//
//   var io = require('./iodebug');
//
//   io.pinMode (pin, mode);
//
//   io.digitalWrite (pin, value);
//
//   io.digitalRead (pin);
//
//   io.attachInterrupt (pin, flag, edge, callback);
//

var piodb = null;

function debuglog (text) {
   console.log ('**iodebug: '+text);
}

exports.LOW = 0;
exports.HIGH = 1;
exports.FALLING = 2;
exports.RAISING = 3;
exports.INPUT = 4;
exports.OUTPUT = 5;

var constantSymbol = ['LOW', 'HIGH', 'FALLING', 'RAISING', 'INPUT', 'OUTPUT'];

function constant2string (value) {
   if (value == null) {
      return '(null)';
   }
   try {
      return constantSymbol[value];
   }
   catch (err) {
      return '#'+value;
   }
}

exports.pinMode = function (pin, mode) {
   debuglog ('pinMode ('+pin+', '+constant2string(mode)+')');
}

exports.digitalWrite = function (pin, value) {
   debuglog ('digitalWrite ('+pin+', '+constant2string(value)+')');
}

exports.digitalRead = function (pin) {
   //debuglog ('digitalRead ('+pin+')');
   return 0;
}

exports.attachInterrupt = function (pin, flag, edge, callback) {
   debuglog ('attachInterrupt ('+pin+', '+flag+', '+constant2string(edge)+', '+callback+')');
}

