/**
 * Change Detection System for PowerBI-SPC Custom Visual
 * 
 * Session 6 Implementation: Implements intelligent change detection to minimize
 * unnecessary recalculations and re-renders when data or settings change.
 * 
 * Key features:
 * 1. Hash-based comparison for incoming data to detect actual changes
 * 2. Settings change tracking by category
 * 3. Selective recalculation flags
 * 4. Render scheduling utilities
 */

/**
 * Change flags indicating what has changed between updates
 */
export interface ChangeFlags {
  /** Whether the input data has changed */
  dataChanged: boolean;
  /** Set of settings categories that have changed */
  settingsChanged: Set<string>;
  /** Whether control limits need recalculation */
  limitsNeedRecalc: boolean;
  /** Whether outlier detection needs to run */
  outliersNeedRecalc: boolean;
  /** Set of render stages that need to run */
  renderNeeded: Set<string>;
  /** Whether this is a resize-only change */
  resizeOnly: boolean;
  /** Whether viewport dimensions changed */
  viewportChanged: boolean;
}

/**
 * Data state snapshot for comparison
 */
export interface DataState {
  /** Hash of numerator values */
  numeratorsHash: string;
  /** Hash of denominator values */
  denominatorsHash: string | null;
  /** Hash of keys/labels */
  keysHash: string;
  /** Number of data points */
  dataLength: number;
  /** Hash of split indexes */
  splitIndexesHash: string;
  /** Viewport width */
  viewportWidth: number;
  /** Viewport height */
  viewportHeight: number;
}

/**
 * Settings state snapshot for comparison
 */
export interface SettingsState {
  /** Hash of each settings category */
  categoryHashes: Map<string, string>;
}

/**
 * Settings categories that map to specific render stages
 */
const SETTINGS_TO_RENDER_MAP: Record<string, string[]> = {
  'spc': ['dots', 'lines', 'icons'],
  'lines': ['lines', 'lineLabels'],
  'scatter': ['dots'],
  'outliers': ['dots', 'lines', 'icons'],
  'x_axis': ['xAxis'],
  'y_axis': ['yAxis'],
  'canvas': ['all'],
  'labels': ['valueLabels'],
  'nhs_icons': ['icons'],
  'summary_table': ['summaryTable'],
  'download': ['downloadButton']
};

/**
 * Settings that require limit recalculation when changed
 */
const LIMIT_RECALC_SETTINGS = new Set([
  'spc' // chart_type, outliers_in_limits, etc.
]);

/**
 * Settings that require outlier recalculation when changed
 */
const OUTLIER_RECALC_SETTINGS = new Set([
  'outliers' // astronomical, shift, trend, two_in_three settings
]);

/**
 * Fast hash function for arrays using FNV-1a algorithm
 * Optimized for performance with numeric arrays
 * 
 * @param arr - Array to hash
 * @returns Hash string
 */
export function hashArray(arr: unknown[] | null | undefined): string {
  if (!arr || arr.length === 0) {
    return 'empty';
  }
  
  // FNV-1a hash - fast and has good distribution
  let hash = 2166136261; // FNV offset basis
  const FNV_PRIME = 16777619;
  
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    // Convert value to a consistent string representation
    let strValue: string;
    if (value === null || value === undefined) {
      strValue = 'null';
    } else if (typeof value === 'number') {
      // Handle NaN and Infinity specially
      if (Number.isNaN(value)) {
        strValue = 'NaN';
      } else if (!Number.isFinite(value)) {
        strValue = value > 0 ? 'Inf' : '-Inf';
      } else {
        // Use fixed precision to avoid floating point comparison issues
        // 6 decimal places is sufficient for most SPC applications
        // and avoids unnecessary hash differences for effectively equal numbers
        strValue = value.toFixed(6);
      }
    } else if (typeof value === 'object') {
      strValue = JSON.stringify(value);
    } else {
      strValue = String(value);
    }
    
    // Hash each character of the string representation
    for (let j = 0; j < strValue.length; j++) {
      hash ^= strValue.charCodeAt(j);
      hash = Math.imul(hash, FNV_PRIME);
    }
  }
  
  // Convert to unsigned 32-bit integer and return as hex string
  return (hash >>> 0).toString(16);
}

/**
 * Hash an object by stringifying and hashing its key-value pairs
 * 
 * @param obj - Object to hash
 * @returns Hash string
 */
export function hashObject(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) {
    return 'null';
  }
  
  // Sort keys for consistent ordering
  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'function') {
      continue; // Skip functions
    }
    pairs.push(`${key}:${JSON.stringify(value)}`);
  }
  
  return hashArray(pairs);
}

/**
 * Create a data state snapshot from current input data
 * 
 * @param numerators - Array of numerator values
 * @param denominators - Array of denominator values (optional)
 * @param keys - Array of key objects
 * @param splitIndexes - Array of split indexes
 * @param viewportWidth - Current viewport width
 * @param viewportHeight - Current viewport height
 * @returns DataState snapshot
 */
export function createDataState(
  numerators: number[] | null,
  denominators: number[] | null | undefined,
  keys: { x: number; id: number; label: string }[] | null,
  splitIndexes: number[] | null,
  viewportWidth: number,
  viewportHeight: number
): DataState {
  return {
    numeratorsHash: hashArray(numerators),
    denominatorsHash: denominators ? hashArray(denominators) : null,
    keysHash: keys ? hashArray(keys.map(k => k.label)) : 'null',
    dataLength: numerators?.length ?? 0,
    splitIndexesHash: hashArray(splitIndexes),
    viewportWidth,
    viewportHeight
  };
}

/**
 * Create a settings state snapshot from current settings
 * 
 * @param settings - The settings object with all categories (accepts any nested object structure)
 * @returns SettingsState snapshot
 */
export function createSettingsState<T extends Record<string, unknown>>(
  settings: T
): SettingsState {
  const categoryHashes = new Map<string, string>();
  
  for (const category of Object.keys(settings)) {
    categoryHashes.set(category, hashObject(settings[category] as Record<string, unknown>));
  }
  
  return { categoryHashes };
}

/**
 * Detect changes between two data states
 * 
 * @param prev - Previous data state
 * @param current - Current data state
 * @returns Object with data change flags
 */
export function detectDataChanges(
  prev: DataState | null,
  current: DataState
): { dataChanged: boolean; resizeOnly: boolean; viewportChanged: boolean } {
  if (!prev) {
    return { dataChanged: true, resizeOnly: false, viewportChanged: true };
  }
  
  const viewportChanged = prev.viewportWidth !== current.viewportWidth ||
                          prev.viewportHeight !== current.viewportHeight;
  
  const dataChanged = prev.numeratorsHash !== current.numeratorsHash ||
                      prev.denominatorsHash !== current.denominatorsHash ||
                      prev.keysHash !== current.keysHash ||
                      prev.dataLength !== current.dataLength ||
                      prev.splitIndexesHash !== current.splitIndexesHash;
  
  const resizeOnly = viewportChanged && !dataChanged;
  
  return { dataChanged, resizeOnly, viewportChanged };
}

/**
 * Detect changes between two settings states
 * 
 * @param prev - Previous settings state
 * @param current - Current settings state
 * @returns Set of changed settings categories
 */
export function detectSettingsChanges(
  prev: SettingsState | null,
  current: SettingsState
): Set<string> {
  const changedCategories = new Set<string>();
  
  if (!prev) {
    // All categories are "changed" on first run
    for (const category of current.categoryHashes.keys()) {
      changedCategories.add(category);
    }
    return changedCategories;
  }
  
  for (const [category, hash] of current.categoryHashes) {
    const prevHash = prev.categoryHashes.get(category);
    if (prevHash !== hash) {
      changedCategories.add(category);
    }
  }
  
  return changedCategories;
}

/**
 * Compute comprehensive change flags from data and settings changes
 * 
 * @param prevDataState - Previous data state
 * @param currentDataState - Current data state  
 * @param prevSettingsState - Previous settings state
 * @param currentSettingsState - Current settings state
 * @param isFirstRun - Whether this is the first update
 * @returns Complete ChangeFlags object
 */
export function computeChangeFlags(
  prevDataState: DataState | null,
  currentDataState: DataState,
  prevSettingsState: SettingsState | null,
  currentSettingsState: SettingsState,
  isFirstRun: boolean
): ChangeFlags {
  const { dataChanged, resizeOnly, viewportChanged } = detectDataChanges(prevDataState, currentDataState);
  const settingsChanged = detectSettingsChanges(prevSettingsState, currentSettingsState);
  
  const renderNeeded = new Set<string>();
  let limitsNeedRecalc = false;
  let outliersNeedRecalc = false;
  
  // On first run, everything needs to happen
  if (isFirstRun) {
    renderNeeded.add('all');
    limitsNeedRecalc = true;
    outliersNeedRecalc = true;
    
    return {
      dataChanged: true,
      settingsChanged,
      limitsNeedRecalc,
      outliersNeedRecalc,
      renderNeeded,
      resizeOnly: false,
      viewportChanged: true
    };
  }
  
  // Data changes trigger limit and outlier recalculation
  if (dataChanged) {
    limitsNeedRecalc = true;
    outliersNeedRecalc = true;
    renderNeeded.add('dots');
    renderNeeded.add('lines');
    renderNeeded.add('icons');
    renderNeeded.add('xAxis');
    renderNeeded.add('yAxis');
    renderNeeded.add('valueLabels');
    renderNeeded.add('lineLabels');
  }
  
  // Check settings changes for recalculation needs
  for (const category of settingsChanged) {
    if (LIMIT_RECALC_SETTINGS.has(category)) {
      limitsNeedRecalc = true;
      outliersNeedRecalc = true;
    }
    if (OUTLIER_RECALC_SETTINGS.has(category)) {
      outliersNeedRecalc = true;
    }
    
    // Map settings changes to render stages
    const renderStages = SETTINGS_TO_RENDER_MAP[category];
    if (renderStages) {
      for (const stage of renderStages) {
        renderNeeded.add(stage);
      }
    }
  }
  
  // Viewport changes always need axis re-render
  if (viewportChanged) {
    renderNeeded.add('xAxis');
    renderNeeded.add('yAxis');
  }
  
  // Resize-only optimization: if only viewport changed, we just need to re-render
  // without recalculating limits or outliers
  if (resizeOnly && !limitsNeedRecalc) {
    renderNeeded.add('dots');
    renderNeeded.add('lines');
  }
  
  return {
    dataChanged,
    settingsChanged,
    limitsNeedRecalc,
    outliersNeedRecalc,
    renderNeeded,
    resizeOnly,
    viewportChanged
  };
}

/**
 * Debounce function for resize events
 * 
 * @param fn - Function to debounce
 * @param wait - Wait time in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return function(this: unknown, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * Render scheduler using requestAnimationFrame for batching
 * Collects multiple render requests and executes them in a single frame
 */
export class RenderScheduler {
  private pendingRender: Set<string> = new Set();
  private frameRequested: boolean = false;
  private renderCallback: ((stages: Set<string>) => void) | null = null;
  
  /**
   * Set the render callback function
   * @param callback - Function to call when rendering
   */
  setRenderCallback(callback: (stages: Set<string>) => void): void {
    this.renderCallback = callback;
  }
  
  /**
   * Schedule a render for specific stages
   * Multiple calls within the same frame will be batched together
   * 
   * @param stages - Set of render stages to execute
   */
  scheduleRender(stages: Set<string>): void {
    // Add all stages to pending set
    for (const stage of stages) {
      this.pendingRender.add(stage);
    }
    
    // Request animation frame if not already requested
    if (!this.frameRequested && this.renderCallback) {
      this.frameRequested = true;
      
      // Use requestAnimationFrame for smooth rendering
      // Falls back to setTimeout for environments without rAF
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => this.executeRender());
      } else {
        setTimeout(() => this.executeRender(), 16); // ~60fps
      }
    }
  }
  
  /**
   * Execute the pending render and clear the queue
   */
  private executeRender(): void {
    this.frameRequested = false;
    
    if (this.pendingRender.size > 0 && this.renderCallback) {
      const stagesToRender = new Set(this.pendingRender);
      this.pendingRender.clear();
      this.renderCallback(stagesToRender);
    }
  }
  
  /**
   * Cancel any pending render
   */
  cancelPending(): void {
    this.pendingRender.clear();
    this.frameRequested = false;
  }
  
  /**
   * Check if there is a pending render
   */
  hasPending(): boolean {
    return this.pendingRender.size > 0;
  }
}

/**
 * Cache manager for computed values that can be reused between updates
 * when underlying data hasn't changed
 */
export class ComputedValueCache<K, V> {
  private cache: Map<K, V> = new Map();
  private validityHashes: Map<K, string> = new Map();
  
  /**
   * Get a cached value if it's still valid
   * 
   * @param key - Cache key
   * @param currentHash - Current data hash to check validity
   * @returns Cached value or undefined if invalid/missing
   */
  get(key: K, currentHash: string): V | undefined {
    const storedHash = this.validityHashes.get(key);
    if (storedHash === currentHash) {
      return this.cache.get(key);
    }
    return undefined;
  }
  
  /**
   * Set a cached value with its validity hash
   * 
   * @param key - Cache key
   * @param value - Value to cache
   * @param hash - Hash for validity checking
   */
  set(key: K, value: V, hash: string): void {
    this.cache.set(key, value);
    this.validityHashes.set(key, hash);
  }
  
  /**
   * Invalidate a specific cache entry
   * 
   * @param key - Cache key to invalidate
   */
  invalidate(key: K): void {
    this.cache.delete(key);
    this.validityHashes.delete(key);
  }
  
  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
    this.validityHashes.clear();
  }
  
  /**
   * Get the current cache size
   */
  get size(): number {
    return this.cache.size;
  }
}
