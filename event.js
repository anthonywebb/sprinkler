// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   event - a module to route event distribution and storage.
//
// SYNOPSYS
//
//   This module receives events and distributes them as configured.
//   All events are stored locally, and removed after some time.
//
//   Events may also be formatted as syslog entries.
//
//   The main benefit of using syslog is to take advantage of the syslog
//   redirections capabilities, more specifically the ability to redirect
//   logging to a remote server for storage.
//
// DESCRIPTION
//
//   var event = require('./event');
//
//   event.configure (config, options);
//
//      Initialize the event module from the configuration.
//      This method can be called as often as necessary (typically
//      when the user configuration has changed).
//
//   event.record (data);
//
//      Record one new event.
//
//   event.find (filter, callback);
//
//      Return a list of events matching the given filter. See the
//      documentation of NeDB for the filter syntax.
//
//      The callback function is called with one parameter, which is
//      a JavaScript structure designed to be sent to a web client.
//
// USER CONFIGURATION
//
//   event.syslog        Enable (true) or disable (false) recording of events
//                       through syslog.
//
//   event.cleanup       Delete events older than this number of days. Events
//                       are kept indefinitely if not defined or 0.
//

var path = require('./path');

function errorLog (text) {
   console.error ('[ERROR] Event: '+text);
}

var syslog = null;
try {
   syslog = require('node-syslog');
   syslog.init("sprinkler", syslog.LOG_ODELAY, syslog.LOG_USER);
}
catch (err) {
   errorLog ('cannot initialize node-syslog');
}

var syslog_enabled = false;

var latestDate = new Date(0);
var latestSequence = 1;

var cleanup = 0;

// load up the database
var nedb = require('nedb'); 
var db = new nedb({ filename: path.events(), autoload: true });

exports.configure = function (config, options) {

   if (config.event) {
      if (config.event.syslog) {
         if (syslog) {
            syslog_enabled = true;
         }
      }
      if (config.event.cleanup) {
         cleanup = config.event.cleanup;
      }
   }
}

exports.record = function (data) {
   data.timestamp = new Date();
   if (data.timestamp > latestDate) {
      latestSequence = 1;
      latestDate = data.timestamp;
   } else {
      latestSequence += 1;
   }
   data.sequence = latestSequence;

   db.insert(data, function (err, newDoc) {
      if(err){
         errorLog('Database insert error: '+err);
      }
   });    

   if (syslog_enabled) {
      description = '';
      if (data.zone!=null) {
         description = ' zone '+data.zone;
      }
      if (data.program) {
         if (data.adjustment) {
            description = ' program '+data.program+' (weather adjustment: '+data.adjustment+'%)';
         } else {
            description = ' program '+data.program;
         }
      }
      if (data.parent) {
         parent = ' (program '+data.parent+')';
      } else {
         parent = '';
      }
      syslog.log(syslog.LOG_INFO, data.action+description+parent);
   }

   // Cleanup old events.
   if (cleanup) {
      if (latestSequence === 1) {
         var old = new Date (latestDate.getTime() - (cleanup * 86400000));
         db.remove ({timestamp: {$lt:old}}, {multi:true});
      }
   }
}

exports.find = function (filter, callback) {
   // Finding all the history entries matching the specified filter.
   if (filter == null) filter = {};
   db.find(filter, function (err, docs) {
      if(err){
         errorLog('cannot use filter "'+filter+'": '+err);
         callback({status: 'error', msg:err.message});
      } else {
         // The history is sorted most recent first.
         docs.sort(function (a, b) {
            if (b.timestamp.getTime() == a.timestamp.getTime()) {
               return b.sequence - a.sequence;
            }
            return b.timestamp - a.timestamp;
         });
         callback({status: 'ok', history:docs});    
      }
   });
}

