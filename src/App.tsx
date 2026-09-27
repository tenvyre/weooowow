import React, { useState, useEffect, useRef } from 'react';
import {
  Monitor,
  Wrench,
  FileCode,
  Terminal,
  Download,
  Copy,
  Check,
  ExternalLink,
  HelpCircle,
  AlertCircle,
  CheckCircle2,
  Columns,
  Play,
  Pause,
  RotateCcw,
  Zap,
  Activity,
  Layers,
  Archive,
} from 'lucide-react';
import { downloadProjectZip } from './utils/zipExport.ts';

// File text definitions for export and viewing
const BACKEND_PY_CODE = `#!/usr/bin/env python3
"""
backend.py - Smart Pump Controller Server & Virtual Hardware Bridge
Hosts kiosk.html and test_mode.html on http://0.0.0.0:5000 with zero HTML changes.
Built-in Virtual Pumper simulation runs automatically if no physical Arduino is connected.
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

state_lock = threading.Lock()
serial_conn = None

system_state = {
    "mode": "virtual_simulator",
    "connected": True,
    "flow_rate": 0.0,
    "dispensed_ml": 0.0,
    "target_ml": 500.0,
    "total_pulses": 0,
    "k_factor": 4.5,
    "pump": False,
    "valve": False,
    "status": "idle",
    "last_updated": time.time()
}

def find_serial_port():
    patterns = ["/dev/ttyUSB*", "/dev/ttyACM*", "/dev/cu.usbmodem*", "COM[0-9]*"]
    for pat in patterns:
        matches = glob.glob(pat)
        if matches:
            return matches[0]
    return None

def virtual_pumper_engine():
    global system_state
    tick_rate = 0.1
    while True:
        with state_lock:
            if system_state["mode"] == "virtual_simulator":
                if system_state["status"] == "dispensing" and system_state["pump"]:
                    current_flow = 2.85
                    system_state["flow_rate"] = current_flow
                    ml_increment = (current_flow * 1000.0 / 60.0) * tick_rate
                    pulses_increment = int(ml_increment * system_state["k_factor"])
                    system_state["dispensed_ml"] += ml_increment
                    system_state["total_pulses"] += pulses_increment

                    if system_state["dispensed_ml"] >= system_state["target_ml"]:
                        system_state["dispensed_ml"] = system_state["target_ml"]
                        system_state["status"] = "completed"
                        system_state["pump"] = False
                        system_state["valve"] = False
                        system_state["flow_rate"] = 0.0
                else:
                    if not system_state["pump"]:
                        system_state["flow_rate"] = 0.0
            system_state["last_updated"] = time.time()
        time.sleep(tick_rate)

def serial_worker():
    global serial_conn, system_state
    while True:
        if serial is not None:
            port = find_serial_port()
            if port and (serial_conn is None or not getattr(serial_conn, "is_open", False)):
                try:
                    serial_conn = serial.Serial(port, SERIAL_BAUD, timeout=1)
                    time.sleep(2)
                    with state_lock:
                        system_state["mode"] = "physical_serial"
                        system_state["connected"] = True
                except Exception:
                    serial_conn = None
            elif not port:
                with state_lock:
                    system_state["mode"] = "virtual_simulator"

        if serial_conn and getattr(serial_conn, "is_open", False):
            try:
                line = serial_conn.readline().decode("utf-8", errors="ignore").strip()
                if line and line.startswith("STATUS:"):
                    with state_lock:
                        for part in line[7:].split(":"):
                            if "=" in part:
                                k, v = part.split("=", 1)
                                if k == "FLOW": system_state["flow_rate"] = float(v)
                                elif k == "ML": system_state["dispensed_ml"] = float(v)
                                elif k == "PULSES": system_state["total_pulses"] = int(v)
                                elif k == "PUMP": system_state["pump"] = (v == "1")
                                elif k == "VALVE": system_state["valve"] = (v == "1")
            except Exception:
                if serial_conn:
                    try: serial_conn.close()
                    except: pass
                serial_conn = None
        time.sleep(0.05)

def dispatch_command(cmd):
    global serial_conn, system_state
    clean_cmd = cmd.strip()
    if serial_conn and getattr(serial_conn, "is_open", False):
        try:
            serial_conn.write((clean_cmd + "\\n").encode("utf-8"))
            return True
        except Exception:
            pass

    with state_lock:
        if clean_cmd.startswith("START:"):
            try:
                ml = float(clean_cmd.split(":")[1])
            except:
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
        elif clean_cmd == "ESTOP":
            system_state["status"] = "estop"
            system_state["pump"] = False
            system_state["valve"] = False
            system_state["flow_rate"] = 0.0
        elif clean_cmd.startswith("RELAY:"):
            parts = clean_cmd.split(":")
            if len(parts) >= 3:
                r_id, state = parts[1], parts[2].upper() in ["ON", "1", "TRUE"]
                if r_id == "1":
                    system_state["pump"] = state
                    system_state["flow_rate"] = 2.85 if state else 0.0
                elif r_id == "2":
                    system_state["valve"] = state
    return True

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

@app.route("/api/dispense/estop", methods=["POST"])
def api_estop():
    dispatch_command("ESTOP")
    return jsonify({"success": True})

@app.route("/api/relay/<int:relay_id>/<state>", methods=["POST"])
def api_relay(relay_id, state):
    state_str = "ON" if state.lower() in ["on", "1", "true"] else "OFF"
    dispatch_command(f"RELAY:{relay_id}:{state_str}")
    return jsonify({"success": True, "relay": relay_id, "state": state_str})

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(BASE_DIR, filename)

if __name__ == "__main__":
    t_virt = threading.Thread(target=virtual_pumper_engine, daemon=True)
    t_virt.start()
    t_serial = threading.Thread(target=serial_worker, daemon=True)
    t_serial.start()
    app.run(host=HOST, port=PORT, debug=False)
`;

const START_SH_CODE = `#!/usr/bin/env bash
# ==============================================================================
# start.sh - Autostart script for Kiosk on Raspberry Pi & Linux
# ==============================================================================

set -e

DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=================================================="
echo " Starting Pump Controller Kiosk System"
echo " Working directory: $DIR"
echo "=================================================="

# 1. Terminate stale instances
pkill -f "python3 backend.py" || true

# 2. Virtual environment support
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# 3. Launch backend.py in background
python3 backend.py > /tmp/pump_backend.log 2>&1 &
BACKEND_PID=$!
echo "[✓] Backend running with PID $BACKEND_PID"

# 4. Wait until the web server is ready (prevents ERR_CONNECTION_REFUSED)
echo "[*] Waiting for web server on port 5000..."
for i in {1..20}; do
    if curl -s http://127.0.0.1:5000/ > /dev/null 2>&1; then
        echo "[✓] Web server is UP and responding!"
        break
    fi
    sleep 0.5
done

# 5. Configure display & Launch Chromium
export DISPLAY=\${DISPLAY:-:0}
chromium-browser \\
    --noerrdialogs \\
    --disable-infobars \\
    --check-for-update-interval=31536000 \\
    --kiosk "http://localhost:5000/kiosk.html" &

wait $BACKEND_PID
`;

const PUMP_CONTROLLER_INO_CODE = `/**
 * @file pump_controller.ino
 * @brief Smart Dispensing Pump & Flow Sensor Controller for Arduino
 */

#include <EEPROM.h>

const int FLOW_SENSOR_PIN = 2;  // Interrupt pin (YF-S201 yellow wire)
const int RELAY_PUMP_PIN  = 7;  // Relay 1: Pump motor
const int RELAY_VALVE_PIN = 8;  // Relay 2: Solenoid valve
const int FLOAT_SENSOR_PIN = A0; // Tank float switch

volatile unsigned long pulseCounter = 0;
float kFactor = 4.5; // pulses per mL
const int EEPROM_ADDR_KFACTOR = 0;

enum DispenseState { STATE_IDLE, STATE_DISPENSING, STATE_PAUSED, STATE_COMPLETED, STATE_ESTOP };
DispenseState currentState = STATE_IDLE;
unsigned long targetPulses = 0;
unsigned long targetMl = 0;
unsigned long dispenseStartTime = 0;
unsigned long lastTelemetryTime = 0;

void IRAM_ATTR pulseISR() {
  pulseCounter++;
}

void setup() {
  Serial.begin(115200);
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), pulseISR, RISING);
  pinMode(RELAY_PUMP_PIN, OUTPUT);
  pinMode(RELAY_VALVE_PIN, OUTPUT);
  pinMode(FLOAT_SENSOR_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PUMP_PIN, LOW);
  digitalWrite(RELAY_VALVE_PIN, LOW);

  float savedK;
  EEPROM.get(EEPROM_ADDR_KFACTOR, savedK);
  if (!isnan(savedK) && savedK > 0.5 && savedK < 50.0) {
    kFactor = savedK;
  }
  Serial.println(F("SYSTEM:READY:PUMP_CONTROLLER_V2.1"));
}

void loop() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\\n');
    cmd.trim();
    if (cmd.startsWith("START:")) {
      long ml = cmd.substring(6).toInt();
      if (ml > 0) {
        targetMl = ml;
        targetPulses = (unsigned long)(targetMl * kFactor);
        pulseCounter = 0;
        currentState = STATE_DISPENSING;
        dispenseStartTime = millis();
        digitalWrite(RELAY_VALVE_PIN, HIGH);
        delay(50);
        digitalWrite(RELAY_PUMP_PIN, HIGH);
        Serial.print(F("OK:STARTED:"));
        Serial.println(targetMl);
      }
    } else if (cmd == "STOP" || cmd == "CANCEL") {
      digitalWrite(RELAY_PUMP_PIN, LOW);
      digitalWrite(RELAY_VALVE_PIN, LOW);
      currentState = STATE_IDLE;
      Serial.println(F("OK:STOPPED"));
    } else if (cmd == "ESTOP") {
      digitalWrite(RELAY_PUMP_PIN, LOW);
      digitalWrite(RELAY_VALVE_PIN, LOW);
      currentState = STATE_ESTOP;
      Serial.println(F("ERR:ESTOP"));
    } else if (cmd == "PING") {
      Serial.println(F("PONG"));
    }
  }

  if (currentState == STATE_DISPENSING) {
    if (pulseCounter >= targetPulses) {
      digitalWrite(RELAY_PUMP_PIN, LOW);
      digitalWrite(RELAY_VALVE_PIN, LOW);
      currentState = STATE_COMPLETED;
      Serial.print(F("DONE:DISPENSED:"));
      Serial.println((int)(pulseCounter / kFactor));
    }
  }

  if (millis() - lastTelemetryTime >= 250) {
    lastTelemetryTime = millis();
    Serial.print(F("STATUS:FLOW="));
    Serial.print(currentState == STATE_DISPENSING ? 2.8 : 0.0, 2);
    Serial.print(F(":ML="));
    Serial.print(pulseCounter / kFactor, 1);
    Serial.print(F(":PULSES="));
    Serial.println(pulseCounter);
  }
}
`;

const README_CODE = `# Smart Pump Controller & Dispensing Kiosk

Automated liquid dispensing kiosk with Web Serial Arduino integration and built-in Virtual Pumper simulation engine.

## File Structure

- \`backend.py\`: Python Flask server & Virtual Pumper hardware bridge (hosts on 0.0.0.0:5000)
- \`start.sh\`: Bash autostart & Chromium kiosk launcher with server wait-loop
- \`kiosk.html\`: Customer-facing touch kiosk interface (connected to virtual pumper)
- \`test_mode.html\`: Technician diagnostic, relay actuation, and pulse calibration
- \`pump_controller.ino\`: Arduino firmware for physical Hall-effect sensor and relays

## Virtual Pumper Connection
The Virtual Pumper simulation engine runs automatically whenever no physical Arduino is connected.
Any actuation or test from \`test_mode.html\` or the test dock immediately syncs and reflects in \`kiosk.html\`!

## Quick Start on Raspberry Pi / Linux

\`\`\`bash
pip3 install flask flask-cors pyserial
chmod +x start.sh
./start.sh
\`\`\`
`;

export default function App() {
  const [activeTab, setActiveTab] = useState<'kiosk' | 'test' | 'split' | 'backend' | 'start_sh' | 'ino' | 'why'>('split');
  const [copied, setCopied] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  // Live Virtual Pumper State (synchronized across views via BroadcastChannel)
  const [virtState, setVirtState] = useState({
    pump: false,
    valve: false,
    flowRate: 0.0,
    dispensedMl: 0,
    targetMl: 500,
    pulses: 0,
    status: 'idle',
  });

  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  // Initialize synchronization channel
  useEffect(() => {
    try {
      const channel = new BroadcastChannel('pump_virtual_channel');
      syncChannelRef.current = channel;

      channel.onmessage = (e) => {
        const data = e.data;
        if (!data) return;
        setVirtState(prev => ({
          ...prev,
          pump: data.pump !== undefined ? data.pump : prev.pump,
          valve: data.valve !== undefined ? data.valve : prev.valve,
          flowRate: typeof data.flow_rate === 'number' ? data.flow_rate : prev.flowRate,
          dispensedMl: typeof data.dispensed_ml === 'number' ? data.dispensed_ml : prev.dispensedMl,
          targetMl: typeof data.target_ml === 'number' ? data.target_ml : prev.targetMl,
          pulses: typeof data.total_pulses === 'number' ? data.total_pulses : prev.pulses,
          status: data.status || prev.status,
        }));
      };

      return () => {
        channel.close();
      };
    } catch {}
  }, []);

  // Broadcast state changes from virtual pumper controls
  const broadcastVirtualAction = (action: Record<string, unknown>) => {
    if (syncChannelRef.current) {
      syncChannelRef.current.postMessage(action);
    }
  };

  // Virtual Pumper Controls
  const togglePumpRelay = (forced?: boolean) => {
    const nextPump = forced !== undefined ? forced : !virtState.pump;
    const nextFlow = nextPump ? 2.85 : 0.0;
    setVirtState(prev => ({ ...prev, pump: nextPump, flowRate: nextFlow }));
    broadcastVirtualAction({
      type: 'RELAY',
      relay: 1,
      state: nextPump,
      pump: nextPump,
      flow_rate: nextFlow,
    });
  };

  const toggleValveRelay = () => {
    const nextValve = !virtState.valve;
    setVirtState(prev => ({ ...prev, valve: nextValve }));
    broadcastVirtualAction({
      type: 'RELAY',
      relay: 2,
      state: nextValve,
      valve: nextValve,
    });
  };

  const triggerPulseTest = (seconds = 1) => {
    togglePumpRelay(true);
    setTimeout(() => {
      togglePumpRelay(false);
    }, seconds * 1000);
  };

  const triggerTestDispense = (ml: number) => {
    setVirtState(prev => ({
      ...prev,
      targetMl: ml,
      dispensedMl: 0,
      pump: true,
      valve: true,
      flowRate: 2.85,
      status: 'dispensing',
    }));
    broadcastVirtualAction({
      type: 'START_DISPENSE',
      target_ml: ml,
      status: 'dispensing',
      pump: true,
      flow_rate: 2.85,
    });
  };

  const triggerEmergencyStop = () => {
    setVirtState(prev => ({
      ...prev,
      pump: false,
      valve: false,
      flowRate: 0.0,
      status: 'estop',
    }));
    broadcastVirtualAction({
      type: 'ESTOP',
      status: 'estop',
      pump: false,
      flow_rate: 0.0,
    });
  };

  const copyCode = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      // Fetch fresh kiosk.html and test_mode.html
      const [kioskRes, testRes] = await Promise.all([
        fetch('/kiosk.html').then(r => r.text()).catch(() => ''),
        fetch('/test_mode.html').then(r => r.text()).catch(() => ''),
      ]);

      await downloadProjectZip(
        {
          'backend.py': BACKEND_PY_CODE,
          'start.sh': START_SH_CODE,
          'kiosk.html': kioskRes,
          'test_mode.html': testRes,
          'pump_controller.ino': PUMP_CONTROLLER_INO_CODE,
          'README.md': README_CODE,
        },
        'pump_kiosk_system.zip'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Top Project Navigation Bar */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Smart Pump Controller</span>
              <span className="text-[10px] bg-sky-950 text-sky-400 border border-sky-800 px-2 py-0.5 rounded font-mono">
                Virtual Pumper Connected
              </span>
            </span>
          </div>

          {/* Navigation View Tabs */}
          <nav className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs overflow-x-auto">
            <button
              onClick={() => setActiveTab('split')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'split' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Side-by-Side (Live Test)</span>
            </button>
            <button
              onClick={() => setActiveTab('kiosk')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'kiosk' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>kiosk.html</span>
            </button>
            <button
              onClick={() => setActiveTab('test')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'test' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>test_mode.html</span>
            </button>
            <button
              onClick={() => setActiveTab('backend')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'backend' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>backend.py</span>
            </button>
            <button
              onClick={() => setActiveTab('start_sh')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'start_sh' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>start.sh</span>
            </button>
            <button
              onClick={() => setActiveTab('ino')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'ino' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>pump_controller.ino</span>
            </button>
            <button
              onClick={() => setActiveTab('why')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'why' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-400 hover:text-amber-200'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Why HTML Failed</span>
            </button>
          </nav>

          {/* Download Complete Project (.ZIP) Button */}
          <button
            onClick={handleDownloadZip}
            disabled={downloadingZip}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <Archive className="w-4 h-4" />
            <span>{downloadingZip ? 'Packaging Zip...' : 'Download Updated Folder (.ZIP)'}</span>
          </button>
        </div>
      </header>

      {/* Persistent Virtual Pumper Test Dock (Connected to Main UI) */}
      <section className="bg-slate-900/95 border-b border-slate-800 px-4 py-2.5 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs">
          {/* Status & Indicators */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                Virtual Pumper Bridge:
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono">
                LIVE SYNCED
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono bg-slate-950 px-3 py-1 rounded-md border border-slate-800">
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${virtState.pump ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-600'}`} />
                <span>Pump: <strong className={virtState.pump ? 'text-emerald-400' : 'text-slate-400'}>{virtState.pump ? 'ACTIVE' : 'OFF'}</strong></span>
              </span>
              <span className="text-slate-700">|</span>
              <span>Flow: <strong className="text-sky-400">{virtState.flowRate.toFixed(2)}</strong> L/min</span>
              <span className="text-slate-700">|</span>
              <span>Target: <strong className="text-slate-300">{virtState.targetMl}</strong> mL</span>
            </div>
          </div>

          {/* Quick Virtual Test Actions that trigger Main UI */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 text-[11px] font-medium hidden sm:inline">Actuate Virtual Pump:</span>
            <button
              onClick={() => togglePumpRelay()}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors cursor-pointer ${
                virtState.pump ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {virtState.pump ? 'Stop Pump' : 'Turn Pump ON'}
            </button>
            <button
              onClick={() => triggerPulseTest(1)}
              className="px-2.5 py-1 bg-amber-600/80 hover:bg-amber-600 text-white rounded text-[11px] font-medium transition-colors cursor-pointer"
            >
              1-Sec Pulse
            </button>
            <button
              onClick={() => triggerTestDispense(250)}
              className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-medium transition-colors cursor-pointer"
            >
              Dispense 250mL
            </button>
            <button
              onClick={() => triggerTestDispense(500)}
              className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-medium transition-colors cursor-pointer"
            >
              Dispense 500mL
            </button>
            <button
              onClick={triggerEmergencyStop}
              className="px-2.5 py-1 bg-red-950 border border-red-500/50 hover:bg-red-900 text-red-300 rounded text-[11px] font-bold transition-colors cursor-pointer uppercase"
            >
              E-Stop
            </button>
          </div>
        </div>
      </section>

      {/* Main Content Viewport */}
      <main className="flex-1 flex flex-col p-4 max-w-7xl mx-auto w-full">
        {/* VIEW 1: SIDE-BY-SIDE SPLIT SCREEN */}
        {activeTab === 'split' && (
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Side-by-side mode: Click any test button on the right, and watch the Main Kiosk react live on the left!</span>
              </span>
              <div className="flex gap-2">
                <a href="/kiosk.html" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline flex items-center gap-1">
                  Open Kiosk in New Tab <ExternalLink className="w-3 h-3" />
                </a>
                <span>·</span>
                <a href="/test_mode.html" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline flex items-center gap-1">
                  Open Test Mode in New Tab <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[680px]">
              {/* Left Column: kiosk.html */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-xl">
                <div className="bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-sky-400" />
                    <span>Main UI: kiosk.html</span>
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">LIVE CONNECTED</span>
                </div>
                <iframe
                  src="/kiosk.html"
                  title="Main Kiosk UI"
                  className="w-full flex-1 border-none bg-slate-950 min-h-[620px]"
                />
              </div>

              {/* Right Column: test_mode.html */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-xl">
                <div className="bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-400" />
                    <span>Virtual Pumper Test Console: test_mode.html</span>
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono">DIAGNOSTIC MODE</span>
                </div>
                <iframe
                  src="/test_mode.html"
                  title="Test Mode Console"
                  className="w-full flex-1 border-none bg-slate-950 min-h-[620px]"
                />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: kiosk.html Full Screen */}
        {activeTab === 'kiosk' && (
          <div className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl min-h-[720px]">
            <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-white">kiosk.html</span>
                <span className="text-slate-400">· Customer Dispense Kiosk (Connected to Virtual Pumper)</span>
              </div>
              <a href="/kiosk.html" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium">
                Open in Full Window <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <iframe src="/kiosk.html" title="kiosk.html" className="w-full flex-1 border-none bg-slate-950 min-h-[680px]" />
          </div>
        )}

        {/* VIEW 3: test_mode.html Full Screen */}
        {activeTab === 'test' && (
          <div className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl min-h-[720px]">
            <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-white">test_mode.html</span>
                <span className="text-slate-400">· Hardware Diagnostic &amp; Virtual Pumper Test Suite</span>
              </div>
              <a href="/test_mode.html" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium">
                Open in Full Window <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <iframe src="/test_mode.html" title="test_mode.html" className="w-full flex-1 border-none bg-slate-950 min-h-[680px]" />
          </div>
        )}

        {/* VIEW 4: backend.py */}
        {activeTab === 'backend' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-emerald-400" />
                <span className="font-mono text-xs font-bold text-white">backend.py</span>
                <span className="text-[11px] text-slate-400">(Includes Virtual Pumper Engine &amp; Serial Bridge)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyCode(BACKEND_PY_CODE, 'backend')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copied === 'backend' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'backend' ? 'Copied' : 'Copy Code'}
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[650px] leading-relaxed bg-slate-950/80 select-text">
              <code>{BACKEND_PY_CODE}</code>
            </pre>
          </div>
        )}

        {/* VIEW 5: start.sh */}
        {activeTab === 'start_sh' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-purple-400" />
                <span className="font-mono text-xs font-bold text-white">start.sh</span>
                <span className="text-[11px] text-slate-400">(Fixed Autostart &amp; Kiosk Launcher)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyCode(START_SH_CODE, 'start_sh')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copied === 'start_sh' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'start_sh' ? 'Copied' : 'Copy Code'}
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[650px] leading-relaxed bg-slate-950/80 select-text">
              <code>{START_SH_CODE}</code>
            </pre>
          </div>
        )}

        {/* VIEW 6: pump_controller.ino */}
        {activeTab === 'ino' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <span className="font-mono text-xs font-bold text-white">pump_controller.ino</span>
                <span className="text-[11px] text-slate-400">(Arduino C++ Firmware)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyCode(PUMP_CONTROLLER_INO_CODE, 'ino')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copied === 'ino' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'ino' ? 'Copied' : 'Copy Code'}
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[650px] leading-relaxed bg-slate-950/80 select-text">
              <code>{PUMP_CONTROLLER_INO_CODE}</code>
            </pre>
          </div>
        )}

        {/* VIEW 7: Why HTML Failed Guide */}
        {activeTab === 'why' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Why Your HTML Wasn&apos;t Loading &amp; How It&apos;s Fixed</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Here are the 4 issues that prevented your previous backend from hosting the HTML properly:
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4">
                <span className="font-bold text-red-400 uppercase tracking-wider block mb-1">Issue 1: Flask Missing Root File Mapping</span>
                <p className="text-slate-400 leading-relaxed">
                  By default, Flask looks for templates inside a <code>templates/</code> subfolder. With <code>kiosk.html</code> in the root folder, Flask returned a 404 error. The fixed <code>backend.py</code> maps <code>static_folder=&apos;.&apos;</code> and uses <code>send_file(&apos;kiosk.html&apos;)</code>.
                </p>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4">
                <span className="font-bold text-red-400 uppercase tracking-wider block mb-1">Issue 2: Chromium Race Condition in start.sh</span>
                <p className="text-slate-400 leading-relaxed">
                  In <code>start.sh</code>, Chromium was launched concurrently while Python was still importing modules. Chromium hit <code>ERR_CONNECTION_REFUSED</code> before port 5000 was open. The updated <code>start.sh</code> has a polling loop that verifies the server is listening before opening Chromium.
                </p>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4">
                <span className="font-bold text-red-400 uppercase tracking-wider block mb-1">Issue 3: Virtual Pumper Synchronization</span>
                <p className="text-slate-400 leading-relaxed">
                  When testing without physical hardware, running commands in test mode did not affect the main UI. We added an automatic Virtual Pumper Engine that runs inside <code>backend.py</code> (and in the browser), updating flow rates and pulses so both UIs stay synchronized.
                </p>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4">
                <span className="font-bold text-red-400 uppercase tracking-wider block mb-1">Issue 4: 0.0.0.0 Network Binding</span>
                <p className="text-slate-400 leading-relaxed">
                  Binding to <code>127.0.0.1</code> prevents remote displays and tablets from reaching the kiosk. The fixed <code>backend.py</code> binds to <code>0.0.0.0:5000</code>.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
