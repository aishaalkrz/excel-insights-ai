import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SmartChartComponent } from './smart-chart.component';
import { ChartConfig } from '../../models/chart-config.model';

describe('SmartChart line rendering', () => {
  // jsdom does not implement SVG path length; only the draw-in animation uses it.
  let previous: PropertyDescriptor | undefined;
  beforeEach(() => {
    previous = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getTotalLength');
    Object.defineProperty(SVGElement.prototype, 'getTotalLength', { configurable: true, value: () => 100 });
  });
  afterEach(() => {
    if (previous) Object.defineProperty(SVGElement.prototype, 'getTotalLength', previous);
    else delete (SVGElement.prototype as any).getTotalLength;
  });

  async function create(config: Partial<ChartConfig>) {
    await TestBed.configureTestingModule({ imports: [SmartChartComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SmartChartComponent);
    fixture.componentRef.setInput('config', {
      title: 'Line', type: 'line', xKey: 'x', yKey: 'y', showLegend: true, showTooltip: true, data: [],
      ...config,
    } as ChartConfig);
    fixture.detectChanges();
    return fixture;
  }

  const vertices = (root: HTMLElement) => root.querySelector('.line-path')!.getAttribute('d')!
    .split(/[ML]/).filter(Boolean).map(point => point.split(',').map(Number));

  it('spaces numeric X values proportionally instead of as evenly spaced categories', async () => {
    const fixture = await create({ xScale: 'number', data: [{ x: 0, y: 1 }, { x: 10, y: 2 }, { x: 100, y: 3 }] });
    const [a, b, c] = vertices(fixture.nativeElement).map(([x]) => x);
    expect((b - a) / (c - a)).toBeCloseTo(0.1);
    expect(fixture.nativeElement.querySelector('svg').outerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('keeps calendar gaps on a time axis', async () => {
    const fixture = await create({ xScale: 'time', data: [
      { x: '2024-01-01', y: 1 }, { x: '2024-01-02', y: 2 }, { x: '2024-01-31', y: 3 },
    ] });
    const [a, b, c] = vertices(fixture.nativeElement).map(([x]) => x);
    expect((b - a) / (c - a)).toBeCloseTo(1 / 30);
    const ticks = [...fixture.nativeElement.querySelectorAll('.axis-x .tick text')].map((t: any) => t.textContent);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.every((t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t))).toBe(true);
  });

  it('draws a clean dense line and snaps the hover tooltip to the nearest point', async () => {
    const fixture = await create({ xScale: 'time', data: Array.from({ length: 240 }, (_, i) => ({
      x: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), y: i,
    })) });
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('.line-dot')).toHaveLength(0);
    const overlay = root.querySelector('.line-overlay')!;
    const focus = root.querySelector('.line-focus') as SVGCircleElement;
    expect(focus.style.display).toBe('none');

    const [firstX] = vertices(root)[0];
    overlay.dispatchEvent(new MouseEvent('mousemove', { clientX: firstX, clientY: 10 }));
    expect(focus.style.display).not.toBe('none');
    expect(root.querySelector('.chart-tooltip')!.textContent).toContain('2024-01-01');
    overlay.dispatchEvent(new MouseEvent('mouseleave'));
    expect(focus.style.display).toBe('none');
  });

  it('keeps category-coloured markers for a sparse line with a legend', async () => {
    const fixture = await create({ data: [{ x: 'A', y: 1 }, { x: 'B', y: 3 }, { x: 'C', y: 2 }] });
    const dots = [...fixture.nativeElement.querySelectorAll('.line-dot')] as SVGCircleElement[];
    const legend = [...fixture.nativeElement.querySelectorAll('.legend-item')] as HTMLElement[];
    expect(dots).toHaveLength(3);
    expect(dots.map(dot => dot.getAttribute('fill'))).toEqual(legend.map(item => item.style.getPropertyValue('--item-color')));
    expect(fixture.nativeElement.querySelector('.line-overlay')).toBeNull();
  });
});
