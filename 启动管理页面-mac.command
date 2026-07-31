#!/bin/zsh

# Resolve the project from this script's location so it works when launched by Finder.
setopt NO_NOMATCH
PROJECT_DIR="${0:A:h}"
PORT="${GPT_WEB_IMAGE_MANAGER_PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"

cd "$PROJECT_DIR" || {
  print -u2 "无法进入项目目录：$PROJECT_DIR"
  read -k 1 "?按任意键退出..."
  exit 1
}

if ! command -v npm >/dev/null 2>&1; then
  print -u2 "未找到 npm。请先安装 Node.js，再重新双击此文件。"
  read -k 1 "?按任意键退出..."
  exit 1
fi

print "正在启动 GPT Web Image 管理页面..."
print "项目目录：$PROJECT_DIR"
print "页面地址：$URL"
print "服务日志会保留在当前窗口；关闭窗口即可停止服务。"

GPT_WEB_IMAGE_MANAGER_PORT="$PORT" npm run preview:manager &
SERVER_PID=$!

for ((attempt = 1; attempt <= 120; attempt++)); do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL"
    print "管理页面已打开。"
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    print -u2 "管理服务启动失败，请查看上方日志。"
    wait "$SERVER_PID"
    read -k 1 "?按任意键退出..."
    exit 1
  fi
  sleep 1
done

if ! curl -fsS "$URL" >/dev/null 2>&1; then
  print -u2 "等待管理服务超时，请查看上方日志。"
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" >/dev/null 2>&1 || true
  read -k 1 "?按任意键退出..."
  exit 1
fi

wait "$SERVER_PID"
