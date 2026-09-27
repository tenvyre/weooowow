import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  DispenseStatus,
  ConnectionMode,
  PumpTelemetry,
  SerialLogEntry,
  DispenseRecord,
  FluidType,
} from '../types/pump.ts';
import { sound } from '../utils/sound.ts';

export const FLUID_PRESETS: FluidType[] = [
  {
    id: 'water',
    name: 'Purified Water',
    color: '#0284c7', // Sky-600
    textColor: '#e0f2fe',
    waveColor: '#38bdf8',
    description: 'Ambient 5-stage filtered drinking water',
    defaultFlowRateLMin: 2.8,
  },
  {
    id: 'chilled_water',
    name: 'Chilled RO Water',
    color: '#0369a1',
    textColor: '#e0f2fe',
    waveColor: '#0ea5e9',
    description: 'Cold 4°C reverse osmosis purified water',
    defaultFlowRateLMin: 2.6,
  },
  {
    id: 'electrolyte',
    name: 'Electrolyte Mineral',
    color: '#059669', // Emerald
    textColor: '#d1fae5',
    waveColor: '#34d399',
    description: 'Infused potassium & magnesium mineral water',
    defaultFlowRateLMin: 2.7,
  },
  {
    id: 'sanitizer',
    name: 'Sanitizing Solution',
    color: '#7c3aed', // Purple
    textColor: '#ede9fe',
    waveColor: '#a78bfa',
    description: 'Food-grade sanitizing liquid for line wash',
    defaultFlowRateLMin: 2.2,
  },
];

interface PumpContextValue {
  connectionMode: ConnectionMode;
  setConnectionMode: (mode: ConnectionMode) => void;
  isSerialSupported: boolean;
  isConnected: boolean;
  portInfo: string | null;
  connectSerial: () => Promise<boolean>;
  disconnectSerial: () => Promise<void>;
  connectWebSocket: (url: string) => void;
  disconnectWebSocket: () => void;
  wsUrl: string;
  setWsUrl: (url: string) => void;
  telemetry: PumpTelemetry;
  dispenseStatus: DispenseStatus;
  targetVolume: number;
  setTargetVolume: (ml: number) => void;
  activeFluid: FluidType;
  setActiveFluid: (f: FluidType) => void;
  startDispense: () => void;
  pauseDispense: () => void;
  resumeDispense: () => void;
  cancelDispense: () => void;
  triggerEmergencyStop: () => void;
  resetEmergencyStop: () => void;
  toggleRelay: (relayNum: 1 | 2, forceState?: boolean) => void;
  setKFactor: (factor: number) => void;
  refillTank: () => void;
  serialLogs: SerialLogEntry[];
  sendSerialCommand: (cmd: string) => void;
  clearSerialLogs: () => void;
  dispenseHistory: DispenseRecord[];
  clearHistory: () => void;
  isMuted: boolean;
  toggleMute: () => void;
}

const PumpContext = createContext<PumpContextValue | undefined>(undefined);

const INITIAL_TELEMETRY: PumpTelemetry = {
  flowRateLMin: 0,
  dispensedMl: 0,
  targetMl: 500,
  totalPulses: 0,
  tankRemainingMl: 18500,
  tankCapacityMl: 20000,
  relay1Pump: false,
  relay2Valve: false,
  kFactor: 4.5, // 4.5 pulses per mL = 4500 pulses/L (YF-S201 sensor standard)
  eStopTriggered: false,
  voltage: 12.1,
  currentAmps: 0.05,
  errorCode: null,
  lastUpdated: Date.now(),
};

export const PumpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('simulator');
  const [isSerialSupported, setIsSerialSupported] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(true); // simulator is connected by default
  const [portInfo, setPortInfo] = useState<string | null>('Hardware Simulator (Active)');
  const [wsUrl, setWsUrl] = useState<string>('ws://localhost:8765');
  const [telemetry, setTelemetry] = useState<PumpTelemetry>(() => {
    const saved = localStorage.getItem('pump_kfactor');
    return saved ? { ...INITIAL_TELEMETRY, kFactor: parseFloat(saved) || 4.5 } : INITIAL_TELEMETRY;
  });
  const [dispenseStatus, setDispenseStatus] = useState<DispenseStatus>('idle');
  const [targetVolume, setTargetVolumeState] = useState<number>(500);
  const [activeFluid, setActiveFluid] = useState<FluidType>(FLUID_PRESETS[0]);
  const [serialLogs, setSerialLogs] = useState<SerialLogEntry[]>([]);
  const [dispenseHistory, setDispenseHistory] = useState<DispenseRecord[]>(() => {
    try {
      const saved = localStorage.getItem('pump_dispense_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Web Serial refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serialPortRef = useRef<any>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const serialWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Dispense tracking refs
  const dispenseStartTimeRef = useRef<number>(0);
  const dispenseStartVolumeRef = useRef<number>(0);
  const statusRef = useRef<DispenseStatus>('idle');
  statusRef.current = dispenseStatus;

  // Check Web Serial support
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serial' in navigator) {
      setIsSerialSupported(true);
    }
  }, []);

  const addLog = useCallback((direction: 'in' | 'out' | 'sys', data: string, raw?: string) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    setSerialLogs(prev => [
      ...prev.slice(-199),
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: timeStr,
        direction,
        data,
        raw,
      },
    ]);
  }, []);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    sound.setMuted(next);
  };

  const setTargetVolume = (ml: number) => {
    const clamped = Math.max(50, Math.min(20000, Math.round(ml)));
    setTargetVolumeState(clamped);
    setTelemetry(prev => ({ ...prev, targetMl: clamped }));
  };

  const setKFactor = (factor: number) => {
    const f = Math.max(0.1, Number(factor.toFixed(3)));
    setTelemetry(prev => ({ ...prev, kFactor: f }));
    localStorage.setItem('pump_kfactor', f.toString());
    sendSerialCommand(`CALIB:${f}`);
    addLog('sys', `K-factor calibrated to ${f} pulses/mL`);
  };

  const refillTank = () => {
    sound.playClick();
    setTelemetry(prev => ({
      ...prev,
      tankRemainingMl: prev.tankCapacityMl,
      errorCode: null,
    }));
    addLog('sys', 'Tank refilled to capacity (20,000 mL)');
  };

  const clearSerialLogs = () => setSerialLogs([]);

  const clearHistory = () => {
    setDispenseHistory([]);
    localStorage.removeItem('pump_dispense_history');
  };

  // Hardware command dispatcher
  const sendSerialCommand = useCallback((cmd: string) => {
    const cleanCmd = cmd.trim();
    if (!cleanCmd) return;

    addLog('out', cleanCmd);

    // If connected via Web Serial
    if (connectionMode === 'web_serial' && serialWriterRef.current) {
      serialWriterRef.current.write(cleanCmd + '\n').catch(err => {
        addLog('sys', `Serial Write Error: ${err.message}`);
      });
      return;
    }

    // If connected via WebSocket
    if (connectionMode === 'backend_ws' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(cleanCmd);
      return;
    }

    // If Simulator
    if (connectionMode === 'simulator') {
      handleSimulatorCommand(cleanCmd);
    }
  }, [connectionMode, addLog]);

  // Simulator Command Handler
  const handleSimulatorCommand = (cmd: string) => {
    const parts = cmd.split(':');
    const action = parts[0].toUpperCase();

    if (action === 'PING') {
      setTimeout(() => addLog('in', 'PONG:PUMP_CONTROLLER_V2.1'), 50);
    } else if (action === 'STATUS') {
      setTimeout(() => {
        addLog(
          'in',
          `STATUS:STATE=${statusRef.current}:RELAY1=${telemetry.relay1Pump ? 1 : 0}:FLOW=${telemetry.flowRateLMin.toFixed(2)}:PULSES=${telemetry.totalPulses}`
        );
      }, 50);
    } else if (action === 'RELAY') {
      const relay = parseInt(parts[1], 10);
      const state = parts[2] === 'ON' || parts[2] === '1';
      setTelemetry(prev => ({
        ...prev,
        relay1Pump: relay === 1 ? state : prev.relay1Pump,
        relay2Valve: relay === 2 ? state : prev.relay2Valve,
      }));
      addLog('in', `OK:RELAY${relay}=${state ? 'ON' : 'OFF'}`);
    } else if (action === 'STOP') {
      setDispenseStatus('idle');
      setTelemetry(prev => ({
        ...prev,
        relay1Pump: false,
        relay2Valve: false,
        flowRateLMin: 0,
        currentAmps: 0.05,
      }));
      sound.stopPumpSound();
      addLog('in', 'OK:STOPPED');
    } else if (action === 'START') {
      const ml = parseInt(parts[1], 10) || targetVolume;
      setTargetVolumeState(ml);
      dispenseStartTimeRef.current = Date.now();
      dispenseStartVolumeRef.current = telemetry.dispensedMl;
      setDispenseStatus('dispensing');
      setTelemetry(prev => ({
        ...prev,
        relay1Pump: true,
        relay2Valve: true,
        currentAmps: 1.85,
        targetMl: ml,
      }));
      sound.startPumpSound();
      addLog('in', `OK:DISPENSING:${ml}ML`);
    } else if (action === 'CALIB') {
      const factor = parseFloat(parts[1]);
      if (!isNaN(factor) && factor > 0) {
        setTelemetry(prev => ({ ...prev, kFactor: factor }));
        addLog('in', `OK:CALIB_SAVED:${factor}`);
      }
    }
  };

  // High precision simulation loop
  useEffect(() => {
    if (connectionMode !== 'simulator') return;

    const interval = setInterval(() => {
      setTelemetry(prev => {
        if (dispenseStatus === 'dispensing' && prev.relay1Pump && !prev.eStopTriggered) {
          // Check tank empty
          if (prev.tankRemainingMl <= 0) {
            setDispenseStatus('error');
            sound.stopPumpSound();
            sound.playEStopAlarm();
            addLog('sys', 'ERROR: Tank Empty! Auto-shutoff triggered.');
            return {
              ...prev,
              relay1Pump: false,
              relay2Valve: false,
              flowRateLMin: 0,
              currentAmps: 0.05,
              errorCode: 'ERR_TANK_EMPTY',
            };
          }

          // Flow dynamics calculation
          // Nominal flow rate with slight natural hydraulic jitter
          const baseRateLMin = activeFluid.defaultFlowRateLMin;
          const jitter = (Math.random() - 0.5) * 0.15;
          const currentFlowRate = Math.max(0.8, baseRateLMin + jitter);

          // In 100ms tick:
          // flow rate L/min -> mL per tick: (L/min * 1000 / 60) * 0.1
          const mlDelta = (currentFlowRate * 1000 / 60) * 0.1;
          const pulsesDelta = Math.round(mlDelta * prev.kFactor);

          const nextDispensed = prev.dispensedMl + mlDelta;
          const nextRemaining = Math.max(0, prev.tankRemainingMl - mlDelta);
          const nextPulses = prev.totalPulses + pulsesDelta;

          // Target reached check
          if (nextDispensed >= prev.targetMl) {
            const finalDispensed = prev.targetMl;
            setDispenseStatus('completed');
            sound.stopPumpSound();
            sound.playSuccessChime();

            // Record transaction
            const durationSec = Math.max(
              1,
              Math.round((Date.now() - (dispenseStartTimeRef.current || Date.now())) / 1000)
            );
            const record: DispenseRecord = {
              id: Math.random().toString(36).substring(2, 9),
              timestamp: new Date().toLocaleTimeString(),
              fluidName: activeFluid.name,
              targetMl: prev.targetMl,
              actualMl: Math.round(finalDispensed),
              durationSeconds: durationSec,
              pulses: nextPulses,
              status: 'completed',
            };

            setDispenseHistory(hist => {
              const updated = [record, ...hist.slice(0, 49)];
              try {
                localStorage.setItem('pump_dispense_history', JSON.stringify(updated));
              } catch {}
              return updated;
            });

            addLog('in', `DONE:DISPENSED:${finalDispensed}ML:PULSES=${nextPulses}`);

            return {
              ...prev,
              dispensedMl: finalDispensed,
              tankRemainingMl: nextRemaining,
              totalPulses: nextPulses,
              flowRateLMin: 0,
              relay1Pump: false,
              relay2Valve: false,
              currentAmps: 0.05,
              lastUpdated: Date.now(),
            };
          }

          return {
            ...prev,
            dispensedMl: nextDispensed,
            tankRemainingMl: nextRemaining,
            totalPulses: nextPulses,
            flowRateLMin: currentFlowRate,
            relay1Pump: true,
            relay2Valve: true,
            currentAmps: 1.85 + (Math.random() - 0.5) * 0.08,
            lastUpdated: Date.now(),
          };
        } else {
          return {
            ...prev,
            flowRateLMin: 0,
            currentAmps: prev.relay1Pump ? 1.8 : 0.05,
            lastUpdated: Date.now(),
          };
        }
      });
    }, 100);

    return () => clearInterval(interval);
  }, [connectionMode, dispenseStatus, activeFluid, addLog]);

  // Actions
  const startDispense = () => {
    if (telemetry.eStopTriggered) {
      sound.playEStopAlarm();
      return;
    }
    if (telemetry.tankRemainingMl <= 100) {
      sound.playEStopAlarm();
      addLog('sys', 'Refill tank before dispensing');
      return;
    }

    sound.playClick();
    dispenseStartTimeRef.current = Date.now();
    dispenseStartVolumeRef.current = 0;
    setTelemetry(prev => ({
      ...prev,
      dispensedMl: 0,
      relay1Pump: true,
      relay2Valve: true,
    }));
    setDispenseStatus('dispensing');
    sound.startPumpSound();
    sendSerialCommand(`START:${targetVolume}`);
  };

  const pauseDispense = () => {
    sound.playClick();
    setDispenseStatus('paused');
    setTelemetry(prev => ({
      ...prev,
      relay1Pump: false,
      relay2Valve: false,
      flowRateLMin: 0,
    }));
    sound.stopPumpSound();
    sendSerialCommand('PAUSE');
  };

  const resumeDispense = () => {
    if (telemetry.eStopTriggered) return;
    sound.playClick();
    setDispenseStatus('dispensing');
    setTelemetry(prev => ({
      ...prev,
      relay1Pump: true,
      relay2Valve: true,
    }));
    sound.startPumpSound();
    sendSerialCommand('RESUME');
  };

  const cancelDispense = () => {
    sound.playClick();
    setDispenseStatus('idle');
    setTelemetry(prev => ({
      ...prev,
      relay1Pump: false,
      relay2Valve: false,
      flowRateLMin: 0,
      dispensedMl: 0,
    }));
    sound.stopPumpSound();
    sendSerialCommand('STOP');
  };

  const triggerEmergencyStop = () => {
    sound.playEStopAlarm();
    sound.stopPumpSound();
    setDispenseStatus('emergency_stopped');
    setTelemetry(prev => ({
      ...prev,
      relay1Pump: false,
      relay2Valve: false,
      flowRateLMin: 0,
      eStopTriggered: true,
      errorCode: 'ERR_EMERGENCY_STOP',
    }));
    sendSerialCommand('ESTOP');
    addLog('sys', '!!! EMERGENCY STOP ACTIVATED: ALL RELAYS TRIPPED LOW !!!');
  };

  const resetEmergencyStop = () => {
    sound.playClick();
    setDispenseStatus('idle');
    setTelemetry(prev => ({
      ...prev,
      eStopTriggered: false,
      errorCode: null,
    }));
    sendSerialCommand('RESET_ESTOP');
    addLog('sys', 'Emergency stop cleared. System armed.');
  };

  const toggleRelay = (relayNum: 1 | 2, forceState?: boolean) => {
    sound.playClick();
    setTelemetry(prev => {
      const currentState = relayNum === 1 ? prev.relay1Pump : prev.relay2Valve;
      const nextState = forceState !== undefined ? forceState : !currentState;
      sendSerialCommand(`RELAY:${relayNum}:${nextState ? 'ON' : 'OFF'}`);

      if (relayNum === 1) {
        if (nextState) sound.startPumpSound();
        else sound.stopPumpSound();
      }

      return {
        ...prev,
        relay1Pump: relayNum === 1 ? nextState : prev.relay1Pump,
        relay2Valve: relayNum === 2 ? nextState : prev.relay2Valve,
      };
    });
  };

  // Web Serial API connection
  const connectSerial = async (): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.serial) {
      alert('Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.');
      return false;
    }

    try {
      addLog('sys', 'Requesting serial port authorization...');
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      serialReaderRef.current = reader;

      const encoder = new TextEncoderStream();
      encoder.readable.pipeTo(port.writable);
      const writer = encoder.writable.getWriter();
      serialWriterRef.current = writer;

      setConnectionMode('web_serial');
      setIsConnected(true);
      setPortInfo('USB Arduino (Web Serial 115200 baud)');
      addLog('sys', 'Serial port opened at 115200 baud. Connected to microcontroller.');

      // Start read loop
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              const lines = value.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                  addLog('in', trimmed);
                  parseArduinoMessage(trimmed);
                }
              }
            }
          }
        } catch (err: unknown) {
          addLog('sys', `Serial read loop terminated: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();

      return true;
    } catch (err: unknown) {
      addLog('sys', `Port open canceled or failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const disconnectSerial = async () => {
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel();
        serialReaderRef.current = null;
      }
      if (serialWriterRef.current) {
        await serialWriterRef.current.close();
        serialWriterRef.current = null;
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close();
        serialPortRef.current = null;
      }
      setIsConnected(false);
      setPortInfo(null);
      setConnectionMode('simulator');
      addLog('sys', 'Disconnected from serial port. Fallback to simulator.');
    } catch (err: unknown) {
      addLog('sys', `Error disconnecting: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Parse incoming messages from physical Arduino or WebSocket backend
  const parseArduinoMessage = (msg: string) => {
    if (msg.startsWith('STATUS:')) {
      // Example: STATUS:FLOW=2.85:ML=250:PULSES=1125:PUMP=1:VALVE=1
      const params = new URLSearchParams(msg.substring(7).replace(/:/g, '&'));
      const flow = parseFloat(params.get('FLOW') || '0');
      const ml = parseFloat(params.get('ML') || '0');
      const pulses = parseInt(params.get('PULSES') || '0', 10);
      const pump = params.get('PUMP') === '1';
      const valve = params.get('VALVE') === '1';

      setTelemetry(prev => ({
        ...prev,
        flowRateLMin: isNaN(flow) ? prev.flowRateLMin : flow,
        dispensedMl: isNaN(ml) ? prev.dispensedMl : ml,
        totalPulses: isNaN(pulses) ? prev.totalPulses : pulses,
        relay1Pump: pump,
        relay2Valve: valve,
        lastUpdated: Date.now(),
      }));
    } else if (msg.startsWith('DONE')) {
      setDispenseStatus('completed');
      sound.stopPumpSound();
      sound.playSuccessChime();
    } else if (msg.startsWith('ERR:')) {
      setDispenseStatus('error');
      sound.stopPumpSound();
      sound.playEStopAlarm();
      setTelemetry(prev => ({ ...prev, errorCode: msg }));
    }
  };

  // WebSocket Connection for local backend.py
  const connectWebSocket = (url: string) => {
    try {
      if (wsRef.current) {
        wsRef.current.close();
      }
      addLog('sys', `Connecting to backend WebSocket: ${url}...`);
      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        setConnectionMode('backend_ws');
        setPortInfo(`Backend WS (${url})`);
        addLog('sys', `Connected to backend bridge at ${url}`);
      };

      socket.onmessage = (event) => {
        const text = String(event.data);
        addLog('in', text);
        parseArduinoMessage(text);
      };

      socket.onerror = () => {
        addLog('sys', `WebSocket error connecting to ${url}. Make sure backend.py is running.`);
      };

      socket.onclose = () => {
        addLog('sys', 'WebSocket closed.');
        if (connectionMode === 'backend_ws') {
          setIsConnected(false);
        }
      };
    } catch (err: unknown) {
      addLog('sys', `WebSocket setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionMode('simulator');
    setIsConnected(true);
    setPortInfo('Hardware Simulator (Active)');
    addLog('sys', 'Switched back to Hardware Simulator.');
  };

  return (
    <PumpContext.Provider
      value={{
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
        toggleRelay,
        setKFactor,
        refillTank,
        serialLogs,
        sendSerialCommand,
        clearSerialLogs,
        dispenseHistory,
        clearHistory,
        isMuted,
        toggleMute,
      }}
    >
      {children}
    </PumpContext.Provider>
  );
};

export const usePump = () => {
  const ctx = useContext(PumpContext);
  if (!ctx) throw new Error('usePump must be used within PumpProvider');
  return ctx;
};
