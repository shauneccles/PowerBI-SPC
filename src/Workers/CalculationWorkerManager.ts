/**
 * Calculation Worker Manager
 * 
 * Session 10: Web Worker Offloading
 * 
 * This manager handles the lifecycle of the calculation web worker, providing:
 * - Worker initialization using inline blob URLs (Power BI sandbox compatible)
 * - Message-based async communication with Promise API
 * - Automatic fallback to synchronous execution when workers aren't available
 * - Request cancellation for long-running calculations
 * - Worker termination and cleanup
 * 
 * Power BI Compatibility:
 * - Uses inline blob workers (no external script loading)
 * - Works within sandboxed iframes
 * - No CSP violations
 * 
 * Usage:
 *   const manager = new CalculationWorkerManager();
 *   await manager.initialize();  // Creates inline blob worker
 *   const limits = await manager.calculateLimits('i', args);
 */

import type { controlLimitsObject, controlLimitsArgs } from "../Classes";
import type { outliersObject } from "../Classes/viewModelClass";
import * as limitFunctions from "../Limit Calculations";
import { astronomical, shift, trend, twoInThree } from "../Outlier Flagging";

/**
 * Configuration for the worker manager
 */
export interface WorkerManagerConfig {
  /** Enable/disable worker usage (fallback to sync) */
  enabled: boolean;
  /** Timeout for worker operations in milliseconds */
  timeout: number;
  /** Minimum data size to use worker (smaller datasets run sync) */
  minDataSize: number;
}

/**
 * Default configuration
 */
export const DEFAULT_WORKER_CONFIG: WorkerManagerConfig = {
  enabled: true,
  timeout: 5000,  // 5 second timeout
  minDataSize: 500,  // Use workers for datasets >= 500 points (higher threshold due to message overhead)
};

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Worker message types
 */
interface WorkerRequest {
  type: 'calculateLimits' | 'detectOutliers' | 'detectOutliersBatch' | 'ping';
  payload: any;
  requestId: string;
}

interface WorkerResponse {
  requestId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;
}

/**
 * Generate inline worker script as a string
 * This allows creating a blob URL worker that works in Power BI's sandboxed environment
 */
function generateWorkerScript(): string {
  // The worker script must be self-contained - it cannot import modules
  // Instead, we inline the calculation logic directly
  return `
// Inline Worker Script - Session 10: Web Worker Offloading
// This script is generated inline to work within Power BI's sandboxed iframe

// ============================================================================
// Helper Functions (inlined from Functions/)
// ============================================================================

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}

function divide(numerators, denominators) {
  const result = new Array(numerators.length);
  for (let i = 0; i < numerators.length; i++) {
    result[i] = denominators && denominators[i] ? numerators[i] / denominators[i] : numerators[i];
  }
  return result;
}

function abs(arr) {
  const result = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    result[i] = Math.abs(arr[i]);
  }
  return result;
}

function diff(arr) {
  if (arr.length < 2) return [];
  const result = new Array(arr.length - 1);
  for (let i = 0; i < arr.length - 1; i++) {
    result[i] = arr[i + 1] - arr[i];
  }
  return result;
}

function rep(value, n) {
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = value;
  }
  return result;
}

function extractValues(arr, indices) {
  if (!indices || indices.length === 0) return arr;
  const indexSet = new Set(indices);
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (indexSet.has(i)) {
      result.push(arr[i]);
    }
  }
  return result;
}

// ============================================================================
// Limit Calculation Functions (simplified i chart only for inline worker)
// ============================================================================

function iLimits(args) {
  const useRatio = args.denominators && args.denominators.length > 0;
  const ratio = useRatio ? divide(args.numerators, args.denominators) : args.numerators;
  const ratio_subset = extractValues(ratio, args.subset_points);
  const cl = mean(ratio_subset);
  
  const consec_diff = abs(diff(ratio_subset));
  const consec_diff_ulim = mean(consec_diff) * 3.267;
  const consec_diff_valid = args.outliers_in_limits 
    ? consec_diff 
    : consec_diff.filter(d => d < consec_diff_ulim);
  
  const sigma = mean(consec_diff_valid) / 1.128;
  const n = args.keys.length;
  
  return {
    keys: args.keys,
    values: ratio.map(d => isNaN(d) ? 0 : d),
    numerators: useRatio ? args.numerators : undefined,
    denominators: useRatio ? args.denominators : undefined,
    targets: rep(cl, n),
    ll99: rep(cl - 3 * sigma, n),
    ll95: rep(cl - 2 * sigma, n),
    ll68: rep(cl - 1 * sigma, n),
    ul68: rep(cl + 1 * sigma, n),
    ul95: rep(cl + 2 * sigma, n),
    ul99: rep(cl + 3 * sigma, n)
  };
}

// ============================================================================
// Outlier Detection Functions (inlined)
// ============================================================================

function astronomical(val, ll, ul) {
  const len = val.length;
  const result = new Array(len);
  for (let i = 0; i < len; i++) {
    if (val[i] === null || val[i] === undefined) {
      result[i] = "none";
    } else if (ll && ll[i] !== null && val[i] < ll[i]) {
      result[i] = "lower";
    } else if (ul && ul[i] !== null && val[i] > ul[i]) {
      result[i] = "upper";
    } else {
      result[i] = "none";
    }
  }
  return result;
}

function shift(val, targets, n) {
  const len = val.length;
  if (len === 0) return [];
  
  const lagged_sign = new Array(len);
  for (let i = 0; i < len; i++) {
    lagged_sign[i] = Math.sign(val[i] - targets[i]);
  }
  
  const lagged_sign_sum = new Array(len);
  let windowSum = 0;
  
  for (let i = 0; i < len; i++) {
    windowSum += lagged_sign[i];
    if (i >= n) {
      windowSum -= lagged_sign[i - n];
    }
    lagged_sign_sum[i] = windowSum;
  }
  
  const shift_detected = new Array(len);
  for (let i = 0; i < len; i++) {
    const absSum = Math.abs(lagged_sign_sum[i]);
    if (absSum >= n) {
      shift_detected[i] = lagged_sign_sum[i] >= n ? "upper" : "lower";
    } else {
      shift_detected[i] = "none";
    }
  }
  
  for (let i = 0; i < len; i++) {
    if (shift_detected[i] !== "none") {
      for (let j = i - 1; j >= i - (n - 1); j--) {
        if (j >= 0) {
          shift_detected[j] = shift_detected[i];
        }
      }
    }
  }
  
  return shift_detected;
}

function trend(val, n) {
  const len = val.length;
  if (len === 0) return [];
  
  const direction = new Array(len);
  direction[0] = 0;
  for (let i = 1; i < len; i++) {
    if (val[i] > val[i - 1]) {
      direction[i] = 1;
    } else if (val[i] < val[i - 1]) {
      direction[i] = -1;
    } else {
      direction[i] = 0;
    }
  }
  
  const direction_sum = new Array(len);
  let windowSum = 0;
  const windowSize = n - 1;
  
  for (let i = 0; i < len; i++) {
    windowSum += direction[i];
    if (i >= windowSize) {
      windowSum -= direction[i - windowSize];
    }
    direction_sum[i] = windowSum;
  }
  
  const trend_detected = new Array(len);
  for (let i = 0; i < len; i++) {
    const absSum = Math.abs(direction_sum[i]);
    if (absSum >= windowSize) {
      trend_detected[i] = direction_sum[i] >= windowSize ? "upper" : "lower";
    } else {
      trend_detected[i] = "none";
    }
  }
  
  for (let i = 0; i < len; i++) {
    if (trend_detected[i] !== "none") {
      for (let j = i - 1; j >= i - (n - 1); j--) {
        if (j >= 0) {
          trend_detected[j] = trend_detected[i];
        }
      }
    }
  }
  
  return trend_detected;
}

function twoInThree(val, ll, ul, highlightSeries) {
  const len = val.length;
  if (len === 0) return [];
  
  const lower_flag = new Array(len);
  const upper_flag = new Array(len);
  
  for (let i = 0; i < len; i++) {
    lower_flag[i] = (ll && ll[i] !== null && val[i] < ll[i]) ? 1 : 0;
    upper_flag[i] = (ul && ul[i] !== null && val[i] > ul[i]) ? 1 : 0;
  }
  
  const lower_sum = new Array(len);
  const upper_sum = new Array(len);
  let lowerWindowSum = 0;
  let upperWindowSum = 0;
  
  for (let i = 0; i < len; i++) {
    lowerWindowSum += lower_flag[i];
    upperWindowSum += upper_flag[i];
    if (i >= 3) {
      lowerWindowSum -= lower_flag[i - 3];
      upperWindowSum -= upper_flag[i - 3];
    }
    lower_sum[i] = lowerWindowSum;
    upper_sum[i] = upperWindowSum;
  }
  
  const detected = new Array(len);
  for (let i = 0; i < len; i++) {
    if (lower_sum[i] >= 2) {
      detected[i] = "lower";
    } else if (upper_sum[i] >= 2) {
      detected[i] = "upper";
    } else {
      detected[i] = "none";
    }
  }
  
  if (highlightSeries) {
    for (let i = 0; i < len; i++) {
      if (detected[i] !== "none") {
        for (let j = i - 1; j >= i - 2; j--) {
          if (j >= 0) {
            detected[j] = detected[i];
          }
        }
      }
    }
  }
  
  return detected;
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = function(event) {
  const { type, payload, requestId } = event.data;
  const startTime = performance.now();
  
  try {
    let result;
    
    switch (type) {
      case 'calculateLimits':
        // Only i chart is supported in inline worker
        if (payload.chartType === 'i') {
          result = iLimits(payload.args);
        } else {
          throw new Error('Chart type not supported in worker: ' + payload.chartType);
        }
        break;
        
      case 'detectOutliers':
        if (payload.rule === 'astronomical') {
          result = astronomical(...payload.args);
        } else if (payload.rule === 'shift') {
          result = shift(...payload.args);
        } else if (payload.rule === 'trend') {
          result = trend(...payload.args);
        } else if (payload.rule === 'twoInThree') {
          result = twoInThree(...payload.args);
        } else {
          throw new Error('Unknown outlier rule: ' + payload.rule);
        }
        break;
        
      case 'detectOutliersBatch':
        result = {};
        for (const { rule, args } of payload.rules) {
          if (rule === 'astronomical') {
            result['astronomical'] = astronomical(...args);
          } else if (rule === 'shift') {
            result['shift'] = shift(...args);
          } else if (rule === 'trend') {
            result['trend'] = trend(...args);
          } else if (rule === 'twoInThree') {
            result['twoInThree'] = twoInThree(...args);
          }
        }
        break;
        
      case 'ping':
        result = { status: 'ok', timestamp: Date.now() };
        break;
        
      default:
        throw new Error('Unknown message type: ' + type);
    }
    
    const duration = (performance.now() - startTime) * 1000;
    self.postMessage({ requestId, success: true, result, duration });
  } catch (error) {
    const duration = (performance.now() - startTime) * 1000;
    self.postMessage({ 
      requestId, 
      success: false, 
      error: error.message || String(error),
      duration 
    });
  }
};

// Signal ready
self.postMessage({ type: 'ready' });
`;
}

/**
 * Manages calculation web worker lifecycle and communication
 */
export class CalculationWorkerManager {
  private worker: Worker | null = null;
  private workerBlobUrl: string | null = null;
  private config: WorkerManagerConfig;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestCounter: number = 0;
  private isReady: boolean = false;
  private workerSupported: boolean = false;
  private blobUrlSupported: boolean = false;
  
  // Track performance metrics
  private workerExecutionTimes: number[] = [];
  private syncExecutionTimes: number[] = [];
  
  constructor(config: Partial<WorkerManagerConfig> = {}) {
    this.config = { ...DEFAULT_WORKER_CONFIG, ...config };
    this.workerSupported = typeof Worker !== 'undefined';
    this.blobUrlSupported = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined';
  }
  
  /**
   * Check if workers are supported in the current environment
   */
  isWorkerSupported(): boolean {
    return this.workerSupported && this.blobUrlSupported;
  }
  
  /**
   * Check if the worker is initialized and ready
   */
  isWorkerReady(): boolean {
    return this.isReady && this.worker !== null;
  }
  
  /**
   * Get performance metrics
   */
  getMetrics(): { workerTimes: number[], syncTimes: number[], avgWorker: number, avgSync: number } {
    const avgWorker = this.workerExecutionTimes.length > 0
      ? this.workerExecutionTimes.reduce((a, b) => a + b, 0) / this.workerExecutionTimes.length
      : 0;
    const avgSync = this.syncExecutionTimes.length > 0
      ? this.syncExecutionTimes.reduce((a, b) => a + b, 0) / this.syncExecutionTimes.length
      : 0;
    
    return {
      workerTimes: [...this.workerExecutionTimes],
      syncTimes: [...this.syncExecutionTimes],
      avgWorker,
      avgSync
    };
  }
  
  /**
   * Clear performance metrics
   */
  clearMetrics(): void {
    this.workerExecutionTimes = [];
    this.syncExecutionTimes = [];
  }
  
  /**
   * Initialize the worker
   * Returns true if worker was successfully created, false if falling back to sync
   * 
   * Power BI Compatibility:
   * - When no workerUrl is provided, creates an inline blob worker
   * - Blob workers work within Power BI's sandboxed iframe environment
   * - No external script loading required (CSP compliant)
   */
  async initialize(workerUrl?: string): Promise<boolean> {
    if (!this.config.enabled || !this.workerSupported) {
      return false;
    }
    
    // If worker is already initialized, return current state
    if (this.worker && this.isReady) {
      return true;
    }
    
    try {
      if (workerUrl) {
        // Create worker from external URL (traditional approach)
        this.worker = new Worker(workerUrl);
      } else if (this.blobUrlSupported) {
        // Create inline blob worker (Power BI compatible)
        // This is the key for Power BI sandbox compatibility
        const workerScript = generateWorkerScript();
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        this.workerBlobUrl = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerBlobUrl);
      } else {
        // Neither URL nor blob workers available
        return false;
      }
      
      // Set up message handler
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);
      
      // Wait for ready signal
      await this.waitForReady();
      
      return true;
    } catch (error) {
      // Clean up on failure
      this.cleanupWorker();
      console.warn('Worker initialization failed, falling back to sync execution:', error);
      return false;
    }
  }
  
  /**
   * Clean up worker resources
   */
  private cleanupWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }
    this.isReady = false;
  }
  
  /**
   * Wait for worker to signal ready
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, this.config.timeout);
      
      const originalHandler = this.worker!.onmessage;
      this.worker!.onmessage = (event) => {
        if (event.data?.type === 'ready') {
          clearTimeout(timeout);
          this.isReady = true;
          this.worker!.onmessage = originalHandler;
          resolve();
        } else if (originalHandler) {
          (originalHandler as (event: MessageEvent) => void)(event);
        }
      };
    });
  }
  
  /**
   * Handle incoming worker messages
   */
  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const { requestId, success, result, error, duration } = event.data;
    
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;  // Request was cancelled or timed out
    }
    
    // Clear timeout and remove from pending
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);
    
    // Track execution time
    if (duration !== undefined) {
      this.workerExecutionTimes.push(duration);
      // Keep only last 100 measurements
      if (this.workerExecutionTimes.length > 100) {
        this.workerExecutionTimes.shift();
      }
    }
    
    if (success) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error || 'Unknown worker error'));
    }
  }
  
  /**
   * Handle worker errors
   */
  private handleWorkerError(event: ErrorEvent): void {
    console.error('Worker error:', event.message);
    
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Worker error: ' + event.message));
    }
    this.pendingRequests.clear();
    
    // Terminate and reset worker
    this.terminate();
  }
  
  /**
   * Send a message to the worker and wait for response
   */
  private sendMessage<T>(type: WorkerRequest['type'], payload: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.isReady) {
        reject(new Error('Worker not ready'));
        return;
      }
      
      const requestId = `req-${++this.requestCounter}`;
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Worker request timeout'));
      }, this.config.timeout);
      
      // Track pending request
      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
      
      // Send message
      const message: WorkerRequest = { type, payload, requestId };
      this.worker.postMessage(message);
    });
  }
  
  /**
   * Calculate control limits asynchronously using worker
   * Falls back to synchronous execution if worker unavailable or data too small
   */
  async calculateLimits(
    chartType: string,
    args: controlLimitsArgs
  ): Promise<controlLimitsObject> {
    const dataSize = args.keys.length;
    
    // Use sync for small datasets or when worker unavailable
    if (!this.isWorkerReady() || dataSize < this.config.minDataSize) {
      return this.calculateLimitsSync(chartType, args);
    }
    
    try {
      return await this.sendMessage<controlLimitsObject>('calculateLimits', {
        chartType,
        args
      });
    } catch {
      // Fallback to sync on error
      return this.calculateLimitsSync(chartType, args);
    }
  }
  
  /**
   * Synchronous limit calculation (used as fallback)
   */
  calculateLimitsSync(chartType: string, args: controlLimitsArgs): controlLimitsObject {
    const startTime = performance.now();
    
    const limitFunction = limitFunctions[chartType as keyof typeof limitFunctions];
    if (!limitFunction) {
      throw new Error(`Unknown chart type: ${chartType}`);
    }
    
    const result = limitFunction(args);
    
    // Track execution time
    const duration = (performance.now() - startTime) * 1000;
    this.syncExecutionTimes.push(duration);
    if (this.syncExecutionTimes.length > 100) {
      this.syncExecutionTimes.shift();
    }
    
    return result;
  }
  
  /**
   * Detect outliers asynchronously using worker
   * Falls back to synchronous execution if worker unavailable or data too small
   */
  async detectOutliers(
    values: number[],
    limits: controlLimitsObject,
    settings: {
      astronomical?: boolean;
      astronomicalLimit?: string;
      shift?: boolean;
      shiftN?: number;
      trend?: boolean;
      trendN?: number;
      twoInThree?: boolean;
      twoInThreeLimit?: string;
      twoInThreeHighlightSeries?: boolean;
    }
  ): Promise<outliersObject> {
    const dataSize = values.length;
    
    // Use sync for small datasets or when worker unavailable
    if (!this.isWorkerReady() || dataSize < this.config.minDataSize) {
      return this.detectOutliersSync(values, limits, settings);
    }
    
    try {
      // Prepare batch of outlier rules to execute
      const rules: { rule: string; args: any[] }[] = [];
      
      if (settings.astronomical) {
        const ll = limits.ll99 ?? [];
        const ul = limits.ul99 ?? [];
        rules.push({ rule: 'astronomical', args: [values, ll, ul] });
      }
      
      if (settings.shift) {
        rules.push({ rule: 'shift', args: [values, limits.targets, settings.shiftN || 8] });
      }
      
      if (settings.trend) {
        rules.push({ rule: 'trend', args: [values, settings.trendN || 6] });
      }
      
      if (settings.twoInThree) {
        const ll = limits.ll95 ?? [];
        const ul = limits.ul95 ?? [];
        rules.push({ rule: 'twoInThree', args: [values, ll, ul, settings.twoInThreeHighlightSeries || false] });
      }
      
      const results = await this.sendMessage<Record<string, string[]>>('detectOutliersBatch', { rules });
      
      return {
        astpoint: results['astronomical'] || new Array(dataSize).fill('none'),
        shift: results['shift'] || new Array(dataSize).fill('none'),
        trend: results['trend'] || new Array(dataSize).fill('none'),
        two_in_three: results['twoInThree'] || new Array(dataSize).fill('none'),
      };
    } catch {
      // Fallback to sync on error
      return this.detectOutliersSync(values, limits, settings);
    }
  }
  
  /**
   * Synchronous outlier detection (used as fallback)
   */
  detectOutliersSync(
    values: number[],
    limits: controlLimitsObject,
    settings: {
      astronomical?: boolean;
      astronomicalLimit?: string;
      shift?: boolean;
      shiftN?: number;
      trend?: boolean;
      trendN?: number;
      twoInThree?: boolean;
      twoInThreeLimit?: string;
      twoInThreeHighlightSeries?: boolean;
    }
  ): outliersObject {
    const startTime = performance.now();
    const dataSize = values.length;
    
    const result: outliersObject = {
      astpoint: new Array(dataSize).fill('none'),
      shift: new Array(dataSize).fill('none'),
      trend: new Array(dataSize).fill('none'),
      two_in_three: new Array(dataSize).fill('none'),
    };
    
    if (settings.astronomical) {
      const ll = limits.ll99 ?? [];
      const ul = limits.ul99 ?? [];
      result.astpoint = astronomical(values, ll, ul);
    }
    
    if (settings.shift) {
      result.shift = shift(values, limits.targets, settings.shiftN || 8);
    }
    
    if (settings.trend) {
      result.trend = trend(values, settings.trendN || 6);
    }
    
    if (settings.twoInThree) {
      const ll = limits.ll95 ?? [];
      const ul = limits.ul95 ?? [];
      result.two_in_three = twoInThree(values, ll, ul, settings.twoInThreeHighlightSeries || false);
    }
    
    // Track execution time
    const duration = (performance.now() - startTime) * 1000;
    this.syncExecutionTimes.push(duration);
    if (this.syncExecutionTimes.length > 100) {
      this.syncExecutionTimes.shift();
    }
    
    return result;
  }
  
  /**
   * Ping the worker to check health
   */
  async ping(): Promise<boolean> {
    if (!this.isWorkerReady()) {
      return false;
    }
    
    try {
      const result = await this.sendMessage<{ status: string }>('ping', {});
      return result.status === 'ok';
    } catch {
      return false;
    }
  }
  
  /**
   * Cancel a pending request
   */
  cancelRequest(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Request cancelled'));
      this.pendingRequests.delete(requestId);
      return true;
    }
    return false;
  }
  
  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('All requests cancelled'));
    }
    this.pendingRequests.clear();
  }
  
  /**
   * Terminate the worker and clean up resources
   */
  terminate(): void {
    this.cancelAllRequests();
    this.cleanupWorker();
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<WorkerManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Get current configuration
   */
  getConfig(): WorkerManagerConfig {
    return { ...this.config };
  }
}

// Singleton instance for global use
let globalWorkerManager: CalculationWorkerManager | null = null;

/**
 * Get the global worker manager instance
 */
export function getGlobalWorkerManager(): CalculationWorkerManager {
  if (!globalWorkerManager) {
    globalWorkerManager = new CalculationWorkerManager();
  }
  return globalWorkerManager;
}

/**
 * Reset the global worker manager (useful for testing)
 */
export function resetGlobalWorkerManager(): void {
  if (globalWorkerManager) {
    globalWorkerManager.terminate();
    globalWorkerManager = null;
  }
}
