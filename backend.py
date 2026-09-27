#!/usr/bin/env python3
"""
Fixed backend.py
Fixes for:
  1. HTML not loading / 404 (template_folder and static_folder mapped to current dir)
  2. Blocking serial loop (runs in daemon thread)
  3. Connection refused on LAN (binds to 0.0.0.0)
  4. Serial port crash if Arduino is disconnected or port name differs (auto-detection + graceful fallback)
  5. CORS headers enabled for all fetch requests
"""

import os
import sys
import glob
import time
import json
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Try importing Flask; if not installed, we provide a robust built-in HTTP server fallback
try:
    from flask import Flask, send_file, send_from_directory, jsonify, request
    from flask_cors import CORS
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False

try:
    import serial
except ImportError:
    serial = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 5000))
HOST = "0.0.0.0"  # CRITICAL: Binds to all interfaces so HTML loads from any device/browser
SERIAL_BAUD = 115200

# Global Hardware State
serial_conn = None
serial_lock = threading.Lock()
telemetry = {
    "flow_rate": 0.0,
    "dispensed_ml": 0.0,
    "target_ml": 500.0,
    "total_pulses": 0,
    "relay1_pump": False,
    "relay2_valve": False,
    "status": "idle",
    "hardware_connected": False,
    "port": None
}

def find_serial_port():
    """Autodetect connected Arduino port on Linux, Mac, or Windows."""
    candidates = (
        glob.glob("/dev/ttyUSB*") +
        glob.glob("/dev/ttyACM*") +
        glob.glob("/dev/cu.usbmodem*") +
        glob.glob("/dev/cu.usbserial*") +
        [f"COM{i}" for i in range(1, 25)]
    )
    for port in candidates:
        try:
            if os.path.exists(port) or port.startswith("COM"):
                return port
        except:
            pass
    return None

def serial_worker():
    """Background thread to handle bidirectional serial communication without blocking the web server."""
    global serial_conn, telemetry
    while True:
        if serial_conn is None or not getattr(serial_conn, 'is_open', False):
            if serial is not None:
                port = find_serial_port()
                if port:
                    try:
                        print(f"[*] Attempting connection to Arduino on {port}...")
                        s = serial.Serial(port, SERIAL_BAUD, timeout=1)
                        time.sleep(2)  # Allow Arduino bootloader to settle
                        serial_conn = s
                        telemetry["hardware_connected"] = True
                        telemetry["port"] = port
                        print(f"[✓] Connected to Arduino on {port}")
                    except Exception as err:
                        telemetry["hardware_connected"] = False
                        telemetry["port"] = None
                        time.sleep(3)
                        continue
                else:
                    telemetry["hardware_connected"] = False
                    telemetry["port"] = None
                    time.sleep(3)
                    continue
            else:
                time.sleep(5)
                continue

        try:
            line = serial_conn.readline().decode('utf-8', errors='ignore').strip()
            if line:
                print(f"[SERIAL RX] {line}")
                # Parse Arduino telemetry
                if line.startswith("STATUS:"):
                    # Format: STATUS:FLOW=2.8:ML=250:PULSES=1125:PUMP=1:VALVE=1
                    parts = line[7:].split(":")
                    for part in parts:
                        if "=" in part:
                            k, v = part.split("=", 1)
                            if k == "FLOW": telemetry["flow_rate"] = float(v)
                            elif k == "ML": telemetry["dispensed_ml"] = float(v)
                            elif k == "PULSES": telemetry["total_pulses"] = int(v)
                            elif k == "PUMP": telemetry["relay1_pump"] = (v == "1")
                            elif k == "VALVE": telemetry["relay2_valve"] = (v == "1")
                elif line.startswith("DONE"):
                    telemetry["status"] = "completed"
                    telemetry["relay1_pump"] = False
                    telemetry["relay2_valve"] = False
                elif line.startswith("OK:STARTED"):
                    telemetry["status"] = "dispensing"
                elif line.startswith("OK:STOPPED"):
                    telemetry["status"] = "idle"
                    telemetry["relay1_pump"] = False
                    telemetry["relay2_valve"] = False
        except Exception as e:
            print(f"[!] Serial read error: {e}")
            try:
                if serial_conn: serial_conn.close()
            except: pass
            serial_conn = None
            telemetry["hardware_connected"] = False
            time.sleep(2)

def send_command(cmd):
    """Safely send command to Arduino."""
    global serial_conn
    with serial_lock:
        if serial_conn and getattr(serial_conn, 'is_open', False):
            try:
                serial_conn.write((cmd.strip() + "\n").encode('utf-8'))
                print(f"[SERIAL TX] {cmd.strip()}")
                return True
            except Exception as e:
                print(f"[!] Send error: {e}")
                return False
        else:
            print(f"[!] Simulation/Offline: command recorded: {cmd.strip()}")
            return False

# ==============================================================================
# FLASK IMPLEMENTATION (When Flask is available)
# ==============================================================================
if HAS_FLASK:
    # Notice: template_folder and static_folder point to BASE_DIR so HTML in root folder works!
    app = Flask(__name__, static_folder=BASE_DIR, template_folder=BASE_DIR)
    CORS(app)

    @app.route("/")
    @app.route("/kiosk")
    @app.route("/kiosk.html")
    def serve_kiosk():
        kiosk_path = os.path.join(BASE_DIR, "kiosk.html")
        if os.path.exists(kiosk_path):
            return send_file(kiosk_path, mimetype="text/html")
        # Check public/ if present
        pub_path = os.path.join(BASE_DIR, "public", "kiosk.html")
        if os.path.exists(pub_path):
            return send_file(pub_path, mimetype="text/html")
        return "<h3>Error: kiosk.html not found in " + BASE_DIR + "</h3>", 404

    @app.route("/test")
    @app.route("/test_mode")
    @app.route("/test_mode.html")
    def serve_test():
        test_path = os.path.join(BASE_DIR, "test_mode.html")
        if os.path.exists(test_path):
            return send_file(test_path, mimetype="text/html")
        pub_path = os.path.join(BASE_DIR, "public", "test_mode.html")
        if os.path.exists(pub_path):
            return send_file(pub_path, mimetype="text/html")
        return "<h3>Error: test_mode.html not found in " + BASE_DIR + "</h3>", 404

    @app.route("/<path:filename>")
    def serve_static(filename):
        # Serve any static asset (js, css, images) from BASE_DIR
        return send_from_directory(BASE_DIR, filename)

    @app.route("/api/status", methods=["GET"])
    def get_status():
        return jsonify(telemetry)

    @app.route("/api/dispense/start", methods=["POST"])
    def dispense_start():
        data = request.get_json(silent=True) or {}
        ml = data.get("ml", 500)
        telemetry["target_ml"] = float(ml)
        telemetry["dispensed_ml"] = 0.0
        telemetry["status"] = "dispensing"
        telemetry["relay1_pump"] = True
        telemetry["relay2_valve"] = True
        send_command(f"START:{ml}")
        return jsonify({"success": True, "target_ml": ml})

    @app.route("/api/dispense/stop", methods=["POST"])
    def dispense_stop():
        telemetry["status"] = "idle"
        telemetry["relay1_pump"] = False
        telemetry["relay2_valve"] = False
        telemetry["flow_rate"] = 0.0
        send_command("STOP")
        return jsonify({"success": True})

    @app.route("/api/relay/<int:relay_id>/<state>", methods=["POST"])
    def control_relay(relay_id, state):
        state_bool = state.lower() in ["on", "1", "true"]
        if relay_id == 1: telemetry["relay1_pump"] = state_bool
        elif relay_id == 2: telemetry["relay2_valve"] = state_bool
        send_command(f"RELAY:{relay_id}:{'ON' if state_bool else 'OFF'}")
        return jsonify({"success": True, "relay": relay_id, "state": state_bool})

    @app.route("/api/command", methods=["POST"])
    def raw_command():
        data = request.get_json(silent=True) or {}
        cmd = data.get("cmd", "")
        success = send_command(cmd)
        return jsonify({"success": success, "cmd": cmd})

# ==============================================================================
# BUILT-IN HTTP SERVER FALLBACK (Zero dependencies, pure Python standard library)
# ==============================================================================
class StandaloneHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Default route serves kiosk.html
        parsed = urlparse(path).path
        if parsed in ["/", "/kiosk", "/kiosk.html"]:
            return os.path.join(BASE_DIR, "kiosk.html")
        elif parsed in ["/test", "/test_mode", "/test_mode.html"]:
            return os.path.join(BASE_DIR, "test_mode.html")
        return super().translate_path(path)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(telemetry).encode("utf-8"))
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            data = json.loads(body.decode("utf-8"))
        except:
            data = {}

        if parsed.path == "/api/dispense/start":
            ml = data.get("ml", 500)
            telemetry["target_ml"] = float(ml)
            telemetry["status"] = "dispensing"
            send_command(f"START:{ml}")
            res = {"success": True, "target_ml": ml}
        elif parsed.path == "/api/dispense/stop":
            telemetry["status"] = "idle"
            send_command("STOP")
            res = {"success": True}
        else:
            res = {"status": "ok"}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(res).encode("utf-8"))

def main():
    print("=" * 65)
    print("  SMART PUMP CONTROLLER - FIXED BACKEND SERVER")
    print(f"  Working Directory: {BASE_DIR}")
    print(f"  Hosting on:        http://{HOST}:{PORT}")
    print(f"  Kiosk View:        http://{HOST}:{PORT}/kiosk.html")
    print(f"  Test View:         http://{HOST}:{PORT}/test_mode.html")
    print("=" * 65)

    # Start serial worker thread in background
    t = threading.Thread(target=serial_worker, daemon=True)
    t.start()

    if HAS_FLASK:
        print("[✓] Using Flask server engine")
        app.run(host=HOST, port=PORT, debug=False, threaded=True)
    else:
        print("[*] Flask not found. Running built-in Python HTTP server engine...")
        server = HTTPServer((HOST, PORT), StandaloneHandler)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            server.server_close()

if __name__ == "__main__":
    main()
