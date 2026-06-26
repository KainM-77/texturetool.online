#!/usr/bin/env bash
# ============================================================
# TRLE Tools — Local Server (Mac / Linux)
# ============================================================
# Double-click this file in Finder (Mac) or run:  bash serve.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo ""
echo "  =========================================="
echo "    🏛️  TRLE Tools — Local Server"
echo "  =========================================="
echo "    ➜  http://localhost:8080"
echo "    ✋  Press Ctrl+C to stop"
echo ""

# Open browser after server starts
(sleep 1 && (open "http://localhost:8080" 2>/dev/null || xdg-open "http://localhost:8080" 2>/dev/null)) &

if command -v python3 &>/dev/null; then
    python3 server.py
elif command -v python &>/dev/null; then
    python server.py
else
    echo "  [ERROR] Python not found."
    echo "  Install Python from https://python.org then run this script again."
    exit 1
fi
