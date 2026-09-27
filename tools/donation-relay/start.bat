@echo off
chcp 65001 > nul
title 유진 팬보드 후원 연동
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행이라 필요한 파일을 설치하는 중입니다...
  call npm install --omit=dev --no-audit --no-fund
)
node index.js
pause
