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
         var elements = document.getElementsByClassName ('hostname');
         for (var i = 0; i < elements.length; i++) {
            elements[i].innerHTML = response.hostname;
         }
         var content;
         var content2;


         if ((response.running == null) || (response.running.zone == null)) {
            content = 'IDLE';
            content2 = 'IDLE';
         } else {
            content = 'ZONE '+response.running.zone+' ACTIVE';
            if (response.running.parent != null)
               content2 = response.running.parent;
            else
               content2 = 'MANUAL';
         }
         sprinklerSetContent ('activezone', content);
         sprinklerSetContent ('activeprogram', content2);

         if ((response.raintimer == null) || (! response.raindelay)) {
            content = 'DISABLED';
         } else {
            var deadline = new Date(response.raintimer).getTime();
            var delta = Math.floor((new Date().getTime() - deadline) / 1000);
            content = sprinklerShowDuration(delta);
         }
         sprinklerSetContent ('raindelay', content);

         if ((response.weather == null) || (! response.weather.status)) {
            content = 'NOT AVAILABLE';
         } else {
            var updated = new Date(response.weather.updated).getTime();
            var delta = Math.floor((new Date().getTime() - updated) / 1000);
            content = sprinklerShowDuration(delta)+' ago';
         }
         sprinklerSetContent ('weatherupdated', content);

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

