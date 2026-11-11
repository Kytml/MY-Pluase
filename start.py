"""录音机的 Python 启动器（无 Node.js 环境时的备选）。

用法：python start.py [--port 8168] [--no-open]
与 server.mjs 行为一致：仅监听 127.0.0.1，端口被占用时自动向后尝试。
"""
import argparse
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description="启动录音机本地服务")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8168)))
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        print("端口必须是 1-65535 之间的整数")
        sys.exit(1)

    httpd = None
    port = args.port
    for candidate in range(args.port, args.port + 20):
        try:
            httpd = Server(("127.0.0.1", candidate), QuietHandler)
            port = candidate
            break
        except OSError:
            continue
    if httpd is None:
        print("端口 %d-%d 均被占用，请用 --port 指定其他端口。" % (args.port, args.port + 19))
        sys.exit(1)

    url = "http://127.0.0.1:%d/" % port
    print("录音机已启动：%s" % url)
    print("仅监听本机回环地址。按 Ctrl+C 停止服务。\n")
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
