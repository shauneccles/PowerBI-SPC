import * as d3 from "d3";
import viewModelClass from "../Classes/viewModelClass";
import { axisProperties } from "../Classes/plotPropertiesClass";
import {abs} from "../Functions/UnaryFunctions";

type SelectionBase = d3.Selection<SVGGElement, unknown, null, undefined>;

export default function drawXAxis(selection: SelectionBase, viewModel: viewModelClass) {
  selection.selectAll(".xaxisgroup").remove()
  selection.selectAll(".xaxislabel").remove()
  if (!(viewModel.plotProperties.displayPlot)) {
    return;
  }

  const xAxisProperties: axisProperties = viewModel.plotProperties.xAxis;
  let xAxis: d3.Axis<d3.NumberValue>;

  if (xAxisProperties.ticks) {
    xAxis = d3.axisBottom(viewModel.plotProperties.xScale);
    if (xAxisProperties.tick_count) {
      xAxis.ticks(xAxisProperties.tick_count)
    }
    if (viewModel.tickLabels) {
      xAxis.tickFormat(d => {
        return viewModel.tickLabels.map(d => d.x).includes(<number>d)
          ? viewModel.tickLabels[<number>d].label
          : "";
      })
    }
  } else {
    xAxis = d3.axisBottom(viewModel.plotProperties.xScale).tickValues([]);
  }

  const axisHeight: number = viewModel.plotProperties.height - viewModel.plotProperties.yAxis.start_padding;

  selection.append('g')
      .classed("xaxisgroup", true)
      .call(xAxis)
      .attr("color", xAxisProperties.colour)
      // Plots the axis at the correct height
      .attr("transform", "translate(0, " + axisHeight + ")")
      .selectAll(".tick text")
      // Right-align
      .style("text-anchor", xAxisProperties.tick_rotation < 0.0 ? "end" : "start")
      // Rotate tick labels
      .attr("dx", xAxisProperties.tick_rotation < 0.0 ? "-.8em" : ".8em")
      .attr("dy", xAxisProperties.tick_rotation < 0.0 ? "-.15em" : ".15em")
      .attr("transform","rotate(" + xAxisProperties.tick_rotation + ")")
      // Scale font
      .style("font-size", xAxisProperties.tick_size)
      .style("font-family", xAxisProperties.tick_font)
      .style("fill", xAxisProperties.tick_colour);

  let axisNode: SVGGElement = selection.selectAll(".xaxisgroup").selectAll(".tick text").node() as SVGGElement;
  let xAxisCoordinates: DOMRect = axisNode.getBoundingClientRect() as DOMRect;

  // Update padding and re-draw axis if large tick values rendered outside of plot
  const tickBelowPadding: number = xAxisCoordinates.bottom - (viewModel.plotProperties.height - viewModel.plotProperties.yAxis.start_padding);
  const tickLeftofPadding: number = xAxisCoordinates.left - xAxisProperties.start_padding;

  if ((tickBelowPadding > 0 || tickLeftofPadding < 0)) {
    if (!viewModel.plotProperties.refreshingAxis) {
      console.log("refresh")
      viewModel.plotProperties.refreshingAxis = true
      if (tickBelowPadding > 0) {
        viewModel.plotProperties.yAxis.start_padding += abs(tickBelowPadding);
      }
      if (tickLeftofPadding < 0) {
        viewModel.plotProperties.xAxis.start_padding += abs(tickLeftofPadding)
      }
      viewModel.plotProperties.initialiseScale();
      selection.call(drawXAxis, viewModel);
      return;
    }
  }
  viewModel.plotProperties.refreshingAxis = false

  const bottomMidpoint: number = viewModel.plotProperties.height - ((viewModel.plotProperties.height - xAxisCoordinates.bottom) / 2);

  selection.append("text")
            .classed("xaxislabel", true)
            .attr("x",viewModel.plotProperties.width / 2)
            .attr("y", bottomMidpoint)
            .style("text-anchor", "middle")
            .text(xAxisProperties.label)
            .style("font-size", xAxisProperties.label_size)
            .style("font-family", xAxisProperties.label_font)
            .style("fill", xAxisProperties.label_colour);
}
