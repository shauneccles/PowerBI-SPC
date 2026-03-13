import type { controlLimitsObject, controlLimitsArgs } from "../Classes/viewModelClass";
import createLimitArrays from "./createLimitArrays";

/**
 * Calculates control limits for an I-chart (Individuals chart), also known as an XmR chart.
 *
 * The I-chart is used to monitor individual measurements (rather than subgroup means)
 * over time. It is typically paired with a moving range (MR) chart. This chart is
 * appropriate when only one observation is available per time period, or when the
 * natural subgroup size is 1.
 *
 * **Centreline Calculation:**
 * The centreline (x̄) is the mean of all individual observations:
 *
 * $$\bar{x} = \frac{\sum_{i=1}^{n} x_i}{n}$$
 *
 * If denominators are provided, each value is calculated as the ratio: $x_i = \frac{numerator_i}{denominator_i}$
 *
 * **Sigma (Standard Deviation) Calculation:**
 * The standard deviation is estimated from the average moving range (AMR):
 *
 * $$\sigma = \frac{\overline{MR}}{d_2} = \frac{\overline{MR}}{1.128}$$
 *
 * where the moving range is the absolute difference between consecutive observations:
 *
 * $$MR_i = |x_i - x_{i-1}|$$
 *
 * $$\overline{MR} = \frac{\sum_{i=2}^{n} MR_i}{n-1}$$
 *
 * and $d_2 = 1.128$ is the expected value of the range for a sample size of 2.
 *
 * Optionally, outliers can be screened from the moving range calculation using:
 * $MR_{limit} = 3.267 \times \overline{MR}$ (the upper limit for moving range).
 *
 * **Control Limits:**
 * - Upper Control Limit (3σ): $UCL = \bar{x} + 3\sigma = \bar{x} + \frac{3 \times \overline{MR}}{1.128}$
 * - Lower Control Limit (3σ): $LCL = \bar{x} - 3\sigma = \bar{x} - \frac{3 \times \overline{MR}}{1.128}$
 *
 * @param args - The control limits calculation arguments
 * @param args.numerators - Array of individual measurements (or numerators if using ratios)
 * @param args.denominators - Optional array of denominators for ratio calculations
 * @param args.keys - Array of key objects containing x-position, id, and label for each point
 * @param args.subset_points - Array of indices indicating which points to include in limit calculations
 * @param args.outliers_in_limits - If false, screens out extreme moving ranges before calculating sigma
 *
 * @returns A controlLimitsObject containing:
 *   - keys: The input keys passed through
 *   - values: The individual values (or ratios) plotted on the chart
 *   - numerators/denominators: The original values if using ratios
 *   - targets: The centreline (mean) for each point
 *   - ll99/ul99: Lower/Upper 3-sigma control limits
 *   - ll95/ul95: Lower/Upper 2-sigma warning limits
 *   - ll68/ul68: Lower/Upper 1-sigma limits
 *
 * @example
 * // For values [10, 12, 11, 14, 9] with mean x̄ = 11.2:
 * // Moving ranges: |12-10|=2, |11-12|=1, |14-11|=3, |9-14|=5
 * // AMR = (2+1+3+5)/4 = 2.75
 * // σ = 2.75 / 1.128 ≈ 2.44
 * // UCL = 11.2 + 3(2.44) ≈ 18.52
 * // LCL = 11.2 - 3(2.44) ≈ 3.88
 *
 * @see {@link https://en.wikipedia.org/wiki/X-bar_and_R_chart} for individuals chart theory
 */
export default function iLimits(args: controlLimitsArgs): controlLimitsObject {
  // Determine if we're calculating ratios (numerator/denominator) or raw values
  const useRatio: boolean = !!(args.denominators && args.denominators.length > 0);

  // Extract input arrays from arguments
  const numerators: readonly number[] = args.numerators;    // Raw values or numerators for ratios
  const denominators: readonly number[] = args.denominators ?? []; // Denominators for ratio calculation
  const subset_points: readonly number[] = args.subset_points; // Indices of points to include (always provided by caller)
  const n_sub: number = subset_points.length;          // Number of points used for limit calculation

  // Initialize with first value (for moving range calculation we need previous value)
  let prevVal: number = useRatio ? numerators[subset_points[0]] / denominators[subset_points[0]]
                                 : numerators[subset_points[0]];

  // Accumulators for mean and average moving range
  let cl: number = prevVal;                              // Running sum for mean calculation
  let amr: number = 0;                                   // Running sum for average moving range
  let consec_diff: number[] = new Array<number>(n_sub - 1); // Store moving ranges for outlier screening

  // Calculate sum for mean and moving ranges: MR_i = |x_i - x_{i-1}|
  for (let i = 1; i < n_sub; i++) {
    // Get current value (raw or ratio)
    let currVal: number = useRatio ? numerators[subset_points[i]] / denominators[subset_points[i]]
                                   : numerators[subset_points[i]];

    // Calculate moving range (absolute difference from previous value)
    consec_diff[i - 1] = Math.abs(currVal - prevVal);
    amr += consec_diff[i - 1];  // Accumulate for AMR
    cl += currVal;               // Accumulate for mean
    prevVal = currVal;           // Update previous value for next iteration
  }

  // Calculate mean: x̄ = Σx / n
  cl /= n_sub;

  // Calculate initial average moving range: AMR = Σ|x_i - x_{i-1}| / (n-1)
  amr /= (n_sub - 1);

  // Optional outlier screening for moving range calculation
  // If outliers_in_limits is false, screen out extreme moving ranges
  if (!args.outliers_in_limits) {
    // Upper limit for moving range: MR_limit = 3.267 × AMR (D4 constant for n=2)
    const consec_diff_ulim: number = amr * 3.267;

    // Recalculate AMR excluding values above the limit
    let screened_amr: number = 0;
    let screened_count: number = 0;
    for (let i = 0; i < consec_diff.length; i++) {
      if (consec_diff[i] < consec_diff_ulim) {
        screened_amr += consec_diff[i];
        screened_count += 1;
      }
    }
    amr = screened_amr / screened_count; // Recalculated AMR without outliers
  }

  // Calculate sigma from average moving range: σ = AMR / d2
  // d2 = 1.128 is the expected value of the range for sample size n=2
  const sigma = amr / 1.128;

  const n: number = args.keys.length; // Total number of data points

  // Create local limit arrays (avoids strictNullChecks issues with optional fields)
  const values = new Array<number>(n);
  const { targets, ll99, ll95, ll68, ul68, ul95, ul99 } = createLimitArrays(n);

  // Calculate control limits for each point
  // I-chart has constant limits (same sigma for all points)
  for (let i = 0; i < n; i++) {
    // Calculate the plotted value (raw or ratio)
    values[i] = useRatio ? numerators[i] / denominators[i] : numerators[i];

    targets[i] = cl;               // Centreline: x̄
    ll99[i] = cl - 3 * sigma;      // LCL: x̄ - 3σ
    ll95[i] = cl - 2 * sigma;      // 2σ lower limit: x̄ - 2σ
    ll68[i] = cl - 1 * sigma;      // 1σ lower limit: x̄ - σ
    ul68[i] = cl + 1 * sigma;      // 1σ upper limit: x̄ + σ
    ul95[i] = cl + 2 * sigma;      // 2σ upper limit: x̄ + 2σ
    ul99[i] = cl + 3 * sigma;      // UCL: x̄ + 3σ
  }

  return {
    keys: args.keys,
    values,
    numerators: useRatio ? args.numerators : undefined,
    denominators: useRatio ? args.denominators : undefined,
    targets, ll99, ll95, ll68, ul68, ul95, ul99
  };
}
