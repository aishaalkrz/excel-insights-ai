import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import * as d3 from 'd3';
import { ChartConfig } from '../../models/chart-config.model';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-smart-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './smart-chart.component.html',
  styleUrl: './smart-chart.component.scss',
})
export class SmartChartComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) config!: ChartConfig;

  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('legendContainer') legendContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('tooltip') tooltip!: ElementRef<HTMLDivElement>;

  private width = 760;
  private height = 390;
  private margin = { top: 24, right: 30, bottom: 70, left: 60 };

  private hiddenCategories = new Set<string>();
  private colorScale!: d3.ScaleOrdinal<string, string>;

  private colors = [
    '#10B981', '#059669', '#34D399', '#047857', '#6EE7B7',
    '#84CC16', '#65A30D', '#A3E635', '#14B8A6', '#0D9488',
    '#2DD4BF', '#0F766E', '#0EA5E9', '#0284C7', '#38BDF8',
    '#0369A1', '#6366F1', '#4F46E5', '#818CF8', '#8B5CF6',
    '#F59E0B', '#D97706', '#FBBF24', '#EAB308',
  ];

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && this.chartContainer) {
      if (!changes['config'].firstChange) {
        this.hiddenCategories.clear();
      }
      this.renderChart();
    }
  }

  private setupColorScale(fullData: any[], catKey: string) {
    const uniqueCategories = Array.from(new Set(fullData.map(d => String(d[catKey]))));
    const step = Math.max(1, Math.floor(this.colors.length / uniqueCategories.length));
    const distributedColors = uniqueCategories.map((_, i) => this.colors[(i * step) % this.colors.length]);

    this.colorScale = d3.scaleOrdinal<string>()
      .domain(uniqueCategories)
      .range(distributedColors);
  }

  private renderChart(): void {
    if (!this.config?.data?.length) return;

    d3.select(this.chartContainer.nativeElement).selectAll('*').remove();
    if (this.legendContainer) {
      d3.select(this.legendContainer.nativeElement).selectAll('*').remove();
    }

    const fullData = this.config.data;
    
    const catKey = String(this.config.type === 'pie' ? (this.config.categoryKey || this.config.xKey) : this.config.xKey);
    const valKey = String(this.config.type === 'pie' ? (this.config.valueKey || this.config.yKey) : this.config.yKey);

    if (!catKey || !valKey) return;

    this.setupColorScale(fullData, catKey);
    this.renderInteractiveLegend(fullData, catKey);

    let chartData = fullData.filter(d => !this.hiddenCategories.has(String(d[catKey])));

    if (['bar', 'line', 'pie','dot'].includes(this.config.type)) {
      chartData = this.aggregateByCategory(chartData, catKey, valKey);
    }

    if (!chartData.length) return;

    switch (this.config.type) {
      case 'bar':
        this.renderBarChart(chartData, catKey, valKey);
        break;
      case 'line':
        this.renderLineChart(chartData, catKey, valKey);
        break;
      case 'pie':
        this.renderPieChart(chartData, catKey, valKey);
        break;
      case 'dot':
        this.renderDotChart(chartData, catKey, valKey);
        break;
    }
  }

  private renderInteractiveLegend(fullData: any[], catKey: string): void {
    if (!this.legendContainer || !this.config.showLegend) return;

    const uniqueCategories = Array.from(new Set(fullData.map(d => String(d[catKey]))));
    const legend = d3.select(this.legendContainer.nativeElement);

    const items = legend.selectAll('.legend-item')
      .data(uniqueCategories)
      .enter()
      .append('div')
      .attr('class', d => `legend-item ${this.hiddenCategories.has(d) ? 'hidden-item' : ''}`)
      .on('click', (event, d) => {
         if (this.hiddenCategories.has(d)) {
            this.hiddenCategories.delete(d);
         } else {
            this.hiddenCategories.add(d);
         }
         this.renderChart();
      });

      items.append('span')
      .style('--item-color', d => this.colorScale(d));

      items.append('small')
      .text(d => d);
  }

  private createSvg() {
    return d3
      .select(this.chartContainer.nativeElement)
      .append('svg')
      .attr('viewBox', `0 0 ${this.width} 450`)
      .attr('preserveAspectRatio', 'xMidYMid meet');
  }

  private getInnerSize() {
    return {
      innerWidth: this.width - this.margin.left - this.margin.right,
      innerHeight: this.height - this.margin.top - this.margin.bottom,
    };
  }

  private getValue(d: Record<string, unknown>, key: string): number {
    const value = Number(d[key]);
    return Number.isFinite(value) ? value : 0;
  }

  private formatTooltip(label: unknown, value: unknown, color: string): string {
    const formattedValue = typeof value === 'number' 
      ? value.toLocaleString('en-US') 
      : value;
      
    return `<strong style="color: ${color};"> <span> :</span> ${label}</strong> <span>${formattedValue}</span>`;
  }

  private renderBarChart(data: any[], catKey: string, valKey: string): void {
    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();

    const chart = svg.append('g').attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    const x = d3.scaleBand().domain(data.map((d) => String(d[catKey]))).range([0, innerWidth]).padding(0.32);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => this.getValue(d, valKey)) || 0]).nice().range([innerHeight, 0]);

    this.drawGrid(chart, x as any, y, innerWidth, innerHeight);
    this.drawAxes(chart, x as any, y, innerHeight);
    this.drawAxisLabels(svg);

    chart.selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(String(d[catKey])) ?? 0)
      .attr('y', innerHeight)
      .attr('width', x.bandwidth())
      .attr('height', 0)
      .attr('rx', 8)
      .attr('fill', (d) => this.colorScale(String(d[catKey])))
      .on('mousemove', (event, d) =>
        this.showTooltip(event, this.formatTooltip(d[catKey], d[valKey], this.colorScale(String(d[catKey]))))
      )
      .on('mouseleave', () => this.hideTooltip())
      .transition().duration(700)
      .attr('y', (d) => y(this.getValue(d, valKey)))
      .attr('height', (d) => innerHeight - y(this.getValue(d, valKey)));
  }

  private renderLineChart(data: any[], catKey: string, valKey: string): void {
    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();

    const chart = svg.append('g').attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    const x = d3.scalePoint().domain(data.map((d: any) => String(d[catKey]))).range([0, innerWidth]).padding(0.5);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => this.getValue(d, valKey)) || 0]).nice().range([innerHeight, 0]);

    this.drawGrid(chart, x as any, y, innerWidth, innerHeight);
    this.drawAxes(chart, x as any, y, innerHeight);
    this.drawAxisLabels(svg);

    const line = d3.line<Record<string, unknown>>()
      .x((d) => x(String(d[catKey])) ?? 0)
      .y((d) => y(this.getValue(d, valKey)))
      .curve(d3.curveLinear);

    const path = chart.append('path')
      .datum(data)
      .attr('class', 'line-path')
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', '#3E7B6B')
      .attr('stroke-width', 4)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    const totalLength = (path.node() as SVGPathElement).getTotalLength();

    path.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
      .attr('stroke-dashoffset', totalLength)
      .transition().duration(850).attr('stroke-dashoffset', 0);
      
    chart.selectAll('.line-dot')
      .data(data)
      .enter().append('circle')
      .attr('cx', d => x(String(d[catKey])) ?? 0)
      .attr('cy', d => y(this.getValue(d, valKey)))
      .attr('r', 5)
      .attr('fill', d => this.colorScale(String(d[catKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('mousemove', (event, d) => 
        this.showTooltip(event, this.formatTooltip(d[catKey], d[valKey], this.colorScale(String(d[catKey]))))
      )
      .on('mouseleave', () => this.hideTooltip());
  }

  private renderDotChart(data: any[], catKey: string, valKey: string): void {
    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();

    const chart = svg.append('g').attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    const x = d3.scalePoint().domain(data.map((d: any) => String(d[catKey]))).range([0, innerWidth]).padding(0.5);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => this.getValue(d, valKey)) || 0]).nice().range([innerHeight, 0]);

    this.drawGrid(chart, x as any, y, innerWidth, innerHeight);
    this.drawAxes(chart, x as any, y, innerHeight);
    this.drawAxisLabels(svg);

    chart.selectAll('.scatter-dot')
      .data(data)
      .enter().append('circle')
      .attr('class', 'scatter-dot')
      .attr('cx', (d) => x(String(d[catKey])) ?? 0)
      .attr('cy', (d) => y(this.getValue(d, valKey)))
      .attr('r', 0)
      .attr('fill', (d) => this.colorScale(String(d[catKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('mousemove', (event, d) =>
        this.showTooltip(event, this.formatTooltip(d[catKey], d[valKey], this.colorScale(String(d[catKey]))))
      )
      .on('mouseleave', () => this.hideTooltip())
      .transition().delay((_, i) => i * 40).duration(400)
      .attr('r', 7);
  }

  private renderPieChart(data: any[], catKey: string, valKey: string): void {
    const svg = this.createSvg();
    const radius = Math.min(this.width, this.height) / 2 - 40;

    const chart = svg.append('g').attr('transform', `translate(${this.width / 2},${this.height / 2})`);
    const pie = d3.pie<Record<string, unknown>>().sort(null).value((d) => this.getValue(d, valKey));
    const arc = d3.arc<d3.PieArcDatum<Record<string, unknown>>>().innerRadius(0).outerRadius(radius);

    chart.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('fill', (d) => this.colorScale(String(d.data[catKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 3)
      .on('mousemove', (event, d) =>
        this.showTooltip(event, this.formatTooltip(d.data[catKey], d.data[valKey], this.colorScale(String(d.data[catKey]))))
      )
      .on('mouseleave', () => this.hideTooltip())
      .transition().duration(650)
      .attrTween('d', (d) => {
        const interpolate = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
        return (t) => arc(interpolate(t)) || '';
      });
  }

  private drawGrid(chart: any, x: any, y: any, innerWidth: number, innerHeight: number): void {
    chart.append('g').attr('class', 'grid grid-y').call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(() => ''));
    chart.append('g').attr('class', 'grid grid-x').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).tickSize(-innerHeight).tickFormat(() => ''));
  }

  private drawAxes(chart: any, x: any, y: any, innerHeight: number): void {
    chart.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).tickSizeOuter(0)).selectAll('text')
    .attr('transform', 'translate(-30, 20) rotate(-29)').attr('text-anchor', 'end').attr('dx', '-0.45em').attr('dy', '0.75em').attr('font-size','8px');
    chart
      .append('g')
      .attr('class', 'axis axis-y')
      .call(
        d3.axisLeft(y)
          .ticks(6)
          .tickSizeOuter(0)
          .tickFormat((d: any) => {
            if (d >= 1000) return (d / 1000) + 'k';
            return d;
          })
      )
  }

  private aggregateByCategory(data: any[], catKey: string, valKey: string): any[] {
    const map = new Map<string, number>();

    for (const row of data) {
      const key = String(row[catKey]);
      const value = this.getValue(row, valKey);
      map.set(key, (map.get(key) ?? 0) + value);
    }

    return Array.from(map.entries()).map(([key, value]) => ({
      [catKey]: key,
      [valKey]: value,
    }));
  }
  private drawAxisLabels(svg: any): void {
    if (this.config.xAxisLabel) svg.append('text').attr('class', 'axis-label x-label').attr('x', this.width / 2).attr('y', this.height + 32).attr('text-anchor', 'middle').text(this.config.xAxisLabel);
    if (this.config.yAxisLabel) svg.append('text').attr('class', 'axis-label y-label').attr('x', -this.height / 2).attr('y', 18).attr('text-anchor', 'middle').attr('transform', 'rotate(-90)').text(this.config.yAxisLabel);
  }

  private showTooltip(event: MouseEvent, html: string): void {
    if (!this.config.showTooltip) return;

    const tooltip = this.tooltip.nativeElement;

    tooltip.innerHTML = html;
    tooltip.style.opacity = '1';
    
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '99999';
    tooltip.style.left = `${event.clientX + 16}px`;
    tooltip.style.top = `${event.clientY + 16}px`;
  }

  private hideTooltip(): void {
    this.tooltip.nativeElement.style.opacity = '0';
  }
}