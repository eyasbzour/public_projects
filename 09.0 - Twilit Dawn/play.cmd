@echo off
rem Launched by the "Play Twilit" shortcut in the game folder: checks for Twilit Essentials, Dawnlight,
rem A Link Between Twilight and game updates, rebuilds Twilit Dawn if needed, then starts the game.
cd /d "%~dp0.."
python "%~dp0update.py" --launcher
start "" "%~dp0..\dusklight.exe"
