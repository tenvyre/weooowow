# Smart Pump Controller & Dispensing Kiosk

Automated liquid dispensing kiosk with Web Serial Arduino integration and built-in Virtual Pumper simulation engine.

## File Structure

```text
├── backend.py            # Python Flask server & Virtual Pumper hardware bridge
├── start.sh              # Bash autostart & Chromium kiosk launcher for Raspberry Pi/Linux
├── kiosk.html            # Customer-facing touch kiosk interface
├── test_mode.html        # Technician diagnostic, relay actuation, and pulse calibration
├── pump_controller.ino   # Arduino firmware (Hall-effect flow sensor on Pin 2, Relays on Pins 7 & 8)
└── README.md             # This guide
```

## How the Virtual Pumper Connects to the Main UI

1. **Integrated Simulation Engine**:
   - If no physical Arduino board is connected to USB, `backend.py` automatically runs the **Virtual Pumper Hardware Engine**.
   - When a test is triggered from `test_mode.html` (e.g. Turn Relay 1 ON, 1s test pulse, dispense 250mL / 500mL), `backend.py` simulates liquid flow (~2.85 L/min), increments pulse counts based on the K-factor, and updates `/api/status` at 10Hz.
   - `kiosk.html` polls this endpoint and listens to browser `BroadcastChannel` events, immediately showing the fluid chamber filling up, the animated flow rate, and the pump running in real time!

2. **Zero-Driver Web Serial USB Support (Direct in Browser)**:
   - You can also flash `pump_controller.ino` to an Arduino UNO/Nano, plug it into your computer/Pi via USB, open `kiosk.html` in Chrome/Edge, and click **Connect Hardware** to control the physical pump without any drivers.

## Running on Raspberry Pi / Linux

```bash
# 1. Install dependencies
pip3 install flask flask-cors pyserial

# 2. Make start script executable
chmod +x start.sh

# 3. Launch the kiosk
./start.sh
```

## Running Manually

```bash
python3 backend.py
```
Then visit:
- **Kiosk Mode**: `http://localhost:5000/` or `http://localhost:5000/kiosk.html`
- **Test & Calibration**: `http://localhost:5000/test_mode.html`
