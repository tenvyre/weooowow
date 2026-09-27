import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  AlertOctagon,
  Droplet,
  Volume2,
  VolumeX,
  Gauge,
  History,
  CheckCircle2,
  AlertTriangle,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { usePump, FLUID_PRESETS } from '../context/PumpContext.tsx';
import { sound } from '../utils/sound.ts';

const PRESET_VOLUMES = [
  { id: 'cup', name: 'Glass Cup', ml: 250, label: '250 mL' },
  { id: 'bottle', name: 'Water Bottle', ml: 500, label: '500 mL' },
  { id: 'flask', name: 'Sports Flask', ml: 750, label: '750 mL' },
  { id: 'liter', name: '1.0L Pitcher', ml: 1000, label: '1,000 mL' },
  { id: 'growler', name: '2.0L Jug', ml: 2000, label: '2,000 mL' },
  { id: 'gallon', name: 'Bulk Dispense', ml: 3800, label: '3,800 mL' },
];

export const KioskView: React.FC = () => {
  const {
    telemetry,
    dispenseStatus,
    targetVolume,
    setTargetVolume,
    activeFluid,
    setActiveFluid,
    startDispense,
    pauseDispense,
    resumeDispense,
    cancelDispense,
    triggerEmergencyStop,
    resetEmergencyStop,
    refillTank,
    dispenseHistory,
    isMuted,
    toggleMute,
  } = usePump();

  const [showHistory, setShowHistory] = useState(false);
  const [customInputOpen, setCustomInputOpen] = useState(false);

  const progressPercent = Math.min(
    100,
    Math.round((telemetry.dispensedMl / (targetVolume || 1)) * 100)
  );

  const tankPercent = Math.min(
    100,
    Math.round((telemetry.tankRemainingMl / telemetry.tankCapacityMl) * 100)
  );

  const isDispensing = dispenseStatus === 'dispensing';
  const isPaused = dispenseStatus === 'paused';
  const isCompleted = dispenseStatus === 'completed';
  const isEStopped = telemetry.eStopTriggered;

  const handleAdjustVolume = (delta: number) => {
    sound.playClick();
    setTargetVolume(targetVolume + delta);
  };

  return (
    <div className="flex flex-col flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 gap-6 select-none">
      {/* Top Kiosk Alert Banner if E-Stop or Low Tank */}
      {isEStopped && (
        <div className="bg-red-500/10 border-2 border-red-500 text-red-400 p-4 rounded-xl flex items-center justify-between shadow-lg animate-pulse">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-8 h-8 text-red-500 shrink-0" />
            <div>
              <h3 className="font-bold text-lg text-red-200">EMERGENCY STOP TRIPPED</h3>
              <p className="text-sm text-red-300">
                Pump relay and flow valve have been forced offline. Check area and reset below.
              </p>
            </div>
          </div>
          <button
            onClick={resetEmergencyStop}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg shadow-md transition-all active:scale-95 text-sm uppercase tracking-wider"
          >
            Reset Safety Latch
          </button>
        </div>
      )}

      {telemetry.tankRemainingMl <= 1000 && !isEStopped && (
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 p-3 rounded-xl flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>Low Fluid Warning: Reservoir below 1,000 mL ({tankPercent}% capacity).</span>
          </div>
          <button
            onClick={refillTank}
            className="px-3 py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 font-medium rounded border border-amber-500/30 transition-all flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refill Reservoir
          </button>
        </div>
      )}

      {/* Main Kiosk Surface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch">
        {/* Left Column: Liquid Selection & Volume Presets */}
        <div className="lg:col-span-4 flex flex-col gap-5 bg-slate-900/70 backdrop-blur border border-slate-800 rounded-2xl p-5 shadow-xl">
          {/* Fluid Type Tabs */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                1. Select Beverage / Fluid
              </span>
              <button
                onClick={toggleMute}
                className="text-slate-400 hover:text-slate-200 p-1 rounded transition-colors"
                title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                aria-label="Toggle Sound"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FLUID_PRESETS.map(fluid => {
                const isSelected = activeFluid.id === fluid.id;
                return (
                  <button
                    key={fluid.id}
                    disabled={isDispensing}
                    onClick={() => {
                      sound.playClick();
                      setActiveFluid(fluid);
                    }}
                    className={`p-3 rounded-xl text-left border transition-all ${
                      isSelected
                        ? 'border-sky-500 bg-sky-950/40 text-white shadow-sm ring-1 ring-sky-500/50'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700 hover:bg-slate-800/40'
                    } ${isDispensing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: fluid.color }}
                      />
                      <span className="font-medium text-sm truncate">{fluid.name}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-1 leading-tight">
                      {fluid.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Volume Presets */}
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  2. Choose Target Volume
                </span>
                <button
                  disabled={isDispensing}
                  onClick={() => setCustomInputOpen(!customInputOpen)}
                  className="text-xs text-sky-400 hover:text-sky-300 transition-colors font-medium"
                >
                  {customInputOpen ? 'Presets' : 'Custom Input'}
                </button>
              </div>

              {!customInputOpen ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {PRESET_VOLUMES.map(preset => {
                    const isSelected = targetVolume === preset.ml;
                    return (
                      <button
                        key={preset.id}
                        disabled={isDispensing}
                        onClick={() => {
                          sound.playClick();
                          setTargetVolume(preset.ml);
                        }}
                        className={`py-3 px-3.5 rounded-xl border text-left flex flex-col transition-all active:scale-[0.98] ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-950/30 text-white ring-1 ring-emerald-500/40'
                            : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700 hover:bg-slate-800/30'
                        } ${isDispensing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <span className="text-base font-bold tracking-tight text-white">
                          {preset.label}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Exact Milliliters</span>
                    <span className="text-lg font-mono font-bold text-white">
                      {targetVolume} <span className="text-xs text-slate-400 font-normal">mL</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="5000"
                    step="50"
                    disabled={isDispensing}
                    value={targetVolume}
                    onChange={e => setTargetVolume(parseInt(e.target.value, 10))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>50 mL</span>
                    <span>1,000 mL</span>
                    <span>2,500 mL</span>
                    <span>5,000 mL</span>
                  </div>
                </div>
              )}
            </div>

            {/* Stepper adjustment controls */}
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Fine Tune Volume:</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={isDispensing || targetVolume <= 50}
                  onClick={() => handleAdjustVolume(-50)}
                  className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors font-bold"
                  aria-label="Decrease 50 mL"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="w-20 text-center font-mono font-bold text-sm text-white">
                  {targetVolume} mL
                </div>
                <button
                  disabled={isDispensing || targetVolume >= 10000}
                  onClick={() => handleAdjustVolume(50)}
                  className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors font-bold"
                  aria-label="Increase 50 mL"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Center Column: Fluid Simulation & Visual Dispenser Vessel */}
        <div className="lg:col-span-5 flex flex-col justify-between bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          {/* Subtle background glow */}
          <div
            className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10 blur-3xl pointer-events-none transition-colors duration-500"
            style={{ backgroundColor: activeFluid.color }}
          />

          {/* Chamber Header */}
          <div className="flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <Droplet className="w-5 h-5 text-sky-400 animate-pulse" />
              <div>
                <h2 className="text-base font-bold text-white tracking-wide">
                  Dispense Chamber
                </h2>
                <span className="text-xs text-slate-400">
                  {activeFluid.name} · Target {targetVolume} mL
                </span>
              </div>
            </div>

            {/* Live Flow Rate Gauge */}
            <div className="flex items-center gap-2 bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800">
              <Gauge className="w-4 h-4 text-emerald-400" />
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-emerald-300">
                  {telemetry.flowRateLMin.toFixed(2)} <span className="text-[10px] text-slate-400">L/min</span>
                </div>
                <div className="text-[10px] text-slate-400">Flow Rate</div>
              </div>
            </div>
          </div>

          {/* Liquid Vessel Container Graphic */}
          <div className="my-6 flex flex-col items-center justify-center z-10">
            <div className="relative w-64 h-80 bg-slate-950/90 border-4 border-slate-700 rounded-b-3xl rounded-t-lg shadow-2xl flex flex-col justify-end p-2 overflow-hidden">
              {/* Glass reflection gradient highlight */}
              <div className="absolute inset-y-0 left-2 w-4 bg-gradient-to-r from-white/10 to-transparent pointer-events-none z-20 rounded-l" />
              <div className="absolute inset-y-0 right-2 w-2 bg-gradient-to-l from-white/5 to-transparent pointer-events-none z-20" />

              {/* Measurement ticks on vessel wall */}
              <div className="absolute right-3 inset-y-6 flex flex-col justify-between text-[10px] font-mono text-slate-500 select-none z-20">
                <span>{targetVolume}mL</span>
                <span>{Math.round(targetVolume * 0.75)}mL</span>
                <span>{Math.round(targetVolume * 0.5)}mL</span>
                <span>{Math.round(targetVolume * 0.25)}mL</span>
                <span>0mL</span>
              </div>

              {/* Nozzle Stream Animation when dispensing */}
              {isDispensing && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 bg-sky-300/80 animate-pulse z-30 rounded-b shadow-[0_0_12px_rgba(56,189,248,0.8)]"
                  style={{
                    height: `${Math.max(0, 100 - progressPercent)}%`,
                    backgroundColor: activeFluid.waveColor,
                  }}
                />
              )}

              {/* Liquid Level Body */}
              <div
                className="w-full transition-all duration-200 relative rounded-b-2xl overflow-hidden"
                style={{
                  height: `${Math.max(4, progressPercent)}%`,
                  backgroundColor: activeFluid.color,
                }}
              >
                {/* Surface Wave Effect */}
                <div
                  className={`absolute top-0 inset-x-0 h-3 opacity-80 ${isDispensing ? 'animate-bounce' : ''}`}
                  style={{ backgroundColor: activeFluid.waveColor }}
                />

                {/* Animated Rising Bubbles */}
                {isDispensing && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <span className="absolute bottom-2 left-1/4 w-2 h-2 rounded-full bg-white/40 animate-ping" />
                    <span className="absolute bottom-6 left-1/2 w-3 h-3 rounded-full bg-white/30 animate-pulse" />
                    <span className="absolute bottom-1 right-1/3 w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" />
                  </div>
                )}
              </div>

              {/* Water Volume Digital Overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20">
                <div className="text-4xl font-mono font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                  {Math.round(telemetry.dispensedMl)}
                </div>
                <div className="text-xs uppercase tracking-widest font-semibold text-slate-200/90 drop-shadow">
                  of {targetVolume} mL
                </div>
                <div className="mt-1 text-sm font-bold text-white/90 drop-shadow">
                  {progressPercent}%
                </div>
              </div>
            </div>

            {/* Status Text Badge */}
            <div className="mt-3 text-center">
              {isDispensing && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-500/30 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  Dispensing In Progress...
                </span>
              )}
              {isPaused && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-950/60 px-3 py-1 rounded-full border border-amber-500/30">
                  Dispense Paused
                </span>
              )}
              {isCompleted && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 bg-sky-950/60 px-3 py-1 rounded-full border border-sky-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Dispense Complete! Enjoy.
                </span>
              )}
              {!isDispensing && !isPaused && !isCompleted && !isEStopped && (
                <span className="text-xs text-slate-400">
                  Ready · Place container under nozzle and press Start
                </span>
              )}
            </div>
          </div>

          {/* Progress Bar & Telemetry Footer */}
          <div className="z-10 bg-slate-950/60 border border-slate-800/80 p-3 rounded-xl flex items-center justify-between text-xs text-slate-400">
            <div>
              <span>Pulses: </span>
              <strong className="text-slate-200 font-mono">{telemetry.totalPulses}</strong>
            </div>
            <div>
              <span>Pump Relay: </span>
              <strong className={telemetry.relay1Pump ? 'text-emerald-400 font-mono' : 'text-slate-500 font-mono'}>
                {telemetry.relay1Pump ? 'ACTIVE' : 'OFF'}
              </strong>
            </div>
            <div>
              <span>Current: </span>
              <strong className="text-slate-200 font-mono">{telemetry.currentAmps.toFixed(2)} A</strong>
            </div>
          </div>
        </div>

        {/* Right Column: Tactile Control Buttons, E-Stop, and Hardware Info */}
        <div className="lg:col-span-3 flex flex-col justify-between gap-5 bg-slate-900/70 backdrop-blur border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 block">
              3. Dispense Controls
            </span>

            {/* Primary Action Buttons */}
            <div className="flex flex-col gap-3">
              {!isDispensing && !isPaused ? (
                <button
                  disabled={isEStopped || telemetry.tankRemainingMl <= 100}
                  onClick={startDispense}
                  className="w-full py-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-3 transition-all active:scale-[0.98] border border-emerald-400/40 cursor-pointer"
                >
                  <Play className="w-6 h-6 fill-white" />
                  START DISPENSE
                </button>
              ) : isDispensing ? (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={pauseDispense}
                    className="w-full py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-base shadow-md flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] border border-amber-400/40 cursor-pointer"
                  >
                    <Pause className="w-5 h-5 fill-white" />
                    PAUSE DISPENSE
                  </button>
                  <button
                    onClick={cancelDispense}
                    className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-slate-700 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Cancel &amp; Reset
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={resumeDispense}
                    className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base shadow-md flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] border border-emerald-400/40 cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-white" />
                    RESUME DISPENSE
                  </button>
                  <button
                    onClick={cancelDispense}
                    className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-slate-700 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Tank Capacity Monitor Widget */}
            <div className="mt-6 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-400">Reservoir Level</span>
                <span className="text-xs font-mono font-bold text-white">
                  {(telemetry.tankRemainingMl / 1000).toFixed(1)} / {(telemetry.tankCapacityMl / 1000).toFixed(0)} L
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    tankPercent > 30 ? 'bg-sky-500' : tankPercent > 15 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${tankPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{tankPercent}% Remaining</span>
                <button
                  onClick={refillTank}
                  className="text-sky-400 hover:text-sky-300 transition-colors font-medium flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refill
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Section: Emergency Stop Button */}
          <div className="pt-4 border-t border-slate-800/80">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400/80 mb-2 block text-center">
              Safety Cutoff Switch
            </span>
            <button
              onClick={triggerEmergencyStop}
              className="w-full py-4 rounded-xl bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-black tracking-widest text-base shadow-xl shadow-red-950/60 border-2 border-red-400/50 flex items-center justify-center gap-2.5 transition-all active:scale-95 cursor-pointer uppercase"
            >
              <AlertOctagon className="w-5 h-5 fill-white text-red-600" />
              EMERGENCY STOP
            </button>
            <p className="text-[10px] text-center text-slate-400 mt-2">
              Instantly de-energizes pump relay and closes solenoid valve.
            </p>
          </div>
        </div>
      </div>

      {/* Dispense History Drawer / Table Modal */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-200">Recent Dispense Activity</h3>
            <span className="text-xs text-slate-400 font-mono">({dispenseHistory.length} records)</span>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-sky-400 hover:text-sky-300 font-medium transition-colors"
          >
            {showHistory ? 'Collapse' : 'Expand History'}
          </button>
        </div>

        {showHistory && (
          <div className="overflow-x-auto">
            {dispenseHistory.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">No dispense records yet in this session.</p>
            ) : (
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-3">Fluid</th>
                    <th className="py-2 px-3">Target</th>
                    <th className="py-2 px-3">Actual Dispensed</th>
                    <th className="py-2 px-3">Duration</th>
                    <th className="py-2 px-3">Pulses</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {dispenseHistory.slice(0, 8).map(record => (
                    <tr key={record.id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-mono text-slate-400">{record.timestamp}</td>
                      <td className="py-2 px-3 font-medium text-white">{record.fluidName}</td>
                      <td className="py-2 px-3 font-mono">{record.targetMl} mL</td>
                      <td className="py-2 px-3 font-mono text-emerald-400 font-semibold">{record.actualMl} mL</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{record.durationSeconds}s</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{record.pulses}</td>
                      <td className="py-2 px-3">
                        <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/20">
                          {record.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
