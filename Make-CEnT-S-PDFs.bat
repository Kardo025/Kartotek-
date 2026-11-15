@echo off
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
%PY% --version >nul 2>nul || (
  echo Python was not found. Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then double-click this file again.
  start https://www.python.org/downloads/
  pause
  exit /b 1
)
echo Installing pypdf...
%PY% -m pip install --quiet pypdf
echo Cutting the CEnT-S page extracts. The first run downloads the books, this can take a few minutes.
%PY% tools\make-cents-pdfs.py
echo.
echo Done. The files are in the sources folder of your content folder (see kartotek.config.json), or in sources here.
pause
