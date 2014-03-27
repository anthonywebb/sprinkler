#! /bin/sh
#
# Default configuration for the sprinkler init script on Raspberry Pi (Debian)
#
# This configuration script must define the following environment variables:
#
#    NODE_JS_HOME     The path to the Node.js installation.
#    SPRINKLER_USER   The user login used for the sprinkler application.
#    SPRINKLER_HOME   The path to the sprinkler application.
#

NODE_JS_HOME=/home/pi/Software/node-v0.10.2-linux-arm-pi 
SPRINKLER_USER=pi
SPRINKLER_HOME=/home/pi/sprinkler

