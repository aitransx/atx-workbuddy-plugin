@echo off
rem Locate the Node runtime that WorkBuddy ships and run the ATX MCP server.
rem WorkBuddy exports its managed Node directory via WORKBUDDY_EXTRA_PATHS (';'-separated)
rem instead of PATH, so try that first, then fall back to PATH.
setlocal
set "NODE_BIN="

if defined WORKBUDDY_EXTRA_PATHS (
  for %%D in ("%WORKBUDDY_EXTRA_PATHS:;=" "%") do (
    if not defined NODE_BIN if exist "%%~D\node.exe" set "NODE_BIN=%%~D\node.exe"
  )
)

if not defined NODE_BIN (
  for %%N in (node.exe) do if not defined NODE_BIN if not "%%~$PATH:N"=="" set "NODE_BIN=%%~$PATH:N"
)

if not defined NODE_BIN (
  echo [atx-assistant] FATAL: cannot locate node ^(checked WORKBUDDY_EXTRA_PATHS and PATH^) 1>&2
  exit /b 127
)

"%NODE_BIN%" %*
exit /b %ERRORLEVEL%
