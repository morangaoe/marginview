"""HTTP front for the Scrapy fetcher.  POST /fetch {"url": "..."}  ->  {"status": int, "html": str}.

Each fetch runs in its own process (Scrapy's Twisted reactor can't be restarted in-process).
Set SCRAPY_TOKEN to require `Authorization: Bearer <token>`.
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

TOKEN = os.getenv("SCRAPY_TOKEN", "")
SLOTS = threading.BoundedSemaphore(int(os.getenv("SCRAPY_CONCURRENCY", "4")))
HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, {"ok": True}) if self.path == "/health" else self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/fetch":
            return self._send(404, {"error": "not found"})
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "unauthorized"})
        try:
            url = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)))).get("url", "")
        except ValueError:
            return self._send(400, {"error": "invalid json"})
        if urlparse(url).scheme not in ("http", "https"):
            return self._send(400, {"error": "url must be http(s)"})
        if not SLOTS.acquire(timeout=5):
            return self._send(503, {"error": "busy"})
        try:
            proc = subprocess.run(
                [sys.executable, os.path.join(HERE, "fetch_spider.py"), url],
                capture_output=True, text=True, timeout=40, cwd=HERE,
            )
            self._send(200, json.loads(proc.stdout.strip().splitlines()[-1]))
        except (subprocess.TimeoutExpired, ValueError, IndexError):
            self._send(504, {"error": "fetch failed or timed out"})
        finally:
            SLOTS.release()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8000"))), Handler).serve_forever()
