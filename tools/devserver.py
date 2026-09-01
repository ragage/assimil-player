"""Tiny static server for local testing that never lets the browser cache files.

Python's built-in http.server sends Last-Modified but no Cache-Control, so Chrome
heuristically caches the JavaScript modules. That makes it look as though code
changes have not taken effect. This server sends no-store on everything.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    directory = sys.argv[1] if len(sys.argv) > 1 else "."
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
    handler = partial(NoCacheHandler, directory=directory)
    print(f"serving {directory} on http://127.0.0.1:{port} (no-store)")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
