#! /bin/sh
### BEGIN INIT INFO
# Provides:          sprinkler
# Required-Start:    $syslog
# Required-Stop:     $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: initscript for the sprinkler control software
# Description:       This file starts the sprinkler control software
### END INIT INFO

# Author: Pascal Martin

# Do NOT "set -e"

DESC="Sprinkler control"
NAME=sprinkler
PIDFILE=/var/run/sprinkler.pid
SCRIPTNAME=/etc/init.d/$NAME

# Default configuration, can be overwritten in /etc/default/$NAME
# (These defaults assume a Raspberry Pi running Debian!)
NODE_JS_HOME=/home/pi/Software/node-v0.10.2-linux-arm-pi 
SPRINKLER_USER=pi
SPRINKLER_HOME=/home/pi/sprinkler

# Read configuration variable file if it is present
[ -r /etc/default/$NAME ] && . /etc/default/$NAME

PATH=/sbin:/usr/sbin:/bin:/usr/bin:$NODE_JS_HOME/bin
DAEMON=$NODE_JS_HOME/bin/node
DAEMON_ARGS="$SPRINKLER_HOME/server.js"
RESET_ARGS="$SPRINKLER_HOME/reset.js"

# Exit if the package is not installed
[ -x "$DAEMON" ] || exit 0
[ -r "$DAEMON_ARGS" ] || exit 0
[ -r "$RESET_ARGS" ] || exit 0

# Load the VERBOSE setting and other rcS variables
. /lib/init/vars.sh

# Define LSB log_* functions.
# Depend on lsb-base (>= 3.2-14) to ensure that this file is present
# and status_of_proc is working.
. /lib/lsb/init-functions

#
# Function that starts the daemon/service
#
do_start()
{
	# Return
	#   0 if daemon has been started
	#   1 if daemon was already running
	#   2 if daemon could not be started
	start-stop-daemon --start --quiet --pidfile $PIDFILE --exec $DAEMON --test > /dev/null \
		|| return 1

	for i in errors stdout
	do
		rm -f /var/lib/sprinkler/$i
		touch /var/lib/sprinkler/$i
		chown $SPRINKLER_USER /var/lib/sprinkler/$i
		chgrp gpio /var/lib/sprinkler/$i
	done

	start-stop-daemon --start --quiet --pidfile $PIDFILE --chuid $SPRINKLER_USER --group gpio --chdir /var/lib/sprinkler --make-pidfile --background --no-close --exec $DAEMON -- $DAEMON_ARGS 2>>/var/lib/sprinkler/errors >>/var/lib/sprinkler/stdout \
		|| return 2
}

#
# Function that stops the daemon/service
#
do_stop()
{
	# Return
	#   0 if daemon has been stopped
	#   1 if daemon was already stopped
	#   2 if daemon could not be stopped
	#   other if a failure occurred
	start-stop-daemon --stop --quiet --retry=TERM/30/KILL/5 --pidfile $PIDFILE
	RETVAL="$?"

	# Reset all zones now, no matter what.
	$DAEMON $RESET_ARGS 2>>/var/lib/sprinkler/errors >>/var/lib/sprinkler/stdout

	[ "$RETVAL" = 2 ] && return 2
	# Many daemons don't delete their pidfiles when they exit.
	rm -f $PIDFILE
	return "$RETVAL"
}

case "$1" in
  start)
	[ "$VERBOSE" != no ] && log_daemon_msg "Starting $DESC" "$NAME"
	do_start
	case "$?" in
		0|1) [ "$VERBOSE" != no ] && log_end_msg 0 ;;
		2) [ "$VERBOSE" != no ] && log_end_msg 1 ;;
	esac
	;;
  stop)
	[ "$VERBOSE" != no ] && log_daemon_msg "Stopping $DESC" "$NAME"
	do_stop
	case "$?" in
		0|1) [ "$VERBOSE" != no ] && log_end_msg 0 ;;
		2) [ "$VERBOSE" != no ] && log_end_msg 1 ;;
	esac
	;;
  status)
	status_of_proc "$DAEMON" "$NAME" && exit 0 || exit $?
	;;
  restart|force-reload)
	#
	# If the "reload" option is implemented then remove the
	# 'force-reload' alias
	#
	log_daemon_msg "Restarting $DESC" "$NAME"
	do_stop
	case "$?" in
	  0|1)
		do_start
		case "$?" in
			0) log_end_msg 0 ;;
			1) log_end_msg 1 ;; # Old process is still running
			*) log_end_msg 1 ;; # Failed to start
		esac
		;;
	  *)
		# Failed to stop
		log_end_msg 1
		;;
	esac
	;;
  *)
	#echo "Usage: $SCRIPTNAME {start|stop|restart|reload|force-reload}" >&2
	echo "Usage: $SCRIPTNAME {start|stop|status|restart|force-reload}" >&2
	exit 3
	;;
esac

:
