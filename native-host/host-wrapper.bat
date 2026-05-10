@echo off
REM Claude Chrome Extension - Native Host Wrapper
REM Windows Chrome calls this file; it bridges to WSL2 Node.js

wsl.exe -e /home/fanta/.nvm/versions/node/v24.13.1/bin/node "/home/fanta/study/FrontEnd/claude_chrome_ext/native-host/host.js"
