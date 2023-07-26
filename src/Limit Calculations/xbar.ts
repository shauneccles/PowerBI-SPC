import * as d3 from "../D3 Plotting Functions/D3 Modules";
import { a3 } from "../Functions/Constants";
import rep from "../Functions/rep";
import { sqrt } from "../Functions/UnaryFunctions"
import { pow, subtract, add, multiply, divide } from "../Functions/BinaryFunctions";
import controlLimitsClass from "../Classes/controlLimitsClass";
import dataClass from "../Classes/dataClass";
import { LimitArgs } from "../Classes/viewModelClass";

export default function xbarLimits(args: LimitArgs): controlLimitsClass {
  const inputData: dataClass = args.inputData;
  // Calculate number of observations in each group
  const count_per_group: number[] = inputData.denominators;

  // Calculate the mean for each group
  const group_means: number[] = inputData.numerators;

  // Calculate the SD for each group
  const group_sd: number[] = inputData.xbar_sds;

  // Per-group sample size minus 1
  const Nm1: number[] = subtract(count_per_group, 1);

  // Calculate weighted SD
  const sd: number = sqrt(d3.sum(multiply(Nm1,pow(group_sd,2))) / d3.sum(Nm1));

  // Calculated weighted mean (for centreline)
  const cl: number = d3.sum(multiply(count_per_group, group_means)) / d3.sum(count_per_group);

  // Sample-size dependent constant
  const A3: number[] = a3(count_per_group);

  return new controlLimitsClass({
    inputSettings: args.inputSettings,
    keys: inputData.keys,
    values: group_means,
    targets: rep(cl, inputData.keys.length),
    ll99: subtract(cl, multiply(A3, sd)),
    ll95: subtract(cl, multiply(multiply(divide(A3, 3), 2), sd)),
    ul95: add(cl, multiply(multiply(divide(A3, 3), 2), sd)),
    ul99: add(cl, multiply(A3, sd)),
    count: count_per_group
  })
}
