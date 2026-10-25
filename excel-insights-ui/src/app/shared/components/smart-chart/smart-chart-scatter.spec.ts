import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SmartChartComponent } from './smart-chart.component';
import { ChartConfig } from '../../models/chart-config.model';

describe('SmartChartComponent true scatter support', () => {
  async function create(data: Record<string, unknown>[], overrides: Partial<ChartConfig> = {}) {
    await TestBed.configureTestingModule({ imports: [SmartChartComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SmartChartComponent);
    fixture.componentRef.setInput('config', {
      title: 'Scatter', type: 'scatter', xKey: 'x', yKey: 'y', xScale: 'number', yScale: 'number',
      xAxisLabel: 'Numeric X', yAxisLabel: 'Numeric Y', showTooltip: true, showLegend: true,
      data, ...overrides,
    } satisfies ChartConfig);
    fixture.detectChanges();
    return fixture;
  }

  // Margins grow to fit tick labels, so coordinates are asserted relative to
  // the rendered plot area rather than a fixed pixel frame.
  function plot(fixture: Awaited<ReturnType<typeof create>>) {
    const { innerWidth, innerHeight } = (fixture.componentInstance as any).layout;
    return { w: innerWidth as number, h: innerHeight as number };
  }

  it('uses linear numeric coordinates for negative, zero, and decimal values', async () => {
    const fixture = await create([{ x: -2, y: -1 }, { x: 0, y: 0 }, { x: 0.5, y: 3 }, { x: 2, y: 5 }]);
    const points = fixture.nativeElement.querySelectorAll('.scatter-point');
    expect(points.length).toBe(4);
    const { w, h } = plot(fixture);
    const expectedX = [0, w / 2, w * 0.625, w];
    const expectedY = [h, h * 5 / 6, h * 2 / 6, 0];
    points.forEach((point: Element, i: number) => {
      expect(Number(point.getAttribute('cx'))).toBeCloseTo(expectedX[i]);
      expect(Number(point.getAttribute('cy'))).toBeCloseTo(expectedY[i]);
    });
    expect(fixture.nativeElement.querySelector('.x-label').textContent).toBe('Numeric X');
    expect(fixture.nativeElement.querySelector('.y-label').textContent).toBe('Numeric Y');
    const { width, height } = (fixture.componentInstance as any).layout;
    expect(fixture.nativeElement.querySelector('svg').getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`);
    expect(Number(fixture.nativeElement.querySelector('.x-label').getAttribute('y'))).toBeLessThan(height);
  });

  it('preserves duplicate X records as separate points', async () => {
    const fixture = await create([{ x: 2, y: 5 }, { x: 2, y: 9 }, { x: 3, y: 7 }]);
    const points = fixture.nativeElement.querySelectorAll('.scatter-point');
    expect(points.length).toBe(3);
    expect(points[0].getAttribute('cx')).toBe(points[1].getAttribute('cx'));
    expect(points[0].getAttribute('cy')).not.toBe(points[1].getAttribute('cy'));
    expect((points[0] as any).__data__.y).toBe(5);
    expect((points[1] as any).__data__.y).toBe(9);
  });

  it('does not discard duplicate records whose category sum would overflow', async () => {
    const fixture = await create([{ x: 1, y: 1e308 }, { x: 1, y: 1e308 }]);
    const points = fixture.nativeElement.querySelectorAll('.scatter-point');
    expect(points.length).toBe(2);
    expect(Number.isFinite(Number(points[0].getAttribute('cy')))).toBe(true);
  });

  it('excludes missing and non-finite coordinates even without numeric scale hints', async () => {
    const invalid = [null, undefined, '', ' ', NaN, Infinity, -Infinity, 'invalid'];
    const fixture = await create([
      ...invalid.map(x => ({ x, y: 1 })), ...invalid.map(y => ({ x: 1, y })),
      { x: 0, y: 0 }, { x: '0.5', y: '-2.5' },
    ], { xScale: undefined, yScale: undefined });
    const points = fixture.nativeElement.querySelectorAll('.scatter-point');
    expect(points.length).toBe(2);
    points.forEach((point: Element) => {
      expect(Number.isFinite(Number(point.getAttribute('cx')))).toBe(true);
      expect(Number.isFinite(Number(point.getAttribute('cy')))).toBe(true);
    });
  });

  it('clears old points and displays the existing empty state when all records are invalid', async () => {
    const fixture = await create([{ x: 1, y: 2 }]);
    fixture.componentRef.setInput('config', {
      ...fixture.componentInstance.config,
      data: [{ x: null, y: 3 }, { x: 1, y: Infinity }, { x: NaN, y: 2 }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    expect(fixture.nativeElement.querySelector('.legend-item')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('لا توجد نتائج');
  });

  it.each([{ x: 0, y: 0 }, { x: -5, y: 2.5 }])(
    'renders finite centered coordinates for singleton domains ($x, $y)', async row => {
      const fixture = await create([row]);
      const point = fixture.nativeElement.querySelector('.scatter-point');
      const { w, h } = plot(fixture);
      expect(Number(point.getAttribute('cx'))).toBeCloseTo(w / 2);
      expect(Number(point.getAttribute('cy'))).toBeCloseTo(h / 2);
    }
  );

  it('reuses the tooltip with both numeric coordinates', async () => {
    const fixture = await create([{ x: -1.5, y: 2.5 }]);
    const point = fixture.nativeElement.querySelector('.scatter-point');
    point.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 30 }));
    const tooltip = fixture.nativeElement.querySelector('.chart-tooltip');
    expect(tooltip.textContent).toContain('x');
    expect(tooltip.textContent).toContain('-1.5');
    expect(tooltip.textContent).toContain('y');
    expect(tooltip.textContent).toContain('2.5');
    expect(tooltip.style.opacity).toBe('1');
    point.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltip.style.opacity).toBe('0');
  });

  it('keeps Dot as a categorical chart with its existing aggregation', async () => {
    const fixture = await create([{ x: 'A', y: 2 }, { x: 'A', y: 3 }], { type: 'dot', xScale: 'category' });
    expect(fixture.nativeElement.querySelectorAll('.scatter-point').length).toBe(0);
    const points = fixture.nativeElement.querySelectorAll('.scatter-dot');
    expect(points.length).toBe(1);
    expect((points[0] as any).__data__).toEqual({ x: 'A', y: 5 });
  });

  function expectFiniteSvg(root: HTMLElement) {
    const svg = root.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity/);
    for (const point of svg.querySelectorAll('.scatter-point')) {
      expect(Number.isFinite(Number(point.getAttribute('cx')))).toBe(true);
      expect(Number.isFinite(Number(point.getAttribute('cy')))).toBe(true);
    }
    for (const tick of svg.querySelectorAll('.axis .tick text')) {
      const value = Number(tick.textContent!.replace('−', '-'));
      expect(Number.isFinite(value)).toBe(true);
    }
  }

  it.each([1e308, Number.MAX_VALUE])(
    'maps symmetric extreme coordinates %s to opposite edges with zero centered', async value => {
      const fixture = await create([
        { x: -value, y: -value }, { x: 0, y: 0 }, { x: value, y: value },
        { x: value, y: -value },
      ]);
      const points = fixture.nativeElement.querySelectorAll('.scatter-point');
      expect(points.length).toBe(4);
      const { w, h } = plot(fixture);
      expect(Number(points[0].getAttribute('cx'))).toBeCloseTo(0);
      expect(Number(points[1].getAttribute('cx'))).toBeCloseTo(w / 2);
      expect(Number(points[2].getAttribute('cx'))).toBeCloseTo(w);
      expect(Number(points[0].getAttribute('cy'))).toBeCloseTo(h);
      expect(Number(points[1].getAttribute('cy'))).toBeCloseTo(h / 2);
      expect(Number(points[2].getAttribute('cy'))).toBeCloseTo(0);
      expect(points[2].getAttribute('cx')).toBe(points[3].getAttribute('cx'));
      expectFiniteSvg(fixture.nativeElement);
      const ticks = [...fixture.nativeElement.querySelectorAll('.axis-x .tick text')]
        .map((el: any) => Number(el.textContent.replace('−', '-')));
      expect(ticks.some((tick: number) => tick < -value * 0.5)).toBe(true);
      expect(ticks.some((tick: number) => tick > value * 0.5)).toBe(true);
      expect(ticks).toContain(0);
    }
  );

  it.each([Number.MAX_VALUE, -Number.MAX_VALUE])(
    'keeps singleton extreme %s finite and centered with original-value ticks', async value => {
      const fixture = await create([{ x: value, y: value }, { x: value, y: value }]);
      const points = fixture.nativeElement.querySelectorAll('.scatter-point');
      expect(points.length).toBe(2);
      const { w, h } = plot(fixture);
      expect(Number(points[0].getAttribute('cx'))).toBeCloseTo(w / 2);
      expect(Number(points[0].getAttribute('cy'))).toBeCloseTo(h / 2);
      expectFiniteSvg(fixture.nativeElement);
      const ticks = [...fixture.nativeElement.querySelectorAll('.axis-x .tick text')]
        .map((el: any) => Number(el.textContent.replace('−', '-')));
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every((tick: number) => Math.sign(tick) === Math.sign(value))).toBe(true);
      expect(ticks.some((tick: number) => Math.abs(tick / value - 1) < 0.00001)).toBe(true);
    }
  );

  it('maps asymmetric extreme domains proportionally', async () => {
    const fixture = await create([{ x: -1e308, y: -1e308 }, { x: 0, y: 0 }, { x: 5e307, y: 5e307 }]);
    const points = fixture.nativeElement.querySelectorAll('.scatter-point');
    const left = Number(points[0].getAttribute('cx'));
    const center = Number(points[1].getAttribute('cx'));
    const right = Number(points[2].getAttribute('cx'));
    expect((center - left) / (right - left)).toBeCloseTo(2 / 3);
    expectFiniteSvg(fixture.nativeElement);
  });
});
