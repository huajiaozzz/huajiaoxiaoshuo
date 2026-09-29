#!/usr/bin/env python3
"""Laya 决策桥：把本地 laya 模型包一层 HTTP，给浏览器里的写作系统调用。

为什么需要它：laya 是 Python 库（外加一个给 agent 用的 MCP stdio 服务），
浏览器直连不上。这里只做一件事：收 JSON state + JSON schema，调 agent.decide，
把结构化判定结果原样返回。不做鉴权，只听 127.0.0.1。

用法（用装有 laya 的 Python 跑）：
  ~/.local/share/laya/venv/bin/python scripts/laya-bridge.py        # 默认 127.0.0.1:1945
  ~/.local/share/laya/venv/bin/python scripts/laya-bridge.py 1946
  LAYA_MODEL=multilingual .../python scripts/laya-bridge.py        # 换 checkpoint

接口：
  GET  /health              -> {"ok": true, "model": ...}
  POST /decide              {"state": {...}, "schema": {...}, "min_confidence": 0.0}
                            -> {"ok": true, "result": {...}} 或 {"ok": false, "error": ...}
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1945
MODEL = os.environ.get("LAYA_MODEL", "auto")

_agent = None

def agent():
    global _agent
    if _agent is None:
        import laya
        model = None if MODEL == "auto" else MODEL
        _agent = laya.load("convaiinnovations/laya") if model is None else laya.load("convaiinnovations/laya", subfolder=model)
    return _agent

class Handler(BaseHTTPRequestHandler):
    server_version = "laya-bridge/1"

    def _send(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 写作系统在另一个端口，浏览器直连需要 CORS
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send({})

    def do_GET(self):
        if self.path == "/health":
            try:
                a = agent()
                self._send({"ok": True, "model": getattr(a, "model_id", MODEL)})
            except Exception as e:
                self._send({"ok": False, "error": str(e)[:300]}, 500)
        else:
            self._send({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/decide":
            self._send({"ok": False, "error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(length) or b"{}")
            state, schema = req.get("state"), req.get("schema")
            if state is None or schema is None:
                self._send({"ok": False, "error": "need state and schema"}, 400)
                return
            result = agent().decide(state, schema, min_confidence=req.get("min_confidence"))
            self._send({"ok": True, "result": result})
        except Exception as e:
            self._send({"ok": False, "error": str(e)[:300]}, 500)

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    # 模型加载慢，先预热再接受请求
    agent()
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
