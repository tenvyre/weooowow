export type DispenseStatus =
  | 'idle'
  | 'dispensing'
  | 'paused'
  | 'completed'
  | 'emergency_stopped'
  | 'error';

export type ConnectionMode = 'simulator' | 'web_serial' | 'backend_ws';

export interface PresetVolume {
  id: string;
  name: string;
  ml: number;
  iconName: string;
  description: string;
}

export interface FluidType {
  id: string;
  name: string;
  color: string;
  textColor: string;
  waveColor: string;
  description: string;
  defaultFlowRateLMin: number;
}

export interface PumpTelemetry {
  flowRateLMin: number;
  dispensedMl: number;
  targetMl: number;
  totalPulses: number;
  tankRemainingMl: number;
  tankCapacityMl: number;
  relay1Pump: boolean;
  relay2Valve: boolean;
  kFactor: number; // pulses per mL (e.g. 4.5 pulses/mL = 4500 pulses/L for YF-S201)
  eStopTriggered: boolean;
  voltage: number;
  currentAmps: number;
  errorCode: string | null;
  lastUpdated: number;
}

export interface SerialLogEntry {
  id: string;
  timestamp: string;
  direction: 'in' | 'out' | 'sys';
  data: string;
  raw?: string;
}

export interface DispenseRecord {
  id: string;
  timestamp: string;
  fluidName: string;
  targetMl: number;
  actualMl: number;
  durationSeconds: number;
  pulses: number;
  status: DispenseStatus;
}
