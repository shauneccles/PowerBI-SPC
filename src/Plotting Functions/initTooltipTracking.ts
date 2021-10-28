import powerbi from "powerbi-visuals-api";
import ITooltipService = powerbi.extensibility.ITooltipService;
import * as d3 from "d3";
import { ViewModel } from "../Interfaces"

function initTooltipTracking(svg: d3.Selection<SVGElement, any, any, any>,
                             listeningRect: d3.Selection<SVGElement, any, any, any>,
                             width: number, height: number,
                             xScale: d3.ScaleLinear<number, number, never>,
                             yScale: d3.ScaleLinear<number, number, never>,
                             tooltipService: ITooltipService,
                             viewModel: ViewModel): void {
    const xAxisLine = svg.append("g")
                            .append("rect")
                            .attr("class", "dotted")
                            .attr("stroke-width", "1px")
                            .attr("width", ".5px")
                            .attr("height", height)
                            .style("fill-opacity", 0);

    listeningRect
            .append("rect")
            .style("fill","transparent")
            .attr("width", width)
            .attr("height", height)
            .on("mousemove", d => {
                let xval: number = xScale.invert((<any>d3).event.pageX);
                
                let x_dist: number[] = viewModel.plotData.map(d => d.x).map(d => {
                    return Math.abs(d - xval)
                })
                let minInd: number = d3.scan(x_dist,(a,b) => a-b);
    
                let scaled_x: number = xScale(viewModel.plotData[minInd].x)
                let scaled_y: number = yScale(viewModel.plotData[minInd].ratio)
    
                tooltipService.show({
                    dataItems: viewModel.plotData[minInd].tooltips,
                    identities: [viewModel.plotData[minInd].identity],
                    coordinates: [scaled_x, scaled_y],
                    isTouchEvent: false
                });
                xAxisLine.style("fill-opacity", 1)
                         .attr("transform", "translate(" + scaled_x + ",0)");
            })
            .on("mouseleave", d => {
                tooltipService.hide({
                    immediately: true,
                    isTouchEvent: false
                });
                xAxisLine.style("fill-opacity", 0);
            });
}

export default initTooltipTracking