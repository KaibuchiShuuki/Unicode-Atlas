# -*- coding: utf-8 -*-
"""
Unicode-Atlas 启动器（pythonw 双击运行，不弹黑框）。

逻辑和 ComfyUI 一致：
  1. 如果本地服务已经在跑，直接打开页面；
  2. 没跑就用 runtime\\node.exe 起服务（无窗口、脱离本进程）；
  3. 等 /api/ping 就绪；
  4. 用 explorer.exe 打开 URL —— 等价于在资源管理器地址栏里输入地址，
     由系统 Shell 交给默认浏览器，不新起浏览器进程、不碰单实例/提权转发。
"""
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(sys.argv[0]))
PORT = 8731
URL = "http://127.0.0.1:%d/" % PORT

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
DETACHED_PROCESS = 0x00000008 if os.name == "nt" else 0


def ping():
    try:
        req = urllib.request.Request(URL + "api/ping", headers={"Cache-Control": "no-store"})
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            return b'"ok":true' in resp.read()
    except Exception:
        return False


def start_server():
    node = os.path.join(ROOT, "runtime", "node.exe")
    script = os.path.join(ROOT, "src", "server.js")
    if not (os.path.isfile(node) and os.path.isfile(script)):
        return False
    logs = os.path.join(ROOT, "logs")
    try:
        os.makedirs(logs, exist_ok=True)
    except Exception:
        pass
    log = os.path.join(logs, "server.log")
    try:
        subprocess.Popen(
            [node, script, "--port", str(PORT), "--no-open", "--log", log],
            cwd=ROOT,
            creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except Exception:
        return False
    for _ in range(240):
        time.sleep(0.15)
        if ping():
            return True
    return False


def open_page():
    # 和资源管理器地址栏输入地址一样，交给 Shell 处理
    try:
        subprocess.Popen(
            ["explorer.exe", URL],
            creationflags=CREATE_NO_WINDOW,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        pass
    try:
        import webbrowser
        webbrowser.open(URL)
        return True
    except Exception:
        return False


def fail(message):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "Unicode-Atlas", 0x10)
    except Exception:
        pass


def main():
    if not (ping() or start_server()):
        fail("Unicode-Atlas 服务没有启动成功。\n请查看 logs\\server.log 里的报错。")
        return
    if not open_page():
        fail("服务已经在运行，但没能打开浏览器。\n请手动打开：\n" + URL)


if __name__ == "__main__":
    main()
