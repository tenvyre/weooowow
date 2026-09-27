import React, { useState } from 'react';
import {
  Droplets,
  Wrench,
  FileCode,
  Usb,
  Volume2,
  VolumeX,
  RefreshCw,
  Cpu,
  Wifi,
  Radio,
  ChevronDown,
} from 'lucide-react';
import { usePump } from '../context/PumpContext.tsx';

interface NavbarProps {
  activeView: 'kiosk' | 'test' | 'code';
  setActiveView: (view: 'kiosk' | 'test' | 'code') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeView, setActiveView }) => {
  const {
    connectionMode,
    setConnectionMode,
    isSerialSupported,
    isConnected,
    portInfo,
    connectSerial,
    disconnectSerial,
    connectWebSocket,
    disconnectWebSocket,
    wsUrl,
    setWsUrl,
    telemetry,
    refillTank,
    isMuted,
    toggleMute,
  } = usePump();

  const [showConnModal, setShowConnModal] = useState(false);

  const tankPercent = Math.min(
    100,
    Math.round((telemetry.tankRemainingMl / telemetry.tankCapacityMl) * 100)
  );

  return (
    <header className="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-50 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md shadow-sky-900/30">
            <Droplets className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
              Smart Pump Controller
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800/60">
                v2.1
              </span>
            </h1>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Dispensing Kiosk &amp; Hardware Diagnostics
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <nav className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveView('kiosk')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeView === 'kiosk'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            <span>Kiosk Mode</span>
          </button>
          <button
            onClick={() => setActiveView('test')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeView === 'test'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Test Mode</span>
          </button>
          <button
            onClick={() => setActiveView('code')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeView === 'code'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Firmware &amp; Scripts</span>
            <span className="sm:hidden">Files</span>
          </button>
        </nav>

        {/* Right Status & Connection Controls */}
        <div className="flex items-center gap-2.5">
          {/* Tank Level Quick Badge */}
          <div
            onClick={refillTank}
            className="hidden md:flex items-center gap-2 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs cursor-pointer hover:border-slate-700 transition-colors"
            title="Click to Refill Tank"
          >
            <div className="w-2 h-2 rounded-full bg-sky-400" />
            <span className="text-slate-400">Tank:</span>
            <span className="font-mono font-bold text-white">{tankPercent}%</span>
            <RefreshCw className="w-3 h-3 text-slate-500 hover:text-sky-400" />
          </div>

          {/* Hardware Connection Dropdown / Trigger */}
          <div className="relative">
            <button
              onClick={() => setShowConnModal(!showConnModal)}
              className="flex items-center gap-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span className="font-medium text-slate-200 hidden sm:inline">
                {connectionMode === 'web_serial'
                  ? 'Web Serial USB'
                  : connectionMode === 'backend_ws'
                  ? 'Local Backend'
                  : 'Simulator'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* Connection Modal / Popover */}
            {showConnModal && (
              <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-4 text-xs z-50">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                    Hardware Connection
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {portInfo || 'Disconnected'}
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Option 1: Hardware Simulator */}
                  <div
                    onClick={() => {
                      if (connectionMode === 'web_serial') disconnectSerial();
                      if (connectionMode === 'backend_ws') disconnectWebSocket();
                      setConnectionMode('simulator');
                      setShowConnModal(false);
                    }}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                      connectionMode === 'simulator'
                        ? 'border-emerald-500/60 bg-emerald-950/30 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <Cpu className="w-4 h-4 text-emerald-400" />
                      <span>Built-in Simulator</span>
                      {connectionMode === 'simulator' && (
                        <span className="ml-auto text-[10px] text-emerald-400 font-mono">ACTIVE</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Simulates pump motor, flow pulses, and tank hydraulics in the browser.
                    </p>
                  </div>

                  {/* Option 2: Web Serial API (Direct USB Arduino) */}
                  <div
                    className={`p-2.5 rounded-lg border transition-all ${
                      connectionMode === 'web_serial'
                        ? 'border-sky-500/60 bg-sky-950/30 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <div className="flex items-center gap-2">
                        <Usb className="w-4 h-4 text-sky-400" />
                        <span>Web Serial (USB Arduino)</span>
                      </div>
                      {connectionMode === 'web_serial' && (
                        <span className="text-[10px] text-sky-400 font-mono">CONNECTED</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 mb-2">
                      Connects directly to Arduino on USB COM port at 115200 baud.
                    </p>

                    {connectionMode !== 'web_serial' ? (
                      <button
                        onClick={async () => {
                          const ok = await connectSerial();
                          if (ok) setShowConnModal(false);
                        }}
                        disabled={!isSerialSupported}
                        className="w-full py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-medium rounded text-xs transition-colors cursor-pointer"
                      >
                        {isSerialSupported ? 'Connect USB Arduino' : 'Web Serial Not Supported'}
                      </button>
                    ) : (
                      <button
                        onClick={() => disconnectSerial()}
                        className="w-full py-1.5 bg-red-600/80 hover:bg-red-600 text-white font-medium rounded text-xs transition-colors cursor-pointer"
                      >
                        Disconnect USB Port
                      </button>
                    )}
                  </div>

                  {/* Option 3: Local Python Backend (backend.py WebSocket) */}
                  <div
                    className={`p-2.5 rounded-lg border transition-all ${
                      connectionMode === 'backend_ws'
                        ? 'border-purple-500/60 bg-purple-950/30 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <div className="flex items-center gap-2">
                        <Wifi className="w-4 h-4 text-purple-400" />
                        <span>Local Backend WebSocket</span>
                      </div>
                      {connectionMode === 'backend_ws' && (
                        <span className="text-[10px] text-purple-400 font-mono">CONNECTED</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 mb-2">
                      Connect to your local <code>backend.py</code> server.
                    </p>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={wsUrl}
                        onChange={e => setWsUrl(e.target.value)}
                        placeholder="ws://localhost:8765"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white font-mono"
                      />
                      {connectionMode !== 'backend_ws' ? (
                        <button
                          onClick={() => {
                            connectWebSocket(wsUrl);
                            setShowConnModal(false);
                          }}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium text-[11px] cursor-pointer"
                        >
                          Connect
                        </button>
                      ) : (
                        <button
                          onClick={() => disconnectWebSocket()}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-[11px] cursor-pointer"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowConnModal(false)}
                  className="w-full mt-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-center text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>

          {/* Sound Mute Toggle */}
          <button
            onClick={toggleMute}
            className="p-2 text-slate-400 hover:text-slate-200 bg-slate-950 border border-slate-800 rounded-lg transition-colors cursor-pointer"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            aria-label="Toggle Sound"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>
      </div>
    </header>
  );
};
