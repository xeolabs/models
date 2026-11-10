export interface ProcessingSettings {
  propertySetMode?: import('../properties/types.js').PropertySetMode;
  automaticIFC: boolean;
  paused: boolean;
  memoryLimitMiB: number;
  reserveMemoryMiB: number;
  cpuCores: number;
  timeoutMinutes: number;
}
export type ProcessingStatus =
  'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type ProcessingKind =
  'prepare-ifc' | 'inspect' | 'convert' | 'thumbnail' | 'export-properties';
export interface ProcessingJob {
  id: string;
  modelId: string;
  modelName: string;
  kind: ProcessingKind;
  format: string;
  status: ProcessingStatus;
  source: 'automatic' | 'requested';
  phase: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  heartbeatAt?: string;
  memoryBytes?: number;
  cpuPercent?: number;
  errorCode?: string;
  error?: string;
}
export interface ProcessingOverview {
  settings: ProcessingSettings;
  jobs: ProcessingJob[];
  counts: Record<ProcessingStatus, number>;
  freeMemoryBytes: number;
  waitingReason?: string;
  workerLimit: 1;
  resourceMonitoring: 'linux' | 'portable';
}
export interface ProcessingProgress {
  phase?: string;
  memoryBytes?: number;
  cpuPercent?: number;
}
