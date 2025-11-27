import type powerbi from "powerbi-visuals-api";
type IVisualHost = powerbi.extensibility.visual.IVisualHost;
type VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
type ISelectionId = powerbi.visuals.ISelectionId;
import * as limitFunctions from "../Limit Calculations"
import { settingsClass, type defaultSettingsType, type derivedSettingsClass } from "../Classes";
import { buildTooltip, getAesthetic, checkFlagDirection, truncate, type truncateInputs, multiply, rep, type dataObject, extractInputData, isNullOrUndefined, variationIconsToDraw, assuranceIconToDraw, validateDataView, valueFormatter, calculateTrendLine,
  createDataState, createSettingsState, computeChangeFlags,
  type ChangeFlags, type DataState, type SettingsState
} from "../Functions"
import { astronomical, trend, twoInThree, shift } from "../Outlier Flagging"
import { lineNameMap } from "../Functions/getAesthetic";

export type viewModelValidationT = {
  status: boolean,
  error?: string,
  warning?: string,
  type?: string
}

export type lineData = {
  x: number;
  line_value: number;
  group: string;
}

export type summaryTableRowData = {
  date: string;
  numerator: number;
  denominator: number;
  value: number;
  target: number;
  alt_target: number;
  ll99: number;
  ll95: number;
  ll68: number;
  ul68: number;
  ul95: number;
  ul99: number;
  speclimits_lower: number;
  speclimits_upper: number;
  trend_line: number;
  astpoint: string;
  trend: string;
  shift: string;
  two_in_three: string;
}

export type summaryTableRowDataGrouped = {
  [key: string]: any;

  latest_date: string;
  value: number;
  target: number;
  alt_target: number;
  ucl99: number;
  ucl95: number;
  ucl68: number;
  lcl68: number;
  lcl95: number;
  lcl99: number;
  variation: string;
  assurance: string;
}

export type plotData = {
  x: number;
  value: number;
  aesthetics: defaultSettingsType["scatter"];
  table_row: summaryTableRowData;
  // ISelectionId allows the visual to report the selection choice to PowerBI
  identity: ISelectionId;
  // Flag for whether dot should be highlighted by selections in other charts
  highlighted: boolean;
  // Tooltip data to print
  tooltip: VisualTooltipDataItem[];
  label: {
    text_value: string,
    aesthetics: defaultSettingsType["labels"],
    angle: number,
    distance: number,
    line_offset: number,
    marker_offset: number
  };
}

export type plotDataGrouped = {
  table_row: summaryTableRowDataGrouped;
  identity: ISelectionId[];
  aesthetics: defaultSettingsType["summary_table"];
  highlighted: boolean;
}

export type controlLimitsObject = {
  keys: { x: number, id: number, label: string }[];
  values: number[];
  numerators?: number[];
  denominators?: number[];
  targets: number[];
  ll99?: number[];
  ll95?: number[];
  ll68?: number[];
  ul68?: number[];
  ul95?: number[];
  ul99?: number[];
  count?: number[];
  alt_targets?: number[];
  speclimits_lower?: number[];
  speclimits_upper?: number[];
  trend_line?: number[];
};

export type controlLimitsArgs = {
  keys: { x: number, id: number, label: string }[];
  numerators: number[];
  denominators?: number[];
  xbar_sds?: number[];
  outliers_in_limits?: boolean;
  subset_points?: number[];
}

export type outliersObject = {
  astpoint: string[];
  trend: string[];
  two_in_three: string[];
  shift: string[];
}

export type colourPaletteType = {
  isHighContrast: boolean,
  foregroundColour: string,
  backgroundColour: string,
  foregroundSelectedColour: string,
  hyperlinkColour: string
};

export default class viewModelClass {
  inputData: dataObject;
  inputSettings: settingsClass;
  controlLimits: controlLimitsObject;
  outliers: outliersObject;
  plotPoints: plotData[];
  groupedLines: [string, lineData[]][];
  tickLabels: { x: number; label: string; }[];
  splitIndexes: number[];
  groupStartEndIndexes: number[][];
  firstRun: boolean;
  colourPalette: colourPaletteType;
  tableColumns: { name: string; label: string; }[];
  svgWidth: number;
  svgHeight: number;
  headless: boolean;
  frontend: boolean;

  showGrouped: boolean;
  indicatorVarNames: string[];
  groupNames: string[][];
  inputDataGrouped: dataObject[];
  controlLimitsGrouped: controlLimitsObject[];
  outliersGrouped: outliersObject[];
  groupStartEndIndexesGrouped: number[][][];
  tableColumnsGrouped: { name: string; label: string; }[];
  plotPointsGrouped: plotDataGrouped[];
  identitiesGrouped: ISelectionId[][];

  // Change detection state (Session 6)
  /** Previous data state for change detection */
  private prevDataState: DataState | null;
  /** Previous settings state for change detection */
  private prevSettingsState: SettingsState | null;
  /** Last computed change flags from the most recent update */
  lastChangeFlags: ChangeFlags | null;

  constructor() {
    this.inputData = <dataObject>null;
    this.inputSettings = new settingsClass();
    this.controlLimits = null;
    this.plotPoints = new Array<plotData>();
    this.groupedLines = new Array<[string, lineData[]]>();
    this.firstRun = true
    this.splitIndexes = new Array<number>();
    this.colourPalette = null;
    this.headless = false;
    this.frontend = false;
    // Initialize change detection state (Session 6)
    this.prevDataState = null;
    this.prevSettingsState = null;
    this.lastChangeFlags = null;
  }

  update(options: VisualUpdateOptions, host: IVisualHost): viewModelValidationT {
    if (isNullOrUndefined(this.colourPalette)) {
      this.colourPalette = {
        isHighContrast: host.colorPalette.isHighContrast,
        foregroundColour: host.colorPalette.foreground.value,
        backgroundColour: host.colorPalette.background.value,
        foregroundSelectedColour: host.colorPalette.foregroundSelected.value,
        hyperlinkColour: host.colorPalette.hyperlink.value
      }
    }

    this.svgWidth = options.viewport.width;
    this.svgHeight = options.viewport.height;
    this.headless = options?.["headless"] ?? false;
    this.frontend = options?.["frontend"] ?? false;

    const indicator_cols: powerbi.DataViewCategoryColumn[] = options.dataViews[0]?.categorical?.categories?.filter(d => d.source.roles.indicator);
    this.indicatorVarNames = indicator_cols?.map(d => d.source.displayName) ?? [];

    const n_indicators: number = indicator_cols?.length - 1;
    const n_values: number = options.dataViews[0]?.categorical?.categories?.[0]?.values?.length ?? 1;
    const res: viewModelValidationT = { status: true };
    const idx_per_indicator = new Array<number[]>();
    idx_per_indicator.push([0]);
    this.groupNames = new Array<string[]>();
    this.groupNames.push(indicator_cols?.map(d => <string>d.values[0]) ?? []);
    let curr_grp: number = 0;

    for (let i = 1; i < n_values; i++) {
      if (indicator_cols?.[n_indicators]?.values[i] === indicator_cols?.[n_indicators]?.values[i - 1]) {
        idx_per_indicator[curr_grp].push(i);
      } else {
        idx_per_indicator.push([i]);
        this.groupNames.push(indicator_cols?.map(d => <string>d.values[i]) ?? []);
        curr_grp += 1;

      }
    }

    if (options.type === 2 || this.firstRun) {
      this.inputSettings.update(options.dataViews[0], idx_per_indicator);
    }
    if (this.inputSettings.validationStatus.error !== "") {
      res.status = false;
      res.error = this.inputSettings.validationStatus.error;
      res.type = "settings";
      return res;
    }
    const checkDV: string = validateDataView(options.dataViews, this.inputSettings);
    if (checkDV !== "valid") {
      res.status = false;
      res.error = checkDV;
      return res;
    }

    // Session 6: Create current settings state for change detection
    // The settings object is typed as defaultSettingsType but is compatible with Record<string, unknown>
    const currentSettingsState = createSettingsState(this.inputSettings.settings);

    // Only re-construct data and re-calculate limits if they have changed
    if (options.type === 2 || this.firstRun) {
      if (options.dataViews[0].categorical.categories.some(d => d.source.roles.indicator)) {
        this.showGrouped = true;
        this.inputDataGrouped = new Array<dataObject>();
        this.groupStartEndIndexesGrouped = new Array<number[][]>();
        this.controlLimitsGrouped = new Array<controlLimitsObject>();
        this.outliersGrouped = new Array<outliersObject>();
        this.identitiesGrouped = new Array<ISelectionId[]>();

        idx_per_indicator.forEach((group_idxs, idx) => {
          const inpData: dataObject = extractInputData(options.dataViews[0].categorical,
                                                        this.inputSettings.settingsGrouped[idx],
                                                        this.inputSettings.derivedSettingsGrouped[idx],
                                                        this.inputSettings.validationStatus.messages,
                                                        group_idxs);
          const invalidData: boolean = inpData.validationStatus.status !== 0;
          const groupStartEndIndexes: number[][] = invalidData ? new Array<number[]>() : this.getGroupingIndexes(inpData);
          const limits: controlLimitsObject = invalidData ? null : this.calculateLimits(inpData, groupStartEndIndexes, this.inputSettings.settingsGrouped[idx]);
          const outliers: outliersObject = invalidData ? null : this.flagOutliers(limits, groupStartEndIndexes,
                                                                                  this.inputSettings.settingsGrouped[idx],
                                                                                  this.inputSettings.derivedSettingsGrouped[idx]);

          if (!invalidData) {
            this.scaleAndTruncateLimits(limits, this.inputSettings.settingsGrouped[idx],
                                        this.inputSettings.derivedSettingsGrouped[idx]);
          }
          const identities = group_idxs.map(i => {
            return host.createSelectionIdBuilder().withCategory(options.dataViews[0].categorical.categories[0], i).createSelectionId();
          })
          this.identitiesGrouped.push(identities);
          this.inputDataGrouped.push(inpData);
          this.groupStartEndIndexesGrouped.push(groupStartEndIndexes);
          this.controlLimitsGrouped.push(limits);
          this.outliersGrouped.push(outliers);
        })
        this.initialisePlotDataGrouped();
        
        // Session 6: Compute change flags for grouped mode
        // For grouped mode, we use a simplified change detection since data is processed per-group
        this.lastChangeFlags = computeChangeFlags(
          this.prevDataState,
          createDataState(null, null, null, null, this.svgWidth, this.svgHeight),
          this.prevSettingsState,
          currentSettingsState,
          this.firstRun
        );
      } else {
        this.showGrouped = false;
        this.groupNames = null;
        this.inputDataGrouped = null;
        this.groupStartEndIndexesGrouped = null;
        this.controlLimitsGrouped = null;
        const split_indexes_str: string = <string>(options.dataViews[0]?.metadata?.objects?.split_indexes_storage?.split_indexes) ?? "[]";
        const split_indexes: number[] = JSON.parse(split_indexes_str);
        this.splitIndexes = split_indexes;
        this.inputData = extractInputData(options.dataViews[0].categorical,
                                          this.inputSettings.settings,
                                          this.inputSettings.derivedSettings,
                                          this.inputSettings.validationStatus.messages,
                                          idx_per_indicator[0]);

        if (this.inputData.validationStatus.status === 0) {
          // Session 6: Create current data state for change detection
          const currentDataState = createDataState(
            this.inputData.limitInputArgs?.numerators ?? null,
            this.inputData.limitInputArgs?.denominators ?? null,
            this.inputData.limitInputArgs?.keys ?? null,
            this.splitIndexes,
            this.svgWidth,
            this.svgHeight
          );

          // Session 6: Compute comprehensive change flags
          this.lastChangeFlags = computeChangeFlags(
            this.prevDataState,
            currentDataState,
            this.prevSettingsState,
            currentSettingsState,
            this.firstRun
          );

          // Session 6: Selective recalculation based on change flags
          // Only recalculate limits if data or relevant settings changed
          if (this.lastChangeFlags.limitsNeedRecalc || this.firstRun) {
            this.groupStartEndIndexes = this.getGroupingIndexes(this.inputData, this.splitIndexes);
            this.controlLimits = this.calculateLimits(this.inputData, this.groupStartEndIndexes, this.inputSettings.settings);
            this.scaleAndTruncateLimits(this.controlLimits, this.inputSettings.settings,
                                        this.inputSettings.derivedSettings);
          }

          // Session 6: Only recalculate outliers if needed
          if (this.lastChangeFlags.outliersNeedRecalc || this.firstRun) {
            this.outliers = this.flagOutliers(this.controlLimits, this.groupStartEndIndexes,
                                              this.inputSettings.settings,
                                              this.inputSettings.derivedSettings);
          }

          // Structure the data and calculated limits to the format needed for plotting
          this.initialisePlotData(host);
          this.initialiseGroupedLines();

          // Session 6: Update previous data state for next comparison
          this.prevDataState = currentDataState;
        }
      }
    } else {
      // Session 6: Handle resize-only or style-only updates
      // Compute change flags even for non-data updates
      const currentDataState = createDataState(
        this.inputData?.limitInputArgs?.numerators ?? null,
        this.inputData?.limitInputArgs?.denominators ?? null,
        this.inputData?.limitInputArgs?.keys ?? null,
        this.splitIndexes,
        this.svgWidth,
        this.svgHeight
      );

      this.lastChangeFlags = computeChangeFlags(
        this.prevDataState,
        currentDataState,
        this.prevSettingsState,
        currentSettingsState,
        this.firstRun
      );

      // Update previous state for resize detection
      this.prevDataState = currentDataState;
    }

    // Session 6: Update previous settings state for next comparison
    this.prevSettingsState = currentSettingsState;

    this.firstRun = false;
    if (this.showGrouped) {
      if (this.inputDataGrouped.map(d => d.validationStatus.status).some(d => d !== 0)) {
        res.status = false;
        res.error = this.inputDataGrouped.map(d => d.validationStatus.error).join("\n");
        return res;
      }
      if (this.inputDataGrouped.some(d => d.warningMessage !== "")) {
       res.warning = this.inputDataGrouped.map(d => d.warningMessage).join("\n");
      }
    } else {
      if (this.inputData.validationStatus.status !== 0) {
        res.status = false;
        res.error = this.inputData.validationStatus.error;
        return res;
      }
      if (this.inputData.warningMessage !== "") {
        res.warning = this.inputData.warningMessage;
      }
    }

    return res;
  }

  getGroupingIndexes(inputData: dataObject, splitIndexes?: number[]): number[][] {
    const allIndexes: number[] = (splitIndexes ?? [])
                                    .concat([-1])
                                    .concat(inputData.groupingIndexes)
                                    .concat([inputData.limitInputArgs.keys.length - 1])
                                    .filter((d, idx, arr) => arr.indexOf(d) === idx)
                                    .sort((a,b) => a - b);

    const groupStartEndIndexes = new Array<number[]>();
    for (let i: number = 0; i < allIndexes.length - 1; i++) {
      groupStartEndIndexes.push([allIndexes[i] + 1, allIndexes[i + 1] + 1])
    }
    return groupStartEndIndexes;
  }

  calculateLimits(inputData: dataObject, groupStartEndIndexes: number[][], inputSettings: defaultSettingsType): controlLimitsObject {
    const limitFunction: (args: controlLimitsArgs) => controlLimitsObject
      = limitFunctions[inputSettings.spc.chart_type];

    inputData.limitInputArgs.outliers_in_limits = inputSettings.spc.outliers_in_limits;
    let controlLimits: controlLimitsObject;
    if (groupStartEndIndexes.length > 1) {
      // Optimize: Only copy limitInputArgs, not the entire dataObject
      // Using shallow copy with array slices instead of JSON.parse/stringify (~10x faster)
      const groupedLimitArgs: controlLimitsArgs[] = groupStartEndIndexes.map((indexes) => {
        const originalArgs = inputData.limitInputArgs;
        return {
          keys: originalArgs.keys.slice(indexes[0], indexes[1]),
          numerators: originalArgs.numerators.slice(indexes[0], indexes[1]),
          denominators: originalArgs.denominators?.slice(indexes[0], indexes[1]),
          xbar_sds: originalArgs.xbar_sds?.slice(indexes[0], indexes[1]),
          outliers_in_limits: originalArgs.outliers_in_limits,
          subset_points: originalArgs.subset_points
        };
      });

      const calcLimitsGrouped: controlLimitsObject[] = groupedLimitArgs.map(args => {
        const currLimits = limitFunction(args);
        currLimits.trend_line = calculateTrendLine(currLimits.values);
        return currLimits;
      });

      controlLimits = calcLimitsGrouped.reduce((all: controlLimitsObject, curr: controlLimitsObject) => {
        const allInner: controlLimitsObject = all;
        Object.entries(all).forEach((entry, idx) => {
          const newValues = Object.entries(curr)[idx][1];
          allInner[entry[0]] = entry[1]?.concat(newValues);
        })
        return allInner;
      })
    } else {
      // Calculate control limits using user-specified type
      controlLimits = limitFunction(inputData.limitInputArgs);
      controlLimits.trend_line = calculateTrendLine(controlLimits.values);
    }

    controlLimits.alt_targets = inputData.alt_targets;
    controlLimits.speclimits_lower = inputData.speclimits_lower;
    controlLimits.speclimits_upper = inputData.speclimits_upper;

    for (const key of Object.keys(controlLimits)) {
      if (key === "keys") {
        continue;
      }
      controlLimits[key] = controlLimits[key]?.map(d => isNaN(d) ? null : d);
    }

    return controlLimits;
  }

  initialisePlotDataGrouped(): void {
    this.plotPointsGrouped = new Array<plotDataGrouped>();
    this.tableColumnsGrouped = new Array<{ name: string; label: string; }>();
    this.indicatorVarNames.forEach(indicator_name => {
      this.tableColumnsGrouped.push({ name: indicator_name, label: indicator_name });
    })
    this.tableColumnsGrouped.push({ name: "latest_date", label: "Latest Date" });

    const lineSettings = this.inputSettings.settings.lines;
    if (lineSettings.show_main) {
      this.tableColumnsGrouped.push({ name: "value", label: "Value" });
    }
    if (this.inputSettings.settings.spc.ttip_show_numerator) {
      this.tableColumnsGrouped.push({ name: "numerator", label: "Numerator" });
    }
    if (this.inputSettings.settings.spc.ttip_show_denominator) {
      this.tableColumnsGrouped.push({ name: "denominator", label: "Denominator" });
    }
    if (lineSettings.show_target) {
      this.tableColumnsGrouped.push({ name: "target", label: lineSettings.ttip_label_target });
    }
    if (lineSettings.show_alt_target) {
      this.tableColumnsGrouped.push({ name: "alt_target", label: lineSettings.ttip_label_alt_target });
    }
    ["99", "95", "68"].forEach(limit => {
      if (lineSettings[`show_${limit}`]) {
        this.tableColumnsGrouped.push({
          name: `ucl${limit}`,
          label: `${lineSettings[`ttip_label_${limit}_prefix_upper`]}${lineSettings[`ttip_label_${limit}`]}`
        })
      }
    });
    ["68", "95", "99"].forEach(limit => {
      if (lineSettings[`show_${limit}`]) {
        this.tableColumnsGrouped.push({
          name: `lcl${limit}`,
          label: `${lineSettings[`ttip_label_${limit}_prefix_lower`]}${lineSettings[`ttip_label_${limit}`]}`
        })
      }
    })
    const nhsIconSettings: defaultSettingsType["nhs_icons"] = this.inputSettings.settings.nhs_icons;
    if (nhsIconSettings.show_variation_icons) {
      this.tableColumnsGrouped.push({ name: "variation", label: "Variation" });
    }
    if (nhsIconSettings.show_assurance_icons) {
      this.tableColumnsGrouped.push({ name: "assurance", label: "Assurance" });
    }
    const anyTooltips: boolean = this.inputDataGrouped.some(d => d?.tooltips?.some(t => t.length > 0));

    if (anyTooltips) {
      this.inputDataGrouped?.[0].tooltips?.[0].forEach(tooltip => {
        this.tableColumnsGrouped.push({ name: tooltip.displayName, label: tooltip.displayName });
      })
    }
    for (let i: number = 0; i < this.groupNames.length; i++) {
      // Skip if no data for this group
      if (isNullOrUndefined(this.inputDataGrouped[i]?.categories)) {
        continue;
      }
      const formatValues = valueFormatter(this.inputSettings.settingsGrouped[i], this.inputSettings.derivedSettingsGrouped[i]);
      const varIconFilter: string = this.inputSettings.settingsGrouped[i].summary_table.table_variation_filter;
      const assIconFilter: string = this.inputSettings.settingsGrouped[i].summary_table.table_assurance_filter;
      const limits: controlLimitsObject = this.controlLimitsGrouped[i];
      const outliers: outliersObject = this.outliersGrouped[i];
      const lastIndex: number = limits.keys.length - 1;
      const varIcons: string[] = variationIconsToDraw(outliers, this.inputSettings.settingsGrouped[i]);
      if (varIconFilter !== "all") {
        if (varIconFilter === "improvement" && !(["improvementHigh", "improvementLow"].includes(varIcons[0]))) {
          continue;
        }
        if (varIconFilter === "deterioration" && !(["concernHigh", "concernLow"].includes(varIcons[0]))) {
          continue;
        }
        if (varIconFilter === "neutral" && !(["neutralHigh", "neutralLow"].includes(varIcons[0]))) {
          continue;
        }
        if (varIconFilter === "common" && varIcons[0] !== "commonCause") {
          continue;
        }
        if (varIconFilter === "special" && varIcons[0] === "commonCause") {
          continue;
        }
      }
      const assIcon: string = assuranceIconToDraw(limits, this.inputSettings.settingsGrouped[i],
                                                      this.inputSettings.derivedSettingsGrouped[i]);
      if (assIconFilter !== "all") {
        if (assIconFilter === "any" && assIcon === "inconsistent") {
          continue;
        }
        if (assIconFilter === "pass" && assIcon !== "consistentPass") {
          continue;
        }
        if (assIconFilter === "fail" && assIcon !== "consistentFail") {
          continue;
        }
        if (assIconFilter === "inconsistent" && assIcon !== "inconsistent") {
          continue;
        }
      }
      const table_row_entries: [string, string | number][] = new Array<[string, string | number]>();
      this.indicatorVarNames.forEach((indicator_name, idx) => {
        table_row_entries.push([indicator_name, this.groupNames[i][idx]]);
      })
      table_row_entries.push(["latest_date", limits.keys?.[lastIndex].label]);
      table_row_entries.push(["value", formatValues(limits.values?.[lastIndex], "value")]);
      table_row_entries.push(["numerator", formatValues(limits.numerators?.[lastIndex], "integer")]);
      table_row_entries.push(["denominator", formatValues(limits.denominators?.[lastIndex], "integer")]);
      table_row_entries.push(["target", formatValues(limits.targets?.[lastIndex], "value")]);
      table_row_entries.push(["alt_target", formatValues(limits.alt_targets?.[lastIndex], "value")]);
      table_row_entries.push(["ucl99", formatValues(limits.ul99?.[lastIndex], "value")]);
      table_row_entries.push(["ucl95", formatValues(limits.ul95?.[lastIndex], "value")]);
      table_row_entries.push(["ucl68", formatValues(limits.ul68?.[lastIndex], "value")]);
      table_row_entries.push(["lcl68", formatValues(limits.ll68?.[lastIndex], "value")]);
      table_row_entries.push(["lcl95", formatValues(limits.ll95?.[lastIndex], "value")]);
      table_row_entries.push(["lcl99", formatValues(limits.ll99?.[lastIndex], "value")]);
      table_row_entries.push(["variation", varIcons[0]]);
      table_row_entries.push(["assurance", assIcon]);

      if (anyTooltips) {
        this.inputDataGrouped[i].tooltips[lastIndex].forEach(tooltip => {
          table_row_entries.push([tooltip.displayName, tooltip.value]);
        })
      }

      this.plotPointsGrouped.push({
        table_row: Object.fromEntries(table_row_entries) as summaryTableRowDataGrouped,
        identity: this.identitiesGrouped[i],
        aesthetics: this.inputSettings.settingsGrouped[i].summary_table,
        highlighted: this.inputDataGrouped[i].anyHighlights
      })
    }
  }

  initialisePlotData(host: IVisualHost): void {
    // Cache frequently accessed objects to reduce property chain traversal
    const controlLimits = this.controlLimits;
    const outliers = this.outliers;
    const inputData = this.inputData;
    const settings = this.inputSettings.settings;
    const derivedSettings = this.inputSettings.derivedSettings;
    const colourPalette = this.colourPalette;
    const isHighContrast = colourPalette.isHighContrast;
    const foregroundColour = colourPalette.foregroundColour;
    const n = controlLimits.keys.length;

    // Pre-allocate arrays with known size for better performance
    this.plotPoints = new Array<plotData>(n);
    this.tickLabels = new Array<{ x: number; label: string; }>(n);

    // Build table columns (small array, push is fine)
    this.tableColumns = new Array<{ name: string; label: string; }>();
    this.tableColumns.push({ name: "date", label: "Date" });
    this.tableColumns.push({ name: "value", label: "Value" });
    if (!isNullOrUndefined(controlLimits.numerators)) {
      this.tableColumns.push({ name: "numerator", label: "Numerator" });
    }
    if (!isNullOrUndefined(controlLimits.denominators)) {
      this.tableColumns.push({ name: "denominator", label: "Denominator" });
    }
    if (settings.lines.show_target) {
      this.tableColumns.push({ name: "target", label: "Target" });
    }
    if (settings.lines.show_alt_target) {
      this.tableColumns.push({ name: "alt_target", label: "Alt. Target" });
    }
    if (settings.lines.show_specification) {
      this.tableColumns.push({ name: "speclimits_lower", label: "Spec. Lower" },
                             { name: "speclimits_upper", label: "Spec. Upper" });
    }
    if (settings.lines.show_trend) {
      this.tableColumns.push({ name: "trend_line", label: "Trend Line" });
    }
    if (derivedSettings.chart_type_props.has_control_limits) {
      if (settings.lines.show_99) {
        this.tableColumns.push({ name: "ll99", label: "LL 99%" },
                               { name: "ul99", label: "UL 99%" });
      }
      if (settings.lines.show_95) {
        this.tableColumns.push({ name: "ll95", label: "LL 95%" }, { name: "ul95", label: "UL 95%" });
      }
      if (settings.lines.show_68) {
        this.tableColumns.push({ name: "ll68", label: "LL 68%" }, { name: "ul68", label: "UL 68%" });
      }
    }

    if (settings.outliers.astronomical) {
      this.tableColumns.push({ name: "astpoint", label: "Ast. Point" });
    }
    if (settings.outliers.trend) {
      this.tableColumns.push({ name: "trend", label: "Trend" });
    }
    if (settings.outliers.shift) {
      this.tableColumns.push({ name: "shift", label: "Shift" });
    }

    // Cache array references for inner loop
    const keys = controlLimits.keys;
    const values = controlLimits.values;
    const targets = controlLimits.targets;
    const numerators = controlLimits.numerators;
    const denominators = controlLimits.denominators;
    const alt_targets = controlLimits.alt_targets;
    const ll99 = controlLimits.ll99;
    const ll95 = controlLimits.ll95;
    const ll68 = controlLimits.ll68;
    const ul68 = controlLimits.ul68;
    const ul95 = controlLimits.ul95;
    const ul99 = controlLimits.ul99;
    const speclimits_lower = controlLimits.speclimits_lower;
    const speclimits_upper = controlLimits.speclimits_upper;
    const trend_line = controlLimits.trend_line;
    const outlierShift = outliers.shift;
    const outlierTrend = outliers.trend;
    const outlierTwoInThree = outliers.two_in_three;
    const outlierAstpoint = outliers.astpoint;
    const scatterFormatting = inputData.scatter_formatting;
    const labelFormatting = inputData.label_formatting;
    const highlights = inputData.highlights;
    const tooltips = inputData.tooltips;
    const labels = inputData.labels;
    const categories = inputData.categories;
    const limitInputArgsKeys = inputData.limitInputArgs.keys;

    for (let i = 0; i < n; i++) {
      const index: number = keys[i].x;
      const aesthetics: defaultSettingsType["scatter"] = scatterFormatting[i];
      if (isHighContrast) {
        aesthetics.colour = foregroundColour;
      }
      if (outlierShift[i] !== "none") {
        aesthetics.colour = getAesthetic(outlierShift[i], "outliers",
                                  "shift_colour", settings) as string;
        aesthetics.colour_outline = getAesthetic(outlierShift[i], "outliers",
                                  "shift_colour", settings) as string;
      }
      if (outlierTrend[i] !== "none") {
        aesthetics.colour = getAesthetic(outlierTrend[i], "outliers",
                                  "trend_colour", settings) as string;
        aesthetics.colour_outline = getAesthetic(outlierTrend[i], "outliers",
                                  "trend_colour", settings) as string;
      }
      if (outlierTwoInThree[i] !== "none") {
        aesthetics.colour = getAesthetic(outlierTwoInThree[i], "outliers",
                                  "twointhree_colour", settings) as string;
        aesthetics.colour_outline = getAesthetic(outlierTwoInThree[i], "outliers",
                                  "twointhree_colour", settings) as string;
      }
      if (outlierAstpoint[i] !== "none") {
        aesthetics.colour = getAesthetic(outlierAstpoint[i], "outliers",
                                  "ast_colour", settings) as string;
        aesthetics.colour_outline = getAesthetic(outlierAstpoint[i], "outliers",
                                  "ast_colour", settings) as string;
      }
      const table_row: summaryTableRowData = {
        date: keys[i].label,
        numerator: numerators?.[i],
        denominator: denominators?.[i],
        value: values[i],
        target: targets[i],
        alt_target: alt_targets[i],
        ll99: ll99?.[i],
        ll95: ll95?.[i],
        ll68: ll68?.[i],
        ul68: ul68?.[i],
        ul95: ul95?.[i],
        ul99: ul99?.[i],
        speclimits_lower: speclimits_lower?.[i],
        speclimits_upper: speclimits_upper?.[i],
        trend_line: trend_line?.[i],
        astpoint: outlierAstpoint[i],
        trend: outlierTrend[i],
        shift: outlierShift[i],
        two_in_three: outlierTwoInThree[i]
      }


      // Direct assignment instead of push() for pre-allocated arrays
      this.plotPoints[i] = {
        x: index,
        value: values[i],
        aesthetics: aesthetics,
        table_row: table_row,
        identity: host.createSelectionIdBuilder()
                      .withCategory(categories, limitInputArgsKeys[i].id)
                      .createSelectionId(),
        highlighted: !isNullOrUndefined(highlights?.[index]),
        tooltip: buildTooltip(table_row, tooltips?.[index],
                              settings, derivedSettings),
        label: {
          text_value: labels?.[index],
          aesthetics: labelFormatting[index],
          angle: null,
          distance: null,
          line_offset: null,
          marker_offset: null
        }
      };
      this.tickLabels[i] = {x: index, label: keys[i].label};
    }
  }

  initialiseGroupedLines(): void {
    // Cache frequently accessed settings objects
    const linesSettings = this.inputSettings.settings.lines;
    const derivedSettings = this.inputSettings.derivedSettings;
    const controlLimits = this.controlLimits;
    const nLimits = controlLimits.keys.length;

    // Build labels array (small, push is fine)
    const labels: string[] = new Array<string>();
    if (linesSettings.show_main) {
      labels.push("values");
    }
    if (linesSettings.show_target) {
      labels.push("targets");
    }
    if (linesSettings.show_alt_target) {
      labels.push("alt_targets");
    }
    if (linesSettings.show_specification) {
      labels.push("speclimits_lower", "speclimits_upper");
    }
    if (linesSettings.show_trend) {
      labels.push("trend_line");
    }
    if (derivedSettings.chart_type_props.has_control_limits) {
      if (linesSettings.show_99) {
        labels.push("ll99", "ul99");
      }
      if (linesSettings.show_95) {
        labels.push("ll95", "ul95");
      }
      if (linesSettings.show_68) {
        labels.push("ll68", "ul68");
      }
    }

    const nLabels = labels.length;
    const showAltTarget = linesSettings.show_alt_target;

    // Use Set for O(1) lookup instead of O(n) array.includes()
    const splitIndexesSet = new Set(this.splitIndexes.map(idx => idx));
    const groupingIndexesSet = new Set(this.inputData.groupingIndexes.map(idx => idx));

    // Pre-cache join_rebaselines settings for each label to avoid repeated property lookups
    const joinRebaselinesMap = new Map<string, boolean>();
    for (let j = 0; j < nLabels; j++) {
      const label = labels[j];
      joinRebaselinesMap.set(label, linesSettings[`join_rebaselines_${lineNameMap[label]}`]);
    }

    // Cache array references for inner loop
    const keys = controlLimits.keys;
    const altTargets = controlLimits.alt_targets;

    // Build grouped lines directly into a Map instead of creating intermediate array
    // This avoids the overhead of groupBy which iterates the entire array
    const groupedLinesMap = new Map<string, lineData[]>();
    for (let j = 0; j < nLabels; j++) {
      groupedLinesMap.set(labels[j], new Array<lineData>());
    }

    for (let i = 0; i < nLimits; i++) {
      const prevIdx = i - 1;
      const isRebaselinePoint: boolean = splitIndexesSet.has(prevIdx) || groupingIndexesSet.has(prevIdx);
      let isNewAltTarget: boolean = false;
      if (i > 0 && showAltTarget) {
        isNewAltTarget = altTargets[i] !== altTargets[prevIdx];
      }
      const xValue = keys[i].x;

      for (let j = 0; j < nLabels; j++) {
        const label = labels[j];
        const lineArray = groupedLinesMap.get(label)!;
        const lineValue = controlLimits[label]?.[i];

        // By adding an additional null line value at each re-baseline point
        // we avoid rendering a line joining each segment
        if (isRebaselinePoint || isNewAltTarget) {
          const is_alt_target: boolean = label === "alt_targets" && isNewAltTarget;
          const is_rebaseline: boolean = label !== "alt_targets" && isRebaselinePoint;
          const join_rebaselines = joinRebaselinesMap.get(label)!;
          lineArray.push({
            x: xValue,
            line_value: (!join_rebaselines && (is_alt_target || is_rebaseline)) ? null : lineValue,
            group: label
          });
        }

        lineArray.push({
          x: xValue,
          line_value: lineValue,
          group: label
        });
      }
    }
    this.groupedLines = Array.from(groupedLinesMap);
  }

  scaleAndTruncateLimits(controlLimits: controlLimitsObject,
                          inputSettings: defaultSettingsType,
                          derivedSettings: derivedSettingsClass): void {
    // Scale limits using provided multiplier
    const multiplier: number = derivedSettings.multiplier;
    let lines_to_scale: string[] = ["values", "targets"];

    if (derivedSettings.chart_type_props.has_control_limits) {
      lines_to_scale = lines_to_scale.concat(["ll99", "ll95", "ll68", "ul68", "ul95", "ul99"]);
    }

    let lines_to_truncate: string[] = lines_to_scale;
    if (inputSettings.lines.show_alt_target) {
      lines_to_truncate = lines_to_truncate.concat(["alt_targets"]);
      if (inputSettings.lines.multiplier_alt_target) {
        lines_to_scale = lines_to_scale.concat(["alt_targets"]);
      }
    }
    if (inputSettings.lines.show_specification) {
      lines_to_truncate = lines_to_truncate.concat(["speclimits_lower", "speclimits_upper"]);
      if (inputSettings.lines.multiplier_specification) {
        lines_to_scale = lines_to_scale.concat(["speclimits_lower", "speclimits_upper"]);
      }
    }

    const limits: truncateInputs = {
      lower: inputSettings.spc.ll_truncate,
      upper: inputSettings.spc.ul_truncate
    };

    lines_to_scale.forEach(limit => {
      controlLimits[limit] = multiply(controlLimits[limit], multiplier)
    })

    lines_to_truncate.forEach(limit => {
      controlLimits[limit] = truncate(controlLimits[limit], limits)
    })
  }

  flagOutliers(controlLimits: controlLimitsObject, groupStartEndIndexes: number[][],
                inputSettings: defaultSettingsType, derivedSettings: derivedSettingsClass): outliersObject {
    const process_flag_type: string = inputSettings.outliers.process_flag_type;
    const improvement_direction: string = inputSettings.outliers.improvement_direction;
    const trend_n: number = inputSettings.outliers.trend_n;
    const shift_n: number = inputSettings.outliers.shift_n;
    const ast_specification: boolean = inputSettings.outliers.astronomical_limit === "Specification";
    const two_in_three_specification: boolean = inputSettings.outliers.two_in_three_limit === "Specification";
    const outliers = {
      astpoint: rep("none", controlLimits.values.length),
      two_in_three: rep("none", controlLimits.values.length),
      trend: rep("none", controlLimits.values.length),
      shift: rep("none", controlLimits.values.length)
    }
    for (let i: number = 0; i < groupStartEndIndexes.length; i++) {
      const start: number = groupStartEndIndexes[i][0];
      const end: number = groupStartEndIndexes[i][1];
      const group_values: number[] = controlLimits.values.slice(start, end);
      const group_targets: number[] = controlLimits.targets.slice(start, end);

      if (derivedSettings.chart_type_props.has_control_limits || ast_specification || two_in_three_specification) {
        const limit_map: Record<string, string> = {
          "1 Sigma": "68",
          "2 Sigma": "95",
          "3 Sigma": "99",
          "Specification": "",
        };
        if (inputSettings.outliers.astronomical) {
          const ast_limit: string = limit_map[inputSettings.outliers.astronomical_limit];
          const ll_prefix: string = ast_specification ? "speclimits_lower" : "ll";
          const ul_prefix: string = ast_specification ? "speclimits_upper" : "ul";
          const lower_limits: number[] = controlLimits?.[`${ll_prefix}${ast_limit}`]?.slice(start, end);
          const upper_limits: number[] = controlLimits?.[`${ul_prefix}${ast_limit}`]?.slice(start, end);
          astronomical(group_values, lower_limits, upper_limits)
            .forEach((flag, idx) => outliers.astpoint[start + idx] = flag)
        }
        if (inputSettings.outliers.two_in_three) {
          const highlight_series: boolean = inputSettings.outliers.two_in_three_highlight_series;
          const two_in_three_limit: string = limit_map[inputSettings.outliers.two_in_three_limit];
          const ll_prefix: string = two_in_three_specification ? "speclimits_lower" : "ll";
          const ul_prefix: string = two_in_three_specification ? "speclimits_upper" : "ul";
          const lower_warn_limits: number[] = controlLimits?.[`${ll_prefix}${two_in_three_limit}`]?.slice(start, end);
          const upper_warn_limits: number[] = controlLimits?.[`${ul_prefix}${two_in_three_limit}`]?.slice(start, end);
          twoInThree(group_values, lower_warn_limits, upper_warn_limits, highlight_series)
            .forEach((flag, idx) => outliers.two_in_three[start + idx] = flag)
        }
      }
      if (inputSettings.outliers.trend) {
        trend(group_values, trend_n)
          .forEach((flag, idx) => outliers.trend[start + idx] = flag)
      }
      if (inputSettings.outliers.shift) {
        shift(group_values, group_targets, shift_n)
          .forEach((flag, idx) => outliers.shift[start + idx] = flag)
      }
    }
    Object.keys(outliers).forEach(key => {
      outliers[key] = checkFlagDirection(outliers[key],
                                              { process_flag_type, improvement_direction });
    })
    return outliers;
  }
}
