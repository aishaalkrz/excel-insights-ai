import * as d3 from 'd3';
import { ChartConfig } from '../../models/chart-config.model';

type Row = Record<string, unknown>;
export const CATEGORY_LIMIT = 30;
export const POINT_LIMIT = 500;

export function numericValue(row: Row, key: string): number | null {
  const raw = row[key];
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function aggregateCategories(data: Row[], xKey: string, yKey: string): Row[] {
  const totals = new Map<string, number>();
  for (const row of data) {
    const value = numericValue(row, yKey);
    if (row[xKey] == null || String(row[xKey]).trim() === '' || value === null) continue;
    const key = String(row[xKey]);
    totals.set(key, (totals.get(key) ?? 0) + value);
  }
  return [...totals].filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => ({ [xKey]: key, [yKey]: value }));
}

export function evenlySample<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  return Array.from({ length: limit }, (_, i) => rows[Math.round(i * (rows.length - 1) / (limit - 1))]);
}

// Retain endpoints and each ordered bucket's minimum/maximum, without inventing
// intermediate values or combining time-series points into an Other category.
function reduceLine(rows: Row[], yKey: string): Row[] {
  if (rows.length <= POINT_LIMIT) return rows;
  const indices = new Set([0, rows.length - 1]);
  const buckets = Math.floor((POINT_LIMIT - 2) / 2);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * (rows.length - 2) / buckets);
    const end = 1 + Math.floor((bucket + 1) * (rows.length - 2) / buckets);
    let min = start;
    let max = start;
    for (let i = start + 1; i < end; i++) {
      if (Number(rows[i][yKey]) < Number(rows[min][yKey])) min = i;
      if (Number(rows[i][yKey]) > Number(rows[max][yKey])) max = i;
    }
    indices.add(min);
    indices.add(max);
  }
  return [...indices].sort((a, b) => a - b).map(index => rows[index]);
}

export function prepareChartPreview(config: ChartConfig) {
  const xKey = config.type === 'pie' ? config.categoryKey || config.xKey : config.xKey;
  const yKey = config.type === 'pie' ? config.valueKey || config.yKey : config.yKey;
  const empty = { data: [] as Row[], domainData: [] as Row[], notice: '', validCount: 0 };
  if (!xKey || !yKey) return empty;
  const sourceNote = config.isSampled
    ? `المصدر معاينة جزئية (${config.data.length} من ${config.sourceRecordCount ?? 'عدد غير محدد'} سجل)؛ النتائج لا تمثل الملف كاملاً. ` : '';
  const valid = (config.data ?? []).filter(row =>
    row[xKey] != null && String(row[xKey]).trim() !== '' && numericValue(row, yKey) !== null &&
    ((config.type !== 'scatter' && config.xScale !== 'number') || numericValue(row, xKey) !== null) &&
    (config.type !== 'line' || config.xScale !== 'time' || Number.isFinite(Date.parse(String(row[xKey]))))
  );
  if (config.type === 'scatter') {
    const data = evenlySample(valid, POINT_LIMIT);
    return {
      data, domainData: valid, validCount: valid.length,
      notice: sourceNote + (data.length < valid.length
        ? `معاينة بعينة حتمية موزعة على كامل البيانات: عرض ${data.length} من ${valid.length} مشاهدة صالحة؛ العينة ليست البيانات الكاملة.`
        : `عرض جميع المشاهدات الصالحة: ${data.length} من ${valid.length}.`) +
        (config.showLegend && new Set(data.map(row => String(row[xKey]))).size > CATEGORY_LIMIT
          ? ' أُخفي مفتاح الألوان لكثرة قيم المحور.' : ''),
    };
  }

  let data = aggregateCategories(valid, xKey, yKey);
  const invalidGroups = new Set(valid.map(row => String(row[xKey]))).size - data.length;
  let notice = sourceNote + `جمع حسب الفئة من جميع السجلات الصالحة المتاحة (${valid.length}).`;
  if (invalidGroups) notice += ` استُبعدت ${invalidGroups} فئة لأن مجموعها خارج النطاق العددي.`;
  const domainData = data;
  if (config.type === 'line') {
    if (config.xScale === 'time') data = [...data].sort((a, b) => Date.parse(String(a[xKey])) - Date.parse(String(b[xKey])));
    else if (config.xScale === 'number') data = [...data].sort((a, b) => Number(a[xKey]) - Number(b[xKey]));
    const count = data.length;
    data = reduceLine(data, yKey);
    notice += data.length < count
      ? ` معاينة مخفّضة: ${data.length} من ${count} نقطة؛ حُفظت الأطراف والقيم الدنيا والعليا ضمن فترات مرتبة، وقد تُحذف تفاصيل أخرى.`
      : ` عرض جميع النقاط (${count})؛ جُمعت قيم المحور المتكررة مع الحفاظ على الترتيب.`;
  } else {
    if (config.type === 'pie' && data.some(row => Number(row[yKey]) < 0)) {
      return { ...empty, validCount: valid.length, notice: notice + ' الرسم الدائري لا يمثل قيماً سالبة؛ اختر Bar أو Dot لعرضها.' };
    }
    if (config.type === 'pie' && !data.some(row => Number(row[yKey]) > 0)) {
      return { ...empty, validCount: valid.length, notice: notice + ' لا توجد قيم موجبة لتمثيل نسب دائرية.' };
    }
    if (data.length > CATEGORY_LIMIT) {
      const ranked = [...data].sort((a, b) => Math.abs(Number(b[yKey])) - Math.abs(Number(a[yKey])));
      const remaining = ranked.slice(CATEGORY_LIMIT - 1);
      const total = remaining.reduce((sum, row) => sum + Number(row[yKey]), 0);
      if (!Number.isFinite(total)) {
        return { ...empty, validCount: valid.length, notice: notice + ' تعذر تمثيل مجموع الفئات الأخرى دون تجاوز النطاق العددي.' };
      }
      let other = `أخرى (مجموع ${remaining.length} فئة)`;
      const names = new Set(data.map(row => String(row[xKey])));
      while (names.has(other)) other += ' ·';
      data = [...ranked.slice(0, CATEGORY_LIMIT - 1), { [xKey]: other, [yKey]: total }];
      notice += ` عرض أكبر ${CATEGORY_LIMIT - 1} فئة بالقيمة المطلقة وجمع ${remaining.length} فئة في «${other}» مع حفظ مجموع الفئات القابلة للتمثيل.`;
    }
  }
  if (config.showLegend && new Set(data.map(row => String(row[xKey]))).size > CATEGORY_LIMIT) {
    notice += ' أُخفي مفتاح الألوان لكثرة قيم المحور.';
  }
  return { data, domainData: config.type === 'line' ? domainData : data, validCount: valid.length, notice };
}

export function numericAxis(data: Row[], key: string, range: [number, number], includeZero = false) {
  const extent = d3.extent(data, row => numericValue(row, key)!) as [number, number];
  const min = includeZero ? Math.min(0, extent[0]) : extent[0];
  const max = includeZero ? Math.max(0, extent[1]) : extent[1];
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const factor = magnitude > Number.MAX_VALUE / 16 || (magnitude > 0 && magnitude < 1e-300) ? magnitude : 1;
  const low = min / factor;
  const high = max / factor;
  const padding = low === high ? Math.abs(low) * 0.05 || 1 : 0;
  const scale = d3.scaleLinear().domain([low - padding, high + padding]).nice().range(range);
  const ticks = scale.ticks(6).filter(value => Math.abs(value) <= Number.MAX_VALUE / factor);
  return { scale, ticks, factor,
    project: (value: number) => scale(value / factor),
    format: (value: d3.NumberValue) => d3.format('~g')(Number(value) * factor),
  };
}
