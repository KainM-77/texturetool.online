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

PORT = 8080

class Handler(http.server.SimpleHTTPRequestHandler):
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
