import * as d3 from "../D3 Plotting Functions/D3 Modules";
import rep from "../Functions/rep";
import { divide } from "../Functions/BinaryFunctions";
import controlLimitsClass from "../Classes/controlLimitsClass";
import dataClass from "../Classes/dataClass";
import settingsClass from "../Classes/settingsClass";

export default function runLimits(inputData: dataClass, inputSettings: settingsClass): controlLimitsClass {
  const useRatio: boolean = (inputData.denominators && inputData.denominators.length > 0);
  const ratio: number[] = useRatio
    ? divide(inputData.numerators, inputData.denominators)
    : inputData.numerators;

  const cl: number = d3.median(ratio);
  return new controlLimitsClass({
    inputSettings: inputSettings,
    keys: inputData.keys,
    values: ratio.map(d => isNaN(d) ? 0 : d),
    numerators: useRatio ? inputData.numerators : <number[]>null,
    denominators: useRatio ? inputData.denominators : <number[]>null,
    targets: rep(cl, inputData.keys.length),
    ll99: <number[]>null,
    ll95: <number[]>null,
    ul95: <number[]>null,
    ul99: <number[]>null
  });
}
