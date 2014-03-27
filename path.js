// Copyrigth (C) Pascal Martin, 2014.
//
// NAME
//
//   path - a central point where to decide the location of files.
//
// SYNOPSYS
//
//   This module provides a way to organize the configuration files.
//
//   The module searchs in the following locations:
//           1- local directory.
//           2- /var/lib/sprinkler
//
//   If the file does not exists, but /var/lib/sprinkler exists, then
//   /var/lib/sprinkler is used. If /var/lib/sprinkler does not exist,
//   the local directory is used.
//
//   A separate function is used for each file needed by the application.
//   This allows changing the search strategy for each file in the future.
//
//
// DESCRIPTION
//
//   var path = require('./path');
//
//   path.userConfig();
//
//       Return a full path name for the user configuration file.
//
//   path.hardwareConfig();
//
//       Return a full path name for the hardware configuration file.
//
//   path.events();
//
//       Return a full path name for the event database file.
//

var fs = require('graceful-fs');

function debuglog (text) {
   console.log ('Path: '+text);
}

function searchFile (name) {
   debuglog ('searching for '+name+' ..');
   if (fs.existsSync('./'+name)) {
      debuglog ('found local file ./'+name);
      return './'+name;
   }
   if (fs.existsSync('/var/lib/sprinkler')) {
      debuglog ('using file /var/lib/sprinkler/'+name);
      return '/var/lib/sprinkler/'+name;
   }
   debuglog ('defaulting to local file ./'+name);
   return './'+name;
}

exports.userConfig = function () {
   return searchFile ('config.json');
}

exports.hardwareConfig = function () {
   return searchFile ('hardware.json');
}

exports.events = function () {
   return searchFile ('database');
}

