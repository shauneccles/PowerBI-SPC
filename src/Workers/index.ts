/**
 * Workers Module
 * 
 * Session 10: Web Worker Offloading
 * 
 * Exports Web Worker manager and utilities for offloading
 * computationally intensive operations from the main thread.
 */

export {
  CalculationWorkerManager,
  getGlobalWorkerManager,
  resetGlobalWorkerManager,
  DEFAULT_WORKER_CONFIG,
  type WorkerManagerConfig,
} from './CalculationWorkerManager';

// Worker message types (for external use)
export type { WorkerRequest, WorkerResponse } from './calculationWorker';
