/**
 * Calculation Web Worker
 * 
 * Session 10: Web Worker Offloading
 * 
 * This worker offloads computationally intensive operations from the main thread
 * to keep the UI responsive during heavy calculations.
 * 
 * Supported operations:
 * - Limit calculations (all 14 chart types)
 * - Outlier detection (astronomical, shift, trend, twoInThree)
 * 
 * Message Protocol:
 * - Request: { type: string, payload: any, requestId: string }
 * - Response: { requestId: string, success: boolean, result?: any, error?: string }
 */

import type { controlLimitsObject, controlLimitsArgs } from "../Classes";
import * as limitFunctions from "../Limit Calculations";
import { astronomical, shift, trend, twoInThree } from "../Outlier Flagging";

// Chart type to function mapping
const limitFunctionMap: Record<string, (args: controlLimitsArgs) => controlLimitsObject> = {
  'i': limitFunctions.i,
  'mr': limitFunctions.mr,
  'run': limitFunctions.run,
  'c': limitFunctions.c,
  'p': limitFunctions.p,
  'u': limitFunctions.u,
  's': limitFunctions.s,
  'pp': limitFunctions.pp,
  'up': limitFunctions.up,
  'xbar': limitFunctions.xbar,
  'g': limitFunctions.g,
  't': limitFunctions.t,
  'i_m': limitFunctions.i_m,
  'i_mm': limitFunctions.i_mm,
  'r': limitFunctions.r,
};

// Outlier detection function mapping
const outlierFunctionMap: Record<string, (...args: any[]) => string[]> = {
  'astronomical': astronomical,
  'shift': shift,
  'trend': trend,
  'twoInThree': twoInThree,
};

/**
 * Message types for worker communication
 */
export interface WorkerRequest {
  type: 'calculateLimits' | 'detectOutliers' | 'detectOutliersBatch' | 'ping';
  payload: any;
  requestId: string;
}

export interface WorkerResponse {
  requestId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;  // Processing time in microseconds
}

/**
 * Calculate limits using the specified chart type
 */
function calculateLimits(chartType: string, args: controlLimitsArgs): controlLimitsObject {
  const limitFunction = limitFunctionMap[chartType];
  if (!limitFunction) {
    throw new Error(`Unknown chart type: ${chartType}`);
  }
  return limitFunction(args);
}

/**
 * Detect outliers using the specified rule
 */
function detectOutliers(rule: string, ...args: any[]): string[] {
  const outlierFunction = outlierFunctionMap[rule];
  if (!outlierFunction) {
    throw new Error(`Unknown outlier rule: ${rule}`);
  }
  return outlierFunction(...args);
}

/**
 * Batch detect multiple outlier rules at once
 * More efficient than multiple separate calls due to reduced message overhead
 */
function detectOutliersBatch(rules: { rule: string; args: any[] }[]): Record<string, string[]> {
  const results: Record<string, string[]> = {};
  for (const { rule, args } of rules) {
    results[rule] = detectOutliers(rule, ...args);
  }
  return results;
}

/**
 * Handle incoming messages from main thread
 */
function handleMessage(event: MessageEvent<WorkerRequest>): void {
  const { type, payload, requestId } = event.data;
  const startTime = performance.now();
  
  try {
    let result: any;
    
    switch (type) {
      case 'calculateLimits':
        result = calculateLimits(payload.chartType, payload.args);
        break;
        
      case 'detectOutliers':
        result = detectOutliers(payload.rule, ...payload.args);
        break;
        
      case 'detectOutliersBatch':
        result = detectOutliersBatch(payload.rules);
        break;
        
      case 'ping':
        // Health check - return immediately
        result = { status: 'ok', timestamp: Date.now() };
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    
    const duration = (performance.now() - startTime) * 1000; // Convert to microseconds
    
    const response: WorkerResponse = {
      requestId,
      success: true,
      result,
      duration
    };
    
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: (performance.now() - startTime) * 1000
    };
    
    self.postMessage(response);
  }
}

// Set up message handler
self.onmessage = handleMessage;

// Signal that worker is ready
self.postMessage({ type: 'ready' });
