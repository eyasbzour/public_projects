@echo off
rem Usage: build.cmd <mod-dir>   (e.g. build.cmd twilit-dawn)
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSDIR="
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
if not defined VSDIR (
  echo Visual Studio 2022 with the C++ build tools was not found.
  exit /b 1
)
call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set CI=1
cd /d "%~dp0%~1" || exit /b 1
if not exist build\build.ninja (
  cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DDUSKLIGHT_DIR="%~dp0dusklight" || exit /b 1
)
cmake --build build --parallel -- -k 0
