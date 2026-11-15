@echo off
cd /d "%~dp0"
python tools\fetch-open-books.py
echo.
echo Files are in tools\cache\open-books\
pause
