#!/usr/bin/env bash
# ==============================================================================
# Fixed start.sh - Autostart script for Kiosk on Raspberry Pi & Linux
# ==============================================================================

set -e

# 1. Always navigate to script's own folder so backend finds kiosk.html
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=================================================="
echo " Starting Pump Controller Kiosk System"
echo " Working directory: $DIR"
echo "=================================================="

# 2. Terminate any stale instances
pkill -f "python3 backend.py" || true

# 3. Virtual environment support (if used)
if [ -d "venv" ]; then
    echo "[*] Activating virtual environment..."
    source venv/bin/activate
fi

# 4. Launch backend.py in background
echo "[*] Starting backend.py on port 5000..."
python3 backend.py > /tmp/pump_backend.log 2>&1 &
BACKEND_PID=$!
echo "[✓] Backend running with PID $BACKEND_PID"

# 5. Wait until the web server is actually listening and responding!
# This prevents Chromium from loading before the server is up and showing ERR_CONNECTION_REFUSED.
echo "[*] Waiting for web server to be ready on port 5000..."
SERVER_READY=0
for i in {1..20}; do
    if curl -s http://127.0.0.1:5000/ > /dev/null 2>&1; then
        echo "[✓] Web server is UP and responding!"
        SERVER_READY=1
        break
    fi
    sleep 0.5
done

if [ $SERVER_READY -eq 0 ]; then
    echo "[!] Warning: Server did not respond within 10 seconds. Check /tmp/pump_backend.log"
fi

# 6. Configure X11 display for Raspberry Pi / touchscreens
export DISPLAY=${DISPLAY:-:0}
xset s off -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# 7. Launch browser in full-screen kiosk mode
echo "[*] Launching Chromium in full-screen kiosk mode..."
if command -v chromium-browser &>/dev/null; then
    BROWSER="chromium-browser"
elif command -v chromium &>/dev/null; then
    BROWSER="chromium"
elif command -v google-chrome &>/dev/null; then
    BROWSER="google-chrome"
else
    echo "[!] No Chromium browser found. Open http://localhost:5000/kiosk.html in your browser."
    wait $BACKEND_PID
    exit 0
fi

$BROWSER \
    --noerrdialogs \
    --disable-infobars \
    --kiosk "http://localhost:5000/kiosk.html" \
    --check-for-update-interval=31536000 \
    --enable-features=WebSerial \
    --overscroll-history-navigation=0 \
    --incognito \
    >/dev/null 2>&1 &

echo "[✓] Kiosk launched. System is fully operational."
wait $BACKEND_PID
