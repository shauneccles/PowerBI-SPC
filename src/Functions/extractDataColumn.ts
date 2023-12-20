import powerbi from "powerbi-visuals-api"
type DataViewValueColumn = powerbi.DataViewValueColumn;
type DataViewCategorical = powerbi.DataViewCategorical;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import type { defaultSettingsType } from "../Classes/";
import { formatPrimitiveValue, dateSettingsToFormatOptions, parseInputDates } from "../Functions";
type TargetT = number[] | string[] | number | string | VisualTooltipDataItem[][];

function datePartsToRecord(dateParts: Intl.DateTimeFormatPart[]) {
  const datePartsRecord = Object.fromEntries(dateParts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  ["weekday", "day", "month", "year"].forEach(key => {
    datePartsRecord[key] ??= ""
  })
  return datePartsRecord
}

function extractKeys(inputView: DataViewCategorical, inputSettings: defaultSettingsType): string[] {
  const inputDates = parseInputDates(inputView.categories.filter(viewColumn => viewColumn.source?.roles?.["key"]))
  const formatter = new Intl.DateTimeFormat(inputSettings.dates.date_format_locale, dateSettingsToFormatOptions(inputSettings.dates));
  const delim: string = inputSettings.dates.date_format_delim;
  return inputDates.dates.map((value: Date, idx) => {
    if (value === null) {
      return null
    }
    const dateParts = datePartsToRecord(formatter.formatToParts(<Date>value))
    const quarter: string = inputDates.quarters?.[idx] ?? ""
    return `${dateParts.weekday} ${dateParts.day}${delim}${dateParts.month}${delim}${quarter}${delim}${dateParts.year}`
  })
}

function extractTooltips(inputView: DataViewCategorical, inputSettings: defaultSettingsType): VisualTooltipDataItem[][] {
  const tooltipColumns = inputView.values.filter(viewColumn => viewColumn.source.roles.tooltips);
  return tooltipColumns?.[0]?.values?.map((_, idx) => {
    return tooltipColumns.map(viewColumn => {
      const config = { valueType: viewColumn.source.type, dateSettings: inputSettings.dates };
      const tooltipValueFormatted: string = formatPrimitiveValue(viewColumn?.values?.[idx], config)

      return <VisualTooltipDataItem>{
        displayName: viewColumn.source.displayName,
        value: tooltipValueFormatted
      }
    })
  })
}

export default function extractDataColumn<T extends TargetT>(inputView: DataViewCategorical,
                                              name: string,
                                              inputSettings: defaultSettingsType): T {
  if (name === "key") {
    return extractKeys(inputView, inputSettings) as Extract<T, string[]>;
  }
  if (name === "tooltips") {
    return extractTooltips(inputView, inputSettings) as Extract<T, VisualTooltipDataItem[][]>;
  }

  // Assumed that any other requested columns are numeric columns for plotting
  const columnRaw = inputView.values.filter(viewColumn => viewColumn?.source?.roles?.[name]) as DataViewValueColumn[];
  return columnRaw?.[0]?.values?.map(d => d === null ? null : Number(d)) as T
}
