import React, { useState } from 'react';
import {
  Wrench,
  Terminal,
  Activity,
  Sliders,
  Send,
  Trash2,
  Zap,
  Power,
  Cpu,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';
import { usePump } from '../context/PumpContext.tsx';
import { sound } from '../utils/sound.ts';

export const TestModeView: React.FC = () => {
  const {
    telemetry,
    toggleRelay,
    setKFactor,
    serialLogs,
    sendSerialCommand,
    clearSerialLogs,
    connectionMode,
    portInfo,
    triggerEmergencyStop,
    resetEmergencyStop,
  } = usePump();

  // Terminal input state
  const [terminalInput, setTerminalInput] = useState('');

  // Calibration Wizard State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [measuredVolumeMl, setMeasuredVolumeMl] = useState<string>('500');
  const [calibStartPulses, setCalibStartPulses] = useState<number>(0);
  const [calibSuccess, setCalibSuccess] = useState<boolean>(false);

  const handleSendTerminal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    sendSerialCommand(terminalInput);
    setTerminalInput('');
  };

  const startCalibrationTest = () => {
    sound.playClick();
    setIsCalibrating(true);
    setCalibSuccess(false);
    setCalibStartPulses(telemetry.totalPulses);
    // Dispense test batch
    sendSerialCommand('START:500');
  };

  const finishCalibration = () => {
    sound.playClick();
    const actualMl = parseFloat(measuredVolumeMl);
    if (!actualMl || actualMl <= 0) return;

    const pulsesRecorded = telemetry.totalPulses - calibStartPulses;
    if (pulsesRecorded <= 0) {
      alert('No pulses were detected during calibration test. Ensure sensor is connected and pump is running.');
      return;
    }

    const newKFactor = Number((pulsesRecorded / actualMl).toFixed(3));
    setKFactor(newKFactor);
    setIsCalibrating(false);
    setCalibSuccess(true);
    sound.playSuccessChime();
  };

  const quickCommands = [
    { label: 'STATUS', cmd: 'STATUS' },
    { label: 'PING', cmd: 'PING' },
    { label: 'START 250mL', cmd: 'START:250' },
    { label: 'START 500mL', cmd: 'START:500' },
    { label: 'STOP PUMP', cmd: 'STOP' },
    { label: 'RELAY 1 ON', cmd: 'RELAY:1:ON' },
    { label: 'RELAY 1 OFF', cmd: 'RELAY:1:OFF' },
    { label: 'RELAY 2 ON', cmd: 'RELAY:2:ON' },
    { label: 'RELAY 2 OFF', cmd: 'RELAY:2:OFF' },
  ];

  return (
    <div className="flex flex-col flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 gap-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Technician Diagnostics &amp; Test Suite</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {connectionMode.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Direct hardware actuation, pulse calibration, and real-time serial monitor · {portInfo}
            </p>
          </div>
        </div>

        {/* Safety controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {telemetry.eStopTriggered ? (
            <button
              onClick={resetEmergencyStop}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Power className="w-3.5 h-3.5" /> Reset Safety Latch
            </button>
          ) : (
            <button
              onClick={triggerEmergencyStop}
              className="px-3.5 py-1.5 bg-red-950/80 border border-red-500/50 hover:bg-red-900 text-red-300 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Power className="w-3.5 h-3.5" /> Emergency Cutoff
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Manual Actuation & Calibration Suite */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          {/* Relay Actuation Card */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white">Manual Relay Actuation</h3>
              </div>
              <span className="text-xs text-slate-400">Hardware Pin 7 &amp; Pin 8</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Relay 1: Main Pump */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300">Relay 1: Main Pump</span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        telemetry.relay1Pump
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {telemetry.relay1Pump ? 'ENERGIZED' : 'OPEN / OFF'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-4">
                    Powers the 12V/24V high-pressure diaphragm pump motor.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleRelay(1)}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      telemetry.relay1Pump
                        ? 'bg-red-600 hover:bg-red-500 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {telemetry.relay1Pump ? 'Turn OFF' : 'Turn ON'}
                  </button>
                  <button
                    disabled={telemetry.relay1Pump}
                    onClick={() => {
                      toggleRelay(1, true);
                      setTimeout(() => toggleRelay(1, false), 1000);
                    }}
                    className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium text-slate-300 rounded-lg transition-colors"
                  >
                    1s Pulse
                  </button>
                </div>
              </div>

              {/* Relay 2: Solenoid Valve */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300">Relay 2: Solenoid Valve</span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        telemetry.relay2Valve
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {telemetry.relay2Valve ? 'OPEN (FLOW)' : 'CLOSED'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-4">
                    Controls anti-drip inlet/outlet electric solenoid gate.
                  </p>
                </div>

                <button
                  onClick={() => toggleRelay(2)}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    telemetry.relay2Valve
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {telemetry.relay2Valve ? 'Close Valve' : 'Open Valve'}
                </button>
              </div>
            </div>

            {/* Electrical Telemetry Bar */}
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-around text-xs text-slate-400">
              <div>
                <span>Bus Voltage: </span>
                <span className="font-mono font-bold text-white">{telemetry.voltage.toFixed(1)} V</span>
              </div>
              <div className="h-4 w-px bg-slate-800" />
              <div>
                <span>Draw Current: </span>
                <span className="font-mono font-bold text-white">{telemetry.currentAmps.toFixed(2)} A</span>
              </div>
              <div className="h-4 w-px bg-slate-800" />
              <div>
                <span>Flow Rate: </span>
                <span className="font-mono font-bold text-emerald-400">{telemetry.flowRateLMin.toFixed(2)} L/min</span>
              </div>
            </div>
          </div>

          {/* Sensor Pulse & K-Factor Calibration Wizard */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Flow Sensor &amp; K-Factor Calibration</h3>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                {telemetry.kFactor} pulses/mL ({telemetry.kFactor * 1000} p/L)
              </span>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Calibrate the Hall-effect turbine pulse counter (YF-S201 or similar) to ensure millimeter-accurate dispensing.
            </p>

            {calibSuccess && (
              <div className="mb-4 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 p-3 rounded-lg flex items-center gap-2 text-xs">
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>K-Factor successfully recalculated and synced to controller!</span>
              </div>
            )}

            {/* Quick Calibration Wizard */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider block mb-2">
                Step-by-Step Calibration Wizard
              </span>

              {!isCalibrating ? (
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-slate-400 space-y-1">
                    <p>1. Place a graduated cylinder or measuring jug under the nozzle.</p>
                    <p>2. Click &quot;Start Calibration Test&quot; to dispense a test sample batch.</p>
                    <p>3. Input the exact liquid volume read from the graduated cylinder.</p>
                  </div>
                  <button
                    onClick={startCalibrationTest}
                    className="py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg text-xs transition-colors self-start cursor-pointer"
                  >
                    Start Calibration Test (500 mL batch)
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="bg-sky-950/40 border border-sky-800/40 p-3 rounded-lg text-xs text-sky-200">
                    Dispensing sample batch... Pulses detected:{' '}
                    <strong className="font-mono text-white">
                      {telemetry.totalPulses - calibStartPulses}
                    </strong>
                  </div>

                  <div className="flex items-center gap-3">
                    <label htmlFor="graduated-reading-input" className="text-xs text-slate-300 whitespace-nowrap">
                      Graduated Cylinder Reading:
                    </label>
                    <div className="relative flex-1">
                      <input
                        id="graduated-reading-input"
                        type="number"
                        value={measuredVolumeMl}
                        onChange={e => setMeasuredVolumeMl(e.target.value)}
                        placeholder="e.g. 505"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                      />
                      <span className="absolute right-3 top-1.5 text-xs text-slate-400">mL</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={finishCalibration}
                      className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      Calculate &amp; Save K-Factor
                    </button>
                    <button
                      onClick={() => setIsCalibrating(false)}
                      className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Direct manual K-factor input */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400">Manual Override K-Factor:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setKFactor(4.5)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
                >
                  Standard YF-S201 (4.5)
                </button>
                <button
                  onClick={() => setKFactor(5.85)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
                >
                  YF-S401 (5.85)
                </button>
              </div>
            </div>
          </div>

          {/* Microcontroller Pinout Reference Card */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-white">Hardware Pinout Specification</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="font-mono text-purple-300 font-bold">PIN 2 (INT0)</span>
                <p className="text-[11px] text-slate-400">Flow Sensor Yellow Pulse Line</p>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="font-mono text-sky-300 font-bold">PIN 7 (OUTPUT)</span>
                <p className="text-[11px] text-slate-400">Relay 1 (Pump Control Gate)</p>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="font-mono text-emerald-300 font-bold">PIN 8 (OUTPUT)</span>
                <p className="text-[11px] text-slate-400">Relay 2 (Solenoid Valve Gate)</p>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="font-mono text-amber-300 font-bold">PIN A0 (ANALOG)</span>
                <p className="text-[11px] text-slate-400">Tank Reservoir Level Sensor</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Real-Time Serial Monitor Console */}
        <div className="lg:col-span-6 flex flex-col bg-slate-900/80 border border-slate-800 rounded-xl shadow-lg overflow-hidden">
          {/* Terminal Header */}
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold text-slate-200">
                Serial Terminal (115200 Baud)
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={clearSerialLogs}
                className="text-xs text-slate-400 hover:text-slate-200 p-1 transition-colors flex items-center gap-1"
                title="Clear Logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="text-[11px]">Clear</span>
              </button>
            </div>
          </div>

          {/* Quick Macro Action Row */}
          <div className="p-2 bg-slate-950/50 border-b border-slate-800 flex flex-wrap gap-1.5">
            {quickCommands.map(item => (
              <button
                key={item.label}
                onClick={() => sendSerialCommand(item.cmd)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px] rounded transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Terminal Output Area */}
          <div className="h-96 overflow-y-auto p-3 font-mono text-xs bg-slate-950 text-slate-300 space-y-1 select-text">
            {serialLogs.length === 0 ? (
              <div className="text-slate-600 italic py-8 text-center">
                Terminal ready. Awaiting serial traffic or commands...
              </div>
            ) : (
              serialLogs.map(log => {
                let badgeClass = 'text-slate-500';
                let tag = 'SYS';
                let textClass = 'text-slate-400';

                if (log.direction === 'in') {
                  badgeClass = 'text-emerald-400';
                  tag = 'RX ←';
                  textClass = 'text-emerald-300';
                } else if (log.direction === 'out') {
                  badgeClass = 'text-amber-400';
                  tag = 'TX →';
                  textClass = 'text-amber-200';
                } else {
                  badgeClass = 'text-sky-400';
                  tag = 'SYS';
                  textClass = 'text-sky-300';
                }

                return (
                  <div key={log.id} className="flex items-start gap-2 hover:bg-slate-900/60 px-1 py-0.5 rounded">
                    <span className="text-[10px] text-slate-600 select-none">{log.timestamp}</span>
                    <span className={`text-[10px] font-bold ${badgeClass} select-none w-10 shrink-0`}>
                      {tag}
                    </span>
                    <span className={`break-all ${textClass}`}>{log.data}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Command Input Form */}
          <form onSubmit={handleSendTerminal} className="p-3 bg-slate-950 border-t border-slate-800 flex items-center gap-2">
            <span className="font-mono text-xs text-emerald-400 font-bold select-none">&gt;</span>
            <input
              type="text"
              value={terminalInput}
              onChange={e => setTerminalInput(e.target.value)}
              placeholder="Type command (e.g. STATUS, START:500, STOP, CALIB:4.5)..."
              className="flex-1 bg-transparent border-none text-xs font-mono text-white focus:outline-none placeholder:text-slate-600"
            />
            <button
              type="submit"
              disabled={!terminalInput.trim()}
              className="p-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white rounded transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
