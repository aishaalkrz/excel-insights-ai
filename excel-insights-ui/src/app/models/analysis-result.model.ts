import { ChartConfig } from "../shared/models/chart-config.model";

export interface AnalysisResult {
  filename: string;
  row_count: number;
  column_count: number;
  columns: string[];

  field_metadata: {
    name: string;
    type: 'text' | 'number' | 'date';
  }[];

  numeric_columns: string[];
  text_columns: string[];
  date_columns: string[];

  numeric_kpis: Record<string, {
    sum: number;
    average: number;
    min: number;
    max: number;
  }>;

  categorical_summary: Record<string, Record<string, number>>;
  summary_stats: Record<string, unknown>;

  chart_suggestions: ChartConfig[];

  sample_data: Record<string, unknown>[];
  ai_insights: string;
  records: Record<string, unknown>[];

  uploaded_at?: string;
  file_size?: string;
  file_size_bytes?: number;
  available_sheets?: string[];
}