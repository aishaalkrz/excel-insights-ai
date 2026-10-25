import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import * as d3 from 'd3';
import { ChartConfig } from '../../models/chart-config.model';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { aggregateCategories, CATEGORY_LIMIT, evenlySample, numericAxis, numericValue, prepareChartPreview } from './chart-preview';

export interface ChartLayout {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
  rotateX: boolean;
}

interface LegendItem {
  label: string;
  color: string;
}

interface TooltipRow {
  label: unknown;
  value: unknown;
  color: string;
}

export interface PreviewSummary {
  records: number;
  rendered: number;
  unit: string;
  mode: 'full' | 'sampled' | 'reduced';
  partialSource: boolean;
  hidden: number;
}

// Keep these in step with the `.axis` and `.axis-label` font sizes in the SCSS:
// label space is reserved from estimated text widths so nothing is clipped,
// including in SSR/tests where text cannot be measured.
const DEFAULT_WIDTH = 760;
const MIN_WIDTH = 280;
const TICK_FONT = 11;
const TITLE_FONT = 13;
const CHAR_RATIO = 0.62;
const TICK_OFFSET = 10;
const AXIS_TITLE_BAND = 28;
const X_LABEL_ANGLE = 40;
const LEGEND_COLLAPSED_LIMIT = 12;
const LONG_NOTICE_LENGTH = 110;
const RTL_TEXT = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

@Component({
  selector: 'app-smart-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './smart-chart.component.html',
  styleUrl: './smart-chart.component.scss',
})
export class SmartChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) config!: ChartConfig;

  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('tooltip') tooltip!: ElementRef<HTMLDivElement>;

  readonly legendCollapsedLimit = LEGEND_COLLAPSED_LIMIT;
  readonly longNoticeLength = LONG_NOTICE_LENGTH;
  legendExpanded = false;
  noticeExpanded = false;

  private layout!: ChartLayout;
  private renderedWidth = 0;
  private animate = true;
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private resizeObserver?: ResizeObserver;
  private resizeFrame = 0;

  private hiddenCategories = new Set<string>();
  private colorScale!: d3.ScaleOrdinal<string, string>;
  private previewConfig?: ChartConfig;
  private preview?: ReturnType<typeof prepareChartPreview>;
  private legendPreview?: ReturnType<typeof prepareChartPreview>;
  private legend: LegendItem[] = [];

  // The title is presentation only: a title edit must not re-aggregate the
  // data, replay animations, or reset legend toggles.
  private getPreview() {
    if (!this.preview || !sameChartData(this.previewConfig, this.config)) {
      this.previewConfig = this.config;
      this.preview = prepareChartPreview(this.config ?? { type: 'bar', title: '', data: [] });
    }
    return this.preview;
  }

  get previewNotice(): string {
    const preview = this.getPreview();
    return preview.notice + (this.hiddenCategories.size ? ` المعروض حالياً بعد إخفاء الفئات: ${this.visibleCount()}.` : '');
  }

  get previewSummary(): PreviewSummary {
    const preview = this.getPreview();
    const type = this.config?.type;
    const pointBased = type === 'scatter' || type === 'line';
    const mode = type === 'scatter' && preview.data.length < preview.validCount ? 'sampled'
      : type === 'line' && preview.data.length < preview.domainData.length ? 'reduced'
      : 'full';
    return {
      records: preview.validCount,
      rendered: this.visibleCount(),
      unit: pointBased ? 'نقطة' : 'فئة',
      mode,
      partialSource: !!this.config?.isSampled,
      hidden: this.hiddenCategories.size,
    };
  }

  get legendItems(): LegendItem[] {
    return this.getLegend();
  }

  isCategoryHidden(label: string): boolean {
    return this.hiddenCategories.has(label);
  }

  toggleCategory(label: string): void {
    if (this.hiddenCategories.has(label)) {
      this.hiddenCategories.delete(label);
    } else {
      this.hiddenCategories.add(label);
    }
    this.renderChart();
  }

  private colors = [
    '#10B981', '#059669', '#34D399', '#047857', '#6EE7B7',
    '#84CC16', '#65A30D', '#A3E635', '#14B8A6', '#0D9488',
    '#2DD4BF', '#0F766E', '#0EA5E9', '#0284C7', '#38BDF8',
    '#0369A1', '#6366F1', '#4F46E5', '#818CF8', '#8B5CF6',
    '#F59E0B', '#D97706', '#FBBF24', '#EAB308',
  ];

  ngAfterViewInit(): void {
    this.renderChart();

    if (this.isBrowser && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(this.chartContainer.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['config'];
    if (!change || !this.chartContainer) return;
    if (!change.firstChange && sameChartData(change.previousValue, change.currentValue)) return;

    if (!change.firstChange) {
      this.hiddenCategories.clear();
      this.legendExpanded = false;
      this.noticeExpanded = false;
    }
    this.renderChart();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
  }

  // Re-render at the container's real width so text stays at its CSS size
  // instead of being scaled down with the whole SVG on narrow screens.
  private scheduleResize(): void {
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (Math.abs(this.measureWidth() - this.renderedWidth) >= 1) this.renderChart(false);
    });
  }

  private measureWidth(): number {
    const width = Math.floor(this.chartContainer?.nativeElement.clientWidth ?? 0);
    return width > 0 ? Math.max(MIN_WIDTH, width) : DEFAULT_WIDTH;
  }

  private categoriesOf(data: Record<string, unknown>[]): string[] {
    const key = this.categoryKey();
    return Array.from(new Set(data.map(d => String(d[key]))));
  }

  private categoryKey(): string {
    return String(this.config?.type === 'pie' ? (this.config.categoryKey || this.config.xKey) : this.config?.xKey);
  }

  private visibleCount(): number {
    const key = this.categoryKey();
    return this.getPreview().data.filter(row => !this.hiddenCategories.has(String(row[key]))).length;
  }

  private getLegend(): LegendItem[] {
    const preview = this.getPreview();
    if (this.legendPreview !== preview) {
      this.legendPreview = preview;
      const categories = this.categoriesOf(preview.data);
      this.setupColorScale(categories);
      this.legend = this.config?.showLegend && categories.length <= CATEGORY_LIMIT
        ? categories.map(label => ({ label, color: this.colorScale(label) }))
        : [];
    }
    return this.legend;
  }

  private setupColorScale(uniqueCategories: string[]) {
    const step = Math.max(1, Math.floor(this.colors.length / uniqueCategories.length));
    const distributedColors = uniqueCategories.map((_, i) => this.colors[(i * step) % this.colors.length]);

    this.colorScale = d3.scaleOrdinal<string>()
      .domain(uniqueCategories)
      .range(distributedColors);
  }

  private renderChart(animate = true): void {
    this.animate = animate;
    d3.select(this.chartContainer.nativeElement).selectAll('*').remove();

    this.hideTooltip();
    this.renderedWidth = this.measureWidth();
    const fullData = this.getPlottableData();
    if (!fullData.length) return;

    const catKey = this.categoryKey();
    const valKey = String(this.config.type === 'pie' ? (this.config.valueKey || this.config.yKey) : this.config.yKey);

    if (!catKey || !valKey) return;

    this.getLegend();

    let chartData = fullData.filter(d => !this.hiddenCategories.has(String(d[catKey])));

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
      case 'scatter':
        this.renderScatterChart(chartData, catKey, valKey);
        break;
    }
  }

  get hasPlottableData(): boolean {
    return this.visibleCount() > 0;
  }

  private getPlottableData(): Record<string, unknown>[] {
    return this.getPreview().data;
  }

  private frame() {
    const width = this.renderedWidth || this.measureWidth();
    const innerHeight = width < 480 ? 220 : width < 720 ? 260 : 296;
    return { width, innerHeight };
  }

  private maxTickChars(width: number): number {
    return width < 480 ? 12 : 18;
  }

  // Reserves margins for tick labels, axis titles, and the overhang of the
  // first/last category label so the viewBox contains every piece of text.
  private computeLayout(
    yLabels: string[],
    x: { labels: string[]; count: number; edge: boolean } | null,
  ): ChartLayout {
    const { width, innerHeight } = this.frame();
    const margin = { top: 24, right: 30, bottom: 0, left: 60 };
    const yTitleBand = this.config.yAxisLabel ? AXIS_TITLE_BAND : 8;
    margin.left = Math.max(margin.left, Math.ceil(yTitleBand + textWidth(yLabels, TICK_FONT) + TICK_OFFSET + 4));

    let rotateX = false;
    let tickBand = TICK_FONT + TICK_OFFSET + 8;
    if (x && x.labels.length) {
      const widest = textWidth(x.labels, TICK_FONT);
      const step = (width - margin.left - margin.right) / Math.max(1, x.count);
      rotateX = !x.edge && widest + 8 > step;

      if (rotateX) {
        const angle = (X_LABEL_ANGLE * Math.PI) / 180;
        tickBand = Math.ceil(widest * Math.sin(angle) + TICK_FONT * Math.cos(angle) + TICK_OFFSET + 6);
        margin.left = Math.max(margin.left, Math.ceil(widest * Math.cos(angle) - step / 2 + 8));
      } else {
        const overhang = Math.ceil(widest / 2 - (x.edge ? 0 : step / 2) + 4);
        margin.left = Math.max(margin.left, overhang);
        margin.right = Math.max(margin.right, overhang);
      }
    }

    margin.bottom = tickBand + (this.config.xAxisLabel ? AXIS_TITLE_BAND : 8);
    const innerWidth = Math.max(40, width - margin.left - margin.right);
    return {
      width,
      height: margin.top + innerHeight + margin.bottom,
      margin,
      innerWidth,
      innerHeight,
      rotateX,
    };
  }

  private createSvg() {
    const { width, height } = this.layout;
    return d3
      .select(this.chartContainer.nativeElement)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('direction', 'ltr')
      .attr('role', 'img')
      .attr('aria-label', this.config.title || `${this.config.yAxisLabel ?? ''} ${this.config.xAxisLabel ?? ''}`.trim());
  }

  private getInnerSize() {
    return { innerWidth: this.layout.innerWidth, innerHeight: this.layout.innerHeight };
  }

  private plotGroup(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
    return svg.append('g').attr('transform', `translate(${this.layout.margin.left},${this.layout.margin.top})`);
  }

  private getValue(d: Record<string, unknown>, key: string): number | null {
    return numericValue(d, key);
  }

  private categoryLayout(data: Record<string, unknown>[], catKey: string, yAxis: ReturnType<typeof numericAxis>) {
    const domain = data.map(d => String(d[catKey]));
    const maxChars = this.maxTickChars(this.frame().width);
    const labels = (domain.length > CATEGORY_LIMIT ? evenlySample(domain, 12) : domain).map(label => truncate(label, maxChars));
    this.layout = this.computeLayout(yAxis.ticks.map(tick => String(yAxis.format(tick))), {
      labels, count: domain.length, edge: false,
    });
    return domain;
  }

  private renderBarChart(data: any[], catKey: string, valKey: string): void {
    const yProbe = numericAxis(this.getPreview().domainData, valKey, [this.frame().innerHeight, 0], true);
    const domain = this.categoryLayout(data, catKey, yProbe);
    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();

    const chart = this.plotGroup(svg);
    const x = d3.scaleBand().domain(domain).range([0, innerWidth]).padding(0.32);
    const yAxis = numericAxis(this.getPreview().domainData, valKey, [innerHeight, 0], true);
    const y = yAxis.project;

    this.drawGrid(chart, x as any, yAxis.scale, innerWidth, innerHeight, yAxis.ticks);
    this.drawAxes(chart, x as any, yAxis.scale, innerHeight, yAxis);
    this.drawAxisLabels(svg);

    const radius = Math.min(8, x.bandwidth() / 3);
    const bars = chart.selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(String(d[catKey])) ?? 0)
      .attr('width', x.bandwidth())
      .attr('rx', radius)
      .attr('fill', (d) => this.colorScale(String(d[catKey])))
      .on('mousemove', (event, d) =>
        this.showTooltip(event, [{ label: d[catKey], value: d[valKey], color: this.colorScale(String(d[catKey])) }])
      )
      .on('mouseleave', () => this.hideTooltip());

    const finalY = (d: any) => y(Math.max(0, this.getValue(d, valKey)!));
    const finalHeight = (d: any) => Math.abs(y(0) - y(this.getValue(d, valKey)!));
    if (this.animate) {
      bars.attr('y', y(0)).attr('height', 0)
        .transition().duration(700)
        .attr('y', finalY)
        .attr('height', finalHeight);
    } else {
      bars.attr('y', finalY).attr('height', finalHeight);
    }
  }

  private renderLineChart(data: any[], catKey: string, valKey: string): void {
    const yProbe = numericAxis(this.getPreview().domainData, valKey, [this.frame().innerHeight, 0], true);
    const domain = this.categoryLayout(data, catKey, yProbe);
    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();

    const chart = this.plotGroup(svg);
    const x = d3.scalePoint().domain(domain).range([0, innerWidth]).padding(0.5);
    const yAxis = numericAxis(this.getPreview().domainData, valKey, [innerHeight, 0], true);
    const y = yAxis.project;

    this.drawGrid(chart, x as any, yAxis.scale, innerWidth, innerHeight, yAxis.ticks);
    this.drawAxes(chart, x as any, yAxis.scale, innerHeight, yAxis);
    this.drawAxisLabels(svg);

    const line = d3.line<Record<string, unknown>>()
      .x((d) => x(String(d[catKey])) ?? 0)
      .y((d) => y(this.getValue(d, valKey)!))
      .curve(d3.curveLinear);

    const path = chart.append('path')
      .datum(data)
      .attr('class', 'line-path')
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke-width', 4)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    if (this.animate) {
      const totalLength = (path.node() as SVGPathElement).getTotalLength();

      path.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
        .attr('stroke-dashoffset', totalLength)
        .transition().duration(850).attr('stroke-dashoffset', 0);
    }

    chart.selectAll('.line-dot')
      .data(data)
      .enter().append('circle')
      .attr('cx', d => x(String(d[catKey])) ?? 0)
      .attr('cy', d => y(this.getValue(d, valKey)!))
      .attr('r', 5)
      .attr('fill', d => this.colorScale(String(d[catKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('mousemove', (event, d) =>
        this.showTooltip(event, [{ label: d[catKey], value: d[valKey], color: this.colorScale(String(d[catKey])) }])
      )
      .on('mouseleave', () => this.hideTooltip());
  }

  private renderDotChart(data: any[], catKey: string, valKey: string): void {
    const yProbe = numericAxis(this.getPreview().domainData, valKey, [this.frame().innerHeight, 0], true);
    const domain = this.categoryLayout(data, catKey, yProbe);
    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();

    const chart = this.plotGroup(svg);
    const x = d3.scalePoint().domain(domain).range([0, innerWidth]).padding(0.5);
    const yAxis = numericAxis(this.getPreview().domainData, valKey, [innerHeight, 0], true);
    const y = yAxis.project;

    this.drawGrid(chart, x as any, yAxis.scale, innerWidth, innerHeight, yAxis.ticks);
    this.drawAxes(chart, x as any, yAxis.scale, innerHeight, yAxis);
    this.drawAxisLabels(svg);

    const dots = chart.selectAll('.scatter-dot')
      .data(data)
      .enter().append('circle')
      .attr('class', 'scatter-dot')
      .attr('cx', (d) => x(String(d[catKey])) ?? 0)
      .attr('cy', (d) => y(this.getValue(d, valKey)!))
      .attr('fill', (d) => this.colorScale(String(d[catKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('mousemove', (event, d) =>
        this.showTooltip(event, [{ label: d[catKey], value: d[valKey], color: this.colorScale(String(d[catKey])) }])
      )
      .on('mouseleave', () => this.hideTooltip());

    if (this.animate) {
      dots.attr('r', 0).transition().delay((_, i) => i * 40).duration(400).attr('r', 7);
    } else {
      dots.attr('r', 7);
    }
  }

  private renderScatterChart(data: Record<string, unknown>[], xKey: string, yKey: string): void {
    const domainData = this.getPreview().domainData;
    const { innerHeight: plotHeight } = this.frame();
    const xProbe = numericAxis(domainData, xKey, [0, 1]);
    const yProbe = numericAxis(domainData, yKey, [plotHeight, 0]);
    const xLabels = xProbe.ticks.map(tick => String(xProbe.format(tick)));
    this.layout = this.computeLayout(yProbe.ticks.map(tick => String(yProbe.format(tick))), {
      labels: xLabels, count: Math.max(1, xLabels.length - 1), edge: true,
    });

    const svg = this.createSvg();
    const { innerWidth, innerHeight } = this.getInnerSize();
    const chart = this.plotGroup(svg);
    const x = numericAxis(domainData, xKey, [0, innerWidth]);
    const y = numericAxis(domainData, yKey, [innerHeight, 0]);

    this.drawGrid(chart, x.scale, y.scale, innerWidth, innerHeight, y.ticks);
    chart.append('g').attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x.scale).tickValues(x.ticks).tickSizeOuter(0).tickFormat(x.format));
    chart.append('g').attr('class', 'axis axis-y')
      .call(d3.axisLeft(y.scale).tickValues(y.ticks).tickSizeOuter(0).tickFormat(y.format));
    this.drawAxisLabels(svg);

    chart.selectAll('.scatter-point')
      .data(data)
      .enter().append('circle')
      .attr('class', 'scatter-dot scatter-point')
      .attr('cx', row => x.scale(this.getValue(row, xKey)! / x.factor))
      .attr('cy', row => y.scale(this.getValue(row, yKey)! / y.factor))
      .attr('r', 6)
      .attr('fill', row => this.colorScale(String(row[xKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('mousemove', (event, row) => {
        const color = this.colorScale(String(row[xKey]));
        this.showTooltip(event, [
          { label: xKey, value: this.getValue(row, xKey), color },
          { label: yKey, value: this.getValue(row, yKey), color },
        ]);
      })
      .on('mouseleave', () => this.hideTooltip());
  }

  private renderPieChart(data: any[], catKey: string, valKey: string): void {
    const { width, innerHeight } = this.frame();
    const margin = { top: 16, right: 16, bottom: 16, left: 16 };
    this.layout = {
      width, height: innerHeight + margin.top + margin.bottom, margin,
      innerWidth: width - margin.left - margin.right, innerHeight, rotateX: false,
    };
    const svg = this.createSvg();
    const radius = Math.min(this.layout.innerWidth, innerHeight) / 2 - 8;

    const chart = svg.append('g').attr('transform', `translate(${width / 2},${margin.top + innerHeight / 2})`);
    const magnitude = d3.max(data, row => Math.abs(this.getValue(row, valKey)!)) || 1;
    const pie = d3.pie<Record<string, unknown>>().sort(null).value((d) => this.getValue(d, valKey)! / magnitude);
    const arc = d3.arc<d3.PieArcDatum<Record<string, unknown>>>().innerRadius(0).outerRadius(radius);

    const slices = chart.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('fill', (d) => this.colorScale(String(d.data[catKey])))
      .attr('stroke', '#fff')
      .attr('stroke-width', 3)
      .on('mousemove', (event, d) =>
        this.showTooltip(event, [{ label: d.data[catKey], value: d.data[valKey], color: this.colorScale(String(d.data[catKey])) }])
      )
      .on('mouseleave', () => this.hideTooltip());

    if (this.animate) {
      slices.transition().duration(650)
        .attrTween('d', (d) => {
          const interpolate = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
          return (t) => arc(interpolate(t)) || '';
        });
    } else {
      slices.attr('d', d => arc(d) || '');
    }
  }

  private drawGrid(chart: any, x: any, y: any, innerWidth: number, innerHeight: number, yTicks?: number[]): void {
    const yGrid = d3.axisLeft(y).tickSize(-innerWidth).tickFormat(() => '');
    if (yTicks) yGrid.tickValues(yTicks); else yGrid.ticks(5);
    chart.append('g').attr('class', 'grid grid-y').call(yGrid);
    const xGrid = d3.axisBottom(x).tickSize(-innerHeight).tickFormat(() => '');
    if (typeof x.bandwidth === 'function' || typeof x.step === 'function') xGrid.tickValues(this.categoryTicks(x.domain()));
    chart.append('g').attr('class', 'grid grid-x').attr('transform', `translate(0,${innerHeight})`).call(xGrid);
  }

  // Category labels are sampled when there are too many to read, then thinned
  // further when rotated labels would collide at the current width.
  private categoryTicks(domain: string[]): string[] {
    let values = domain.length > CATEGORY_LIMIT ? evenlySample(domain, 12) : domain;
    if (this.layout.rotateX) {
      const fit = Math.max(2, Math.floor(this.layout.innerWidth / (TICK_FONT * 1.6)));
      if (values.length > fit) values = evenlySample(values, fit);
    }
    return values;
  }

  private drawAxes(chart: any, x: any, y: any, innerHeight: number, numericY: ReturnType<typeof numericAxis>): void {
    const maxChars = this.maxTickChars(this.layout.width);
    const xAxis = d3.axisBottom(x).tickSizeOuter(0)
      .tickValues(this.categoryTicks(x.domain()))
      .tickFormat(value => isolate(truncate(String(value), maxChars)));
    const labels = chart.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${innerHeight})`).call(xAxis).selectAll('text');
    if (this.layout.rotateX) {
      labels.attr('transform', `rotate(-${X_LABEL_ANGLE})`).attr('text-anchor', 'end').attr('dx', '-0.6em').attr('dy', '0.2em');
    }
    labels.each(function (this: SVGTextElement, value: unknown) {
      if ([...String(value)].length > maxChars) d3.select(this).append('title').text(String(value));
    });
    chart
      .append('g')
      .attr('class', 'axis axis-y')
      .call(
        d3.axisLeft<number>(y).tickValues(numericY.ticks).tickSizeOuter(0).tickFormat(numericY.format)
      )
  }

  private aggregateByCategory(data: any[], catKey: string, valKey: string): any[] {
    return aggregateCategories(data, catKey, valKey);
  }

  private drawAxisLabels(svg: any): void {
    const { margin, innerWidth, innerHeight, height } = this.layout;
    const charsPer = (space: number) => Math.max(8, Math.floor(space / (TITLE_FONT * CHAR_RATIO)));
    const addTitle = (text: string, space: number, className: string) => {
      const shown = truncate(text, charsPer(space));
      const node = svg.append('text').attr('class', `axis-label ${className}`).attr('text-anchor', 'middle').text(isolate(shown));
      if (shown !== text) node.append('title').text(text);
      return node;
    };

    if (this.config.xAxisLabel) {
      addTitle(this.config.xAxisLabel, innerWidth, 'x-label')
        .attr('x', margin.left + innerWidth / 2)
        .attr('y', height - 10);
    }
    if (this.config.yAxisLabel) {
      addTitle(this.config.yAxisLabel, innerHeight, 'y-label')
        .attr('transform', `translate(${AXIS_TITLE_BAND / 2 + 2},${margin.top + innerHeight / 2}) rotate(-90)`)
        .attr('dominant-baseline', 'middle');
    }
  }

  // Built with DOM text nodes: spreadsheet values must never be parsed as HTML.
  private showTooltip(event: MouseEvent, rows: TooltipRow[]): void {
    if (!this.config.showTooltip) return;

    const tooltip = this.tooltip.nativeElement;
    tooltip.replaceChildren(...rows.map(row => {
      const item = document.createElement('div');
      item.className = 'tooltip-row';
      const swatch = document.createElement('span');
      swatch.className = 'tooltip-swatch';
      swatch.style.background = row.color;
      const label = document.createElement('bdi');
      label.className = 'tooltip-label';
      label.textContent = String(row.label ?? '');
      const value = document.createElement('span');
      value.className = 'tooltip-value';
      value.textContent = typeof row.value === 'number' ? row.value.toLocaleString('en-US') : String(row.value ?? '');
      item.append(swatch, label, value);
      return item;
    }));
    tooltip.style.opacity = '1';

    // Prefer the lower right of the cursor; flip when that would leave the viewport.
    const gap = 14;
    const edge = 8;
    const { width, height } = tooltip.getBoundingClientRect();
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    if (left + width > window.innerWidth - edge) left = event.clientX - gap - width;
    if (top + height > window.innerHeight - edge) top = event.clientY - gap - height;
    tooltip.style.left = `${Math.max(edge, left)}px`;
    tooltip.style.top = `${Math.max(edge, top)}px`;
  }

  private hideTooltip(): void {
    this.tooltip.nativeElement.style.opacity = '0';
  }
}

function sameChartData(a?: ChartConfig, b?: ChartConfig): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ChartConfig>;
  for (const key of keys) {
    if (key !== 'title' && a[key] !== b[key]) return false;
  }
  return true;
}

function textWidth(labels: string[], fontSize: number): number {
  return labels.reduce((widest, label) => Math.max(widest, [...label].length), 0) * fontSize * CHAR_RATIO;
}

function truncate(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length > maxChars ? chars.slice(0, maxChars - 1).join('') + '…' : text;
}

// The SVG is laid out left-to-right; Arabic labels get their own RTL isolate.
function isolate(text: string): string {
  return RTL_TEXT.test(text) ? `⁧${text}⁩` : text;
}
