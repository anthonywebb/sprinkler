var os = require('os');
var fs = require('graceful-fs');
var dgram = require('dgram');
var express = require('express');
var moment = require('moment-timezone');

var path = require('./path');
var event = require('./event');
var hardware = require('./hardware');
var calendar = require('./calendar');
var weather = require('./weather');
var wateringindex = require('./wateringindex');


// Some of our default vars
var zoneTimer = null;
var zoneInterval = null;
var running = {};
var runqueue = [];
var currOn = 0;
var buttonTimer = null;
var lastScheduleCheck = -1;
var lastWeatherUpdateRecorded = 0;
var lastWateringIndexUpdateRecorded = 0;
var zonecount = 0;
var programcount = 0;

const rainDelayInterval = 86340000; // 1 day - 1 minute.
var rainTimer = 0;


var errorLog = function (text) {
    console.log ('[ERROR] '+text);
}

var options = new Object();

process.argv.forEach(function(val, index, array) {
    if (val == '--debug') {
        options.debug = true;
    }
});

var debugLog = function (text) {}

if (options.debug) {
    debugLog = function (text) {
        console.log ('[DEBUG] '+moment().format('YYYY/MM/DD HH:mm')+' '+text);
    }
}
debugLog ('starting sprinkler');

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
    if (config.programs) {
        programcount = config.programs.length;
    }
    else {
        programcount = 0;
    }
}

function activateConfig () {

    debugLog ('activating new configuration');
    event.configure(config, options);
    hardware.configure (hardwareConfig, config, options);
    hardware.rainInterrupt (rainCallback);
    hardware.buttonInterrupt (buttonCallback);
    calendar.configure(config, options);
    weather.configure(config, options);
    wateringindex.configure(config, options);
    // Calculate the real counts from the configuration we loaded.
    resetCounts();
}

function saveConfig (body, activate) {

    var data = JSON.stringify(body);

    fs.writeFile(path.userConfig(), data, function (err) {
        if (err) {
            errorLog('failed to save configuration data: '+err.message);
            return;
        }
        debugLog('Configuration saved successfully.');
        config = body;
        if (activate) {
           activateConfig();
        }
    });
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

if (config.on == null) {
    config.on = true;
}

if (!config.weather) {
    config.weather = new Object();
    config.weather.enable = false;
}

if (!config.wateringindex) {
    config.wateringindex = new Object();
    config.wateringindex.enable = false;
}


///////////////////////////////////////
// CONFIGURE THE WEBSERVER
//////////////////////////////////////
var app = express();
app.use(express.favicon());
app.use(express.bodyParser());
app.use(app.router);
app.use(express.static(__dirname+'/public'));
app.use(missingHandler);

// Routes

// This URL is a way to enable/disable automatic watering completely.
app.get('/onoff', function(req, res){
    if (config.on == false) {
        config.on = true;
        event.record({action: 'ON'});
        res.json({status:'ok',hostname:os.hostname(),msg:'Watering enabled'});
    } else {
        config.on = false;
        event.record({action: 'OFF'});
        res.json({status:'ok',hostname:os.hostname(),msg:'Watering disabled'});
    }
    saveConfig (config);
});

app.get('/config', function(req, res){
    res.json(config);
});

app.post('/config', function(req, res){
    //debugLog(req.body);
    saveConfig (req.body, true);
    res.json({status:'ok',msg:'config saved'});
});

app.get('/status', function(req, res){
    var now = new Date().getTime();
    var response = {
        status:'ok',
        on:config.on,
        hostname:os.hostname(),
        weather:{
            enabled:weather.enabled(),
            status:weather.status(),
            updated:weather.updated(),
            adjustment:weather.adjustment(),
            source:'WEATHER'
        },
        wateringindex:{
            enabled:wateringindex.enabled(),
            status:wateringindex.status(),
            updated:wateringindex.updated(),
            adjustment:wateringindex.adjustment(),
            source:wateringindex.source()
        },
        calendars:calendar.status(),
        raindelay:config.raindelay,
        running:running,
        queue:runqueue
    };
    if ((config.raindelay) && (now < rainTimer)) {
       response.raintimer = new Date(rainTimer);
    }
    res.json(response);
});

// This URL is to simulate the physical button.
app.get('/button', function(req, res){
    buttonCallback({output: true});
    if (currOn == 0) {
        res.json({status:'ok',hostname:os.hostname(),msg:'No zone turned on'});
    }
    else {
        var zone = currOn - 1;
        res.json({status:'ok',hostname:os.hostname(),msg:'Current zone is '+config.zones[zone].name+' ('+zone+')'});
    }
});

// This URL is a manual rain delay.
app.get('/raindelay', function(req, res){
    if (! config.raindelay) {
        config.raindelay = true;
        saveConfig (config);
    }
    var now = new Date().getTime();
    if (now > rainTimer) {
        // There was no rain delay pending: start a new one.
        rainTimer = now + rainDelayInterval;
    } else {
        // A rain delay is pending: extend it.
        rainTimer = rainTimer + rainDelayInterval;
    }
    var until = new Date(rainTimer);
    res.json({status:'ok',hostname:os.hostname(),msg:'Programs delayed until '+until.getDate()+'/'+(until.getMonth()+1)+'/'+until.getFullYear()});
});

// This URL is a way to enable/disable the rain delay feature.
app.get('/raindelay/:flag', function(req, res){
    var old = config.raindelay;
    if (req.params.flag == 'true') {
        config.raindelay = true;
        res.json({status:'ok',hostname:os.hostname(),msg:'Rain delay enabled'});
    } else {
        config.raindelay = false;
        rainTimer = 0;
        res.json({status:'ok',hostname:os.hostname(),msg:'Rain delay disabled'});
    }
    if (old != config.raindelay) {
        saveConfig (config);
    }
});

// This URL is a way to enable/disable the weather adjustment feature.
app.get('/weather/:flag', function(req, res){
    var old = config.weather.enable;
    if (req.params.flag == 'true') {
        config.weather.enable = true;
        res.json({status:'ok',hostname:os.hostname(),msg:'Weather adjustment enabled'});
    } else {
        config.weather.enable = false;
        res.json({status:'ok',hostname:os.hostname(),msg:'Weather adjustment disabled'});
    }
    if (old != config.weather.enable) {
        saveConfig (config);
    }
});

// This URL is a way to enable/disable the watering index adjustment feature.
app.get('/wateringindex/:flag', function(req, res){
    var old = config.wateringindex.enable;
    if (req.params.flag == 'true') {
        config.wateringindex.enable = true;
        res.json({status:'ok',hostname:os.hostname(),msg:'Watering Index adjustment enabled'});
    } else {
        config.wateringindex.enable = false;
        res.json({status:'ok',hostname:os.hostname(),msg:'Watering Index adjustment disabled'});
    }
    if (old != config.wateringindex.enable) {
        saveConfig (config);
        wateringindex.configure (config, options);
    }
});

app.get('/refresh', function(req, res){
    activateConfig();
    res.json({status:'ok',hostname:os.hostname(),msg:'Refresh initiated'});
});

app.get('/history', function(req, res){
    // Finding all the history for all zones
    event.find({}, function (response) {
        response.hostname = os.hostname();
        res.json(response);
    });
});

app.get('/history/latest', function(req, res){
    // Finding the latest historical event
    // This is a way to tell if something new has happened and
    // let the client know when to ask for all events (see /history).
    res.json({_id:event.latest()});
});

app.get('/system/history', function(req, res){
    // Finding all the system events
    event.find({action: {$nin:['START', 'END', 'CANCEL']}}, function (response) {
        response.hostname = os.hostname();
        res.json(response);
    });
});

function retrieveProgramById (id) {

    if (id.match(/C/)) {
       var index = parseInt(id.substring(1));
       var programs = calendar.programs();
       if(index>=0 && index<programs.length){
          return programs[index];
       }
       return null;
    }
    if (id.match(/L/)) {
       var index = parseInt(id.substring(1));
       if(index>=0 && index<config.programs.length){
          return config.programs[index];
       }
       return null;
    }
    var index = parseInt(id);
    if(index>=0 && index<config.programs.length){
       return config.programs[index];
    }
    return null;
}

app.get('/program/:id/history', function(req, res){
    // Finding the history's main events for this program
    var program = retrieveProgramById (req.params.id);
    if (program) {
       event.find({program: program.name}, function (response) {
          response.hostname = os.hostname();
          res.json(response);
       });
    }
    else {
        errorHandler(res,''+req.params.id+' is not a valid program');
    }
});

app.get('/program/:id/full/history', function(req, res){
    // Finding all the history for this program
    var program = retrieveProgramById (req.params.id);
    if (program) {
       event.find({$or:[{program:program.name}, {parent:program.name}]}, function (response) {
          response.hostname = os.hostname();
          res.json(response);
       });
    }
    else {
        errorHandler(res,''+req.params.id+' is not a valid program');
    }
});

app.get('/program/:id/on', function(req, res){
    var program = retrieveProgramById (req.params.id);
    if (program) {
        programOn(program);
        res.json({status:'ok',hostname:os.hostname(),msg:'started program: '+program.name});    
    }
    else {
        errorHandler(res,''+req.params.id+' is not a valid program');
    }
});

app.get('/zone/:id/history', function(req, res){
    // Finding all the history for this zone
    event.find({ zone: parseInt(req.params.id) }, function (response) {
        response.hostname = os.hostname();
        res.json(response);
    });
});

app.get('/zone/:id/on/:seconds', function(req, res){
    if(req.params.id>=0 && req.params.id<zonecount){
        zoneOnManual(req.params.id,req.params.seconds);
        res.json({status:'ok',hostname:os.hostname(),msg:'started zone: '+config.zones[req.params.id].name});    
    }
    else {
        errorHandler(res,''+req.params.id+' is not a valid zone')
    }
});

app.get('/zone/off', function(req, res){
    killQueue();
    res.json({status:'ok',hostname:os.hostname(),msg:'all zones have been turned off'});
});

app.get('/calendar/programs', function(req, res){
    res.json(calendar.programs());
});

app.get('/weather', function(req, res){
    if (weather.status()) {
        res.json({status:'ok',hostname:os.hostname(),temperature:weather.temperature(),high:weather.high(),low:weather.low(),humidity:weather.humidity(),rain:weather.rain(),rainsensor:weather.rainsensor(),adjustment:weather.adjustment()});
    } else {
        res.json({status:'ok'});    
    }
});

app.get('/hardware/info', function(req, res){
    res.json(hardware.info());
});

///////////////////////////////////////
// SCHEDULER
//////////////////////////////////////

// Analyze one watering program to see if it must be activated.
function scheduleOneProgram (program, now) {

   // Eliminate immediately a program that would not start
   // at this exact time of day.
   if (now.format('HH:mm') != program.start) return false;

   // Eliminate a program that has become obsolete.
   if (program.until) {
      if (program.until.isBefore(now)) return false;
   }

   // Eliminate occurrences that have been excluded (either modified and
   // replaced by an exception, or deleted).
   if (program.exclusions) {
      for (var j = 0; j < program.exclusions.length; j++) {
         if (Math.abs(now.diff(program.exclusions[j])) < 60000) {
            return false; // This occurrence was excluded.
         }
      }
   }

   // Check the date when the program starts (or started) to be active.
   if (program.date) {
      var date = moment(program.date+' '+program.start, 'YYYYMMDD HH:mm');
      var delta = now.diff(date, 'days');
      if (delta < 0) return false; // Starts at a future date.
      debugLog ('delta from '+date.format()+' to '+now.format()+' is '+delta);
   } else {
      // No start date yet: force the program to start today.
      program.date = now.format('YYYYMMDD');
      delta = 0;
      debugLog ('make program '+program.name+' start today');
   }

   // Now check if the program should be activated today.
   switch (program.repeat) {
   case 'weekly':
       // Runs weekly, on specific days of the week.
       debugLog ('Checking day for program '+program.name+' (weekly)');
       if (program.days[now.day()]) {
           return true;
       }
       break;

   case 'daily':
       // Runs daily, at some day interval.
       debugLog ('Checking day for program '+program.name+' (daily, interval='+program.interval+', delta='+delta+')');
       if ((delta % program.interval) == 0) {
           return true;
       }
       break;;

   default:
       // Otherwise, this program runs at the specified date (once).
       debugLog ('Checking day for program '+program.name+' (once, delta='+delta+')');
       program.active = false; // Do not run it anymore.
       if (delta == 0) {
           return true;
       }
   }
   return false;
}

// Go through one list of watering programs to search one to activate.
//
function scheduleProgramList (programs, now) {

    if (programs == null) return;

    for (var i = 0; i < programs.length; i++) {

        var program = programs[i];

        // Eliminate immediately a program that was disabled.
        // (this also disable all associated exception programs).
        if (! program.active) continue;

        // Allow enabling a program for a specific season only (user-defined)
        // (this also impacts all associated exception programs).
        if (program.season) {
           if (config.seasons) {
              var giveup = false;
              for (var si = 0; si < config.seasons.length; si++) {
                 if (config.seasons[si].name == program.season) {
                    if (config.seasons[si].weekly) {
                       if (! config.seasons[si].weekly[now.week()]) {
                          giveup = true;
                       }
                    } else if (config.seasons[si].monthly) {
                       if (! config.seasons[si].monthly[now.month()]) {
                          giveup = true;
                       }
                    }
                    break;
                 }
              }
              if (giveup) continue;
           }
        }

        // Each exception is a non-repeat program on its own, which replaces
        // the normal program's occurrence.
        var launched = false;
        if (program.exceptions) {
           for (var j = 0; j < program.exceptions.length; j++) {
              if (scheduleOneProgram(program.exceptions[j], now)) {
                 programOn(program.exceptions[j]);
                 launched = true;
                 break;
              }
           }
        }
        if (! launched) {
           if (scheduleOneProgram(program, now)) {
              programOn(program);
           }
        }
    }
}

// Schedule all watering programs.
//
function scheduler () {

    if (config.on == false) return;

    var now = moment();
    now.millisecond(0);
    now.second(0);

    var thisminute = now.minute();
    if (thisminute == lastScheduleCheck) return;
    lastScheduleCheck = thisminute;

    // Rain sensor(s) handling.
    // In this design, rain detection does not abort an active program
    // on its track, it only disables launching new programs.
    // We check the status of the rain sensor(s) even if the rain timer
    // is armed: this pushes the timer to one day after the end of the rain.
    // The rationale is that we hope that this will make the controller's
    // behavior more predictable. This is just a (debatable) choice.

    if (config.raindelay) {
        if (hardware.rainSensor() || weather.rainsensor()) {
              var nextTimer = rainDelayInterval + now;
              if (nextTimer > rainTimer) {
                  rainTimer = nextTimer;
              }
        }
        if (rainTimer > +now) return;
    }

    scheduleProgramList (config.programs, now);
    scheduleProgramList (calendar.programs(), now);
}

///////////////////////////////////////
// START UP THE APP
//////////////////////////////////////

app.listen(config.webserver.port);
debugLog('Listening on port '+config.webserver.port);

// turn off all zones
killQueue();

// Add the listener for recurring program schedules
//
// The calendar programs are kept separate from the programs in config,
// so that they are not saved to config.json as a side effect.
// Another solution would be to build a list of programs to execute, separate
// from the config object, that would be an union of config and calendar.
//
// We schedule every 10s to start reasonably close to the beginning of
// a 1mn period. The scheduler is responsible for handling frequent calls.
//
setInterval(function(){
    scheduler();
},10000);

// Add the listener for periodic information refresh.
//
// This does not need to be fast (here: 1mn), but each refresh function
// called is free to do nothing until a longer delay has expired.
//
setInterval(function(){
    calendar.refresh();
    weather.refresh();
    wateringindex.refresh();
    var update = weather.updated();
    if (weather.status() && (update > lastWeatherUpdateRecorded)) {
        event.record({action: 'UPDATE', source:'WEATHER', temperature: weather.temperature(), humidity: weather.humidity(), rain: weather.rain(), adjustment: weather.adjustment()});
        lastWeatherUpdateRecorded = update;
    }
    update = wateringindex.updated();
    if (wateringindex.status() && (update > lastWateringIndexUpdateRecorded)) {
        event.record({action: 'UPDATE', source:wateringindex.source(), adjustment: wateringindex.adjustment()});
        lastWateringIndexUpdateRecorded = update;
    }
},60000);

// Start auto discovery UDP broadcast ping
//
if (config.udp == null) {
   config.udp = new Object();
   config.udp.port = config.webserver.port;
}
var message = new Buffer("sprinkler "+config.webserver.port);
var socket = dgram.createSocket("udp4");
// TBD: better use callback: socket.bind(config.webserver.port, function() {
socket.bind(config.udp.port);
setTimeout(function(){
    socket.setBroadcast(true);
}, 3000);

setInterval(function(){
    socket.send(message, 0, message.length, 41234, '255.255.255.255', function(err, bytes) {
        if(err){
            errorLog('cannot send periodic broadcast signature: '+err);
        }
    });
},6000);

// Do not remove this event: one side effect is that it ensures that
// there is always an event created, and thus we know the latest event.
//
event.record({action: 'STARTUP'});

///////////////////////////////////////
// HELPERS
//////////////////////////////////////

function missingHandler(req, res, next) {
    errorLog('404 Not found - '+req.url);
    res.json(404, { status: 'error', msg: 'Not found, sorry...' });
}

function errorHandler(res, msg) {
    errorLog(msg);
    res.json(500, { status: 'error', msg: msg });
}

function clearTimers() {
    if (zoneInterval != null) {
        clearInterval(zoneInterval);
        zoneInterval = null;
    }
    if (zoneTimer != null) {
        clearTimeout(zoneTimer);
        zoneTimer = null;
    }
}

function zoneOnManual(index,seconds) {
    killQueue();
    runqueue.push({zone:index,seconds:seconds,parent:null});
    processQueue();
}

function programOn(program) {
    debugLog ('Running program '+program.name);
    if ((!program.options) || (!program.options.append)) {
        killQueue();
    }

    // We need to clone the list of zones because we remove each item from
    // the list of zones in the queue after it has run its course: without
    // cloning we would destroy the list of zones in the program itself.
    //
    // We build the zone activation list in two phases:
    // Phase 1: retrieve the list of zones, calculate the adjusted runtime.
    // Phase 2: run the program as many times as necessary to cover the
    //          adjusted time with runs no longer than the configured pulse.
    //          Put the minimal pause between each iteration to cover the
    //          configured pause.
    //
    var zonecontext = new Array();
    var timeremaining = 0;

    for (var i = 0; i < program.zones.length; i++) {

        var zone = + program.zones[i].zone;
        var seconds = + program.zones[i].seconds;

        zonecontext[i] = new Object();
        zonecontext[i].zone = zone;
        zonecontext[i].raw = seconds;

        // Add the capability to disable one zone, when activated from
        // a program. Keep the ability to control it manually. This is
        // typically for a zone with a problem (broken pipe, leak, etc).
        // This way one can avoid this zone without modifying all programs.
        //
        var zoneconfig = config.zones[zone];
        if (zoneconfig.manual) {
           event.record({action: 'SKIP', zone:zone, parent: program.name, seconds: 0});
           zonecontext[i].adjusted = 0;
           continue;
        }

        // Each zone may have its own predefined adjustment settings, or else
        // use the "default" one. Use the weather adjustment only if there
        // is no predefined adjustment settings for that zone and weather
        // adjustment is enabled.

        var source = null;
        var adjusted = seconds;

        var adjustname = zoneconfig.adjust;
        if (adjustname == null) {
           adjustname = "default";
        }
        var adjust = null;
        if (config.adjust != null) {
            for (var ai = 0; ai < config.adjust.length; ai++) {
               if (config.adjust[ai].name == adjustname) {
                  adjust = config.adjust[ai];
               }
            }
        }
        if (adjust != null) {
            // Predefined adjustments take priority.
            var ratio = 100;
            if (adjust.weekly != null) {
                ratio = adjust.weekly[moment().week()];
                source = adjustname+' (weekly)'
            } else if (adjust.monthly != null) {
                ratio = adjust.monthly[moment().month()];
                source = adjustname+' (monthly)'
            }
            adjusted = Math.floor(((seconds * ratio) + 50) / 100);
        } else {
            if (wateringindex.enabled()) {
                // Adjust the zone duration according to the watering index.
                adjusted = wateringindex.adjust(seconds);
                source = wateringindex.source();
            } else if (weather.enabled()) {
                // Adjust the zone duration according to the weather.
                // Note that we do not adjust a manual activation on
                // a manual zone start: the user knows what he is doing.
                //
                adjusted = weather.adjust(seconds);
                source = "WEATHER";
            }
        }

        timeremaining += adjusted

        zonecontext[i].source = source;
        zonecontext[i].adjusted = adjusted;
        zonecontext[i].ratio = Math.floor((adjusted * 100) / seconds);

        if (zoneconfig.pulse) {
           zonecontext[i].pulse = zoneconfig.pulse;
           zonecontext[i].pause = zoneconfig.pause;
        } else {
           zonecontext[i].pulse = zonecontext[i].adjusted
           zonecontext[i].pause = 0;
        }
    }

    // In phase 2, loop as long as there is still a zone that must be run.
    //
    while (timeremaining > 0) {
        timeremaining = 0;
        var pause = 0;
        for (var i = 0; i < program.zones.length; i++) {

            if (zonecontext[i].adjusted <= 0) continue;

            var runtime = zonecontext[i].adjusted;
            if (runtime > zonecontext[i].pulse) {
                runtime = zonecontext[i].pulse;
                zonecontext[i].adjusted -= runtime;
                if ((zonecontext[i].adjusted < 15) &&
                    (zonecontext[i].adjusted < zonecontext[i].pulse)) {
                   // Forget the last run since it is too short.
                   zonecontext[i].adjusted = 0;
                } else if (pause < zonecontext[i].pause) {
                   // There will be a next run: plan for the pause.
                   pause = zonecontext[i].pause;
                }
            } else {
                zonecontext[i].adjusted = 0;
            }
            timeremaining += zonecontext[i].adjusted; // time left after this.

            var zone = + zonecontext[i].zone;

            if (zonecontext[i].source != null) {
               runqueue.push({
                   zone:zone,
                   seconds:runtime,
                   adjust:zonecontext[i].source,
                   ratio:zonecontext[i].ratio,
                   parent:program.name});
            } else {
               runqueue.push({zone:zone,seconds:runtime,parent:program.name});
            }
        }
        if (pause > 0) {
            runqueue.push({zone:null,seconds:pause,parent:program.name});
        }
    }

    var logentry = {
        action: 'START',
        program: program.name
    };

    if (wateringindex.status()) {
        logentry.adjustment = wateringindex.adjustment();
        logentry.source = wateringindex.source();
    } else if (weather.status()) {
        logentry.temperature = weather.temperature();
        logentry.humidity = weather.humidity();
        logentry.rain = weather.rain();
        logentry.adjustment = weather.adjustment();
        logentry.source = 'WEATHER';
    }
    event.record(logentry);
    processQueue();
}

// Control on or off the master valve of the specified zone (if any).
//
function zoneMaster (index, on) {
    if (config.zones[index].master !== undefined) {
       var master = config.zones[index].master;
       if ((master >= 0) && (master < zonecount)) {
          hardware.setZone (master, on);
          hardware.apply();
       }
    }
}

// Shut down all the zones and stop the current action.
//
function zonesOff() {
    debugLog('shutting off all zones');

    if (running != null) {
        // if we are currently running something, log that we interrupted it.
        if (running.remaining > 0) {
           if(running.remaining == 1) running.remaining = 0;
           var runtime = running.seconds-running.remaining;
           event.record({action: 'CANCEL', zone: running.zone-0, parent: running.parent, seconds: running.seconds, runtime: runtime});
        } else if (running.parent) {
           event.record({action: 'CANCEL', program: running.parent});
        }

        running = null;
    }

    for(var i = 0; i < zonecount; i++){
        hardware.setZone (i, false);
    }
    hardware.apply();
}

function killQueue() {
    debugLog('clearing the queue');
    zonesOff();
    runqueue = [];
    clearTimers();
}

function processQueue() {
    // is anything in the queue?
    if(runqueue.length) {
        // start working on the next item in the queue
        running = runqueue.shift();

        if(running.seconds <= 0) {
            // Skip that zone.
            processQueue();
            return;
        }

        if (running.zone == null) { // This is a pause.
            zoneTimer = setTimeout(function(){
                running = {parent:running.parent}; // Wait time.
                processQueue();
            },running.seconds*1000);
            return;
        }

        if ((running.zone == undefined) || (running.zone < 0) || (running.zone >= zonecount)) {
            // Don't process an invalid program.
            errorLog('Invalid zone '+running.zone);
            return;
        }
        if (running.adjust != null) {
            event.record({action: 'START', zone:running.zone-0, parent: running.parent, seconds: running.seconds, adjust:running.adjust, ratio:running.ratio});
        } else {
            event.record({action: 'START', zone:running.zone-0, parent: running.parent, seconds: running.seconds});
        }

        running.remaining = running.seconds;

        // Make sure that the zone does not open after its master (to avoid
        // risks of backflow).
        hardware.setZone (running.zone, true);
        hardware.apply();
        zoneMaster (running.zone, true);

        // clear any timers that are currently running
        clearTimers();

        // count down the time remaining
        zoneInterval = setInterval(function(){
            if(running.zone != null){
                running.remaining = running.remaining - 1;
            }
                
        },1000) 

        // start a countdown timer for the zone watering time
        zoneTimer = setTimeout(function(){
            // Make sure that the master does not close after the zone (to 
            // avoid risks of backflow).
            zoneMaster (running.zone, false);
            hardware.setZone (running.zone, false);
            hardware.apply();

            if (running.parent) {
               if (runqueue.length) {
                  if (running.parent != runqueue[0].parent) {
                     event.record({action: 'END', program: running.parent});
                  }
               } else {
                  event.record({action: 'END', program: running.parent});
               }
            }
            running = {parent:running.parent}; // Wait time.

            // wait a couple seconds and kick off the next
            setTimeout(function(){
                processQueue();
            },2000) 

        },running.seconds*1000);

    } else {
        // once there is nothing left to process we can clear the timers
        running = null; // Now idle for real.
        zonesOff();
        clearTimers();
    }
}

function rainCallback(x) {
    if(x.output){
        debugLog('Raining! '+JSON.stringify(x));
        rainTimer = new Date().getTime() + rainDelayInterval;
    }
}

function buttonCallback(x) {
    if(x.output){
        currOn += 1;
        if (buttonTimer != null) {
           clearTimeout(buttonTimer);
           buttonTimer = null;
        }
        if (currOn<=zonecount){
            buttonTimer = setTimeout (function () {
                var zone = currOn - 1;
                debugLog('Turning on zone '+zone);
                zoneOnManual(zone,900);
            }, 2000);
        }
        else {
            debugLog('All done, back to the start');
            currOn = 0;
        }

        debugLog('Button Pressed!');
        debugLog(JSON.stringify(x));   
    }
}

