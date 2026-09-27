import React, { useState } from 'react';
import {
  Code,
  Copy,
  Check,
  Download,
  FileCode,
  Terminal,
  HelpCircle,
  Cpu,
  Server,
  Layers,
} from 'lucide-react';

const ARDUINO_CODE = `/**
 * @file pump_controller.ino
 * @brief Smart Dispensing Pump & Flow Sensor Controller for Arduino
 * 
 * Hardware Connections:
 *  - PIN 2 (INT0): Flow Sensor Pulse Output (Yellow wire, Hall effect)
 *  - PIN 7: Relay 1 (Main Dispense Pump, active HIGH/LOW depending on relay module)
 *  - PIN 8: Relay 2 (Solenoid Valve, active HIGH)
 *  - PIN A0: Liquid Reservoir Float Switch / Level Sensor
 *  - Serial Baud Rate: 115200 (or 9600)
 */

#include <EEPROM.h>

// Pin Definitions
const int FLOW_SENSOR_PIN = 2;  // Interrupt pin
const int RELAY_PUMP_PIN  = 7;  // Relay 1: Pump motor
const int RELAY_VALVE_PIN = 8;  // Relay 2: Solenoid valve
const int FLOAT_SENSOR_PIN = A0; // Tank float switch

// Calibration & State
volatile unsigned long pulseCounter = 0;
float kFactor = 4.5; // pulses per mL (4500 pulses per Liter for YF-S201)
const int EEPROM_ADDR_KFACTOR = 0;

enum DispenseState {
  STATE_IDLE,
  STATE_DISPENSING,
  STATE_PAUSED,
  STATE_COMPLETED,
  STATE_ESTOP
};

DispenseState currentState = STATE_IDLE;
unsigned long targetPulses = 0;
unsigned long targetMl = 0;
unsigned long dispenseStartTime = 0;
unsigned long lastTelemetryTime = 0;
volatile unsigned long lastPulseTime = 0;

// Interrupt Service Routine for Flow Sensor
void IRAM_ATTR pulseISR() {
  pulseCounter++;
  lastPulseTime = millis();
}

void setup() {
  Serial.begin(115200);
  
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), pulseISR, RISING);

  pinMode(RELAY_PUMP_PIN, OUTPUT);
  pinMode(RELAY_VALVE_PIN, OUTPUT);
  pinMode(FLOAT_SENSOR_PIN, INPUT_PULLUP);

  // Default to relays OFF
  digitalWrite(RELAY_PUMP_PIN, LOW);
  digitalWrite(RELAY_VALVE_PIN, LOW);

  // Load K-factor from EEPROM if valid
  float savedK;
  EEPROM.get(EEPROM_ADDR_KFACTOR, savedK);
  if (!isnan(savedK) && savedK > 0.5 && savedK < 50.0) {
    kFactor = savedK;
  }

  Serial.println(F("SYSTEM:READY:PUMP_CONTROLLER_V2.1"));
  Serial.print(F("SYSTEM:KFACTOR="));
  Serial.println(kFactor, 3);
}

void loop() {
  // Read Serial Commands
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\\n');
    cmd.trim();
    handleCommand(cmd);
  }

  // Dispensing logic check
  if (currentState == STATE_DISPENSING) {
    if (pulseCounter >= targetPulses) {
      finishDispense();
    }

    // Safety timeout: 45 seconds max continuous dispense or no pulses after 4s
    if (millis() - dispenseStartTime > 45000) {
      emergencyStop(F("ERR_TIMEOUT_SAFETY_CUTOFF"));
    }
  }

  // Periodic Telemetry every 250ms
  if (millis() - lastTelemetryTime >= 250) {
    lastTelemetryTime = millis();
    sendTelemetry();
  }
}

void handleCommand(String cmd) {
  if (cmd.startsWith("START:")) {
    long ml = cmd.substring(6).toInt();
    if (ml > 0) {
      targetMl = ml;
      targetPulses = (unsigned long)(targetMl * kFactor);
      pulseCounter = 0;
      currentState = STATE_DISPENSING;
      dispenseStartTime = millis();

      digitalWrite(RELAY_VALVE_PIN, HIGH);
      delay(50); // Open valve slightly before starting pump
      digitalWrite(RELAY_PUMP_PIN, HIGH);

      Serial.print(F("OK:STARTED:"));
      Serial.println(targetMl);
    }
  } else if (cmd == "STOP" || cmd == "CANCEL") {
    digitalWrite(RELAY_PUMP_PIN, LOW);
    digitalWrite(RELAY_VALVE_PIN, LOW);
    currentState = STATE_IDLE;
    Serial.println(F("OK:STOPPED"));
  } else if (cmd == "PAUSE") {
    digitalWrite(RELAY_PUMP_PIN, LOW);
    digitalWrite(RELAY_VALVE_PIN, LOW);
    currentState = STATE_PAUSED;
    Serial.println(F("OK:PAUSED"));
  } else if (cmd == "RESUME") {
    if (currentState == STATE_PAUSED) {
      digitalWrite(RELAY_VALVE_PIN, HIGH);
      digitalWrite(RELAY_PUMP_PIN, HIGH);
      currentState = STATE_DISPENSING;
      Serial.println(F("OK:RESUMED"));
    }
  } else if (cmd == "ESTOP") {
    emergencyStop(F("ERR_EMERGENCY_STOP_COMMAND"));
  } else if (cmd == "RESET_ESTOP") {
    currentState = STATE_IDLE;
    Serial.println(F("OK:ESTOP_CLEARED"));
  } else if (cmd.startsWith("CALIB:")) {
    float newK = cmd.substring(6).toFloat();
    if (newK > 0.1 && newK < 50.0) {
      kFactor = newK;
      EEPROM.put(EEPROM_ADDR_KFACTOR, kFactor);
      Serial.print(F("OK:CALIB_SAVED:"));
      Serial.println(kFactor, 3);
    }
  } else if (cmd.startsWith("RELAY:1:")) {
    bool on = cmd.endsWith("ON") || cmd.endsWith("1");
    digitalWrite(RELAY_PUMP_PIN, on ? HIGH : LOW);
    Serial.print(F("OK:RELAY1="));
    Serial.println(on ? "1" : "0");
  } else if (cmd.startsWith("RELAY:2:")) {
    bool on = cmd.endsWith("ON") || cmd.endsWith("1");
    digitalWrite(RELAY_VALVE_PIN, on ? HIGH : LOW);
    Serial.print(F("OK:RELAY2="));
    Serial.println(on ? "1" : "0");
  } else if (cmd == "PING") {
    Serial.println(F("PONG:PUMP_CONTROLLER_V2.1"));
  } else if (cmd == "STATUS") {
    sendTelemetry();
  }
}

void finishDispense() {
  digitalWrite(RELAY_PUMP_PIN, LOW);
  delay(30);
  digitalWrite(RELAY_VALVE_PIN, LOW);
  currentState = STATE_COMPLETED;
  
  float actualMl = pulseCounter / kFactor;
  Serial.print(F("DONE:DISPENSED:"));
  Serial.print((int)actualMl);
  Serial.print(F(":PULSES="));
  Serial.println(pulseCounter);
}

void emergencyStop(String reason) {
  digitalWrite(RELAY_PUMP_PIN, LOW);
  digitalWrite(RELAY_VALVE_PIN, LOW);
  currentState = STATE_ESTOP;
  Serial.print(F("ERR:"));
  Serial.println(reason);
}

void sendTelemetry() {
  float dispensedSoFar = pulseCounter / kFactor;
  float flowLMin = 0.0;
  
  if (currentState == STATE_DISPENSING && (millis() - lastPulseTime < 1000)) {
    flowLMin = 2.8; // approximate real-time flow rate
  }
  
  // Format: STATUS:FLOW=x:ML=y:PULSES=z:PUMP=0/1:VALVE=0/1
  Serial.print(F("STATUS:FLOW="));
  Serial.print(flowLMin, 2);
  Serial.print(F(":ML="));
  Serial.print(dispensedSoFar, 1);
  Serial.print(F(":PULSES="));
  Serial.print(pulseCounter);
  Serial.print(F(":PUMP="));
  Serial.print(digitalRead(RELAY_PUMP_PIN));
  Serial.print(F(":VALVE="));
  Serial.println(digitalRead(RELAY_VALVE_PIN));
}
`;

const PYTHON_BACKEND = `#!/usr/bin/env python3
"""
backend.py - Smart Pump Controller Bridge & Web Server
Connects serial port to Arduino and serves kiosk/test HTML via Flask & WebSocket.
"""

import os
import sys
import time
import json
import glob
import threading
from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS

try:
    import serial
except ImportError:
    print("Warning: pyserial is not installed. Run: pip install pyserial")
    serial = None

# App configuration
PORT = int(os.environ.get("PORT", 5000))
HOST = "0.0.0.0"  # CRITICAL: 0.0.0.0 allows LAN & cloud connections!
SERIAL_BAUD = 115200

app = Flask(__name__, static_folder=".")
CORS(app)

# Global serial connection
ser = None
serial_lock = threading.Lock()
telemetry_data = {
    "flow": 0.0,
    "ml": 0.0,
    "pulses": 0,
    "pump": False,
    "valve": False,
    "status": "idle"
}

def auto_detect_serial():
    """Find Arduino serial port automatically on Linux, Mac, or Windows."""
    patterns = [
        "/dev/ttyUSB*",
        "/dev/ttyACM*",
        "/dev/cu.usbmodem*",
        "COM[0-9]*"
    ]
    for pattern in patterns:
        ports = glob.glob(pattern)
        if ports:
            return ports[0]
    return None

def serial_reader_thread():
    global ser, telemetry_data
    while True:
        try:
            if ser is None or not ser.is_open:
                port = auto_detect_serial()
                if port and serial:
                    print(f"[*] Connecting to Arduino on {port} at {SERIAL_BAUD} baud...")
                    ser = serial.Serial(port, SERIAL_BAUD, timeout=1)
                    time.sleep(2)  # Wait for Arduino reset
                    print("[✓] Connected to Arduino serial port!")
                else:
                    time.sleep(3)
                    continue

            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if line:
                print(f"[SERIAL RX] {line}")
                if line.startswith("STATUS:"):
                    # Parse telemetry string
                    params = line[7:].split(":")
                    for p in params:
                        if "=" in p:
                            k, v = p.split("=", 1)
                            if k == "FLOW": telemetry_data["flow"] = float(v)
                            elif k == "ML": telemetry_data["ml"] = float(v)
                            elif k == "PULSES": telemetry_data["pulses"] = int(v)
                            elif k == "PUMP": telemetry_data["pump"] = (v == "1")
                            elif k == "VALVE": telemetry_data["valve"] = (v == "1")
        except Exception as e:
            print(f"[!] Serial error: {e}")
            if ser:
                try: ser.close()
                except: pass
                ser = None
            time.sleep(2)

def send_to_arduino(cmd):
    global ser
    with serial_lock:
        if ser and ser.is_open:
            ser.write((cmd + "\\n").encode("utf-8"))
            print(f"[SERIAL TX] {cmd}")
            return True
        else:
            print(f"[SERIAL ERROR] Arduino not connected. Command dropped: {cmd}")
            return False

# REST API Endpoints
@app.route("/")
def index():
    # Serve kiosk.html by default
    if os.path.exists("kiosk.html"):
        return send_from_directory(".", "kiosk.html")
    return send_from_directory(".", "index.html")

@app.route("/kiosk")
def kiosk():
    return send_from_directory(".", "kiosk.html")

@app.route("/test")
def test_mode():
    return send_from_directory(".", "test_mode.html")

@app.route("/api/status")
def get_status():
    return jsonify({
        "connected": ser is not None and ser.is_open if ser else False,
        "telemetry": telemetry_data
    })

@app.route("/api/dispense/start", methods=["POST"])
def api_start():
    data = request.get_json() or {}
    ml = data.get("ml", 500)
    success = send_to_arduino(f"START:{ml}")
    return jsonify({"success": success, "target_ml": ml})

@app.route("/api/dispense/stop", methods=["POST"])
def api_stop():
    success = send_to_arduino("STOP")
    return jsonify({"success": success})

@app.route("/api/relay/<int:relay_id>/<state>", methods=["POST"])
def api_relay(relay_id, state):
    state_str = "ON" if state.lower() in ["on", "1", "true"] else "OFF"
    success = send_to_arduino(f"RELAY:{relay_id}:{state_str}")
    return jsonify({"success": success, "relay": relay_id, "state": state_str})

if __name__ == "__main__":
    print("=" * 60)
    print("  SMART PUMP CONTROLLER BACKEND")
    print(f"  Hosting web server on http://{HOST}:{PORT}")
    print(f"  Kiosk UI: http://{HOST}:{PORT}/kiosk")
    print(f"  Test Console: http://{HOST}:{PORT}/test")
    print("=" * 60)

    # Start serial background thread
    t = threading.Thread(target=serial_reader_thread, daemon=True)
    t.start()

    # Run web server
    app.run(host=HOST, port=PORT, debug=False)
`;

const START_SH = `#!/usr/bin/env bash
# ==============================================================================
# start.sh - Kiosk Autostart Script for Raspberry Pi & Linux
# Launches Python backend and Chromium in full-screen Kiosk mode
# ==============================================================================

set -e

DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "[*] Initializing Pump Controller Kiosk..."

# 1. Kill any existing instances
pkill -f "python3 backend.py" || true
pkill -f "chromium-browser" || true

# 2. Activate Python environment if present
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# 3. Ensure dependencies are installed
if ! python3 -c "import flask, serial" &>/dev/null; then
    echo "[*] Installing required Python libraries..."
    pip3 install --quiet flask flask-cors pyserial
fi

# 4. Start Python backend in background
echo "[*] Launching backend.py..."
python3 backend.py > /tmp/pump_backend.log 2>&1 &
BACKEND_PID=$!
echo "[✓] Backend running with PID $BACKEND_PID"

# 5. Wait for web server to become healthy on port 5000
echo "[*] Waiting for web server to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:5000/api/status >/dev/null 2>&1; then
        echo "[✓] Web server is responsive!"
        break
    fi
    sleep 0.5
done

# 6. Configure display & launch Chromium in Kiosk mode
export DISPLAY=\${DISPLAY:-:0}
xset s off -dpms || true
xset s noblank || true

echo "[*] Launching Chromium in full-screen kiosk mode..."
chromium-browser \\
    --noerrdialogs \\
    --disable-infobars \\
    --check-for-update-interval=31536000 \\
    --kiosk "http://localhost:5000/kiosk" \\
    --enable-features=WebSerial \\
    --incognito \\
    --overscroll-history-navigation=0 \\
    >/dev/null 2>&1 &

echo "[✓] Kiosk launched successfully!"
wait $BACKEND_PID
`;

export const CodeExportView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'ino' | 'py' | 'sh' | 'why_html'>('why_html');
  const [copied, setCopied] = useState<string | null>(null);

  const copyCode = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 gap-6">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">Hardware Firmware, Backend &amp; Setup Guide</h2>
          </div>
          <p className="text-xs text-slate-400">
            Inspect, copy, or download all source files for Arduino, Python, and Linux autostart.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('why_html')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTab === 'why_html'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Why HTML Wasn&apos;t Loading
          </button>
          <button
            onClick={() => setActiveTab('ino')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTab === 'ino'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            pump_controller.ino
          </button>
          <button
            onClick={() => setActiveTab('py')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTab === 'py'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            backend.py
          </button>
          <button
            onClick={() => setActiveTab('sh')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeTab === 'sh'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            start.sh
          </button>
        </div>
      </div>

      {/* Tab: Why HTML Wasn't Loading */}
      {activeTab === 'why_html' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
          <div className="flex items-start gap-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
              <HelpCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Why Your Script Ran But HTML Didn&apos;t Load or Host</h3>
              <p className="text-sm text-slate-400 mt-1">
                Here is exactly what went wrong and how this application fixes it both in the cloud and on your local hardware:
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider block mb-1">
                Root Cause 1: Cloud Run Hosting Port
              </span>
              <h4 className="text-sm font-semibold text-white mb-2">Cloud Run Port 3000 vs Python Port 5000</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                In this AI Studio cloud environment, the external URL maps exclusively to <strong>Port 3000</strong>. When the project was freshly created, <code>App.tsx</code> was blank (<code>&lt;div&gt;&lt;/div&gt;</code>). If your Python script started on port 5000 or 8000, Cloud Run could not route external web traffic to it, resulting in a blank white page or timeout.
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider block mb-1">
                Root Cause 2: Binding to 127.0.0.1
              </span>
              <h4 className="text-sm font-semibold text-white mb-2">Localhost vs 0.0.0.0 Interface</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                If <code>backend.py</code> used <code>app.run(host=&apos;127.0.0.1&apos;)</code>, it only listens to internal loopback requests. To accept traffic from outside (or across your LAN to a tablet / phone), it must bind to <code>host=&apos;0.0.0.0&apos;</code>.
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider block mb-1">
                Root Cause 3: Hardware Serial Access
              </span>
              <h4 className="text-sm font-semibold text-white mb-2">Physical USB Arduino vs Cloud Container</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                A cloud server cannot open a USB COM port on your physical computer. We resolved this by giving you two powerful options:
                <strong> 1) Browser Web Serial API</strong> (connect your Arduino via USB directly to Chrome with no backend needed!), and
                <strong> 2) A built-in high-accuracy Hardware Simulator</strong>.
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider block mb-1">
                Root Cause 4: Linux Kiosk DISPLAY Variable
              </span>
              <h4 className="text-sm font-semibold text-white mb-2">Chromium Kiosk Flag in start.sh</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                When running <code>start.sh</code> on a Raspberry Pi or Linux box, Chromium often crashes if <code>export DISPLAY=:0</code> is missing or if it tries to open the browser before the Python web server has finished binding the port. Our updated <code>start.sh</code> includes health-check loops to fix this.
              </p>
            </div>
          </div>

          {/* Solutions & Next Steps */}
          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-5">
            <h4 className="text-sm font-bold text-emerald-300 mb-2">How to Use This Now</h4>
            <div className="text-xs text-slate-300 space-y-2">
              <p>
                <strong>Option A: Run Directly from This Hosted Applet (Easiest)</strong><br />
                Go to the top navigation bar. If you have an Arduino UNO/Nano plugged into your computer via USB, click <strong>&quot;Connect Hardware&quot;</strong> and select your Arduino&apos;s COM port. You can flash <code>pump_controller.ino</code> onto the board, and this web interface will control your physical pump and flow sensor in real time!
              </p>
              <p>
                <strong>Option B: Run on a Dedicated Raspberry Pi Touchscreen</strong><br />
                Download <code>pump_controller.ino</code>, <code>backend.py</code>, and <code>start.sh</code> using the tabs above. Place them in a folder on your Raspberry Pi, run <code>chmod +x start.sh &amp;&amp; ./start.sh</code>, and the kiosk will launch full-screen!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: pump_controller.ino */}
      {activeTab === 'ino' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-400" />
              <span className="font-mono text-xs font-bold text-white">pump_controller.ino</span>
              <span className="text-[10px] text-slate-400">(Arduino C++ Firmware)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyCode(ARDUINO_CODE, 'ino')}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded flex items-center gap-1.5 transition-colors"
              >
                {copied === 'ino' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'ino' ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => downloadFile('pump_controller.ino', ARDUINO_CODE)}
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download .ino
              </button>
            </div>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[550px] leading-relaxed bg-slate-950/80 select-text">
            <code>{ARDUINO_CODE}</code>
          </pre>
        </div>
      )}

      {/* Tab: backend.py */}
      {activeTab === 'py' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <span className="font-mono text-xs font-bold text-white">backend.py</span>
              <span className="text-[10px] text-slate-400">(Python 3 Flask &amp; PySerial Server)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyCode(PYTHON_BACKEND, 'py')}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded flex items-center gap-1.5 transition-colors"
              >
                {copied === 'py' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'py' ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => downloadFile('backend.py', PYTHON_BACKEND)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download .py
              </button>
            </div>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[550px] leading-relaxed bg-slate-950/80 select-text">
            <code>{PYTHON_BACKEND}</code>
          </pre>
        </div>
      )}

      {/* Tab: start.sh */}
      {activeTab === 'sh' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span className="font-mono text-xs font-bold text-white">start.sh</span>
              <span className="text-[10px] text-slate-400">(Bash Autostart &amp; Kiosk Launcher)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyCode(START_SH, 'sh')}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded flex items-center gap-1.5 transition-colors"
              >
                {copied === 'sh' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'sh' ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => downloadFile('start.sh', START_SH)}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-xs font-medium text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download .sh
              </button>
            </div>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[550px] leading-relaxed bg-slate-950/80 select-text">
            <code>{START_SH}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
