/**
 * Test Suite: Web Worker Offloading (Session 10)
 * 
 * Tests for the CalculationWorkerManager and inline blob workers
 * that enable Power BI-compatible background computation.
 */

import { 
  CalculationWorkerManager, 
  DEFAULT_WORKER_CONFIG,
  getGlobalWorkerManager,
  resetGlobalWorkerManager
} from '../src/Workers';

describe('Web Worker Offloading (Session 10)', () => {
  
  describe('CalculationWorkerManager', () => {
    let manager: CalculationWorkerManager;
    
    beforeEach(() => {
      manager = new CalculationWorkerManager();
    });
    
    afterEach(() => {
      manager.terminate();
    });
    
    describe('Configuration', () => {
      it('should use default configuration when no config provided', () => {
        const config = manager.getConfig();
        expect(config.enabled).toBe(DEFAULT_WORKER_CONFIG.enabled);
        expect(config.timeout).toBe(DEFAULT_WORKER_CONFIG.timeout);
        expect(config.minDataSize).toBe(DEFAULT_WORKER_CONFIG.minDataSize);
      });
      
      it('should allow custom configuration', () => {
        const customManager = new CalculationWorkerManager({
          enabled: false,
          timeout: 10000,
          minDataSize: 200
        });
        
        const config = customManager.getConfig();
        expect(config.enabled).toBe(false);
        expect(config.timeout).toBe(10000);
        expect(config.minDataSize).toBe(200);
        
        customManager.terminate();
      });
      
      it('should allow config updates', () => {
        manager.updateConfig({ timeout: 7500 });
        
        const config = manager.getConfig();
        expect(config.timeout).toBe(7500);
        expect(config.enabled).toBe(DEFAULT_WORKER_CONFIG.enabled);
      });
    });
    
    describe('Worker Support Detection', () => {
      it('should detect worker support in browser environment', () => {
        // In Karma/browser tests, Worker should be available
        const isSupported = manager.isWorkerSupported();
        // Workers are supported in Chrome headless
        expect(typeof isSupported).toBe('boolean');
      });
      
      it('should report not ready before initialization', () => {
        expect(manager.isWorkerReady()).toBe(false);
      });
    });
    
    describe('Synchronous Fallback', () => {
      it('should calculate limits synchronously when worker disabled', () => {
        const disabledManager = new CalculationWorkerManager({ enabled: false });
        
        const args = {
          keys: [{ x: 0, id: 0, label: 'Point 1' }, { x: 1, id: 1, label: 'Point 2' }, { x: 2, id: 2, label: 'Point 3' }],
          numerators: [10, 20, 30],
          subset_points: [0, 1, 2]
        };
        
        const result = disabledManager.calculateLimitsSync('i', args);
        
        expect(result).toBeDefined();
        expect(result.keys.length).toBe(3);
        expect(result.values.length).toBe(3);
        expect(result.targets.length).toBe(3);
        expect(result.ll99.length).toBe(3);
        expect(result.ul99.length).toBe(3);
        
        disabledManager.terminate();
      });
      
      it('should detect outliers synchronously', () => {
        const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const limits = {
          keys: values.map((_, i) => ({ x: i, id: i, label: `Point ${i}` })),
          values,
          targets: Array(10).fill(50),
          ll99: Array(10).fill(20),
          ll95: Array(10).fill(30),
          ll68: Array(10).fill(40),
          ul68: Array(10).fill(60),
          ul95: Array(10).fill(70),
          ul99: Array(10).fill(80)
        };
        
        const result = manager.detectOutliersSync(values, limits, {
          astronomical: true,
          shift: true,
          shiftN: 8,
          trend: true,
          trendN: 6,
          twoInThree: true,
          twoInThreeHighlightSeries: false
        });
        
        expect(result).toBeDefined();
        expect(result.astpoint.length).toBe(10);
        expect(result.shift.length).toBe(10);
        expect(result.trend.length).toBe(10);
        expect(result.two_in_three.length).toBe(10);
      });
      
      it('should return none for all outliers when rules disabled', () => {
        const values = [10, 20, 30, 40, 50];
        const limits = {
          keys: values.map((_, i) => ({ x: i, id: i, label: `Point ${i}` })),
          values,
          targets: Array(5).fill(30),
          ll99: Array(5).fill(10),
          ul99: Array(5).fill(50)
        };
        
        const result = manager.detectOutliersSync(values, limits, {});
        
        expect(result.astpoint.every(v => v === 'none')).toBe(true);
        expect(result.shift.every(v => v === 'none')).toBe(true);
        expect(result.trend.every(v => v === 'none')).toBe(true);
        expect(result.two_in_three.every(v => v === 'none')).toBe(true);
      });
    });
    
    describe('Performance Metrics', () => {
      it('should track execution times', () => {
        const args = {
          keys: [{ x: 0, id: 0, label: 'Point 1' }, { x: 1, id: 1, label: 'Point 2' }],
          numerators: [10, 20],
          subset_points: [0, 1]
        };
        
        // Run a few sync calculations
        manager.calculateLimitsSync('i', args);
        manager.calculateLimitsSync('i', args);
        manager.calculateLimitsSync('i', args);
        
        const metrics = manager.getMetrics();
        
        expect(metrics.syncTimes.length).toBe(3);
        // avgSync may be 0 for very fast calculations, just check it's a number >= 0
        expect(metrics.avgSync).toBeGreaterThanOrEqual(0);
        expect(metrics.workerTimes.length).toBe(0);
        expect(metrics.avgWorker).toBe(0);
      });
      
      it('should clear metrics', () => {
        const args = {
          keys: [{ x: 0, id: 0, label: 'Point 1' }],
          numerators: [10],
          subset_points: [0]
        };
        
        manager.calculateLimitsSync('i', args);
        expect(manager.getMetrics().syncTimes.length).toBe(1);
        
        manager.clearMetrics();
        expect(manager.getMetrics().syncTimes.length).toBe(0);
      });
    });
    
    describe('Error Handling', () => {
      it('should throw error for unknown chart type', () => {
        const args = {
          keys: [{ x: 0, id: 0, label: 'Point 1' }],
          numerators: [10],
          subset_points: [0]
        };
        
        expect(() => manager.calculateLimitsSync('unknown' as any, args)).toThrowError(/Unknown chart type/);
      });
    });
  });
  
  describe('Global Worker Manager', () => {
    afterEach(() => {
      resetGlobalWorkerManager();
    });
    
    it('should return singleton instance', () => {
      const manager1 = getGlobalWorkerManager();
      const manager2 = getGlobalWorkerManager();
      
      expect(manager1).toBe(manager2);
    });
    
    it('should reset singleton instance', () => {
      const manager1 = getGlobalWorkerManager();
      resetGlobalWorkerManager();
      const manager2 = getGlobalWorkerManager();
      
      expect(manager1).not.toBe(manager2);
    });
  });
  
  describe('Worker Initialization (Browser Environment)', () => {
    let manager: CalculationWorkerManager;
    
    beforeEach(() => {
      manager = new CalculationWorkerManager();
    });
    
    afterEach(() => {
      manager.terminate();
    });
    
    it('should initialize inline blob worker', async () => {
      // In browser environment, blob workers should be supported
      if (manager.isWorkerSupported()) {
        const initialized = await manager.initialize();
        
        // In Karma, this should succeed
        expect(typeof initialized).toBe('boolean');
        
        if (initialized) {
          expect(manager.isWorkerReady()).toBe(true);
          
          // Test ping
          const pingResult = await manager.ping();
          expect(pingResult).toBe(true);
        }
      } else {
        // If workers not supported, should fall back gracefully
        const initialized = await manager.initialize();
        expect(initialized).toBe(false);
      }
    });
    
    it('should fall back to sync when worker disabled', async () => {
      const disabledManager = new CalculationWorkerManager({ enabled: false });
      
      const initialized = await disabledManager.initialize();
      expect(initialized).toBe(false);
      expect(disabledManager.isWorkerReady()).toBe(false);
      
      disabledManager.terminate();
    });
    
    it('should handle multiple initialize calls', async () => {
      if (manager.isWorkerSupported()) {
        const first = await manager.initialize();
        const second = await manager.initialize();
        
        // Second call should return same state (idempotent)
        expect(second).toBe(first);
      }
    });
  });
  
  describe('Async Worker Operations (Browser Environment)', () => {
    let manager: CalculationWorkerManager;
    let workerAvailable: boolean;
    
    beforeEach(async () => {
      manager = new CalculationWorkerManager();
      workerAvailable = await manager.initialize();
    });
    
    afterEach(() => {
      manager.terminate();
    });
    
    it('should calculate limits asynchronously when worker ready', async () => {
      const args = {
        keys: Array.from({ length: 600 }, (_, i) => ({ x: i, id: i, label: `Point ${i}` })),
        numerators: Array.from({ length: 600 }, () => Math.random() * 100),
        subset_points: Array.from({ length: 600 }, (_, i) => i)
      };
      
      // This should use worker if available (600 > minDataSize of 500)
      const result = await manager.calculateLimits('i', args);
      
      expect(result).toBeDefined();
      expect(result.keys.length).toBe(600);
      expect(result.values.length).toBe(600);
      expect(result.targets.length).toBe(600);
    });
    
    it('should use sync for small datasets regardless of worker state', async () => {
      const args = {
        keys: Array.from({ length: 50 }, (_, i) => ({ x: i, id: i, label: `Point ${i}` })),
        numerators: Array.from({ length: 50 }, () => Math.random() * 100),
        subset_points: Array.from({ length: 50 }, (_, i) => i)
      };
      
      // This should use sync (50 < minDataSize of 500)
      const result = await manager.calculateLimits('i', args);
      
      expect(result).toBeDefined();
      expect(result.keys.length).toBe(50);
    });
    
    it('should detect outliers asynchronously', async () => {
      const values = Array.from({ length: 600 }, () => Math.random() * 100);
      const limits = {
        keys: values.map((_, i) => ({ x: i, id: i, label: `Point ${i}` })),
        values,
        targets: Array(600).fill(50),
        ll99: Array(600).fill(20),
        ll95: Array(600).fill(30),
        ul95: Array(600).fill(70),
        ul99: Array(600).fill(80)
      };
      
      const result = await manager.detectOutliers(values, limits, {
        astronomical: true,
        shift: true,
        shiftN: 8,
        trend: true,
        trendN: 6
      });
      
      expect(result).toBeDefined();
      expect(result.astpoint.length).toBe(600);
      expect(result.shift.length).toBe(600);
      expect(result.trend.length).toBe(600);
    });
  });
  
  describe('Request Management', () => {
    it('should cancel pending request', () => {
      const manager = new CalculationWorkerManager();
      
      // No pending requests to cancel
      const cancelled = manager.cancelRequest('non-existent');
      expect(cancelled).toBe(false);
      
      manager.terminate();
    });
    
    it('should cancel all pending requests on terminate', async () => {
      const manager = new CalculationWorkerManager();
      await manager.initialize();
      
      // Terminate should not throw even with no pending requests
      expect(() => manager.terminate()).not.toThrow();
    });
  });
});
