var fs = require('graceful-fs');
var dgram = require('dgram');
var express = require('express');
var moment = require('moment-timezone');
var nedb = require('nedb'); 

var calendar = require('./calendar');
var weather = require('./weather');
var hardware = require('./hardware');

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

try {
    var hardwareConfig = fs.readFileSync('./hardware.json');
    hardwareConfig = JSON.parse(hardwareConfig);
}
catch (err) {
    console.error('There has been an error loading or parsing the hardware config')
    console.error(err);
} 

var config = fs.readFileSync('./config.json');
try {
    config = JSON.parse(config);
    //console.log(config);
    calendar.configure(config);
    weather.configure(config);

    if (config.udp == null) {
       config.udp = new Object();
       config.udp.port = config.webserver.port;
    }
}
catch (err) {
    console.error('There has been an error parsing the user config')
    console.error(err);
} 

if (!config.weather) {
    config.weather = new Object();
    config.weather.enable = false;
}

// load up the database
var db = new nedb({ filename: './database', autoload: true });

// Some of our default vars
var zoneTimer = null;
var zoneInterval = null;
var running = {};
var runqueue = [];
var currOn = 0;
var buttonTimer = null;
var lastScheduleCheck = null;
var zonecount = 0;
var programcount = 0;

var rainDelayInterval = 86340000; // 1 day - 1 minute.
var rainTimer = 0;

// Calculate the real counts from the configuration we loaded.
resetCounts();

hardware.configure (hardwareConfig, config);
hardware.rainInterrupt (rainCallback);
hardware.buttonInterrupt (buttonCallback);

function refreshConfig () {

    calendar.configure(config);
    weather.configure(config);
    hardware.configure (hardwareConfig, config);
    hardware.rainInterrupt (rainCallback);
    hardware.buttonInterrupt (buttonCallback);
    resetCounts();
}

function saveConfig (body) {

    var data = JSON.stringify(body);

    fs.writeFile('./config.json', data, function (err) {
        if (err) {
            console.error('failed to save configuration data: '+err.message);
            return;
        }
        console.log('Configuration saved successfully.');
        config = body;
        refreshConfig();
    });
}

///////////////////////////////////////
// CONFIGURE THE WEBSERVER
//////////////////////////////////////
var app = express();
app.use(express.favicon());
app.use(express.bodyParser());
app.use(app.router);
app.use(missingHandler);

// Routes
app.get('/config', function(req, res){
    res.json(config);
});

app.post('/config', function(req, res){
    //console.log(req.body);

    saveConfig (req.body);

    res.json({status:'ok',msg:'config saved'});
});

app.get('/status', function(req, res){
    var now = new Date().getTime();
    if ((config.raindelay) && (now < rainTimer)) {
       res.json({status:'ok',weatherenable:config.weather.enable,raintimer:new Date(rainTimer),raindelay:config.raindelay,running:running,queue:runqueue});
    } else {
       res.json({status:'ok',weatherenable:config.weather.enable,raindelay:config.raindelay,running:running,queue:runqueue});
    }
});

app.get('/off', function(req, res){
    killQueue();
    res.json({status:'ok',msg:'all zones have been turned off'});
});

// This URL is to simulate the physical button.
app.get('/button', function(req, res){
    buttonCallback({output: true});
    if (currOn == 0) {
        res.json({status:'ok',msg:'No zone turned on'});
    }
    else {
        var zone = currOn - 1;
        res.json({status:'ok',msg:'Current zone is '+zone});
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
    res.json({status:'ok',msg:'Programs delayed until '+until.getDate()+'/'+(until.getMonth()+1)+'/'+until.getFullYear()});
});

// This URL is a way to enable/disable the rain delay feature.
app.get('/raindelay/:flag', function(req, res){
    var old = config.raindelay;
    if (req.params.flag == 'true') {
        config.raindelay = true;
        res.json({status:'ok',msg:'Rain delay enabled'});
    } else {
        config.raindelay = false;
        rainTimer = 0;
        res.json({status:'ok',msg:'Rain delay disabled'});
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
        res.json({status:'ok',msg:'Weather adjustment enabled'});
    } else {
        config.weather.enable = false;
        res.json({status:'ok',msg:'Weather adjustment disabled'});
    }
    if (old != config.weather.enable) {
        saveConfig (config);
    }
});

app.get('/refresh', function(req, res){
    refreshConfig();
    res.json({status:'ok',msg:'Refresh initiated'});
});

app.get('/history', function(req, res){
    // Finding all the history for this zone
    db.find({}, function (err, docs) {
        if(err){
            console.error(err);
            res.json({status: 'error', msg:err.message});
        } else {
            reportHistory(res, docs);
        }
    });
});

app.get('/zone/:id/history', function(req, res){
    // Finding all the history for this zone
    db.find({ zone: parseInt(req.params.id) }, function (err, docs) {
        if(err){
            console.error(err);
            res.json({status: 'error', msg:err.message});
        } else {
            reportHistory(res, docs);
        }
    });
});

app.get('/zone/:id/on/:seconds', function(req, res){
    if(req.params.id>=0 && req.params.id<zonecount){
        zoneOn(req.params.id,req.params.seconds);
        res.json({status:'ok',msg:'started zone: '+config.zones[req.params.id].name});    
    }
    else {
        errorHandler(res,'That is not a valid zone')
    }
});

app.get('/program/:id/on', function(req, res){
    if(req.params.id>=0 && req.params.id<programcount){
        programOn(config.programs[req.params.id]);
        res.json({status:'ok',msg:'started program: '+config.programs[req.params.id].name});    
    }
    else {
        errorHandler(res,'That is not a valid program');
    }
});

///////////////////////////////////////
// SCHEDULER
//////////////////////////////////////

// Go through one list of watering programs to search one to activate.
//
function schedulePrograms (programs, currTime, currDay, d) {
    if (programs == null) return;
    for(var i=0;i<programs.length;i++){
        // Eliminate immediately a program that would not start
        // at this exact time, or was disabled.
        if (currTime != programs[i].start) continue;
        if (! programs[i].active) continue;

        // Now check if the program should start today.
        if (programs[i].days) {
            // Runs weekly, on specific days of the week.
console.log ('Checking day for program '+programs[i].name+' (weekly)');
            if(programs[i].days.indexOf(currDay) != -1){
                programOn(programs[i]);
            }
            continue;
        }

        var date = moment(programs[i].date+' '+currTime, 'YYYYMMDD HH:mm');
        var delta = d.diff(date, 'days');
        if (delta < 0) continue; // Start at a future date.

        if (programs[i].interval) {
            // Runs daily, at some day interval.
console.log ('Checking day for program '+programs[i].name+' (daily, interval='+programs[i].interval+', delta='+delta+')');
            if ((delta % programs[i].interval) == 0) {
                programOn(programs[i]);
            }
            continue;
        }
        // Otherwise, this program runs at the specified date (once).
console.log ('Checking day for program '+programs[i].name+' (once, delta='+delta+')');
        if (delta == 0) {
            programOn(programs[i]);
            programs[i].active = false; // Do not run it again.
            continue;
        }
        if (delta > 0) {
            programs[i].active = false; // Obsolete, do not run it anymore.
        }
    }
}

// Schedule all watering programs.
//
function scheduler () {
    var d = moment().tz(config.timezone);
    var currTime = d.format('HH:mm');
    var currDay = parseInt(d.format('d'));

    if (currTime == lastScheduleCheck) return;
    lastScheduleCheck = currTime;

    // Rain sensor(s) handling.
    // In this design, rain detection does not abort an active program
    // on its track, it only disables launching new programs.
    // We check the status of the rain sensor(s) even if the rain timer
    // is armed: this pushes the timer to one day after the end of the rain.
    // The rationale is that we hope that this will make the controller's
    // behavior more predictable. This is just a (debatable) choice.

    if (config.raindelay) {
        var now = new Date().getTime();

        if (hardware.rainSensor() || weather.rainsensor()) {
              var nextTimer = now + rainDelayInterval;
              if (nextTimer > rainTimer) {
                  rainTimer = nextTimer;
              }
        }
        if (rainTimer > now) return;
    }

    schedulePrograms (config.programs, currTime, currDay, d);
    schedulePrograms (calendar.programs(), currTime, currDay, d);
}

///////////////////////////////////////
// START UP THE APP
//////////////////////////////////////

app.listen(config.webserver.port);
console.log('Listening on port '+config.webserver.port);

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
// This does not need to be fast (here: 10mn), but each refresh function
// called is free to do nothing until a longer delay has expired.
//
setInterval(function(){
    calendar.refresh();
    weather.refresh();
},600000);

// Start auto discovery UDP broadcast ping
//
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
            console.error(err);
        }
    });
},6000);

logEvent({action: 'STARTUP'});

///////////////////////////////////////
// HELPERS
//////////////////////////////////////

function reportHistory (res, docs) {
   // The history is sorted most recent first.
   docs.sort(function (a, b) {
       return b.timestamp - a.timestamp;
   });
   res.json({status: 'ok', history:docs});    
}

function logEvent (data) {
    data.timestamp = new Date();
    db.insert(data, function (err, newDoc) {
        if(err){
            console.error('Database insert error: '+err);
        }
        //console.log('wrote record '+newDoc._id);
    });    
}

function missingHandler(req, res, next) {
    console.log('404 Not found - '+req.url);
    res.json(404, { status: 'error', msg: 'Not found, sorry...' });
}

function errorHandler(res, msg) {
    console.log(msg);
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

function zoneOn(index,seconds) {
    killQueue();
    runqueue.push({zone:index,seconds:seconds,parent:null});
    processQueue();
}

function programOn(program) {
    killQueue();
    console.log ('Running program '+programs[i].name);
    logEvent({action: 'START', program: program.name, temperature: weather.temperature(), humidity: weather.humidity(), rain: weather.rain(), adjustment: weather.adjustment()});

    runqueue = program.zones;

    if (config.weather.enable) {
        // Adjust the program's zones duration according to the weather.
        // Note that we do not adjust a manual activation on an individual
        // zone: the user knows what he is doing.

        for (var i = 0; i < runqueue.length; i++) {
             runqueue[i].parent = program.name;
             runqueue[i].seconds =
                 (runqueue[i].seconds * weather.adjustment()) / 100;
        }
    }
    processQueue();
}

// Shut down all the zones and stop the current action.
//
function zonesOff() {
    // console.log('shutting off all zones');
    
    // if we are currently running something, log that we interrupted it.
    if(running.seconds) {
        if(running.remaining == 1) running.remaining = 0;
        var runtime = running.seconds-running.remaining;
        logEvent({action: 'CANCEL', zone: running.zone-0, parent: running.parent, seconds: running.seconds, runtime: runtime});
    }

    running = {};

    for(var i = 0; i < zonecount; i++){
        hardware.setZone (i, false);
    }
    hardware.apply();
}

function killQueue() {
    //console.log('clearing the queue');
    zonesOff();
    runqueue = [];
    clearTimers();
}

function processQueue() {
    // is anything in the queue?
    if(runqueue.length){
        // start working on the next item in the queue
        running = runqueue.shift();

        if(running.seconds <= 0) {
            // Skip that zone.
            processQueue();
            return;
        }

        if ((running.zone == null) || (running.zone == undefined) || (running.zone < 0) || (running.zone >= zonecount)) {
            // Don't process an invalid program.
            console.error('Invalid zone '+running.zone);
            return;
        }
        logEvent({action: 'START', zone:running.zone-0, parent: running.parent, seconds: running.seconds});

        running.remaining = running.seconds;

        hardware.setZone (running.zone, true);
        hardware.apply();

        // clear any timers that are currently running
        clearTimers();

        // count down the time remaining
        zoneInterval = setInterval(function(){
            if(running.zone){
                running.remaining = running.remaining - 1;
            }
                
        },1000) 

        // start a countdown timer for the zone watering time
        zoneTimer = setTimeout(function(){
            hardware.setZone (running.zone, false);
            hardware.apply();

            logEvent({action: 'END', zone: running.zone-0, parent: running.parent, seconds: running.seconds, runtime: running.seconds});
            running = {};

            // wait a couple seconds and kick off the next
            setTimeout(function(){
                processQueue();
            },2000) 

        },running.seconds*1000);

    } else {
        // once there is nothing left to process we can clear the timers
        zonesOff();
        clearTimers();
        logEvent({action: 'IDLE'});
    }
}

function rainCallback(x) {
    if(x.output){
        console.log('Raining! '+JSON.stringify(x));
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
                console.log('Turning on zone '+zone);
                zoneOn(zone,900);
            }, 2000);
        }
        else {
            console.log('All done, back to the start');
            currOn = 0;
        }

        console.log('Button Pressed!');
        console.log(JSON.stringify(x));   
    }
}

