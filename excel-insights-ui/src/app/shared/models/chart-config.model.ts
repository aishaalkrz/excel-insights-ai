export type ChartType = 'bar' | 'line' | 'pie' | 'dot' | 'scatter';
export type ChartScale = 'category' | 'number' | 'time';

export interface ChartConfig {
  id?: string;
  type: ChartType;
  title: string;

  data: Record<string, unknown>[];
  sourceRecordCount?: number;
  isSampled?: boolean;

  xKey?: string;
  yKey?: string;

  categoryKey?: string;
  valueKey?: string;

  xScale?: ChartScale;
  yScale?: ChartScale;

  xAxisLabel?: string;
  yAxisLabel?: string;

  showTooltip?: boolean;
  showLegend?: boolean;
}
