import { describe, expect, it } from 'vitest';
import { ChartConfig, ChartType } from '../../models/chart-config.model';
import { CATEGORY_LIMIT, POINT_LIMIT, numericAxis, prepareChartPreview } from './chart-preview';

function preview(type: ChartType, data: Record<string, unknown>[], extra: Partial<ChartConfig> = {}) {
  return prepareChartPreview({ title: 'Accuracy', type, xKey: 'x', yKey: 'y', data, ...extra });
}

describe('Full-data chart preparation', () => {
  it.each(['bar', 'pie', 'dot'] as const)('aggregates records after row 100 exactly once for %s', type => {
    const data = Array.from({ length: 150 }, (_, i) => ({ x: i === 149 ? 'Late' : 'Early', y: i === 149 ? 1000 : 1 }));
    const result = preview(type, data);
    expect(result.data).toEqual([{ x: 'Early', y: 149 }, { x: 'Late', y: 1000 }]);
    expect(result.validCount).toBe(150);
    expect(result.notice).toContain('150');
    expect(result.notice).not.toContain('عينة');
  });

  it.each(['bar', 'pie', 'dot'] as const)('bounds %s categories with an accurate Other sum', type => {
    const data = Array.from({ length: 200 }, (_, i) => ({ x: `C${i}`, y: i + 1 }));
    const result = preview(type, data);
    expect(result.data).toHaveLength(CATEGORY_LIMIT);
    expect(result.data.reduce((sum, row) => sum + Number(row['y']), 0)).toBe(20100);
    const other = result.data.find(row => String(row['x']).startsWith('أخرى'))!;
    expect(other['y']).toBe(14706);
    expect(result.domainData).toBe(result.data);
    expect(result.notice).toContain('171');
  });

  it('keeps synthetic Other distinct from a real category with the same name', () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ x: i ? `C${i}` : 'أخرى (مجموع 171 فئة)', y: i ? i : 10000 }));
    const result = preview('bar', data);
    expect(new Set(result.data.map(row => row['x'])).size).toBe(CATEGORY_LIMIT);
    expect(result.data.reduce((sum, row) => sum + Number(row['y']), 0)).toBe(29900);
  });

  it('retains signed and zero sums, filters invalid values and discloses overflow', () => {
    const result = preview('bar', [
      { x: 'zero', y: 0 }, { x: 'negative', y: -5 }, { x: 'negative', y: 2 },
      { x: 'invalid', y: null }, { x: 'invalid', y: Infinity }, { x: 'invalid', y: NaN },
      { x: 'overflow', y: 1e308 }, { x: 'overflow', y: 1e308 },
    ]);
    expect(result.data).toEqual([{ x: 'zero', y: 0 }, { x: 'negative', y: -3 }]);
    expect(result.notice).toContain('استُبعدت 1 فئة');
    expect(preview('bar', [{ x: 'A', y: 1e308 }, { x: 'A', y: 1e308 }]).data).toEqual([]);
  });

  it('never misrepresents signed pie data or an overflowing Other total', () => {
    expect(preview('pie', [{ x: 'negative', y: -1 }, { x: 'positive', y: 5 }]).data).toEqual([]);
    const huge = preview('bar', Array.from({ length: 40 }, (_, i) => ({ x: `C${i}`, y: 1e308 })));
    expect(huge.data).toEqual([]);
    expect(huge.notice).toContain('تعذر تمثيل مجموع');
  });

  it('reduces chronologically ordered full line data while retaining endpoints and a late peak', () => {
    const data = Array.from({ length: 4000 }, (_, i) => ({
      x: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), y: i === 1500 ? 999999 : i,
    })).reverse();
    const result = preview('line', data, { xScale: 'time' });
    expect(result.data.length).toBeLessThanOrEqual(POINT_LIMIT);
    expect(result.data[0]['x']).toBe('2020-01-01');
    expect(result.data.at(-1)!['x']).toBe(data[0].x);
    expect(result.data.some(row => row['y'] === 999999)).toBe(true);
    const times = result.data.map(row => Date.parse(String(row['x'])));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(result.notice).toContain('معاينة مخفّضة');
    expect(result.notice).toContain('4000');
    expect(result.data.some(row => String(row['x']).startsWith('أخرى'))).toBe(false);
  });

  it('keeps first-seen categorical line order, sorts numeric line X, and sums duplicate X', () => {
    expect(preview('line', [{ x: 'Z', y: 1 }, { x: 'A', y: 3 }, { x: 'Z', y: 2 }, { x: 'B', y: 4 }]).data)
      .toEqual([{ x: 'Z', y: 3 }, { x: 'A', y: 3 }, { x: 'B', y: 4 }]);
    expect(preview('line', [{ x: 3, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }], { xScale: 'number' }).data.map(row => row['x']))
      .toEqual(['1', '2', '3']);
  });

  it('samples scatter across all valid observations deterministically, preserving duplicates', () => {
    const data = Array.from({ length: 2000 }, (_, i) => ({ x: Math.floor(i / 20), y: i }));
    const result = preview('scatter', [...data, { x: null as any, y: 0 }, { x: 0, y: Infinity }]);
    expect(result.data).toHaveLength(POINT_LIMIT);
    expect(result.validCount).toBe(2000);
    expect(result.data[0]).toEqual(data[0]);
    expect(result.data.at(-1)).toEqual(data.at(-1));
    expect(result.data).toEqual(preview('scatter', data).data);
    expect(new Set(result.data.map(row => row['x'])).size).toBeLessThan(result.data.length);
    expect(result.domainData).toHaveLength(2000);
    expect(result.notice).toContain('500 من 2000');
    expect(result.notice).toContain('ليست البيانات الكاملة');
  });

  it('discloses incomplete standalone suggestion payloads instead of claiming full-file totals', () => {
    const result = preview('bar', [{ x: 'A', y: 1 }], { isSampled: true, sourceRecordCount: 1000 });
    expect(result.notice).toContain('لا تمثل الملف كاملاً');
    expect(result.notice).toContain('1 من 1000');
  });

  it('keeps extreme signed axes finite, including zero and an aggregated Other maximum', () => {
    const axis = numericAxis([{ y: -Number.MAX_VALUE }, { y: 0 }, { y: Number.MAX_VALUE }], 'y', [296, 0], true);
    expect(axis.project(0)).toBeCloseTo(148);
    expect(axis.project(-Number.MAX_VALUE)).toBeCloseTo(296);
    expect(axis.project(Number.MAX_VALUE)).toBeCloseTo(0);
    expect(axis.ticks.every(value => Number.isFinite(Number(axis.format(value).replace('−', '-'))))).toBe(true);
  });
});
