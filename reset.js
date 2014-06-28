// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   reset - a tool to reset all sprinklers.
//
// SYNOPSYS
//
//   This tools stop all zones. It is intended to be run after the sprinkler
//   software stop, either an intended stop or an unintended stop.
//
//   The goal is to avoid water to flow out of control.
//
var os = require('os');
var fs = require('graceful-fs');
var moment = require('moment-timezone');

var path = require('./path');
var event = require('./event');
var hardware = require('./hardware');


// Some of our default vars
var zonecount = 0;


var errorLog = function (text) {
    console.log ('[ERROR] '+text);
}

var options = new Object();

process.argv.forEach(function(val, index, array) {
    if ((val == '--debug') || (val == '-d')) {
        options.debug = true;
    }
});

var debugLog = function (text) {}

if (options.debug) {
    debugLog = function (text) {
        console.log ('[DEBUG] '+moment().format('YYYY/MM/DD HH:mm')+' '+text);
    }
}
debugLog ('system reset (all zones)');

///////////////////////////////////////
// LOAD THE PROGRAM CONFIGURATION
//////////////////////////////////////

// Count the number of items (protected against the worst possible case).
function resetCounts() {
    if (config.zones) {
        zonecount = config.zones.length;
    }
    else {
        zonecount = 0;
    }
}

function activateConfig () {

    debugLog ('activating new configuration');
    event.configure(config, options);
    hardware.configure (hardwareConfig, config, options);
    // Calculate the real counts from the configuration we loaded.
    resetCounts();
}

try {
    var hardwareConfig = fs.readFileSync(path.hardwareConfig());
    hardwareConfig = JSON.parse(hardwareConfig);
}
catch (err) {
    errorLog('There has been an error loading or parsing the hardware config: '+err)
} 

var config = fs.readFileSync(path.userConfig());
try {
    config = JSON.parse(config);
    debugLog("User configuration parsed");

    activateConfig();
}
catch (err) {
    errorLog('There has been an error parsing the user config: '+err)
} 

///////////////////////////////////////
// START UP THE APP
//////////////////////////////////////

// Shut down all the zones.
//
event.record({action: 'CANCEL'});

for(var i = 0; i < zonecount; i++){
    hardware.setZone (i, false);
}
hardware.apply();

