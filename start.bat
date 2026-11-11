@echo off
rem 录音机一键启动：优先使用 Node.js，其次 Python。
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    python start.py
  ) else (
    py start.py
  )
)
if errorlevel 1 (
  echo.
  echo 启动失败：请先安装 Node.js 20+ 或 Python 3，然后重试。
  pause
)
