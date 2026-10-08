"""
TRLE Tools — Local Development Server
Serves the tool at http://localhost:8080.

Usage:
  python server.py
  - or double-click serve.bat (Windows) / serve.sh (Mac/Linux)
"""
import http.server
import webbrowser
import threading
import os
import re

PORT = 8080
HEADERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_headers")


def read_site_headers(path):
    """The `/*` block of Netlify's `_headers` file: the live site's security headers
    (Content-Security-Policy and friends). Read on every request, so editing the file
    takes effect on the next page load with no restart. The dev server sends exactly
    what Netlify sends, so a policy mistake shows up here first, not on the live site
    (docs/SECURITY-PLAN.md, phase 6)."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []
    out, block = [], None
    for raw in text.splitlines():
        line = "" if raw.lstrip().startswith("#") else re.sub(r"\s+#.*$", "", raw)
        if not line.strip():
            continue
        if not line[0].isspace():
            block = line.strip()
            continue
        if block == "/*" and ":" in line:
            name, value = line.strip().split(":", 1)
            out.append((name.strip(), value.strip()))
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Same reason the repo-root server.py does this: with no build step the
        # tool is eleven separate <script> files, so a browser that caches one of
        # them ends up running a MIXED version of the tool -- which presents as a
        # function missing from a sibling module rather than as anything obviously
        # cache-shaped.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        for name, value in read_site_headers(HEADERS_FILE):
            self.send_header(name, value)
        super().end_headers()

    """Plain static file handler."""

    def log_message(self, format, *args):  # noqa: A002
        # Uncomment the next line to see request logs:
        # print(f"  {self.address_string()} — {format % args}")
        pass


def open_browser():
    webbrowser.open(f"http://localhost:{PORT}")


if __name__ == "__main__":
    # Change to the directory this script lives in so relative paths work
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    print("=" * 50)
    print("  🏛️  TRLE Tools — Local Server")
    print("=" * 50)
    print(f"  ➜  http://localhost:{PORT}")
    print(f"  ✋  Press Ctrl+C to stop\n")

    # Open browser after a short delay so the server is ready
    threading.Timer(0.8, open_browser).start()

    try:
        http.server.HTTPServer(("", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
