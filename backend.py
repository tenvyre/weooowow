#!/usr/bin/env python3
"""
==============================================================================
backend.py - Smart Pump Controller Server & Virtual Hardware Bridge
==============================================================================
Features:
- Hosts kiosk.html and test_mode.html on http://0.0.0.0:5000
- Auto-detects physical Arduino on USB/Serial (/dev/ttyUSB*, /dev/ttyACM*, COM*)
- Built-in Virtual Pumper Hardware Engine: If no Arduino is connected,
  a realistic virtual pump & flow sensor simulation runs in the background.
  Any test command from test_mode.html or kiosk.html immediately updates the
  shared virtual pump state, flow rate, and pulse counter!
- REST & WebSocket API endpoints for state synchronization.
==============================================================================
"""

import os
import sys
import glob
import time
import json
import threading

try:
    from flask import Flask, send_file, send_from_directory, jsonify, request
    from flask_cors import CORS
    HAS_FLASK = True
except ImportError:
    print("[!] Warning: Flask not installed. Install with: pip3 install flask flask-cors pyserial")
    HAS_FLASK = False

try:
    import serial
except ImportError:
    serial = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 5000))
HOST = "0.0.0.0"
SERIAL_BAUD = 115200

# Shared Hardware & Telemetry State
state_lock = threading.Lock()
serial_conn = None

system_state = {
    "mode": "virtual_simulator",  # 'physical_serial' or 'virtual_simulator'
    "connected": True,
    "flow_rate": 0.0,             # Liters per minute
    "dispensed_ml": 0.0,          # Total mL dispensed in current run
    "target_ml": 500.0,           # Target dispense volume
    "total_pulses": 0,            # Flow sensor pulses
    "k_factor": 4.5,              # Pulses per mL (YF-S201 standard)
    "pump": False,                # Relay 1: Main Pump state
    "valve": False,               # Relay 2: Solenoid Valve state
    "status": "idle",             # 'idle', 'dispensing', 'paused', 'completed', 'estop'
    "error": None,
    "last_updated": time.time()
}

# ------------------------------------------------------------------------------
# Serial Port Detection
# ------------------------------------------------------------------------------
def find_serial_port():
    patterns = ["/dev/ttyUSB*", "/dev/ttyACM*", "/dev/cu.usbmodem*", "COM[0-9]*"]
    for pat in patterns:
        matches = glob.glob(pat)
        if matches:
            return matches[0]
    return None

# ------------------------------------------------------------------------------
# Virtual Pumper Simulation Engine
# ------------------------------------------------------------------------------
def virtual_pumper_engine():
    """Simulates physical pump flow, pulses, and relay sequencing when no board is attached."""
    global system_state
    tick_rate = 0.1  # 100ms interval (10 Hz)

    while True:
        with state_lock:
            if system_state["mode"] == "virtual_simulator":
                if system_state["status"] == "dispensing" and system_state["pump"]:
                    # Realistic flow rate: ~2.8 L/min nominal with slight hydraulic variation
                    current_flow = 2.85
                    system_state["flow_rate"] = current_flow

                    # ml per tick: (flow_rate L/min * 1000 mL/L / 60 sec) * 0.1 sec = ~4.75 mL/tick
                    ml_increment = (current_flow * 1000.0 / 60.0) * tick_rate
                    pulses_increment = int(ml_increment * system_state["k_factor"])

                    system_state["dispensed_ml"] += ml_increment
                    system_state["total_pulses"] += pulses_increment

                    # Check if target reached
                    if system_state["dispensed_ml"] >= system_state["target_ml"]:
                        system_state["dispensed_ml"] = system_state["target_ml"]
                        system_state["status"] = "completed"
                        system_state["pump"] = False
                        system_state["valve"] = False
                        system_state["flow_rate"] = 0.0
                        print(f"[VIRTUAL PUMP] Target {system_state['target_ml']} mL reached! Total pulses: {system_state['total_pulses']}")
                else:
                    if not system_state["pump"]:
                        system_state["flow_rate"] = 0.0

            system_state["last_updated"] = time.time()

        time.sleep(tick_rate)

# ------------------------------------------------------------------------------
# Physical Serial Communication Worker
# ------------------------------------------------------------------------------
def serial_worker():
    global serial_conn, system_state
    while True:
        if serial is not None:
            port = find_serial_port()
            if port and (serial_conn is None or not getattr(serial_conn, "is_open", False)):
                try:
                    print(f"[*] Found hardware on {port}. Attempting serial connection at {SERIAL_BAUD} baud...")
                    serial_conn = serial.Serial(port, SERIAL_BAUD, timeout=1)
                    time.sleep(2)
                    with state_lock:
                        system_state["mode"] = "physical_serial"
                        system_state["connected"] = True
                    print(f"[✓] Connected to Arduino on {port}! Switched from virtual to physical mode.")
                except Exception as e:
                    serial_conn = None
                    with state_lock:
                        system_state["mode"] = "virtual_simulator"
            elif not port:
                with state_lock:
                    if system_state["mode"] != "virtual_simulator":
                        print("[*] No serial port detected. Running in Virtual Pumper mode.")
                    system_state["mode"] = "virtual_simulator"

        # Read line from Arduino if connected
        if serial_conn and getattr(serial_conn, "is_open", False):
            try:
                line = serial_conn.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    with state_lock:
                        parse_serial_message(line)
            except Exception as e:
                print(f"[!] Serial read error: {e}")
                if serial_conn:
                    try: serial_conn.close()
                    except: pass
                serial_conn = None

        time.sleep(0.05)

def parse_serial_message(line):
    global system_state
    if line.startswith("STATUS:"):
        for part in line[7:].split(":"):
            if "=" in part:
                k, v = part.split("=", 1)
                try:
                    if k == "FLOW": system_state["flow_rate"] = float(v)
                    elif k == "ML": system_state["dispensed_ml"] = float(v)
                    elif k == "PULSES": system_state["total_pulses"] = int(v)
                    elif k == "PUMP": system_state["pump"] = (v == "1")
                    elif k == "VALVE": system_state["valve"] = (v == "1")
                except ValueError:
                    pass
    elif line.startswith("DONE:"):
        system_state["status"] = "completed"
        system_state["pump"] = False
        system_state["valve"] = False
        system_state["flow_rate"] = 0.0

def dispatch_command(cmd):
    """Sends command to physical Arduino or applies directly to Virtual Pumper."""
    global serial_conn, system_state
    clean_cmd = cmd.strip()
    print(f"[CMD] Dispatching: {clean_cmd}")

    # If physical serial is available, forward command
    if serial_conn and getattr(serial_conn, "is_open", False):
        try:
            serial_conn.write((clean_cmd + "\n").encode("utf-8"))
            return True
        except Exception:
            pass

    # Apply to Virtual Pumper
    with state_lock:
        if clean_cmd.startswith("START:"):
            try:
                ml = float(clean_cmd.split(":")[1])
            except (IndexError, ValueError):
                ml = 500.0
            system_state["target_ml"] = ml
            system_state["dispensed_ml"] = 0.0
            system_state["status"] = "dispensing"
            system_state["pump"] = True
            system_state["valve"] = True
            system_state["flow_rate"] = 2.85
        elif clean_cmd == "STOP":
            system_state["status"] = "idle"
            system_state["pump"] = False
            system_state["valve"] = False
            system_state["flow_rate"] = 0.0
        elif clean_cmd == "PAUSE":
            system_state["status"] = "paused"
            system_state["pump"] = False
            system_state["valve"] = False
            system_state["flow_rate"] = 0.0
        elif clean_cmd == "RESUME":
            system_state["status"] = "dispensing"
            system_state["pump"] = True
            system_state["valve"] = True
        elif clean_cmd == "ESTOP":
            system_state["status"] = "estop"
            system_state["pump"] = False
            system_state["valve"] = False
            system_state["flow_rate"] = 0.0
        elif clean_cmd.startswith("RELAY:"):
            # RELAY:1:ON or RELAY:2:OFF
            parts = clean_cmd.split(":")
            if len(parts) >= 3:
                r_id = parts[1]
                on = parts[2].upper() in ["ON", "1", "TRUE"]
                if r_id == "1":
                    system_state["pump"] = on
                    if on:
                        system_state["flow_rate"] = 2.85
                        system_state["status"] = "dispensing"
                    else:
                        system_state["flow_rate"] = 0.0
                elif r_id == "2":
                    system_state["valve"] = on
        elif clean_cmd.startswith("CALIB:"):
            try:
                system_state["k_factor"] = float(clean_cmd.split(":")[1])
            except ValueError:
                pass

    return True

# ------------------------------------------------------------------------------
# Flask Web Server & API
# ------------------------------------------------------------------------------
app = Flask(__name__, static_folder=BASE_DIR, template_folder=BASE_DIR)
if HAS_FLASK:
    CORS(app)

@app.route("/")
@app.route("/kiosk")
@app.route("/kiosk.html")
def serve_kiosk():
    return send_file(os.path.join(BASE_DIR, "kiosk.html"), mimetype="text/html")

@app.route("/test")
@app.route("/test_mode")
@app.route("/test_mode.html")
def serve_test():
    return send_file(os.path.join(BASE_DIR, "test_mode.html"), mimetype="text/html")

@app.route("/api/status")
def api_status():
    with state_lock:
        return jsonify(system_state)

@app.route("/api/dispense/start", methods=["POST"])
def api_start():
    data = request.get_json(silent=True) or {}
    ml = data.get("ml", 500)
    dispatch_command(f"START:{ml}")
    return jsonify({"success": True, "target_ml": ml})

@app.route("/api/dispense/stop", methods=["POST"])
def api_stop():
    dispatch_command("STOP")
    return jsonify({"success": True})

@app.route("/api/dispense/pause", methods=["POST"])
def api_pause():
    dispatch_command("PAUSE")
    return jsonify({"success": True})

@app.route("/api/dispense/resume", methods=["POST"])
def api_resume():
    dispatch_command("RESUME")
    return jsonify({"success": True})

@app.route("/api/dispense/estop", methods=["POST"])
def api_estop():
    dispatch_command("ESTOP")
    return jsonify({"success": True})

@app.route("/api/relay/<int:relay_id>/<state>", methods=["POST"])
def api_relay(relay_id, state):
    state_str = "ON" if state.lower() in ["on", "1", "true"] else "OFF"
    dispatch_command(f"RELAY:{relay_id}:{state_str}")
    return jsonify({"success": True, "relay": relay_id, "state": state_str})

@app.route("/api/command", methods=["POST"])
def api_custom_command():
    data = request.get_json(silent=True) or {}
    cmd = data.get("cmd", "")
    if cmd:
        dispatch_command(cmd)
        return jsonify({"success": True, "cmd": cmd})
    return jsonify({"success": False, "error": "No command provided"}), 400

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(BASE_DIR, filename)

if __name__ == "__main__":
    print("=" * 65)
    print("  SMART PUMP CONTROLLER & VIRTUAL HARDWARE SERVER")
    print(f"  Web Kiosk:    http://{HOST}:{PORT}/kiosk.html")
    print(f"  Test Console: http://{HOST}:{PORT}/test_mode.html")
    print("  Virtual Pumper Test Engine: CONNECTED TO MAIN UI")
    print("=" * 65)

    # 1. Start Virtual Pumper thread
    t_virt = threading.Thread(target=virtual_pumper_engine, daemon=True)
    t_virt.start()

    # 2. Start Physical Serial Worker thread
    t_serial = threading.Thread(target=serial_worker, daemon=True)
    t_serial.start()

    # 3. Start Flask web server
    app.run(host=HOST, port=PORT, debug=False)
