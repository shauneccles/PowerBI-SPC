import type powerbi from "powerbi-visuals-api"
type DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
type PrimitiveValue = powerbi.PrimitiveValue;
type DataViewCategorical = powerbi.DataViewCategorical;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import extractDataColumn from "../Functions/extractDataColumn";
import extractValues from "../Functions/extractValues";
import extractConditionalFormatting from "../Functions/extractConditionalFormatting";
import validateInputData from "../Functions/validateInputData";
import isNullOrUndefined from "../Functions/isNullOrUndefined";
import seq from "../Functions/seq";
import between from "../Functions/between";
import type { defaultSettingsType } from "../Classes/settingsClass";
import type { controlLimitsArgs } from "../Classes/viewModelClass";
import type derivedSettingsClass from "../Classes/derivedSettingsClass";
import type { ValidationT } from "./validateInputData";

export type dataObject = {
  limitInputArgs: controlLimitsArgs | null;
  spcSettings: defaultSettingsType["spc"] | null;
  highlights: (PrimitiveValue | null)[];
  anyHighlights: boolean;
  categories: DataViewCategoryColumn | null;
  groupings: string[] | null;
  groupingIndexes: number[] | null;
  scatter_formatting: defaultSettingsType["scatter"][] | null;
  line_formatting: defaultSettingsType["lines"][] | null;
  label_formatting: defaultSettingsType["labels"][] | null;
  tooltips: VisualTooltipDataItem[][] | null;
  labels: string[] | null;
  anyLabels: boolean;
  warningMessage: string;
  alt_targets: (number | null)[] | null;
  speclimits_lower: (number | null)[] | null;
  speclimits_upper: (number | null)[] | null;
  validationStatus: ValidationT;
}

function invalidInputData(inputValidStatus: ValidationT): dataObject {
  return {
    limitInputArgs: null,
    spcSettings: null,
    highlights: [],
    anyHighlights: false,
    categories: null,
    groupings: null,
    groupingIndexes: null,
    scatter_formatting: null,
    line_formatting: null,
    label_formatting: null,
    tooltips: null,
    labels: null,
    anyLabels: false,
    warningMessage: inputValidStatus.error ?? "",
    alt_targets: null,
    speclimits_lower: null,
    speclimits_upper: null,
    validationStatus: inputValidStatus
  }
}

export default function extractInputData(inputView: DataViewCategorical,
                                          inputSettings: defaultSettingsType,
                                          derivedSettings: derivedSettingsClass,
                                          validationMessages: string[][],
                                          idxs: number[]): dataObject {
  const numerators = extractDataColumn<number[]>(inputView, "numerators", inputSettings, idxs);
  const denominators = extractDataColumn<number[]>(inputView, "denominators", inputSettings, idxs);
  const xbar_sds = extractDataColumn<number[]>(inputView, "xbar_sds", inputSettings, idxs);
  const keys = extractDataColumn<string[]>(inputView, "key", inputSettings, idxs);
  const tooltips = extractDataColumn<VisualTooltipDataItem[][]>(inputView, "tooltips", inputSettings, idxs);
  const groupings = extractDataColumn<string[]>(inputView, "groupings", inputSettings, idxs);
  const labels = extractDataColumn<string[]>(inputView, "labels", inputSettings, idxs);
  const highlights = idxs.map(d => inputView?.values?.[0]?.highlights?.[d] ?? null) as (PrimitiveValue | null)[];
  let scatter_cond = extractConditionalFormatting<defaultSettingsType["scatter"]>(inputView, "scatter", inputSettings, idxs).values;
  let lines_cond = extractConditionalFormatting<defaultSettingsType["lines"]>(inputView, "lines", inputSettings, idxs).values;
  let labels_cond = extractConditionalFormatting<defaultSettingsType["labels"]>(inputView, "labels", inputSettings, idxs).values;
  let alt_targets = extractConditionalFormatting<defaultSettingsType["lines"]>(inputView, "lines", inputSettings, idxs)
                                    .values
                                    ?.map(d => inputSettings.lines.show_alt_target ? d.alt_target : null) ?? null;
  let speclimits_lower = extractConditionalFormatting<defaultSettingsType["lines"]>(inputView, "lines", inputSettings, idxs)
                                    .values
                                    ?.map(d => d.show_specification ? d.specification_lower : null) ?? null;
  let speclimits_upper = extractConditionalFormatting<defaultSettingsType["lines"]>(inputView, "lines", inputSettings, idxs)
                                    .values
                                    ?.map(d => d.show_specification ? d.specification_upper : null) ?? null;
  let spcSettings = extractConditionalFormatting<defaultSettingsType["spc"]>(inputView, "spc", inputSettings, idxs).values ?? null;
  const inputValidStatus: ValidationT = validateInputData(keys, numerators, denominators, xbar_sds, derivedSettings.chart_type_props, idxs);
  if (inputValidStatus.status !== 0) {
    return invalidInputData(inputValidStatus);
  }

  // After validation passes (status === 0), keys and spcSettings are guaranteed non-null
  const validKeys = keys!;
  const validSpcSettings = spcSettings!;
  const valid_ids: number[] = new Array<number>();
  const valid_keys: { x: number, id: number, label: string }[] = new Array<{ x: number, id: number, label: string }>();
  const removalMessages: string[] = new Array<string>();
  const groupVarName: string = inputView.categories![0].source.displayName;
  const settingsMessages = validationMessages;
  let valid_x: number = 0;
  const x_axis_use_date: boolean = derivedSettings.chart_type_props.x_axis_use_date;
  idxs.forEach((i, idx) => {
    if (inputValidStatus.messages[idx] === "") {
      valid_ids.push(idx);
      valid_keys.push({ x: valid_x, id: i, label: x_axis_use_date ? validKeys[idx] : valid_x.toString() });
      valid_x += 1;

      if (settingsMessages[i].length > 0) {
        settingsMessages[i].forEach(setting_removal_message => {
          removalMessages.push(
            `Conditional formatting for ${groupVarName} ${validKeys[idx]} ignored due to: ${setting_removal_message}.`
          )}
        );
      }
    } else {
      removalMessages.push(`${groupVarName} ${validKeys[idx]} removed due to: ${inputValidStatus.messages[idx]}.`)
    }
  })

  const valid_groupings: string[] = extractValues(groupings, valid_ids);
  const groupingIndexes: number[] = new Array<number>();
  let current_grouping: string = valid_groupings[0];
  valid_groupings.forEach((d, idx) => {
    if (d !== current_grouping) {
      groupingIndexes.push(idx - 1);
      current_grouping = d;
    }
  })

  const valid_alt_targets = extractValues(alt_targets, valid_ids);
  if (inputSettings.nhs_icons.show_assurance_icons) {
    const alt_targets_length: number = valid_alt_targets.length;
    if (alt_targets_length > 0) {
      const last_target = valid_alt_targets[alt_targets_length - 1];
      if (isNullOrUndefined(last_target)) {
        removalMessages.push("NHS Assurance icon requires a valid alt. target at last observation.")
      }
    }

    if (!derivedSettings.chart_type_props.has_control_limits) {
      removalMessages.push("NHS Assurance icon requires chart with control limits.")
    }
  }

  const curr_highlights = extractValues(highlights, valid_ids);
  const num_points_subset = validSpcSettings[0].num_points_subset;
  let subset_points: number[];
  if (isNullOrUndefined(num_points_subset) || !between(num_points_subset, 1, valid_ids.length)) {
    subset_points = seq(0, valid_ids.length - 1);
  } else {
    if (validSpcSettings[0].subset_points_from === "Start") {
      subset_points = seq(0, num_points_subset - 1);
    } else {
      subset_points = seq(valid_ids.length - num_points_subset, valid_ids.length - 1);
    }
  }
  const valid_labels: string[] = extractValues(labels, valid_ids);
  return {
    limitInputArgs: {
      keys: valid_keys,
      numerators: extractValues(numerators, valid_ids),
      denominators: extractValues(denominators, valid_ids),
      xbar_sds: extractValues(xbar_sds, valid_ids),
      outliers_in_limits: validSpcSettings[0].outliers_in_limits,
      subset_points: subset_points
    },
    spcSettings: validSpcSettings[0],
    tooltips: extractValues(tooltips, valid_ids),
    labels: valid_labels,
    anyLabels: valid_labels.filter(d => !isNullOrUndefined(d) && d !== "").length > 0,
    highlights: curr_highlights,
    anyHighlights: curr_highlights.filter(d => !isNullOrUndefined(d)).length > 0,
    categories: inputView.categories![0],
    groupings: valid_groupings,
    groupingIndexes: groupingIndexes,
    scatter_formatting: extractValues(scatter_cond, valid_ids),
    line_formatting: extractValues(lines_cond, valid_ids),
    label_formatting: extractValues(labels_cond, valid_ids),
    warningMessage: removalMessages.length > 0 ? removalMessages.join("\n") : "",
    alt_targets: valid_alt_targets,
    speclimits_lower: extractValues(speclimits_lower, valid_ids),
    speclimits_upper: extractValues(speclimits_upper, valid_ids),
    validationStatus: inputValidStatus
  }
}
