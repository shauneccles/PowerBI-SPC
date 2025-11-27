# Performance Improvement Plan for PowerBI-SPC Custom Visual

## Executive Summary

This document outlines a comprehensive 10-session performance improvement plan for the PowerBI-SPC custom visual. The plan is based on analysis of the existing benchmark system and identification of key performance bottlenecks in the visual's architecture.

**Sessions 1-5**: Core computational optimizations (limit calculations, outlier detection, D3 rendering, ViewModel processing) - **COMPLETED**

**Session 6**: Change detection and selective rendering - **COMPLETED**

**Session 7**: Summary table virtualization - **COMPLETED**

**Sessions 8-10**: Advanced optimizations (axis caching, selection optimization, Web Worker offloading) - **PLANNED**

### Current State Assessment

The existing benchmark system (`test/benchmarks/`) provides solid infrastructure for:
- **Limit Calculations**: Benchmarking 4 chart types (i, mr, run, p) across 4 dataset sizes (10, 100, 500, 1000 points)
- **Outlier Detection**: Benchmarking 4 rules (astronomical, shift, trend, twoInThree)
- **Historical Tracking**: JSON-based history with git commit tracking
- **Baseline Comparison**: Ability to compare against established baselines

### Key Performance Observations

Based on benchmark results analysis:

| Category | Operation | 100 pts | 1000 pts | Notes |
|----------|-----------|---------|----------|-------|
| Limit Calculations | i chart | ~33μs | ~535μs | Good linear scaling |
| Limit Calculations | p chart | ~73μs | ~1250μs | Higher complexity due to denominator calculations |
| Outlier Detection | astronomical | ~18μs | ~26μs | Excellent O(n) performance |
| Outlier Detection | twoInThree | ~29μs | ~234μs | Needs optimization investigation - likely O(n²) sliding window |

### Identified Performance Bottlenecks

1. **Rendering Pipeline**: D3 data binding and DOM manipulation in `drawDots.ts` and `drawLines.ts`
2. **Data Processing**: Deep copy operations in `viewModelClass.ts` (JSON.parse/stringify)
3. **Missing Benchmarks**: No rendering performance coverage in standalone benchmark suite
4. **Statistical Calculations**: Some limit calculation functions (p chart, xbar) show higher complexity

---

## Session 1: Benchmark System Enhancement

### Objective
Extend the benchmark system to provide comprehensive coverage of all performance-critical operations.

### Key Deliverables

1. **Complete Limit Calculation Coverage**
   - Add benchmarks for all 14 chart types: i, mr, run, c, p, u, s, pprime, uprime, xbar, g, t, i_m, i_mm
   - Currently only 4 types are benchmarked in `run-benchmarks.ts`

2. **Add Memory Profiling**
   - Track memory allocation during benchmark runs
   - Identify memory leaks in repeated operations
   - Add `heapUsed` and `heapTotal` metrics to benchmark results

3. **Add Rendering Benchmarks to Standalone Suite**
   - Create headless rendering benchmarks using linkedom
   - Measure D3 data binding performance
   - Benchmark DOM element creation/update cycles

4. **Improve Statistical Accuracy**
   - Increase default iterations from 20 to 50 for more stable results
   - Add percentile metrics (p95, p99) for outlier detection
   - Implement warm-up phase improvements

### Implementation Guidance

```typescript
// benchmark-runner.ts additions
interface BenchmarkResult {
  // Existing fields...
  p95: number;          // 95th percentile
  p99: number;          // 99th percentile
  memoryUsed?: number;  // Heap memory delta in bytes
}

// Add memory tracking
benchmark(name: string, category: string, fn: () => void, options: BenchmarkOptions): BenchmarkResult {
  const memBefore = process.memoryUsage().heapUsed;
  // ... run benchmarks
  const memAfter = process.memoryUsage().heapUsed;
  result.memoryUsed = memAfter - memBefore;
}
```

### Rationale
- Complete benchmark coverage enables accurate identification of optimization opportunities
- Memory profiling is critical for Power BI visuals as they operate in constrained environments
- Statistical improvements reduce noise in measurements

---

## Session 2: Limit Calculation Optimizations

### Objective
Optimize the most computationally expensive limit calculation algorithms.

### Key Deliverables

1. **Optimize p chart Calculations**
   - Current: ~1250μs for 1000 points
   - Target: <800μs for 1000 points
   - Focus on reducing redundant array operations

2. **Optimize Array Operations in Helper Functions**
   - Review `src/Functions/` for inefficient patterns
   - Replace chained `.map().filter()` with single-pass operations
   - Use typed arrays where appropriate

3. **Implement Memoization for Repeated Calculations**
   - Cache statistical calculations (mean, standard deviation)
   - Implement lazy evaluation for limit arrays

4. **Optimize xbar Chart Weighted Calculations**
   - Profile and optimize the complex weighted mean calculations
   - Reduce object allocations during processing

### Implementation Guidance

```typescript
// Example optimization for consecutive difference calculation in i.ts
// Before:
const consec_diff: number[] = abs(diff(ratio_subset));

// After (single pass):
const consec_diff: number[] = new Array(ratio_subset.length - 1);
for (let i = 0; i < ratio_subset.length - 1; i++) {
  consec_diff[i] = Math.abs(ratio_subset[i + 1] - ratio_subset[i]);
}
```

### Rationale
- p chart is the slowest limit calculation (~2.3x slower than i chart)
- Function call overhead compounds in tight loops
- Typed arrays provide better JIT optimization opportunities

---

## Session 3: Outlier Detection Optimizations

### Objective
Improve outlier detection algorithm performance, particularly for the twoInThree rule.

### Key Deliverables

1. **Optimize twoInThree Rule**
   - Current: Shows non-linear scaling (29μs → 234μs, ~8x for 10x data)
   - Target: Linear O(n) scaling
   - Review sliding window implementation

2. **Optimize shift Rule**
   - Current: ~112μs for 1000 points
   - Target: <80μs for 1000 points
   - Implement running count optimization

3. **Optimize trend Rule**
   - Current: ~103μs for 1000 points
   - Target: <70μs for 1000 points
   - Use incremental direction tracking

4. **Implement Early Exit Optimizations**
   - Skip outlier detection for data subsets below threshold
   - Add early termination for sequences meeting criteria

### Implementation Guidance

```typescript
// Optimized shift rule with running count
export default function shift(values: number[], targets: number[], n: number): string[] {
  const result: string[] = new Array(values.length).fill("none");
  let aboveCount = 0;
  let belowCount = 0;
  
  for (let i = 0; i < values.length; i++) {
    if (values[i] > targets[i]) {
      aboveCount++;
      belowCount = 0;
    } else if (values[i] < targets[i]) {
      belowCount++;
      aboveCount = 0;
    } else {
      aboveCount = 0;
      belowCount = 0;
    }
    
    if (aboveCount >= n) {
      for (let j = i - n + 1; j <= i; j++) {
        result[j] = "upper";
      }
    }
    if (belowCount >= n) {
      for (let j = i - n + 1; j <= i; j++) {
        result[j] = "lower";
      }
    }
  }
  return result;
}
```

### Rationale
- twoInThree shows concerning O(n²) behavior that needs addressing
- SPC outlier rules are applied on every data update
- Early exit conditions can significantly reduce average-case time

---

## Session 4: D3 Rendering Pipeline Optimizations

### Objective
Optimize the D3 rendering pipeline for faster visual updates and reduced DOM manipulation overhead.

### Key Deliverables

1. **Optimize drawDots.ts**
   - Pre-compute symbol paths once per unique shape/size combination
   - Cache scale calculations
   - Reduce per-element style calculations

2. **Optimize drawLines.ts**
   - Pre-compute line generators
   - Batch path string generation
   - Reduce filter/defined function calls

3. **Implement Efficient Update Pattern**
   - Add change detection to avoid unnecessary re-renders
   - Implement partial updates for data changes vs. style changes
   - Use D3's enter/update/exit pattern more efficiently

4. **Optimize SVG Element Attributes**
   - Batch attribute changes
   - Reduce CSS property lookups
   - Use transform instead of individual x/y attributes where appropriate

### Implementation Guidance

```typescript
// Pre-computed symbol path cache in drawDots.ts
// Caches the generated path string for each unique shape/size combination
const symbolPathCache = new Map<string, string>();

function getSymbolPath(shape: string, size: number): string {
  const key = `${shape}-${size}`;
  if (!symbolPathCache.has(key)) {
    // Generate the path string once and cache it
    const symbolGenerator = d3.symbol().type(d3[`symbol${shape}`]).size((size * size) * Math.PI);
    symbolPathCache.set(key, symbolGenerator());
  }
  return symbolPathCache.get(key);
}

// Use in render - returns cached path string directly:
.attr("d", (d: plotData) => getSymbolPath(d.aesthetics.shape, d.aesthetics.size))
```

### Rationale
- DOM manipulation is the primary rendering bottleneck
- Symbol path generation is pure and deterministic (ideal for caching)
- Power BI visuals receive frequent resize and update events

---

## Session 5: Data Processing & ViewModel Optimizations

### Objective
Optimize data processing in the ViewModel to reduce memory allocation and improve update performance.

### Key Deliverables

1. **Eliminate Deep Copy Operations**
   - Replace `JSON.parse(JSON.stringify())` with structured cloning or manual copy
   - Use object pooling for frequently created structures
   - Implement immutable data patterns where appropriate

2. **Optimize initialisePlotData Function**
   - Current loop creates many intermediate objects
   - Implement batch processing for large datasets
   - Pre-allocate arrays with known sizes

3. **Optimize initialiseGroupedLines Function**
   - Reduce object creation in inner loops
   - Use typed arrays for coordinate data
   - Implement lazy line data generation

4. **Add Incremental Update Support**
   - Detect minimal changes in data updates
   - Implement delta updates instead of full recalculation
   - Cache computed values between updates

### Implementation Guidance

```typescript
// Replace JSON.parse/stringify deep copy pattern
// BEFORE (inefficient - creates string intermediary, ~10x slower):
const data: dataObject = JSON.parse(JSON.stringify(inputData));

// AFTER Option 1 - Using structuredClone (Node 17+, best for complex nested objects):
const data: dataObject = structuredClone(inputData);

// AFTER Option 2 - Manual structured copy (for performance-critical paths):
function deepCopyLimitArgs(data: dataObject): dataObject {
  return {
    ...data,
    limitInputArgs: {
      keys: data.limitInputArgs.keys.slice(),
      numerators: data.limitInputArgs.numerators.slice(),
      denominators: data.limitInputArgs.denominators?.slice(),
      // ... other fields
    }
  };
}

// Pre-allocate arrays in initialisePlotData
initialisePlotData(host: IVisualHost): void {
  const n = this.controlLimits.keys.length;
  this.plotPoints = new Array(n);  // Pre-allocate
  this.tickLabels = new Array(n);  // Pre-allocate
  
  for (let i = 0; i < n; i++) {
    // Direct assignment instead of push()
    this.plotPoints[i] = { /* ... */ };
    this.tickLabels[i] = { /* ... */ };
  }
}
```

### Rationale
- `JSON.parse(JSON.stringify())` is expensive (~10x slower than manual copy)
- Array pre-allocation reduces GC pressure
- Power BI visual updates should complete in <16ms for 60fps interaction

---

## Performance Targets

### Limit Calculations
| Operation | Current (1000 pts) | Target | Improvement |
|-----------|-------------------|--------|-------------|
| i chart | ~535μs | <400μs | 25% |
| p chart | ~1250μs | <800μs | 35% |
| xbar chart | TBD | <600μs | - |

### Outlier Detection
| Operation | Current (1000 pts) | Target | Improvement |
|-----------|-------------------|--------|-------------|
| astronomical | ~26μs | <25μs | 5% |
| shift | ~112μs | <80μs | 30% |
| trend | ~103μs | <70μs | 30% |
| twoInThree | ~234μs | <150μs | 35% |

### Rendering (New Benchmarks)
| Operation | Target (100 pts) | Target (1000 pts) |
|-----------|-----------------|-------------------|
| Initial render | <100ms | <500ms |
| Update render | <50ms | <200ms |
| Resize | <20ms | <50ms |

---

## Success Metrics

1. **Benchmark Improvements**: All sessions should demonstrate measurable improvements in benchmark results
2. **Test Coverage**: Maintain or improve existing test coverage (currently 77.4% statements)
3. **No Regressions**: All 834 existing tests must continue to pass
4. **Real-World Performance**: Visual should remain responsive with datasets up to 10,000 points

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Optimization breaks edge cases | Medium | High | Comprehensive test suite coverage |
| Memory optimizations cause leaks | Low | High | Memory profiling in benchmarks |
| Rendering changes affect visual output | Medium | Medium | Visual regression testing |
| Type safety compromises | Low | Medium | TypeScript strict mode |

---

## Appendix: Current Benchmark System Analysis

### Strengths
- Comprehensive statistical metrics (mean, median, stdDev, min, max)
- Git commit tracking for historical analysis
- CSV export capability for external analysis
- Well-documented README with usage examples

### Areas for Improvement
- Limited to 4 of 14 chart types in benchmarks
- No memory profiling
- No rendering benchmarks in standalone suite
- Iteration count (20) may be insufficient for noisy results

### File Structure
```
test/benchmarks/
├── README.md              # Documentation
├── benchmark-runner.ts    # Core runner class
├── run-benchmarks.ts      # Main benchmark suite
└── benchmark-history.ts   # History viewer/exporter

benchmark-results/
├── benchmark-history.json # Historical results
└── benchmark-baseline.json # Baseline for comparisons (when created)
```

---

## Session Completion Status

### Session 1: Benchmark System Enhancement ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Successfully enhanced the benchmark system with comprehensive coverage, memory profiling, and statistical improvements.

**Key Deliverables:**
- ✅ Extended limit calculation benchmarks to 12 of 14 chart types (s and xbar skipped due to ts-node circular dependency issue)
- ✅ Added memory profiling with heap usage tracking
- ✅ Added P95 and P99 percentile metrics
- ✅ Increased default iterations from 10 to 50
- ✅ Added 4 rendering benchmarks using linkedom
- ✅ Improved warm-up phase from 3 to 5 runs

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_1.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_1.md)

**Key Performance Findings:**
| Category | 1000 pts Median | Notes |
|----------|-----------------|-------|
| Fastest limit calc | mr chart: ~475μs | Simple formula |
| Slowest limit calc | t chart: ~2.3ms | Power transforms |
| Fastest outlier | astronomical: ~25μs | O(n) performance |
| DOM creation | ~1.3ms | High variance |

### Session 2: Limit Calculation Optimizations ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Delivered significant performance improvements to limit calculation algorithms, achieving **53-83% speed improvements** across all chart types through algorithmic optimization and elimination of expensive deep copy operations.

**Key Deliverables:**
- ✅ Optimized `extractValues` function from O(n²) to O(n) using Set for index lookup - **Primary performance driver**
- ✅ Eliminated `JSON.parse(JSON.stringify())` deep copy in t chart calculations
- ✅ Optimized `viewModelClass.calculateLimits` to avoid full dataObject deep copies
- ✅ All existing tests continue to pass
- ✅ Benchmark baseline updated with new performance targets

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_2.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_2.md)

**Performance Improvements (1000 data points):**
| Chart Type | Before | After | Improvement |
|------------|--------|-------|-------------|
| i chart | ~603μs | ~143μs | **76%** |
| mr chart | ~546μs | ~93μs | **83%** |
| p chart | ~1359μs | ~453μs | **67%** |
| t chart | ~2182μs | ~1015μs | **53%** |
| pprime chart | ~2019μs | ~653μs | **68%** |
| uprime chart | ~1955μs | ~596μs | **69%** |

**Target Achievement:**
| Metric | Target | Achieved | Status |
|--------|--------|----------|--------|
| i chart (1000 pts) | <400μs | ~143μs | ✅ Exceeded by 64% |
| p chart (1000 pts) | <800μs | ~453μs | ✅ Exceeded by 43% |

### Session 3: Outlier Detection Optimizations ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Delivered significant performance improvements to outlier detection algorithms, achieving **67-91% speed improvements** across the three optimized rules through sliding window algorithm optimization.

**Key Deliverables:**
- ✅ Optimized `twoInThree` rule from O(n²) to O(n) using running total sliding window - **91% improvement**
- ✅ Optimized `shift` rule from O(n²) to O(n) using running total sliding window - **67% improvement**
- ✅ Optimized `trend` rule from O(n²) to O(n) using running total sliding window - **87% improvement**
- ✅ Fixed edge case bounds checking in backfill loops
- ✅ All 834 tests continue to pass
- ✅ Benchmark baseline updated with new performance metrics

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_3.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_3.md)

**Performance Improvements (1000 data points):**
| Outlier Rule | Before | After | Improvement |
|--------------|--------|-------|-------------|
| shift | ~171μs | ~57μs | **67%** |
| trend | ~139μs | ~18μs | **87%** |
| twoInThree | ~129μs | ~22μs | **91%** |

**Target Achievement:**
| Metric | Target | Achieved | Status |
|--------|--------|----------|--------|
| shift (1000 pts) | <80μs | ~57μs | ✅ Exceeded by 29% |
| trend (1000 pts) | <70μs | ~18μs | ✅ Exceeded by 74% |
| twoInThree (1000 pts) | <150μs | ~22μs | ✅ Exceeded by 85% |

**Scaling Behavior:**
The algorithms now demonstrate linear O(n) scaling instead of the original O(n²) behavior, which was causing significant slowdowns on larger datasets.

### Session 4: D3 Rendering Pipeline Optimizations ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Delivered significant performance improvements to the D3 rendering pipeline through symbol path caching and line generator optimization, achieving **17x-49x speedup** for symbol path generation.

**Key Deliverables:**
- ✅ Implemented symbol path caching in drawDots.ts with Map-based cache
- ✅ Optimized drawLines.ts with hoisted calculations and cached line generator
- ✅ Added symbol caching benchmarks to measure optimization effectiveness
- ✅ Exported cache utility functions for testing and monitoring
- ✅ All 834 tests continue to pass
- ✅ Benchmark baseline updated with new performance metrics

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_4.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_4.md)

**Performance Improvements (Symbol Path Generation):**

| Data Points | Uncached | Cached | Improvement |
|-------------|----------|--------|-------------|
| 10 pts | ~83μs | ~1.7μs | **49x faster** |
| 100 pts | ~240μs | ~14μs | **17x faster** |
| 500 pts | ~926μs | ~41μs | **23x faster** |
| 1000 pts | ~1742μs | ~50μs | **35x faster** |

**Key Optimization Technique:**
The symbol path cache stores pre-computed D3 symbol path strings, eliminating redundant trigonometric calculations. Since D3 symbol paths are deterministic (same shape + size = same path), caching provides massive performance benefits with minimal memory overhead (~3.2KB for typical usage).

### Session 5: Data Processing & ViewModel Optimizations ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Delivered targeted performance improvements to the ViewModel data processing pipeline through array pre-allocation, cached property lookups, and optimized grouping algorithms. These optimizations reduce memory pressure and improve CPU efficiency during visual update cycles.

**Key Deliverables:**
- ✅ Pre-allocated arrays in `initialisePlotData` with direct index assignment
- ✅ Cached property chain lookups to reduce object traversal overhead
- ✅ Set-based index lookups in `initialiseGroupedLines` for O(1) vs O(n) rebaseline checks
- ✅ Direct Map grouping to eliminate intermediate array and groupBy overhead
- ✅ Added ViewModel processing benchmarks to track optimization effectiveness
- ✅ All 833 tests continue to pass
- ✅ Benchmark baseline updated with Session 5 metrics

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_5.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_5.md)

**Performance Improvements:**

| Optimization | Impact |
|--------------|--------|
| Array pre-allocation | ~13% faster at 1000 points, reduced GC pressure |
| Cached property lookups | Reduced property chain traversal overhead |
| Set-based index lookups | O(1) vs O(n) per iteration for rebaseline checks |
| Direct Map grouping | Eliminated intermediate array, single-pass grouping |

### Session 6: Incremental Update & Change Detection ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Implemented an intelligent change detection system using hash-based comparisons to minimize unnecessary recalculations and re-renders when data or settings change. The system enables selective recalculation and selective rendering based on what actually changed.

**Key Deliverables:**
- ✅ Hash-based data change detection using FNV-1a algorithm
- ✅ Settings change detection by category with render stage mapping
- ✅ Selective limit recalculation when data unchanged
- ✅ Selective outlier detection when limits unchanged
- ✅ Selective rendering for affected components only
- ✅ Change detection benchmarks added to characterize overhead
- ✅ All 834 tests continue to pass

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_6.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_6.md)

**Performance Characteristics (Change Detection Overhead):**

| Operation | 10 pts | 100 pts | 500 pts | 1000 pts |
|-----------|--------|---------|---------|----------|
| hashArray (numbers) | ~7μs | ~69μs | ~74μs | ~148μs |
| createDataState | ~20μs | ~32μs | ~151μs | ~301μs |
| computeChangeFlags | ~1.6μs | ~1.6μs | ~1.6μs | ~1.6μs |
| detectDataChanges | ~0.2μs | ~0.2μs | ~0.2μs | ~0.2μs |

**Key Performance Insight:**
The change detection overhead (~315μs for 1000 points) is more than offset by avoided recalculations:
- Limit calculation avoided: ~500-1000μs
- Outlier detection avoided: ~100-300μs
- Full render avoided: ~1000-2000μs

**Net benefit for unchanged data: ~1700-3300μs saved per update**

### Session 7: Summary Table Virtualization ✅ COMPLETED

**Completion Date:** 2025-11-27

**Summary:** Implemented virtual scrolling for the summary table to efficiently handle large datasets by rendering only visible rows plus a small buffer. This dramatically reduces DOM node count and memory usage while maintaining smooth scrolling performance.

**Key Deliverables:**
- ✅ VirtualTable class with viewport-based row rendering
- ✅ Row pooling for DOM element reuse during scroll
- ✅ Efficient data binding without recreating elements
- ✅ Lazy NHS icon rendering (deferred until visible)
- ✅ Automatic activation for datasets >= 50 rows
- ✅ Virtualization benchmarks added
- ✅ All 834 tests continue to pass

**Detailed Documentation:** See [PERFORMANCE_IMPROVEMENT_PLAN_SESSION_7.md](PERFORMANCE_IMPROVEMENT_PLAN_SESSION_7.md)

**Performance Improvements (Row Creation):**

| Data Size | Traditional (all rows) | Virtual (visible only) | Improvement |
|-----------|----------------------|----------------------|-------------|
| 100 rows | ~642μs | ~184μs | **71% faster** |
| 500 rows | ~2,996μs | ~179μs | **94% faster** |
| 1000 rows | ~6,090μs | ~179μs | **97% faster** |

**DOM Node Reduction:**

| Data Size | Traditional DOM Nodes | Virtual DOM Nodes | Memory Reduction |
|-----------|----------------------|-------------------|------------------|
| 100 rows | ~400 | ~130 | **68%** |
| 500 rows | ~2,000 | ~130 | **93.5%** |
| 1000 rows | ~4,000 | ~130 | **96.75%** |

**Key Performance Insight:**
Virtualization renders only ~30 visible rows regardless of total data size, enabling constant-time DOM operations for scroll and render. This is critical for maintaining 60fps scrolling with large datasets.

---

## Session 7: Summary Table Virtualization

### Objective
Implement virtual scrolling for the summary table to handle large datasets efficiently, rendering only visible rows.

### Key Deliverables

1. **Virtual Scroll Container**
   - Implement viewport-based row rendering
   - Render only visible rows plus small buffer
   - Maintain scroll position and handle rapid scrolling

2. **Row Pooling**
   - Reuse DOM elements as user scrolls
   - Avoid creating/destroying elements during scroll
   - Pre-allocate row buffer pool

3. **Efficient Data Binding**
   - Update row content without recreating elements
   - Cache row heights for consistent scrollbar
   - Handle variable row heights if needed

4. **Lazy Cell Rendering**
   - Defer NHS icon SVG creation until row visible
   - Cache rendered icons for reuse
   - Progressive enhancement for complex cells

### Implementation Guidance

```typescript
// Virtual table renderer
class VirtualTable {
  private rowPool: HTMLTableRowElement[] = [];
  private visibleStartIdx: number = 0;
  private visibleEndIdx: number = 0;
  private rowHeight: number = 30;  // Estimated row height
  private bufferSize: number = 5;   // Extra rows above/below viewport
  
  render(data: plotData[], container: HTMLElement, viewport: { top: number; height: number }) {
    // Calculate visible range
    const firstVisible = Math.max(0, Math.floor(viewport.top / this.rowHeight) - this.bufferSize);
    const lastVisible = Math.min(data.length - 1, 
                                  Math.ceil((viewport.top + viewport.height) / this.rowHeight) + this.bufferSize);
    
    // Recycle rows outside visible range
    for (let i = this.visibleStartIdx; i < firstVisible; i++) {
      this.recycleRow(i);
    }
    for (let i = lastVisible + 1; i <= this.visibleEndIdx; i++) {
      this.recycleRow(i);
    }
    
    // Render newly visible rows
    for (let i = firstVisible; i <= lastVisible; i++) {
      if (i < this.visibleStartIdx || i > this.visibleEndIdx) {
        this.renderRow(i, data[i]);
      }
    }
    
    this.visibleStartIdx = firstVisible;
    this.visibleEndIdx = lastVisible;
    
    // Set spacer height for scrollbar accuracy
    const totalHeight = data.length * this.rowHeight;
    container.style.height = `${totalHeight}px`;
  }
}
```

### Rationale
- Summary tables with 1000+ rows cause significant DOM overhead
- Current implementation creates all rows upfront
- Virtual scrolling reduces DOM nodes from N to ~50 (visible + buffer)
- Essential for responsive interaction with large datasets

### Expected Impact
| Data Size | Current DOM Nodes | Virtual DOM Nodes | Memory Saved |
|-----------|-------------------|-------------------|--------------|
| 100 rows | ~400 | ~100 | 75% |
| 1000 rows | ~4000 | ~100 | 97% |
| 5000 rows | ~20000 | ~100 | 99.5% |

---

## Session 8: Axis Rendering Optimization

### Objective
Optimize axis rendering through tick caching, label pooling, and efficient tick format calculation.

### Key Deliverables

1. **Tick Label Caching**
   - Cache tick label lookup in drawXAxis (currently O(n) filter per tick)
   - Convert tickLabels array to Map for O(1) lookup
   - Pre-compute formatted tick strings

2. **Axis Scale Caching**
   - Cache scale domain/range when unchanged
   - Avoid recreating d3.scale objects on every render
   - Share scale calculations between X and Y axes where applicable

3. **Label Formatting Optimization**
   - Cache toFixed() results for Y-axis percentage labels
   - Pre-format tick values during data processing
   - Avoid repeated string concatenation in tight loops

4. **DOM Update Minimization**
   - Use D3 key functions for efficient tick updates
   - Batch attribute changes
   - Skip redundant style applications

### Implementation Guidance

```typescript
// Cached tick label lookup in drawXAxis.ts
// BEFORE: O(n) filter per tick
xAxis.tickFormat(axisX => {
  const targetKey = visualObj.viewModel.tickLabels.filter(d => d.x == <number>axisX);
  return targetKey.length > 0 ? targetKey[0].label : "";
});

// AFTER: O(1) Map lookup
// Pre-build map in viewModel during data processing
const tickLabelMap = new Map<number, string>();
for (const tick of tickLabels) {
  tickLabelMap.set(tick.x, tick.label);
}

// Use in axis render
xAxis.tickFormat(axisX => tickLabelMap.get(axisX as number) ?? "");

// Y-axis format caching
// BEFORE: toFixed() called per tick on every render
yAxis.tickFormat((d: number) => d.toFixed(sig_figs) + (percentLabels ? "%" : ""));

// AFTER: Pre-computed format function with cached suffix
const suffix = percentLabels ? "%" : "";
const cachedFormat = (d: number) => d.toFixed(sig_figs) + suffix;
yAxis.tickFormat(cachedFormat);
```

### Rationale
- Axis rendering occurs on every visual update
- Current tick label lookup is O(n) per tick, O(n×m) total
- Axes are typically static relative to data changes
- Small optimizations here compound across frequent updates

### Expected Impact
| Operation | Current | Target | Improvement |
|-----------|---------|--------|-------------|
| X-axis tick format | O(n×m) | O(m) | ~10x faster |
| Y-axis label format | New each render | Cached | 50% faster |
| Full axis render | ~5ms | ~1ms | 80% faster |

---

## Session 9: Selection & Highlighting Optimization

### Objective
Optimize the selection and highlighting system to reduce DOM queries and style updates during user interactions.

### Key Deliverables

1. **Selection State Caching**
   - Cache current selection IDs in efficient data structure
   - Avoid repeated getSelectionIds() calls during highlight updates
   - Implement dirty flag for selection changes

2. **Efficient DOM Traversal**
   - Replace selectAll().nodes().forEach() with data-driven updates
   - Use CSS classes for highlight states instead of inline styles
   - Leverage D3 selection caching

3. **Batch Style Updates**
   - Group opacity changes by element type
   - Use CSS custom properties for theme-based styling
   - Minimize style recalculation triggers

4. **Event Handler Optimization**
   - Debounce highlight updates during rapid selections
   - Cache frequently accessed DOM references
   - Use passive event listeners where applicable

### Implementation Guidance

```typescript
// BEFORE: O(n) DOM traversal with individual style updates
updateHighlighting(): void {
  dotsSelection.nodes().forEach(currentDotNode => {
    const dot: plotData = d3.select(currentDotNode).datum() as plotData;
    const currentPointSelected = identitySelected(dot.identity, this.selectionManager);
    const newOpacity = currentPointSelected ? dot.aesthetics.opacity_selected : dot.aesthetics.opacity_unselected;
    d3.select(currentDotNode).style("fill-opacity", newOpacity);
    d3.select(currentDotNode).style("stroke-opacity", newOpacity);
  });
}

// AFTER: Single D3 selection with data-driven update
updateHighlighting(): void {
  // Cache selection IDs as Set for O(1) lookup
  const selectedIds = new Set(this.selectionManager.getSelectionIds().map(id => id.key));
  
  // Single D3 selection update - let D3 handle DOM efficiently
  this.svg.selectAll(".dotsgroup path")
    .style("fill-opacity", (d: plotData) => 
      this.shouldHighlight(d, selectedIds) ? d.aesthetics.opacity_selected : d.aesthetics.opacity_unselected
    )
    .style("stroke-opacity", (d: plotData) =>
      this.shouldHighlight(d, selectedIds) ? d.aesthetics.opacity_selected : d.aesthetics.opacity_unselected
    );
}

// Use CSS classes for common highlight states
// In CSS:
// .highlight-selected { opacity: 1; }
// .highlight-unselected { opacity: 0.2; }

// In JS:
dotsSelection.classed("highlight-selected", d => selectedIds.has(d.identity.key))
             .classed("highlight-unselected", d => !selectedIds.has(d.identity.key) && hasSelection);
```

### Rationale
- Highlighting is triggered on every click/hover interaction
- Current implementation iterates all DOM nodes individually
- CSS class-based styling leverages browser optimization
- D3's data-driven approach is more efficient than manual iteration

### Expected Impact
| Selection Size | Current Update Time | Target | Improvement |
|----------------|---------------------|--------|-------------|
| Single point | ~8ms | ~2ms | 75% faster |
| Multiple points | ~20ms | ~3ms | 85% faster |
| Clear selection | ~15ms | ~2ms | 87% faster |

---

## Session 10: Web Worker Offloading

### Objective
Move computationally intensive operations to a Web Worker to keep the main thread responsive during heavy calculations.

### Key Deliverables

1. **Worker Setup**
   - Create dedicated calculation worker
   - Implement message-based communication protocol
   - Handle worker initialization and termination

2. **Limit Calculation Offloading**
   - Move all limit calculation functions to worker
   - Implement data transfer optimization (Transferable objects)
   - Handle async calculation results

3. **Outlier Detection Offloading**
   - Move outlier detection algorithms to worker
   - Batch multiple detection rules in single worker call
   - Cache worker results for quick re-display

4. **Progress Reporting**
   - Report calculation progress for large datasets
   - Enable cancellation of long-running calculations
   - Graceful degradation for unsupported environments

### Implementation Guidance

```typescript
// calculation.worker.ts
import iLimits from "../Limit Calculations/i";
import astronomical from "../Outlier Flagging/astronomical";
// ... other imports

interface WorkerMessage {
  type: 'calculateLimits' | 'detectOutliers';
  payload: any;
  requestId: string;
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, requestId } = event.data;
  
  try {
    let result;
    switch (type) {
      case 'calculateLimits':
        result = calculateLimits(payload.chartType, payload.args);
        break;
      case 'detectOutliers':
        result = detectOutliers(payload.values, payload.limits, payload.settings);
        break;
    }
    
    self.postMessage({ requestId, success: true, result });
  } catch (error) {
    self.postMessage({ requestId, success: false, error: error.message });
  }
};

// viewModelClass.ts - Worker usage
class viewModelClass {
  private calculationWorker: Worker;
  private pendingCalculations: Map<string, Promise<any>>;
  
  constructor() {
    if (typeof Worker !== 'undefined') {
      this.calculationWorker = new Worker('./calculation.worker.js');
      this.calculationWorker.onmessage = this.handleWorkerMessage.bind(this);
    }
  }
  
  async calculateLimitsAsync(chartType: string, args: controlLimitsArgs): Promise<controlLimitsObject> {
    if (!this.calculationWorker) {
      // Fallback to synchronous calculation
      return this.calculateLimitsSync(chartType, args);
    }
    
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingCalculations.set(requestId, { resolve, reject });
      this.calculationWorker.postMessage({
        type: 'calculateLimits',
        payload: { chartType, args },
        requestId
      });
    });
  }
}
```

### Rationale
- Large dataset calculations can block the main thread for 100ms+
- Blocked main thread causes UI freezing and poor user experience
- Web Workers enable parallel computation without UI impact
- Power BI visuals benefit from responsive interactions during data updates

### Expected Impact
| Dataset Size | Main Thread Block (Current) | With Worker | UI Responsiveness |
|--------------|----------------------------|-------------|-------------------|
| 500 points | ~50ms | ~5ms | 90% improvement |
| 1000 points | ~150ms | ~10ms | 93% improvement |
| 5000 points | ~500ms | ~15ms | 97% improvement |

### Considerations
- Workers have initialization overhead (~10ms)
- Data serialization has cost for large datasets
- Fallback needed for environments without Worker support
- Power BI's sandboxed environment may require special handling

---

## Extended Performance Targets (Sessions 6-10)

### Update Latency Targets
| Update Type | Current | Session 6-10 Target | Improvement |
|-------------|---------|---------------------|-------------|
| Data refresh (1000 pts) | ~200ms | <50ms | 75% |
| Resize event | ~100ms | <20ms | 80% |
| Style-only change | ~150ms | <30ms | 80% |
| Selection update | ~20ms | <5ms | 75% |

### Memory Efficiency Targets
| Scenario | Current | Target | Reduction |
|----------|---------|--------|-----------|
| Summary table (1000 rows) | ~8MB | <1MB | 87% |
| Large dataset render | ~15MB | <5MB | 67% |
| Peak during update | ~25MB | <10MB | 60% |

### User Experience Targets
| Metric | Current | Target |
|--------|---------|--------|
| Time to interactive | ~300ms | <100ms |
| Scroll jank (summary table) | Frequent | Rare |
| Selection response time | ~20ms | <5ms |
| Resize smoothness | Choppy | Smooth |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-27 | Performance Agent | Initial plan creation |
| 1.1 | 2025-11-27 | Performance Agent | Session 1 completion, added session status section |
| 1.2 | 2025-11-27 | Performance Agent | Session 2 completion, significant limit calculation optimizations |
| 1.3 | 2025-11-27 | Performance Agent | Session 3 completion, outlier detection optimizations with sliding window |
| 1.4 | 2025-11-27 | Performance Agent | Session 4 completion, D3 rendering pipeline optimizations with symbol caching |
| 1.5 | 2025-11-27 | Performance Agent | Session 5 completion, ViewModel data processing optimizations |
| 1.6 | 2025-11-27 | Performance Agent | Added Sessions 6-10 plans: incremental updates, virtualization, axis optimization, selection optimization, Web Worker offloading |
| 1.7 | 2025-11-27 | Performance Agent | Session 6 completion, change detection system with hash-based comparisons and selective rendering |
| 1.8 | 2025-11-27 | Performance Agent | Session 7 completion, summary table virtualization with VirtualTable class |
