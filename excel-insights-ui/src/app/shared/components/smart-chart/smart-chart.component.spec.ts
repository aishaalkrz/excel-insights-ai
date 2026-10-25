import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { SmartChartComponent } from './smart-chart.component';
import { ChartConfig, ChartType } from '../../models/chart-config.model';

describe('SmartChartComponent numeric null compatibility', () => {
  async function create(data: Record<string, unknown>[], type: ChartType = 'bar') {
    await TestBed.configureTestingModule({ imports: [SmartChartComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SmartChartComponent);
    const config: ChartConfig = { title: 'Test chart', type, xKey: 'x', yKey: 'y', data, showLegend: true };
    fixture.componentRef.setInput('config', config);
    return fixture;
  }

  it('excludes null values and missing X values while preserving zero and negatives', async () => {
    const fixture = await create([]);
    const chart = fixture.componentInstance as any;
    expect(chart.getValue({ y: null }, 'y')).toBeNull();
    expect(chart.getValue({ y: 0 }, 'y')).toBe(0);
    expect(chart.getValue({ y: -5 }, 'y')).toBe(-5);
    expect(chart.aggregateByCategory([
      { x: 'missing', y: null }, { x: 'zero', y: 0 }, { x: 'negative', y: -5 },
      { x: null, y: 10 }, { x: undefined, y: 10 }, { x: '', y: 10 },
      { x: 'sum', y: 4 }, { x: 'sum', y: null }, { x: 'sum', y: 6 },
    ], 'x', 'y')).toEqual([
      { x: 'zero', y: 0 }, { x: 'negative', y: -5 }, { x: 'sum', y: 10 },
    ]);
  });

  it.each(['bar', 'line', 'dot', 'pie'] as Exclude<ChartType, 'scatter'>[])(
    'passes only valid data to the %s renderer and legend', async type => {
      const fixture = await create([
        { x: 'missing', y: null }, { x: null, y: 30 },
        { x: 'zero', y: 0 }, { x: 'negative', y: -2 }, { x: 'valid', y: 5 },
      ], type);
      const chart = fixture.componentInstance as any;
      const methods = { bar: 'renderBarChart', line: 'renderLineChart', dot: 'renderDotChart', pie: 'renderPieChart' };
      const render = vi.spyOn(chart, methods[type]).mockImplementation(() => {});
      fixture.detectChanges();
      expect(render).toHaveBeenCalledWith([
        { x: 'zero', y: 0 }, { x: 'negative', y: -2 }, { x: 'valid', y: 5 },
      ], 'x', 'y');
      const legends = [...fixture.nativeElement.querySelectorAll('.legend-item small')].map((el: any) => el.textContent);
      expect(legends).toEqual(['zero', 'negative', 'valid']);
      expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    }
  );

  it('clears an existing chart and shows the empty state for missing-only or empty data', async () => {
    const fixture = await create([{ x: 'valid', y: 10 }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).not.toBeNull();
    for (const data of [
      [{ x: 'missing', y: null }, { x: null, y: 2 }, { x: 'invalid', y: Infinity }],
      [],
    ]) {
      fixture.componentRef.setInput('config', { type: 'bar', xKey: 'x', yKey: 'y', data, showLegend: true });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('svg')).toBeNull();
      expect(fixture.nativeElement.querySelector('.legend-item')).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('لا توجد نتائج');
    }
  });

  it('keeps numeric X zero and rejects missing numeric X', async () => {
    const fixture = await create([{ x: 0, y: 0 }, { x: null, y: 5 }, { x: NaN, y: 5 }]);
    fixture.componentRef.setInput('config', {
      ...fixture.componentInstance.config, xScale: 'number',
    });
    expect((fixture.componentInstance as any).getPlottableData()).toEqual([{ x: 0, y: 0 }]);
  });

  it('renders negative bars with positive height and preserves legitimate zero', async () => {
    const fixture = await create([{ x: 'negative', y: -5 }, { x: 'zero', y: 0 }, { x: 'positive', y: 10 }]);
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 800));
    const bars = fixture.nativeElement.querySelectorAll('.bar');
    expect(Number(bars[0].getAttribute('height'))).toBeGreaterThan(0);
    expect(Number(bars[1].getAttribute('height'))).toBe(0);
    expect(Number(bars[2].getAttribute('height'))).toBeGreaterThan(0);
  });

  it.each([1e308, -1e308])('excludes category overflow from %s while retaining finite totals', async value => {
    const fixture = await create([]);
    const chart = fixture.componentInstance as any;
    expect(chart.aggregateByCategory([
      { x: 'overflow', y: value }, { x: 'overflow', y: value },
      { x: 'zero', y: 5 }, { x: 'zero', y: -5 },
      { x: 'negative', y: -2 }, { x: 'negative', y: -3 },
      { x: 'finite', y: 3 }, { x: 'finite', y: 4 },
      { x: 'invalid', y: NaN },
    ], 'x', 'y')).toEqual([
      { x: 'zero', y: 0 }, { x: 'negative', y: -5 }, { x: 'finite', y: 7 },
    ]);
  });

  it.each(['bar', 'line', 'dot', 'pie'] as Exclude<ChartType, 'scatter'>[])(
    'does not send overflowing totals to the %s renderer or legend', async type => {
      const fixture = await create([
        { x: 'positive overflow', y: 1e308 }, { x: 'positive overflow', y: 1e308 },
        { x: 'negative overflow', y: -1e308 }, { x: 'negative overflow', y: -1e308 },
        { x: 'zero', y: 0 }, { x: 'finite', y: 10 },
      ], type);
      const chart = fixture.componentInstance as any;
      const methods = { bar: 'renderBarChart', line: 'renderLineChart', dot: 'renderDotChart', pie: 'renderPieChart' };
      const render = vi.spyOn(chart, methods[type]).mockImplementation(() => {});
      fixture.detectChanges();
      expect(render).toHaveBeenCalledWith([{ x: 'zero', y: 0 }, { x: 'finite', y: 10 }], 'x', 'y');
      const legends = [...fixture.nativeElement.querySelectorAll('.legend-item small')].map((el: any) => el.textContent);
      expect(legends).toEqual(['zero', 'finite']);
      expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    }
  );

  it.each(['bar', 'line', 'dot', 'pie'] as Exclude<ChartType, 'scatter'>[])(
    'shows the empty state when all %s aggregates overflow', async type => {
      const fixture = await create([{ x: 'valid', y: 10 }], type);
      const chart = fixture.componentInstance as any;
      const methods = { bar: 'renderBarChart', line: 'renderLineChart', dot: 'renderDotChart', pie: 'renderPieChart' };
      const render = vi.spyOn(chart, methods[type]).mockImplementation(() => {});
      fixture.detectChanges();
      render.mockClear();
      fixture.componentRef.setInput('config', {
        ...fixture.componentInstance.config,
        data: [
          { x: 'overflow', y: 1e308 }, { x: 'overflow', y: 1e308 },
          { x: 'negative overflow', y: -1e308 }, { x: 'negative overflow', y: -1e308 },
        ],
      });
      fixture.detectChanges();
      expect(render).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('svg')).toBeNull();
      expect(fixture.nativeElement.querySelector('.legend-item')).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('لا توجد نتائج');
    }
  );
});
