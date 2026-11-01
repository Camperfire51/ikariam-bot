@echo off
title Ikariam bot - YAYINLA
cd /d "%~dp0"
echo Bu islem su anki kodu herkese (urun surumu) gonderir.
echo.
set /p MSG=Ne degisti? (kisaca yaz, Enter):
if "%MSG%"=="" set MSG=Yeni surum
node release.js "%MSG%"
echo.
pause
