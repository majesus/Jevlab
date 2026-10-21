@echo off
setlocal
cd /d "%~dp0"
title JEV - servidor local
rem Busca Python en este orden: carpeta "python" portatil, lanzador "py", comando "python".
set "PYCMD="
if exist "%~dp0python\python.exe" set "PYCMD="%~dp0python\python.exe""
if not defined PYCMD (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -c "import sys" >nul 2>nul
    if not errorlevel 1 set "PYCMD=py -3"
  )
)
if not defined PYCMD (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info[0]==3 else 1)" >nul 2>nul
    if not errorlevel 1 set "PYCMD=python"
  )
)
if not defined PYCMD (
  echo.
  echo No se encontro Python 3.
  echo  - Para el modo SIMULACION no hace falta: abra index.html con doble clic.
  echo  - Para el modo API real o GLiNER instale Python una sola vez. En PowerShell:
  echo        winget install Python.Python.3.12
  echo    Despues CIERRE esta ventana y vuelva a abrir INICIAR.bat.
  echo  - Si Windows abre la Microsoft Store al escribir "python", desactive el alias:
  echo    Configuracion ^> Aplicaciones ^> Configuracion avanzada de aplicaciones ^> Alias de ejecucion de aplicaciones.
  echo.
  pause
  exit /b 1
)
%PYCMD% -c "import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)"
if errorlevel 1 (
  echo.
  echo Se necesita Python 3.8 o superior.
  echo.
  pause
  exit /b 1
)

%PYCMD% "%~dp0jev_server.py" --open
set "RC=%errorlevel%"
echo.
echo El servidor se ha detenido ^(codigo %RC%^). Si no lo esperaba, copie el mensaje de arriba.
pause
