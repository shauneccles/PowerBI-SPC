import rep from "../Functions/rep";
import astronomical from "../Outlier Flagging/astronomical"
import trend from "../Outlier Flagging/trend"
import two_in_three from "../Outlier Flagging/two_in_three"
import shift from "../Outlier Flagging/shift"
import settingsClass from "./settingsClass";
import checkFlagDirection from "../Functions/checkFlagDirection"

type controlLimitsArgs = {
  keys: { x: number, id: number, label: string }[];
  values: number[];
  numerators?: number[];
  denominators?: number[];
  targets: number[];
  alt_targets?: number[];
  ll99: number[];
  ll95: number[];
  ul95: number[];
  ul99: number[];
  count?: number[];
}

class controlLimitsClass {
  [key: string] : any;
  keys: { x: number, id: number, label: string }[];
  values: number[];
  numerators?: number[];
  denominators?: number[];
  targets: number[];
  alt_targets?: number[];
  ll99: number[];
  ll95: number[];
  ul95: number[];
  ul99: number[];
  count?: number[];
  astpoint: string[];
  trend: string[];
  two_in_three: string[];
  shift: string[];

  flagOutliers(inputSettings: settingsClass) {
    const process_flag_type: string = inputSettings.outliers.process_flag_type;
    const improvement_direction: string = inputSettings.outliers.improvement_direction;
    if (inputSettings.spc.chart_type !== "run") {
      if (inputSettings.outliers.astronomical) {
        this.astpoint = checkFlagDirection(astronomical(this.values, this.ll99, this.ul99),
                                            { process_flag_type, improvement_direction });
      }
      if (inputSettings.outliers.two_in_three) {
        this.two_in_three = checkFlagDirection(two_in_three(this.values, this.ll95, this.ul95),
                                                { process_flag_type, improvement_direction });
      }
    }
    if (inputSettings.outliers.trend) {
      this.trend = checkFlagDirection(trend(this.values, inputSettings.outliers.trend_n),
                                      { process_flag_type, improvement_direction });
    }
    if (inputSettings.outliers.shift) {
      this.shift = checkFlagDirection(shift(this.values, this.targets, inputSettings.outliers.shift_n),
                                      { process_flag_type, improvement_direction });
    }
  }

  constructor(args: controlLimitsArgs) {
    this.keys = args.keys;
    this.values = args.values;
    if (args.numerators || !(args.numerators === null || args.numerators === undefined)) {
      this.numerators = args.numerators;
    }
    if (args.denominators || !(args.denominators === null || args.denominators === undefined)) {
      this.denominators = args.denominators;
    }
    this.targets = args.targets;
    this.ll99 = args.ll99;
    this.ll95 = args.ll95;
    this.ul95 = args.ul95;
    this.ul99 = args.ul99;
    this.astpoint = rep("none", args.values.length);
    this.trend = rep("none", args.values.length);
    this.two_in_three = rep("none", args.values.length);
    this.shift = rep("none", args.values.length);
    if (args.count || !(args.count === null || args.count === undefined)) {
      this.count = args.count;
    }
  }
}

export default controlLimitsClass
