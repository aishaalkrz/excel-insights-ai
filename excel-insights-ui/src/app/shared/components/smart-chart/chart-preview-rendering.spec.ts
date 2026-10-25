import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SmartChartComponent } from './smart-chart.component';
import { ChartConfig } from '../../models/chart-config.model';

describe('Bounded chart preview rendering', () => {
  async function create(config: ChartConfig) {
    await TestBed.configureTestingModule({ imports: [SmartChartComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SmartChartComponent);
    fixture.componentRef.setInput('config', config);
    fixture.detectChanges();
    return fixture;
  }

  it('bounds bars and legends while retaining the full category total', async () => {
    const fixture = await create({ title: 'Categories', type: 'bar', xKey: 'x', yKey: 'y', showLegend: true,
      data: Array.from({ length: 4000 }, (_, i) => ({ x: `C${i % 200}`, y: 1 })),
    });
    const bars = [...fixture.nativeElement.querySelectorAll('.bar')] as any[];
    expect(bars).toHaveLength(30);
    expect(bars.reduce((sum, bar) => sum + bar.__data__.y, 0)).toBe(4000);
    expect(fixture.nativeElement.querySelectorAll('.legend-item')).toHaveLength(30);
    expect(fixture.nativeElement.querySelector('[role="note"]').textContent).toContain('4000');
    const cached = (fixture.componentInstance as any).getPreview();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).getPreview()).toBe(cached);
  });

  it('bounds scatter SVG and legend elements and resets counts on new config', async () => {
    const fixture = await create({ title: 'Scatter', type: 'scatter', xKey: 'x', yKey: 'y', showLegend: true,
      data: Array.from({ length: 10000 }, (_, i) => ({ x: i, y: i })),
    });
    expect(fixture.nativeElement.querySelectorAll('.scatter-point')).toHaveLength(500);
    expect(fixture.nativeElement.querySelectorAll('.legend-item')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('[role="note"]').textContent).toContain('500 من 10000');
    fixture.componentRef.setInput('config', { ...fixture.componentInstance.config, data: [{ x: 0, y: 0 }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.scatter-point')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[role="note"]').textContent).toContain('1 من 1');
    expect(fixture.nativeElement.querySelectorAll('.legend-item')).toHaveLength(1);
  });

  it('bounds line points and axis ticks and discloses reduction', async () => {
    // jsdom does not implement SVG path length; only the animation uses it.
    const previous = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getTotalLength');
    Object.defineProperty(SVGElement.prototype, 'getTotalLength', { configurable: true, value: () => 100 });
    try {
      const fixture = await create({ title: 'Line', type: 'line', xKey: 'x', yKey: 'y', xScale: 'time', showLegend: true,
        data: Array.from({ length: 4000 }, (_, i) => ({
          x: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), y: i,
        })),
      });
      const points = fixture.nativeElement.querySelectorAll('.chart-wrapper svg circle');
      expect(points.length).toBeGreaterThan(0);
      expect(points.length).toBeLessThanOrEqual(500);
      expect(fixture.nativeElement.querySelectorAll('.axis-x .tick').length).toBeLessThanOrEqual(12);
      expect(fixture.nativeElement.querySelectorAll('.grid-x .tick').length).toBeLessThanOrEqual(12);
      expect(fixture.nativeElement.querySelector('[role="note"]').textContent).toContain('معاينة مخفّضة');
      expect(fixture.nativeElement.querySelector('svg').outerHTML).not.toMatch(/NaN|Infinity/);
    } finally {
      if (previous) Object.defineProperty(SVGElement.prototype, 'getTotalLength', previous);
      else delete (SVGElement.prototype as any).getTotalLength;
    }
  });

  it('keeps extreme positive pie proportions finite and signed pie data explicitly unavailable', async () => {
    const fixture = await create({ title: 'Pie', type: 'pie', xKey: 'x', yKey: 'y',
      data: [{ x: 'A', y: 1e308 }, { x: 'B', y: 1e308 }],
    });
    const wedges = [...fixture.nativeElement.querySelectorAll('svg path')] as any[];
    expect(wedges).toHaveLength(2);
    for (const wedge of wedges) expect(wedge.__data__.endAngle - wedge.__data__.startAngle).toBeCloseTo(Math.PI);
    fixture.componentRef.setInput('config', { ...fixture.componentInstance.config, data: [{ x: 'A', y: -1 }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="note"]').textContent).toContain('قيماً سالبة');
  });

  it('keeps legend toggles interactive after preparation without aggregating again', async () => {
    const fixture = await create({ title: 'Bar', type: 'bar', xKey: 'x', yKey: 'y', showLegend: true,
      data: [{ x: 'A', y: 10 }, { x: 'A', y: 20 }, { x: 'B', y: 5 }],
    });
    const cached = (fixture.componentInstance as any).getPreview();
    fixture.nativeElement.querySelector('.legend-item').dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    const bars = [...fixture.nativeElement.querySelectorAll('.bar')] as any[];
    expect(bars.map(bar => bar.__data__)).toEqual([{ x: 'B', y: 5 }]);
    expect((fixture.componentInstance as any).getPreview()).toBe(cached);
    expect(fixture.nativeElement.querySelectorAll('.legend-item')).toHaveLength(2);
  });
});
