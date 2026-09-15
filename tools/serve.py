#!/usr/bin/env python3
"""Static server for Photon.Directory, with the two things http.server lacks.

  python3 tools/serve.py            # http://localhost:8000
  python3 tools/serve.py 8080       # another port

Why this exists instead of `python3 -m http.server`:
  1. Range requests. The media player needs a server that answers 206 Partial
     Content, or seeking inside a .mkv in a test file does nothing and looks like
     a bug in the player.
  2. MIME types. Python's map does not know .mkv, .m4v, .opus or .mka, and a
     <video> element that is told "application/octet-stream" will not play.
"""
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".wasm": "application/wasm",
    ".mkv": "video/x-matroska", ".webm": "video/webm", ".mp4": "video/mp4",
    ".m4v": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
    ".mpg": "video/mpeg", ".mpeg": "video/mpeg", ".ts": "video/mp2t",
    ".ogv": "video/ogg", ".mka": "audio/x-matroska",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/opus",
    ".flac": "audio/flac", ".wav": "audio/wav", ".aif": "audio/aiff",
    ".aiff": "audio/aiff", ".srt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PhotonDirectory/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.address_string(), fmt % args))

    def path_to_file(self):
        rel = unquote(self.path.split("?")[0].split("#")[0]).lstrip("/")
        if rel in ("", "/"):
            rel = "index.html"
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT):
            return None
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        return full if os.path.isfile(full) else None

    def send_file(self, full, head_only=False):
        size = os.path.getsize(full)
        ext = os.path.splitext(full)[1].lower()
        ctype = TYPES.get(ext, "application/octet-stream")
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            else:
                length = int(m.group(2))
                start = max(0, size - length)
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        if ext in (".html", ".css", ".js"):
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if head_only:
            return
        with open(full, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = fh.read(min(64 * 1024, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def handle_request(self, head_only=False):
        full = self.path_to_file()
        if not full:
            missing = os.path.join(ROOT, "404.html")
            if os.path.isfile(missing):
                # the hub's own 404 page, under a real 404 status: a 200 here
                # would teach a crawler that the dead link is fine
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                size = os.path.getsize(missing)
                self.send_header("Content-Length", str(size))
                self.end_headers()
                if not head_only:
                    with open(missing, "rb") as fh:
                        self.wfile.write(fh.read())
            else:
                body = b"404 - not in the drawer"
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if not head_only:
                    self.wfile.write(body)
            return
        try:
            self.send_file(full, head_only)
        except BrokenPipeError:
            pass

    def do_GET(self):
        self.handle_request(False)

    def do_HEAD(self):
        self.handle_request(True)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Photon.Directory  →  http://localhost:%d/   (root: %s)" % (port, ROOT))
    print("Range requests on, media MIME types on. Ctrl-C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
