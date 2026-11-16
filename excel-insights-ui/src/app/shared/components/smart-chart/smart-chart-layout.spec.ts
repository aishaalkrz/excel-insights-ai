import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { SmartChartComponent } from './smart-chart.component';
import { ChartConfig } from '../../models/chart-config.model';

describe('SmartChart presentation layout', () => {
  let restoreWidth: (() => void) | null = null;

  afterEach(() => {
    restoreWidth?.();
    restoreWidth = null;
  });

  // jsdom has no layout; emulate the chart container's measured width.
  function stubContainerWidth(width: number) {
    const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get() { return this.classList?.contains('chart-wrapper') ? width : 0; },
    });
    restoreWidth = () => Object.defineProperty(Element.prototype, 'clientWidth', previous);
  }

  async function create(config: Partial<ChartConfig>) {
    await TestBed.configureTestingModule({ imports: [SmartChartComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SmartChartComponent);
    fixture.componentRef.setInput('config', {
      title: 'Chart', type: 'bar', xKey: 'x', yKey: 'y', showLegend: true, showTooltip: true, data: [],
      ...config,
    } as ChartConfig);
    fixture.detectChanges();
    return fixture;
  }

  const layoutOf = (fixture: { componentInstance: SmartChartComponent }) => (fixture.componentInstance as any).layout;

  it('rotates and truncates long category labels and reserves room for them inside the viewBox', async () => {
    const long = 'A very long product category name that keeps going';
    const fixture = await create({
      xAxisLabel: 'Category', yAxisLabel: 'Revenue',
      data: Array.from({ length: 12 }, (_, i) => ({ x: `${long} ${i}`, y: (i + 1) * 1000 })),
    });
    const layout = layoutOf(fixture);
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
    expect(layout.rotateX).toBe(true);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${layout.width} ${layout.height}`);

    const ticks = [...fixture.nativeElement.querySelectorAll('.axis-x .tick text')] as SVGTextElement[];
    expect(ticks.length).toBe(12);
    for (const tick of ticks) {
      expect(tick.getAttribute('transform')).toContain('rotate(-40)');
      expect(tick.firstChild!.textContent!.length).toBeLessThanOrEqual(18);
      expect(tick.querySelector('title')!.textContent).toContain(long);
    }
    // 17 characters at 11px rotated 40° need ~75px below the axis plus the title band.
    expect(layout.margin.bottom).toBeGreaterThanOrEqual(100);
    expect(Number(svg.querySelector('.x-label')!.getAttribute('y'))).toBeLessThan(layout.height);
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('widens the left margin for long Y tick labels instead of clipping them', async () => {
    const fixture = await create({
      yAxisLabel: 'Revenue',
      data: [{ x: 'A', y: -1234567.5 }, { x: 'B', y: 9876543.25 }],
    });
    const layout = layoutOf(fixture);
    const widest = Math.max(...[...fixture.nativeElement.querySelectorAll('.axis-y .tick text')]
      .map((el: any) => el.textContent.length));
    expect(layout.margin.left).toBeGreaterThanOrEqual(28 + widest * 11 * 0.62 + 10);
  });

  it('draws at the measured container width on narrow screens and thins crowded labels', async () => {
    stubContainerWidth(340);
    const fixture = await create({
      data: Array.from({ length: 30 }, (_, i) => ({ x: `Region number ${i}`, y: i + 1 })),
    });
    const layout = layoutOf(fixture);
    expect(fixture.nativeElement.querySelector('svg').getAttribute('viewBox')).toBe(`0 0 340 ${layout.height}`);
    expect(layout.innerHeight).toBe(220);
    expect(fixture.nativeElement.querySelectorAll('.bar')).toHaveLength(30);
    const labels = fixture.nativeElement.querySelectorAll('.axis-x .tick');
    expect(labels.length).toBeLessThan(30);
    expect(labels.length).toBeLessThanOrEqual(Math.floor(layout.innerWidth / (11 * 1.6)));
  });

  it('lays the SVG out left-to-right and isolates Arabic labels', async () => {
    const fixture = await create({ xAxisLabel: 'الفئة', data: [{ x: 'الرياض', y: 5 }, { x: 'جدة', y: 3 }] });
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('direction')).toBe('ltr');
    expect(svg.querySelector('.x-label')!.textContent).toBe('⁧الفئة⁩');
    expect(svg.querySelector('.axis-x .tick text')!.textContent).toBe('⁧الرياض⁩');
  });

  it('renders tooltip values as text, never HTML, and keeps it inside the viewport', async () => {
    const fixture = await create({ data: [{ x: '<img src=x onerror="window.__xss=1">', y: 1234.5 }] });
    const tooltip: HTMLElement = fixture.nativeElement.querySelector('.chart-tooltip');
    tooltip.getBoundingClientRect = () => ({ width: 200, height: 60 } as DOMRect);
    fixture.nativeElement.querySelector('.bar').dispatchEvent(
      new MouseEvent('mousemove', { clientX: window.innerWidth - 20, clientY: window.innerHeight - 10 }));
    expect(tooltip.querySelector('img')).toBeNull();
    expect(tooltip.textContent).toContain('<img src=x');
    expect(tooltip.textContent).toContain('1,234.5');
    expect(parseFloat(tooltip.style.left) + 200).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(tooltip.style.top) + 60).toBeLessThanOrEqual(window.innerHeight);
  });

  it('does not re-render or reset legend toggles when only the title changes', async () => {
    const fixture = await create({ data: [{ x: 'A', y: 1 }, { x: 'B', y: 2 }] });
    fixture.nativeElement.querySelector('.legend-item').dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg');
    const preview = (fixture.componentInstance as any).getPreview();

    fixture.componentRef.setInput('config', { ...fixture.componentInstance.config, title: 'Renamed' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBe(svg);
    expect((fixture.componentInstance as any).getPreview()).toBe(preview);
    expect(fixture.nativeElement.querySelector('.legend-item').getAttribute('aria-pressed')).toBe('false');
    expect(fixture.nativeElement.querySelectorAll('.bar')).toHaveLength(1);
  });

  it('summarises record and rendered counts separately from the detailed notice', async () => {
    const fixture = await create({
      type: 'scatter', xScale: 'number', showLegend: false,
      data: Array.from({ length: 2000 }, (_, i) => ({ x: i, y: i % 7 })),
    });
    const chips = [...fixture.nativeElement.querySelectorAll('.notice-chip')].map((el: any) => el.textContent.replace(/\s+/g, ' ').trim());
    expect(chips).toContain('السجلات المستخدمة 2000');
    expect(chips).toContain('المعروض 500 نقطة');
    expect(chips).toContain('عينة حتمية');
    expect(fixture.nativeElement.querySelector('[role="note"]').textContent).toContain('500 من 2000');
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('collapses a long legend behind an accessible toggle while keeping every item', async () => {
    const fixture = await create({ data: Array.from({ length: 20 }, (_, i) => ({ x: `C${i}`, y: i + 1 })) });
    const container = fixture.nativeElement.querySelector('.legend-container');
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.legend-more');
    expect(fixture.nativeElement.querySelectorAll('.legend-item')).toHaveLength(20);
    expect(container.classList).toContain('is-collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.classList).toContain('export-exclude');
    toggle.click();
    fixture.detectChanges();
    expect(container.classList).not.toContain('is-collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
