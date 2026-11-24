@echo off
cd /d "%~dp0"
if not exist node_modules\fastify (
  echo Instalando o HireLinks pela primeira vez...
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  call npm ci
)
call npm start
pause
