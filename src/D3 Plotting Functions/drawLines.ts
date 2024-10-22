import * as d3 from "./D3 Modules";
import type { lineData } from "../Classes";
import { between, getAesthetic, isNullOrUndefined } from "../Functions";
import type { svgBaseType, Visual } from "../visual";

export default function drawLines(selection: svgBaseType, visualObj: Visual) {
  selection
      .select(".linesgroup")
      .selectAll("path")
      .data(visualObj.viewModel.groupedLines)
      .join("path")
      .attr("d", d => {
        const ylower: number = visualObj.viewModel.plotProperties.yAxis.lower;
        const yupper: number = visualObj.viewModel.plotProperties.yAxis.upper;
        const xlower: number = visualObj.viewModel.plotProperties.xAxis.lower;
        const xupper: number = visualObj.viewModel.plotProperties.xAxis.upper;
        return d3.line<lineData>()
                  .x(d => visualObj.viewModel.plotProperties.xScale(d.x))
                  .y(d => visualObj.viewModel.plotProperties.yScale(d.line_value))
                  .defined(d => {
                    return !isNullOrUndefined(d.line_value)
                      && between(d.line_value, ylower, yupper)
                      && between(d.x, xlower, xupper)
                  })(d[1])
      })
      .attr("fill", "none")
      .attr("stroke", d => {
        return visualObj.viewModel.colourPalette.isHighContrast
                ? visualObj.viewModel.colourPalette.foregroundColour
                : getAesthetic(d[0], "lines", "colour", visualObj.viewModel.inputSettings.settings)
      })
      .attr("stroke-width", d => getAesthetic(d[0], "lines", "width", visualObj.viewModel.inputSettings.settings))
      .attr("stroke-dasharray", d => getAesthetic(d[0], "lines", "type", visualObj.viewModel.inputSettings.settings));

  // Add data labels for mean and process limits
  const dataLabels = visualObj.viewModel.plotProperties.dataLabels;
  selection
      .select(".linesgroup")
      .selectAll("text.mean-label")
      .data(dataLabels.mean)
      .join("text")
      .attr("class", "mean-label")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("dx", 5)
      .text(d => d.value.toFixed(2));

  selection
      .select(".linesgroup")
      .selectAll("text.process-limit-label")
      .data(dataLabels.processLimits)
      .join("text")
      .attr("class", "process-limit-label")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("dx", 5)
      .text(d => d.value.toFixed(2));
}
