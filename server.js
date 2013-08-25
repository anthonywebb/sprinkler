var fs = require('fs');
var dgram = require('dgram');
var express = require('express');
var moment = require('moment-timezone');
var nedb = require('nedb'); 

///////////////////////////////////////
// LOAD THE DEFAULT CONFIG
//////////////////////////////////////
var config = fs.readFileSync('./config.json');
try {
    config = JSON.parse(config);
    //console.log(config);
}
catch (err) {
    console.log('There has been an error parsing your config')
    console.log(err);
} 

// load up the database
var db = new nedb({ filename: './database', autoload: true });

// Some of our default vars
var t, i;
var running = {};
var runqueue = [];
var zonecount = config.zones.length;
var programcount = config.programs.length;
var currOn = 0;

///////////////////////////////////////
// BBB specific setup
//////////////////////////////////////
if(config.production){
    var b = require('bonescript');

    // declare the pin modes
    b.pinMode(config.rain, b.INPUT);
    b.pinMode(config.button, b.INPUT);
    for(var i = 0; i < config.zones.length; i++){
        b.pinMode(config.zones[i].pin, b.OUTPUT); 
    }

    // attach interrupts
    b.attachInterrupt(config.rain, true, b.FALLING, rainCallback);
    b.attachInterrupt(config.button, true, b.FALLING, buttonCallback);    
}

///////////////////////////////////////
// CONFFIGURE THE WEBSERVER
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
    console.log(req.body);

    var data = JSON.stringify(req.body);

    fs.writeFile('./config.json', data, function (err) {
        if (err) {
            console.log('There has been an error saving your configuration data.');
            console.log(err.message);
            return;
        }
        console.log('Configuration saved successfully.');
        config = req.body;
        zonecount = config.zones.length;
        programcount = config.zones.length;
    });

    res.json({status:'ok',msg:'config saved'});
});

app.get('/status', function(req, res){
    res.json({status:'ok',running:running,queue:runqueue});
});

app.get('/off', function(req, res){
    zonesOff(true);
    res.json({status:'ok',msg:'all zones have been turned off'});
});

app.get('/history', function(req, res){
    // Finding all the history for this zone
    db.find({}, function (err, docs) {
        if(err){
            console.log(err);
            res.json({status: 'error', msg:err.message});
        } else {
            res.json({status: 'ok', history:docs});    
        }
    });
});

app.get('/zone/:id/history', function(req, res){
    // Finding all the history for this zone
    db.find({ zone: parseInt(req.params.id) }, function (err, docs) {
        if(err){
            console.log(err);
            res.json({status: 'error', msg:err.message});
        } else {
            res.json({status: 'ok', history:docs});    
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
        programOn(req.params.id);
        res.json({status:'ok',msg:'started program: '+config.programs[req.params.id].name});    
    }
    else {
        errorHandler(res,'That is not a valid program');
    }
});

///////////////////////////////////////
// START UP THE APP
//////////////////////////////////////
app.listen(config.webserver.port);
console.log('Listening on port '+config.webserver.port);

// turn off all zones
zonesOff(true);

// Add the listener for recurring program schedules
setInterval(function(){
    var d = moment().tz(config.timezone);
    var currTime = d.format('HH:mm');
    var currDay = parseInt(d.format('d'));

    // loop over the programs and see if we have a match
    for(var i=0;i<config.programs.length;i++){
        if(config.programs[i].active && currTime == config.programs[i].start &&  config.programs[i].days.indexOf(currDay) != -1){
            programOn(i);
        }
    }
    
},60000) 

// Start auto discovery UDP broadcast ping
var message = new Buffer("Some bytes");
var socket = dgram.createSocket("udp4");
socket.bind();
socket.setBroadcast(true);

setInterval(function(){
    socket.send(message, 0, message.length, 41234, '255.255.255.255', function(err, bytes) {
        if(err){
            console.log(err);
        }
    });
},6000);


///////////////////////////////////////
// HELPERS
//////////////////////////////////////
function missingHandler(req, res, next) {
    console.log('404 Not found - '+req.url);
    res.json(404, { status: 'error', msg: 'Not found, sorry...' });
}

function errorHandler(res, msg) {
    console.log(msg);
    res.json(500, { status: 'error', msg: msg });
}

function clearTimers() {
    clearInterval(i);
    clearTimeout(t);
}

function resetCounts() {
    zonecount = config.zones.length;
    programcount = config.zones.length;
}

function zoneOn(index,seconds) {
    zonesOff(true);
    runqueue.push({zone:index,seconds:seconds});
    processQueue();
}

function programOn(index) {
    zonesOff(true);
    runqueue = config.programs[index].zones;
    processQueue();
}

function zonesOff(killqueue) {
    // shut down all the zones
    console.log('shutting off all zones');
    
    // if we are currently running something
    if(running.seconds){
        if(running.remaining == 1) running.remaining = 0;
        var runtime = running.seconds-running.remaining;
        // dont log stuff that wasnt running for at least a minute
        if (runtime > 5) {
            console.log('writing to the database...');
            var data = {seconds: running.seconds, runtime: runtime, zone:running.zone, timestamp: new Date()};
            db.insert(data, function (err, newDoc) {
                if(err){
                    console.log(err);
                }
                console.log('wrote record '+newDoc._id);
            });    
        }        
    }

    running = {};

    for(var i = 0; i < config.zones.length; i++){
        pinToggle(config.zones[i].pin,false);
    }

    if(killqueue){
        console.log('clearing the queue');
        runqueue = [];
        // kill any outstanding timers
        clearTimers();
    }
}

function processQueue() {
    // is anything in the queue?
    if(runqueue.length){
        // start working on the next item in the queue
        running = runqueue.shift();
        running.remaining = running.seconds;
        console.log('Starting zone with an index of '+running.zone+' for '+running.seconds+' seconds');

        pinToggle(config.zones[running.zone].pin,true);
        
        if(running.seconds > 0) {
            // clear any timers that are currently running
            clearTimers();

            // count down the time remaining
            i = setInterval(function(){
                if(running.zone){
                    running.remaining = running.remaining - 1;
                }
                
            },1000) 

            // start a countdown timer for the zone watering time
            t = setTimeout(function(){
                // turn off the zones, pass false so it wont kill the rest of the items in the queue
                console.log('Done with zone '+running.zone+' for '+running.seconds+' seconds');
                zonesOff(false);

                // wait a couple seconds and kick off the next
                setTimeout(function(){
                    processQueue();
                },2000) 

            },running.seconds*1000)    
        }

    } else {
        // once there is nothing left to process we can clear the timers
        clearTimers();

    }
}

function rainCallback(x) {
    if(x.output){
        console.log('Raining!');
        console.log(JSON.stringify(x));  
    }
}

function buttonCallback(x) {
    if(x.output){
        currOn += 1;
        if (currOn<=config.zones.length){
            console.log('Turning on zone '+currOn);
            zoneOn(currOn-1,900);
        }
        else {
            console.log('All done, back to the start');
            currOn = 0;
        }

        console.log('Button Pressed!');
        console.log(JSON.stringify(x));   
    }
}

function pinToggle(pin,on) {
    if(config.production){
        if(on){
            b.digitalWrite(ping, b.HIGH);
        } else {
            b.digitalWrite(ping, b.LOW);
        }
    }
}