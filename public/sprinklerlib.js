// Copyrigth (C) Pascal Martin, 2013.
//
// NAME
//
//   sprinklerlib - a library of JavaScript web functions.
//
// SYNOPSYS
//
//   This module provides a set of common JavaScript functions
//   used in multiple web pages.
//
// DESCRIPTION
//
//   sprinklerInfo();
//
//      This function populates the page's title and all HTML items marked
//      with known CSS class names with information from the controler:
//
//      hostname        the controler's host name.
//      activezone      the currently active zone name, or else "Idle".
//      activeprogram   the currently active program, or else "Idle".
//      raindelay       'DISABLED', 'NONE' or remaining duration.
//      weatherupdated  the time of the last weather update.
//      temperature     the temperature in the last weather update.
//      humidity        the humidity level in the last weather update.
//      rain            the rain level in the last weather update.
//      rainsensor      the state of the rain sensor (ON, OFF), as computed
//                      from the last weather update.
//      adjustment      the weather adjustment level, as computed from
//                      the last weather update.
//
//   sprinklerOnOff();
//
//      This function toggles the sprinkler scheduler between on and off.
//
//   sprinklerConfig(callback);
//
//      This function retrieves the user configuration.
//
//   sprinklerStatus(callback);
//
//      This function retrieves the current status.
//
//   sprinklerZoneOn(index, duration);
//
//      This function requests the controler to start the specified zone
//      for the specified duration.
//
//   sprinklerZoneOff();
//
//      This function requests the controler to stop all zones (and programs).
//
//   sprinklerRefresh();
//
//      This function requests the controler to refresh all information
//      from the outsid world: weather, calendar programs.
//
//   sprinklerHistory(callback);
//
//      This function requests the complete history.
//
//   sprinklerLatestEvent(callback);
//
//      This function requests the ID of the latest event.
//

function sprinklerShowDuration (seconds) {
   var minutes = Math.floor(seconds / 60);
   seconds = Math.floor(seconds % 60);
   if (minutes > 60) {
      var hours = Math.floor(minutes / 60);
      minutes = Math.floor(minutes % 60);
      return ('00'+hours).slice(-2)+':'+('00'+minutes).slice(-2)+':'+('00'+seconds).slice(-2);
   }
   return ('00'+minutes).slice(-2)+':'+('00'+seconds).slice(-2);
}

function sprinklerSetContent (classname, content) {
   var elements = document.getElementsByClassName (classname);
   for (var i = 0; i < elements.length; i++) {
      elements[i].innerHTML = content;
   }
}

function sprinklerUpdate () {
   var command = new XMLHttpRequest();
   command.open("GET", "/status");
   command.onreadystatechange = function () {
      if (command.readyState === 4 && command.status === 200) {
         // var type = command.getResponseHeader("Content-Type");
         var response = JSON.parse(command.responseText);
         var content;
         var content2;

         sprinklerSetContent ('hostname', response.hostname);

         if (response.running == null) {
            content = 'IDLE';
            content2 = 'IDLE';
         } else {
            if (response.running.zone != null)
               content = 'ZONE '+response.running.zone+' ACTIVE';
            else
               content = 'IDLE';
            if (response.running.parent != null)
               content2 = response.running.parent;
            else
               content2 = 'MANUAL';
         }
         if (response.on == false) {
            content2 = 'OFF';
         }
         sprinklerSetContent ('activezone', content);
         sprinklerSetContent ('activeprogram', content2);

         if (! response.raindelay) {
            content = 'DISABLED';
         } else if (response.raintimer == null) {
            content = 'NONE';
         } else {
            var deadline = new Date(response.raintimer).getTime();
            var delta = Math.floor((deadline - new Date().getTime()) / 1000);
            if (delta <= 0) {
               content = 'NONE';
            } else {
               content = sprinklerShowDuration(delta);
            }
         }
         sprinklerSetContent ('raindelay', content);

         if ((response.wateringindex) && (response.wateringindex.enabled)) {

            sprinklerSetContent ('adjustment',
                ''+response.wateringindex.adjustment+'%'+' (FROM '+response.wateringindex.source+')');
            sprinklerSetContent ('rainsensor', 'NO SENSOR');

         } else if ((response.weather) && (response.weather.enabled)) {

            sprinklerSetContent ('adjustment',
                ''+response.weather.adjustment+'%'+' (FROM '+response.weather.source+')');
            sprinklerSetContent ('rainsensor', response.weather.rainsensor?'SENSOR ON':'SENSOR OFF');

         } else {
            sprinklerSetContent ('adjustment','NOT AVAILABLE');
            sprinklerSetContent ('rainsensor','NO SENSOR');
         }

         if ((response.weather) && (response.weather.status)) {

            content = new Date(response.weather.updated).toLocaleString();
            sprinklerSetContent ('weatherupdated', content);

            var weathercmd = new XMLHttpRequest();
            weathercmd.open("GET", "/weather");
            weathercmd.onreadystatechange = function () {
               if (weathercmd.responseText == '') return;
               var response = JSON.parse(weathercmd.responseText);
               sprinklerSetContent ('temperature', ''+response.temperature+' F');
               sprinklerSetContent ('humidity', ''+response.humidity+'%');
               sprinklerSetContent ('rain', ''+response.rain+' in');
            }
            weathercmd.send(null);
         } else {
            sprinklerSetContent ('weatherupdated', 'NOT AVAILABLE');
         }

         for (var i = 0; i < response.calendars.length; i++) {
            content = new Date(response.calendars[i].updated).toLocaleString();
            if (response.calendars[i].status) {
               sprinklerSetContent ('calendar'+i, content);
            } else {
               sprinklerSetContent ('calendar'+i, 'NOT AVAILABLE');
            }
         }

         title = document.getElementsByClassName ('hostname');
         var title = 'Sprinkler Controler '+response.hostname;
         document.getElementsByTagName ('title')[0].innerHTML = title;
      }
   }
   command.send(null);
}

function sprinklerInfo () {
   sprinklerUpdate();
   setInterval (sprinklerUpdate, 1000);
}

function sprinklerConfig (callback) {
   var command = new XMLHttpRequest();
   command.open("GET", "/config");
   command.onreadystatechange = function () {
      if (command.readyState === 4 && command.status === 200) {
         var config = JSON.parse(command.responseText);
         // var type = command.getResponseHeader("Content-Type");
         callback(config);
      }
   }
   command.send(null);
}

function sprinklerStatus (callback) {
   var command = new XMLHttpRequest();
   command.open("GET", "/status");
   command.onreadystatechange = function () {
      if (command.readyState === 4 && command.status === 200) {
         var status = JSON.parse(command.responseText);
         // var type = command.getResponseHeader("Content-Type");
         callback(status);
      }
   }
   command.send(null);
}

function sprinklerOnOff () {
   var command = new XMLHttpRequest();
   command.open("GET", "/onoff");
   command.send(null);
}

function sprinklerZoneOn (index, duration) {
   var command = new XMLHttpRequest();
   command.open("GET", "/zone/"+index+"/on/"+duration);
   command.send(null);
}

function sprinklerZoneOff () {
   var command = new XMLHttpRequest();
   command.open("GET", "/zone/off");
   command.send(null);
}

function sprinklerRefresh () {
   var command = new XMLHttpRequest();
   command.open("GET", "/refresh");
   command.send(null);
}

function sprinklerHistory (callback) {
   var command = new XMLHttpRequest();
   command.open("GET", "/history");
   command.onreadystatechange = function () {
      if (command.readyState === 4 && command.status === 200) {
         var response = JSON.parse(command.responseText);
         // var type = command.getResponseHeader("Content-Type");
         callback(response.history);
      }
   }
   command.send(null);
}

function sprinklerLatestEvent (callback) {
   var command = new XMLHttpRequest();
   command.open("GET", "/history/latest");
   command.onreadystatechange = function () {
      if (command.readyState === 4 && command.status === 200) {
         var event = JSON.parse(command.responseText);
         // var type = command.getResponseHeader("Content-Type");
         callback(event);
      }
   }
   command.send(null);
}

