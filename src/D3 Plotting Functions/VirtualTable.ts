/**
 * VirtualTable - Session 7: Summary Table Virtualization
 * 
 * Implements virtual scrolling for the summary table to handle large datasets
 * efficiently by rendering only visible rows plus a small buffer.
 * 
 * Key features:
 * - Viewport-based row rendering
 * - Row pooling for DOM element reuse
 * - Efficient data binding without recreating elements
 * - Lazy NHS icon rendering
 * - Icon path caching
 */

import type { plotData, plotDataGrouped } from "../Classes/viewModelClass";
import type { defaultSettingsType } from "../Classes";
import type { Visual } from "../visual";
import initialiseIconSVG from "./initialiseIconSVG";
import * as nhsIcons from "./NHS Icons";
import * as d3 from "./D3 Modules";
import { identitySelected } from "../Functions";

/**
 * Configuration for virtual table rendering
 */
export interface VirtualTableConfig {
  /** Estimated height of each row in pixels */
  rowHeight: number;
  /** Number of extra rows to render above/below viewport */
  bufferSize: number;
  /** Minimum number of rows to render (avoids virtualization for small tables) */
  minRowsForVirtualization: number;
}

/**
 * State tracking for virtual table
 */
interface VirtualTableState {
  /** Index of first currently rendered row */
  visibleStartIdx: number;
  /** Index of last currently rendered row */
  visibleEndIdx: number;
  /** Total number of data rows */
  totalRows: number;
  /** Whether virtualization is active */
  isVirtualized: boolean;
  /** Scroll position at last render */
  lastScrollTop: number;
  /** Container height at last render */
  lastContainerHeight: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_VIRTUAL_TABLE_CONFIG: VirtualTableConfig = {
  rowHeight: 32,           // Typical row height in pixels
  bufferSize: 5,           // 5 rows above and below viewport
  minRowsForVirtualization: 50  // Only virtualize tables with >50 rows
};

/**
 * VirtualTable class for efficient rendering of large summary tables
 */
export class VirtualTable {
  private config: VirtualTableConfig;
  private state: VirtualTableState;
  private container: HTMLDivElement | null = null;
  private tableBody: HTMLTableSectionElement | null = null;
  private spacer: HTMLDivElement | null = null;
  private rowPool: HTMLTableRowElement[] = [];
  private scrollHandler: ((event: Event) => void) | null = null;
  private boundVisualObj: Visual | null = null;
  
  // Column and settings references
  private cols: { name: string; label: string; }[] = [];
  private tableSettings: defaultSettingsType["summary_table"] | null = null;
  private inputSettings: defaultSettingsType | null = null;
  private showGrouped: boolean = false;

  constructor(config: Partial<VirtualTableConfig> = {}) {
    this.config = { ...DEFAULT_VIRTUAL_TABLE_CONFIG, ...config };
    this.state = {
      visibleStartIdx: 0,
      visibleEndIdx: 0,
      totalRows: 0,
      isVirtualized: false,
      lastScrollTop: 0,
      lastContainerHeight: 0
    };
  }

  /**
   * Initialize the virtual table with container elements
   */
  initialize(
    container: HTMLDivElement,
    tableBody: HTMLTableSectionElement,
    visualObj: Visual
  ): void {
    this.container = container;
    this.tableBody = tableBody;
    this.boundVisualObj = visualObj;
    
    // Create spacer element for scrollbar accuracy
    this.spacer = container.querySelector('.virtual-spacer') as HTMLDivElement;
    if (!this.spacer) {
      this.spacer = document.createElement('div');
      this.spacer.className = 'virtual-spacer';
      this.spacer.style.position = 'absolute';
      this.spacer.style.top = '0';
      this.spacer.style.left = '0';
      this.spacer.style.width = '1px';
      this.spacer.style.visibility = 'hidden';
      this.spacer.style.pointerEvents = 'none';
      container.appendChild(this.spacer);
    }
    
    // Setup scroll handler
    this.setupScrollHandler();
  }

  /**
   * Setup scroll event handler with throttling
   */
  private setupScrollHandler(): void {
    if (!this.container || this.scrollHandler) return;
    
    let ticking = false;
    this.scrollHandler = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.onScroll();
          ticking = false;
        });
        ticking = true;
      }
    };
    
    this.container.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  /**
   * Handle scroll event - recalculate visible range and update rows
   */
  private onScroll(): void {
    if (!this.state.isVirtualized || !this.container) return;
    
    const scrollTop = this.container.scrollTop;
    const containerHeight = this.container.clientHeight;
    
    // Only update if scroll position changed significantly
    if (Math.abs(scrollTop - this.state.lastScrollTop) < this.config.rowHeight / 2) {
      return;
    }
    
    this.state.lastScrollTop = scrollTop;
    this.state.lastContainerHeight = containerHeight;
    
    this.updateVisibleRows(scrollTop, containerHeight);
  }

  /**
   * Render the virtual table with the given data
   */
  render(
    plotPoints: plotData[] | plotDataGrouped[],
    cols: { name: string; label: string; }[],
    tableSettings: defaultSettingsType["summary_table"],
    inputSettings: defaultSettingsType,
    showGrouped: boolean,
    maxWidth: number,
    visualObj: Visual
  ): void {
    if (!this.container || !this.tableBody) return;
    
    // Store references for use in row rendering
    this.cols = cols;
    this.tableSettings = tableSettings;
    this.inputSettings = inputSettings;
    this.showGrouped = showGrouped;
    this.boundVisualObj = visualObj;
    
    const dataLength = plotPoints.length;
    this.state.totalRows = dataLength;
    
    // Determine if virtualization is needed
    this.state.isVirtualized = dataLength >= this.config.minRowsForVirtualization;
    
    if (!this.state.isVirtualized) {
      // For small datasets, render all rows traditionally
      this.renderAllRows(plotPoints, maxWidth);
      this.hideSpacerElement();
      return;
    }
    
    // Store data for scroll updates
    (this.container as any)._virtualData = plotPoints;
    (this.container as any)._maxWidth = maxWidth;
    
    // Calculate total height and set spacer
    const totalHeight = dataLength * this.config.rowHeight;
    if (this.spacer) {
      this.spacer.style.height = `${totalHeight}px`;
    }
    
    // Make container scrollable with relative positioning
    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';
    
    // Calculate initial visible range
    const scrollTop = this.container.scrollTop;
    const containerHeight = this.container.clientHeight;
    
    this.state.lastScrollTop = scrollTop;
    this.state.lastContainerHeight = containerHeight;
    
    // Clear existing rows and render visible range
    this.clearRows();
    this.updateVisibleRows(scrollTop, containerHeight);
  }

  /**
   * Update visible rows based on scroll position
   */
  private updateVisibleRows(scrollTop: number, containerHeight: number): void {
    if (!this.container || !this.tableBody) return;
    
    const data = (this.container as any)._virtualData as (plotData[] | plotDataGrouped[]);
    const maxWidth = (this.container as any)._maxWidth as number;
    
    if (!data) return;
    
    // Calculate visible range
    const firstVisible = Math.max(0, Math.floor(scrollTop / this.config.rowHeight) - this.config.bufferSize);
    const lastVisible = Math.min(
      data.length - 1,
      Math.ceil((scrollTop + containerHeight) / this.config.rowHeight) + this.config.bufferSize
    );
    
    // Check if we need to update
    if (firstVisible === this.state.visibleStartIdx && lastVisible === this.state.visibleEndIdx) {
      return;
    }
    
    // Determine rows to remove and add
    const rowsToRemove: number[] = [];
    const rowsToAdd: number[] = [];
    
    // Find rows that are now outside visible range
    for (let i = this.state.visibleStartIdx; i <= this.state.visibleEndIdx; i++) {
      if (i < firstVisible || i > lastVisible) {
        rowsToRemove.push(i);
      }
    }
    
    // Find new rows to render
    // Edge case: when visibleStartIdx === visibleEndIdx (initial state or single row),
    // we need to render all rows in the visible range since the range iteration
    // would otherwise skip most indices
    for (let i = firstVisible; i <= lastVisible; i++) {
      const isOutsidePreviousRange = i < this.state.visibleStartIdx || i > this.state.visibleEndIdx;
      const isInitialOrSingleRow = this.state.visibleStartIdx === this.state.visibleEndIdx;
      if (isOutsidePreviousRange || isInitialOrSingleRow) {
        rowsToAdd.push(i);
      }
    }
    
    // Remove rows outside visible range
    this.removeRows(rowsToRemove);
    
    // Add new visible rows
    for (const idx of rowsToAdd) {
      if (idx >= 0 && idx < data.length) {
        this.renderRow(idx, data[idx], maxWidth);
      }
    }
    
    // Update state
    this.state.visibleStartIdx = firstVisible;
    this.state.visibleEndIdx = lastVisible;
    
    // Sort rows by data index for correct visual order
    this.sortRenderedRows();
  }

  /**
   * Render a single row at the given index
   */
  private renderRow(
    dataIndex: number,
    rowData: plotData | plotDataGrouped,
    maxWidth: number
  ): void {
    if (!this.tableBody || !this.tableSettings || !this.inputSettings || !this.boundVisualObj) return;
    
    // Get or create row element
    let row = this.rowPool.pop();
    if (!row) {
      row = document.createElement('tr');
    }
    
    // Store data index for sorting
    (row as any)._dataIndex = dataIndex;
    
    // Position row absolutely for virtualization
    if (this.state.isVirtualized) {
      row.style.position = 'absolute';
      row.style.top = `${dataIndex * this.config.rowHeight}px`;
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = `${this.config.rowHeight}px`;
    } else {
      row.style.position = '';
      row.style.top = '';
      row.style.left = '';
      row.style.right = '';
      row.style.height = '';
    }
    
    // Bind data to row for D3 compatibility
    (row as any).__data__ = rowData;
    
    // Clear existing cells - use while loop to avoid innerHTML
    while (row.firstChild) {
      row.removeChild(row.firstChild);
    }
    
    // Create cells
    this.renderCells(row, rowData, maxWidth);
    
    // Setup row event handlers
    this.setupRowEventHandlers(row, rowData);
    
    // Apply overflow styles
    if (this.tableSettings.table_text_overflow !== "none") {
      row.style.overflow = 'hidden';
      row.style.maxWidth = `${maxWidth}px`;
      row.style.textOverflow = this.tableSettings.table_text_overflow;
    } else {
      row.style.overflow = 'auto';
      row.style.maxWidth = 'none';
    }
    
    this.tableBody.appendChild(row);
  }

  /**
   * Render cells for a row
   */
  private renderCells(
    row: HTMLTableRowElement,
    rowData: plotData | plotDataGrouped,
    _maxWidth: number
  ): void {
    if (!this.tableSettings || !this.inputSettings) return;
    
    const drawIcons = this.inputSettings.nhs_icons.show_variation_icons || this.inputSettings.nhs_icons.show_assurance_icons;
    
    for (const col of this.cols) {
      const cell = document.createElement('td');
      const value = rowData.table_row[col.name];
      
      // Render cell content
      if (this.showGrouped && drawIcons && (col.name === "variation" || col.name === "assurance")) {
        if (value !== "none") {
          this.renderIconCell(cell, col.name, value as string);
        }
      } else {
        const displayValue: string = typeof value === "number"
          ? value.toFixed(this.inputSettings.spc.sig_figs)
          : value;
        cell.textContent = displayValue;
        cell.className = 'cell-text';
      }
      
      // Apply cell styles
      this.applyCellStyles(cell, rowData);
      
      row.appendChild(cell);
    }
  }

  /**
   * Render an NHS icon in a cell with caching
   */
  private renderIconCell(cell: HTMLTableCellElement, columnName: string, iconName: string): void {
    if (!this.inputSettings) return;
    
    const scaling = this.inputSettings.nhs_icons[`${columnName}_icons_scaling`];
    
    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 378 378');
    svg.setAttribute('class', 'rowsvg');
    
    // Calculate size based on row height and scaling
    const iconSize = Math.min(this.config.rowHeight * 0.8, 30) * scaling;
    svg.style.width = `${iconSize}px`;
    svg.style.height = `${iconSize}px`;
    
    // Use D3 to build the icon structure
    const d3svg = d3.select(svg);
    d3svg.call(initialiseIconSVG, iconName);
    d3svg.selectAll('.icongroup')
         .selectAll(`.${iconName}`)
         .call(nhsIcons[iconName]);
    
    cell.appendChild(svg);
  }

  /**
   * Apply styles to a cell based on row data and settings
   */
  private applyCellStyles(cell: HTMLTableCellElement, rowData: plotData | plotDataGrouped): void {
    if (!this.tableSettings || !this.inputSettings) return;
    
    const tableAesthetics = (rowData as any).aesthetics?.["table_body_bg_colour"]
      ? (rowData as any).aesthetics
      : this.inputSettings.summary_table;
    
    cell.style.backgroundColor = tableAesthetics.table_body_bg_colour;
    cell.style.fontWeight = tableAesthetics.table_body_font_weight;
    cell.style.textTransform = tableAesthetics.table_body_text_transform;
    cell.style.textAlign = tableAesthetics.table_body_text_align;
    cell.style.fontSize = `${tableAesthetics.table_body_size}px`;
    cell.style.fontFamily = tableAesthetics.table_body_font;
    cell.style.color = tableAesthetics.table_body_colour;
    cell.style.borderWidth = `${tableAesthetics.table_body_border_width}px`;
    cell.style.borderStyle = tableAesthetics.table_body_border_style;
    cell.style.borderColor = tableAesthetics.table_body_border_colour;
    cell.style.padding = `${tableAesthetics.table_body_text_padding}px`;
    cell.style.opacity = 'inherit';
    
    if (!tableAesthetics.table_body_border_left_right) {
      cell.style.borderLeft = 'none';
      cell.style.borderRight = 'none';
    }
    if (!tableAesthetics.table_body_border_top_bottom) {
      cell.style.borderTop = 'none';
      cell.style.borderBottom = 'none';
    }
  }

  /**
   * Setup event handlers for a row
   */
  private setupRowEventHandlers(row: HTMLTableRowElement, rowData: plotData | plotDataGrouped): void {
    if (!this.boundVisualObj) return;
    
    const visualObj = this.boundVisualObj;
    const plotData = rowData as plotData;
    
    // Click handler for selection
    row.onclick = (event) => {
      if (visualObj.host.hostCapabilities.allowInteractions) {
        const alreadySel = identitySelected(plotData.identity, visualObj.selectionManager);
        visualObj.selectionManager
          .select(plotData.identity, alreadySel || event.ctrlKey || event.metaKey)
          .then(() => visualObj.updateHighlighting());
        event.stopPropagation();
      }
    };
    
    // Hover handlers
    row.onmouseover = (event) => {
      const target = event.target as HTMLElement;
      const td = target.closest('td');
      if (td) {
        td.style.backgroundColor = 'lightgray';
      }
    };
    
    row.onmouseout = (event) => {
      const target = event.target as HTMLElement;
      const td = target.closest('td');
      if (td && this.inputSettings) {
        const tableAesthetics = (rowData as any).aesthetics?.["table_body_bg_colour"]
          ? (rowData as any).aesthetics
          : this.inputSettings.summary_table;
        td.style.backgroundColor = tableAesthetics.table_body_bg_colour ?? 'inherit';
      }
    };
  }

  /**
   * Remove rows at the given indices
   */
  private removeRows(indices: number[]): void {
    if (!this.tableBody) return;
    
    const rows = Array.from(this.tableBody.querySelectorAll('tr'));
    for (const row of rows) {
      const dataIndex = (row as any)._dataIndex;
      if (indices.includes(dataIndex)) {
        row.remove();
        // Return to pool for reuse
        this.rowPool.push(row);
      }
    }
  }

  /**
   * Clear all rendered rows
   */
  private clearRows(): void {
    if (!this.tableBody) return;
    
    const rows = Array.from(this.tableBody.querySelectorAll('tr'));
    for (const row of rows) {
      row.remove();
      this.rowPool.push(row);
    }
    
    this.state.visibleStartIdx = 0;
    this.state.visibleEndIdx = 0;
  }

  /**
   * Sort rendered rows by data index for correct visual order
   */
  private sortRenderedRows(): void {
    if (!this.tableBody) return;
    
    const rows = Array.from(this.tableBody.querySelectorAll('tr'));
    rows.sort((a, b) => ((a as any)._dataIndex || 0) - ((b as any)._dataIndex || 0));
    
    for (const row of rows) {
      this.tableBody.appendChild(row);
    }
  }

  /**
   * Render all rows without virtualization (for small datasets)
   */
  private renderAllRows(
    plotPoints: plotData[] | plotDataGrouped[],
    maxWidth: number
  ): void {
    if (!this.tableBody) return;
    
    this.clearRows();
    
    for (let i = 0; i < plotPoints.length; i++) {
      this.renderRow(i, plotPoints[i], maxWidth);
    }
    
    this.state.visibleStartIdx = 0;
    this.state.visibleEndIdx = plotPoints.length - 1;
  }

  /**
   * Hide spacer element when not virtualizing
   */
  private hideSpacerElement(): void {
    if (this.spacer) {
      this.spacer.style.height = '0';
    }
  }

  /**
   * Cleanup and dispose of resources
   */
  dispose(): void {
    if (this.container && this.scrollHandler) {
      this.container.removeEventListener('scroll', this.scrollHandler);
    }
    
    // Clear virtual data reference before nulling container
    if (this.container) {
      (this.container as any)._virtualData = null;
    }
    
    this.clearRows();
    this.rowPool = [];
    this.container = null;
    this.tableBody = null;
    this.spacer = null;
    this.scrollHandler = null;
    this.boundVisualObj = null;
  }

  /**
   * Get current state (for debugging/testing)
   */
  getState(): Readonly<VirtualTableState> {
    return { ...this.state };
  }

  /**
   * Get configuration (for debugging/testing)
   */
  getConfig(): Readonly<VirtualTableConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VirtualTableConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Force refresh of visible rows
   */
  refresh(): void {
    if (!this.container || !this.state.isVirtualized) return;
    
    const scrollTop = this.container.scrollTop;
    const containerHeight = this.container.clientHeight;
    
    // Reset state to force full update
    this.state.visibleStartIdx = -1;
    this.state.visibleEndIdx = -1;
    
    this.updateVisibleRows(scrollTop, containerHeight);
  }

  /**
   * Scroll to a specific row
   */
  scrollToRow(rowIndex: number): void {
    if (!this.container || !this.state.isVirtualized) return;
    
    const targetTop = rowIndex * this.config.rowHeight;
    this.container.scrollTop = targetTop;
  }

  /**
   * Get the number of DOM rows currently rendered
   */
  getRenderedRowCount(): number {
    if (!this.tableBody) return 0;
    return this.tableBody.querySelectorAll('tr').length;
  }

  /**
   * Check if virtualization is active
   */
  isVirtualizationActive(): boolean {
    return this.state.isVirtualized;
  }

  /**
   * Get row pool size (for memory optimization tracking)
   */
  getRowPoolSize(): number {
    return this.rowPool.length;
  }
}

/**
 * Factory function to create a VirtualTable instance
 */
export function createVirtualTable(config?: Partial<VirtualTableConfig>): VirtualTable {
  return new VirtualTable(config);
}

/**
 * Default export for the module
 */
export default VirtualTable;
