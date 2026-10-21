@echo off
setlocal
cd /d "%~dp0"
title JEV - instalacion de GLiNER
echo ============================================================
echo  Instalacion OPCIONAL del modulo GLiNER2 (extraccion de entidades)
echo  Requiere Python 3.10 o superior e internet. Descarga PyTorch y el
echo  modelo (varios cientos de MB en total). Sin esto, la pestana
echo  Entidades funciona con una simulacion lexica.
echo ============================================================
echo.
set "PYCMD="
if exist "%~dp0python\python.exe" set "PYCMD="%~dp0python\python.exe""
if not defined PYCMD (
  py -3.12 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PYCMD=py -3.12"
)
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
  echo No se encontro Python. En PowerShell: winget install Python.Python.3.12
  echo Despues cierre esta ventana y vuelva a abrir este archivo.
  pause
  exit /b 1
)
%PYCMD% -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
if errorlevel 1 (
  echo Se necesita Python 3.10 o superior ^(winget install Python.Python.3.12^).
  pause
  exit /b 1
)
rem Instala fuera de OneDrive/rutas docentes largas para evitar errores al cargar DLL.
set "GLENV=%LOCALAPPDATA%\JEV\gliner_env"
if defined JEV_GLINER_ENV set "GLENV=%JEV_GLINER_ENV%"
set "GLPY=%GLENV%\Scripts\python.exe"
if not exist "%GLPY%" (
  echo Creando entorno virtual en "%GLENV%" ...
  %PYCMD% -m venv "%GLENV%"
  if errorlevel 1 ( echo No se pudo crear el entorno virtual. & pause & exit /b 1 )
)
echo Instalando gliner2 en "%GLENV%" ^(puede tardar varios minutos^)...
"%GLPY%" -m pip install --upgrade pip
if errorlevel 1 ( echo No se pudo actualizar pip. & pause & exit /b 1 )
"%GLPY%" -m pip install "gliner2[local]"
if errorlevel 1 ( echo La instalacion fallo. Revise los mensajes anteriores. & pause & exit /b 1 )
echo.
echo Comprobacion completa de las dependencias:
"%GLPY%" gliner_service.py --check
if errorlevel 1 ( echo Las dependencias no cargan correctamente. Copie el error anterior. & pause & exit /b 1 )
echo.
echo Prueba con el modelo real ^(la primera vez descarga el modelo^):
"%GLPY%" gliner_service.py --selftest
if errorlevel 1 ( echo GLiNER se instalo, pero la prueba del modelo fallo. Copie el error anterior. & pause & exit /b 1 )

"%GLPY%" -c "import os,sys;from pathlib import Path;Path('gliner_python.txt').write_text(os.path.realpath(sys.executable)+'\n',encoding='utf-8')"
if errorlevel 1 ( echo No se pudo guardar la ruta del entorno. & pause & exit /b 1 )
echo.
echo Instalacion y prueba correctas. Cierre el servidor anterior y ejecute INICIAR.bat.
echo Si ya dispone del modelo en una carpeta, escriba su ruta en gliner_model.txt.
pause