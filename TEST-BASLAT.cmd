@echo off
title Ikariam bot - TEST SUNUCUSU
cd /d "%~dp0"
echo Test sunucusu baslatiliyor. Testi bitirmek icin bu pencereyi kapat.
echo.
node test-server.js
pause
