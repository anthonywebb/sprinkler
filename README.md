# Node Sprinkler

A node.js application to enable a BeagleBone to become a smart sprinkler controller via our forthcoming cape which you can get a sneak peek at here: https://plus.google.com/112693340411141805940/posts/JqfbhicXUrv

This software also includes early support for the OpenSprinkler OSBo board.

## Installation

1. Copy `config-template.json` to a new file called: `config.json`
2. Create `hardware.js` as a symbolic link to `hardware-beagle16.js`
3. Install dependencies: `npm install`
4. To run, simply type: `node server.js`

Note that there are drivers for 3 types of hardware availables:
1. The Sprinkler Beagle 16 board (`hardware-beagle16.js`),
2. The OpenSprinkler's OSBo board from rayshobby.net (`hardware-osbo.js`).
3. Generic relay boards, such as the SainSmart ones (`hardware-relays.js`). Each relay must be directly connected to one I/O pin. Setup the `pin` name and the `on` level in the user config (`config.json`).

## Usage

This project acts as an API to our forthcoming mobile app.  If you want to play around with it without the app you may load the postman collection (postman.js) into the postman chrome extension (https://chrome.google.com/webstore/detail/postman-rest-client/fdmmgilgnpjigdojojpjoooidkmcomcm) and browse the methods that are exposed in the API.

Watering programs can also be defined using Google calendars:

1. The Google calendars must be public. Your watering schedule will be for the world to see! Do not store personal information in that calendar.
2. The software supports non-repeat (one specific day), daily (with interval count) or weekly (with specific days of the week) events. Monthly or yearly events are ignored.
3. The events location (see item `Where` in the event details) must match the item `location` in `config.json` (this is a new item in the configuration!). The location is used to support multiple watering controllers in the same calendar. If the `location` item is missing, value `home` is used as default.
4. The events description must be a space-separated (or comma-separated) list of zone entries.
5. Each zone entry contains the zone name and duration (minutes), separated by an equal sign (or a column). For example: `flowerbed=14`. A zone name cannot contain spaces, sorry.
6. A calendar used for watering schedule must only contain watering schedule events. Create separate calendars for your watering schedules.
7. Each calendar must be described in config.json, array `calendars`
8. Each entry in the array must include an item `name` (must be unique).
9. Each entry in the array must include an item `format`, set to `iCalendar`.
10. Each entry in the array must include an item `source`, set to the `ICAL` address of the calendar (see calendar details). You can also load a calendar from a file (must be in the iCalendar format) using a `file:` URL (for example: `file:mycalendar.ics`).

(This calendar feature supports both https and http web access. It should work with any web calendar that supports public download in the iCalendar format.)

Watering programs can be automatically adjusted using weather information from the Weather Underground servers:

1. The user must register with Weather Underground to get his own key.
2. The weather module is configured in config.json as the `weather` structure:
3. The `weather.key` item must be set to the Weather Underground key.
4. The `weather.adjust.min` item represents the minimum allowed adjustment.
5. The `weather.adjust.max` item represents the maximum allowed adjustment.
6. The `weather.raintrigger` item represents the rain level (in inches) that triggers a virtual rain sensor.

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## History

This app is PRE-ALPHA, is no where complete, and should not be used yet.  There is virtually no data validation and it isnt too hard to entirely crash it.  We'll get there though, hang tight.

## Credits

TODO: Write credits

## License

TODO: Write license
