@echo off
title Koby
rem Fallback launcher: runs Koby with the bundled official Node runtime.
rem Use this if Koby.exe will not start on your PC.
"%~dp0node\node.exe" "%~dp0launcher.js"
if errorlevel 1 pause
