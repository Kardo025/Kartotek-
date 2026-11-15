@echo off
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
echo Downloading the books for TU Delft AE Prep (Calculus Volume 1 and 3, College Physics 2e). This can take a few minutes.
%PY% tools\fetch-books.py calc1 calc3 cp
echo.
pause
