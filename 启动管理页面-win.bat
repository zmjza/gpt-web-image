@echo off
setlocal

cd /d "%~dp0"
set "PORT=%GPT_WEB_IMAGE_MANAGER_PORT%"
if not defined PORT set "PORT=4173"
set "URL=http://127.0.0.1:%PORT%/"

where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请先安装 Node.js，再重新双击此文件。
  pause
  exit /b 1
)

echo 正在启动 GPT Web Image 管理页面...
echo 项目目录：%~dp0
echo 页面地址：%URL%
echo 服务日志会显示在新窗口中；关闭服务窗口即可停止服务。

start "GPT Web Image Manager" /d "%~dp0" cmd /k "set GPT_WEB_IMAGE_MANAGER_PORT=%PORT%&& npm run preview:manager"

for /l %%I in (1,1,120) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$r = try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%' } catch { $null }; if ($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto :open
  timeout /t 1 /nobreak >nul
)

echo 等待管理服务超时，请检查服务窗口中的日志。
pause
exit /b 1

:open
start "" "%URL%"
echo 管理页面已打开。
exit /b 0
