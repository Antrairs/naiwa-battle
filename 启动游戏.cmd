@echo off
chcp 65001 >nul
cd /d "%~dp0"
node launch.cjs
if errorlevel 1 pause
