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
//      hostname      the controler's host name.
//      activezone    the currently active zone name, or else "Idle".
//
//   sprinklerConfig(callback);
//
//      This function retrieves the user configuration.
//

function sprinklerShowDuration (seconds) {
   var minutes = Math.floor(seconds / 60);
   seconds = Math.floor(seconds % 60);
   if (minutes > 60) {
      var hours = Math.floor(minutes / 60);
      minutes = Math.floor(minutes % 60);
console.log('hours='+hours+', minutes='+minutes);
      return ('00'+hours).slice(-2)+':'+('00'+minutes).slice(-2)+':'+('00'+seconds).slice(-2);
   }
   return ('00'+minutes).slice(-2)+':'+('00'+seconds).slice(-2);
}

function sprinklerInfo () {
   var command = new XMLHttpRequest();
   command.open("GET", "/status");
   command.onreadystatechange = function () {
      if (command.readyState === 4 && command.status === 200) {
         // var type = command.getResponseHeader("Content-Type");
         var response = JSON.parse(command.responseText);
         var elements = document.getElementsByClassName ('hostname');
         for (var i = 0; i < elements.length; i++) {
            elements[i].innerHTML = response.hostname;
         }
         elements = document.getElementsByClassName ('activezone');
         var content;
         if ((response.running == null) || (response.running.zone == null)) {
            content = 'Idle';
         } else {
            content = 'Zone '+response.running.zone+' active';
         }
         for (var i = 0; i < elements.length; i++) {
            elements[i].innerHTML = content;
         }
         elements = document.getElementsByClassName ('weatherupdated');
         if ((response.weather == null) || (! response.weather.status)) {
            content = 'Not Available';
         } else {
            var updated = new Date(response.weather.updated).getTime();
            var delta = Math.floor((new Date().getTime() - updated) / 1000);
            var ago = sprinklerShowDuration(delta);
            content = 'last update '+ago+' ago';
         }
         for (var i = 0; i < elements.length; i++) {
            elements[i].innerHTML = content;
         }
         title = document.getElementsByClassName ('hostname');
         var title = 'Sprinkler Controler '+response.hostname;
         document.getElementsByTagName ('title')[0].innerHTML = title;
      }
   }
   command.send(null);
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

