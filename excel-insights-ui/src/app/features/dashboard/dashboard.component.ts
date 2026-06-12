import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { AnalysisStateService } from '../../services/analysis-state.service';
import { AnalysisResult } from '../../models/analysis-result.model';
import { SmartChartComponent } from '../../shared/components/smart-chart/smart-chart.component';
import { DropdownComponent } from '../../shared/components/dropdown/dropdown.component';

import { ChartConfig, ChartType } from '../../shared/models/chart-config.model';
import { DropdownConfig } from '../../shared/components/dropdown/dropdown.model';
import { DataTableModalComponent } from '../../shared/components/model/data-table-modal.component';
import { FormsModule } from '@angular/forms';

type MetricType =
  | 'revenue'
  | 'quantity'
  | 'average'
  | 'max'
  | 'min'
  | 'discount'
  | 'count'
  | 'growth'
  | 'profit'
  | 'price'
  | 'generic';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    SmartChartComponent,
    DropdownComponent,
    DataTableModalComponent,
    FormsModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private analysisState = inject(AnalysisStateService);
  private router = inject(Router);

  result: AnalysisResult | null = null;

  selectedSheetName = '';
  currentSheet: any = null;

  chartSuggestions: ChartConfig[] = [];
  smartInsights: any = null;
  uploadedAgo = '';
  chartTitle = '';

  isTableModalOpen = false;

  chartTypeDropdown: DropdownConfig<ChartType> = {
    label: 'نوع الرسم',
    selectedValue: 'bar',
    grouped: false,
    showIcons: true,
    options: [
      { label: 'أعمدة', value: 'bar', icon: '/charts/bar.svg' },
      { label: 'خط', value: 'line', icon: '/charts/line.svg' },
      { label: 'نقاط', value: 'dot', icon: '/charts/dot.svg' },
      { label: 'دائري', value: 'pie', icon: '/charts/pie.svg' },
    ],
  };

  xAxisDropdown: DropdownConfig<string> = {
    label: 'المحور X',
    options: [],
    selectedValue: '',
  };

  yAxisDropdown: DropdownConfig<string> = {
    label: 'المحور Y',
    options: [],
    selectedValue: '',
  };
  sheetDropdown: DropdownConfig<string> = {
    label: 'الشيت الحالي',
    selectedValue: '',
    grouped: false,
    showIcons: false,
    options: [],
  };

  bigNumbers: {
    label: string;
    value: string | number;
    description: string;
    metricType: MetricType;
    icon: string;
    color: string;
    background: string;
  }[] = [];

  ngOnInit(): void {
    this.result =
      this.analysisState.getResult() ||
      JSON.parse(localStorage.getItem('analysisResult') || 'null');

    if (!this.result) {
      this.router.navigate(['/']);
      return;
    }

    this.setUploadedAgo();
    this.initializeSelectedSheet();
    this.buildBigNumbers();
    this.initializeChartBuilder();
  }

  openTableModal(): void {
    this.isTableModalOpen = true;
  }

  closeTableModal(): void {
    this.isTableModalOpen = false;
  }

  onSheetChange(sheetName: string): void {
    const sheet = (this.result as any)?.sheets?.[sheetName];

    if (!sheet) {
      console.warn('Sheet not found:', sheetName);
      return;
    }

    this.selectedSheetName = sheetName;
    this.currentSheet = sheet;

    this.buildBigNumbers();

    this.smartInsights = sheet.ai_insights?.smart_insights ?? null;

    this.updateSheetDropdown();
    this.initializeChartBuilder();
  }
  private initializeSelectedSheet(): void {
    if (!this.result) return;

    const defaultSheetName =
      (this.result as any).active_sheet ||
      (this.result as any).available_sheets?.[0];

    this.selectedSheetName = defaultSheetName;

    this.currentSheet =
      (this.result as any).sheets?.[defaultSheetName] ||
      this.result;

    this.updateSheetDropdown();
  }

  private setUploadedAgo(): void {
    const uploadedAt =
      (this.result as any)?.uploaded_at ||
      localStorage.getItem('uploadedAt');

    if (!uploadedAt) {
      const now = new Date().toISOString();
      localStorage.setItem('uploadedAt', now);
      this.uploadedAgo = 'الآن';
      return;
    }

    const uploadedDate = new Date(uploadedAt);
    const diffMs = Date.now() - uploadedDate.getTime();

    if (!Number.isFinite(diffMs) || diffMs < 0) {
      this.uploadedAgo = 'الآن';
      return;
    }

    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) {
      this.uploadedAgo = 'الآن';
    } else if (diffMinutes < 60) {
      this.uploadedAgo = `منذ ${diffMinutes} دقيقة`;
    } else if (diffHours < 24) {
      this.uploadedAgo = `منذ ${diffHours} ساعة`;
    } else {
      this.uploadedAgo = `منذ ${diffDays} يوم`;
    }
  }

  private initializeChartBuilder(): void {
    if (!this.currentSheet) return;

    const suggestedChart = this.currentSheet.chart_suggestions?.[0];

    const numericCols = this.currentSheet.numeric_columns ?? [];

    const xCols = [
      ...(this.currentSheet.text_columns ?? []),
      ...(this.currentSheet.date_columns ?? []),
      ...(this.currentSheet.numeric_columns ?? []),
    ];

    this.xAxisDropdown = {
      ...this.xAxisDropdown,
      options: xCols.map((col: string) => ({
        label: col,
        value: col,
        dataType: this.currentSheet.date_columns?.includes(col)
          ? 'date'
          : this.currentSheet.numeric_columns?.includes(col)
            ? 'number'
            : 'text',
      })),
      selectedValue: suggestedChart?.xKey ?? xCols[0] ?? '',
    };

    this.yAxisDropdown = {
      ...this.yAxisDropdown,
      options: numericCols.map((col: string) => ({
        label: col,
        value: col,
        dataType: 'number' as const,
      })),
      selectedValue: suggestedChart?.yKey ?? numericCols[0] ?? '',
    };

    if (suggestedChart) {
      this.chartTitle = suggestedChart.title;

      this.chartSuggestions = [
        {
          ...suggestedChart,
          showLegend: true,
          data: this.currentSheet.records?.slice(0, 100) || [],
        },
      ];

      this.chartTypeDropdown = {
        ...this.chartTypeDropdown,
        selectedValue: suggestedChart.type,
      };

      return;
    }

    this.chartTitle = '';
    this.buildChartFromSelection();
  }

  private buildChartFromSelection(): void {
    if (!this.currentSheet?.records?.length) return;

    const type = this.chartTypeDropdown.selectedValue as ChartType;
    const xKey = this.xAxisDropdown.selectedValue;
    const yKey = this.yAxisDropdown.selectedValue;

    if (!type || !xKey || !yKey) return;

    const chartData = this.currentSheet.records.slice(0, 100);

    this.chartSuggestions = [
      {
        id: `custom_${this.selectedSheetName}`,
        sheetName: this.selectedSheetName,
        title: this.chartTitle || `${yKey} حسب ${xKey}`,
        type,
        xKey,
        yKey,
        categoryKey: xKey,
        valueKey: yKey,
        xAxisLabel: xKey,
        yAxisLabel: yKey,
        xScale: this.currentSheet.date_columns?.includes(xKey)
          ? 'time'
          : this.currentSheet.numeric_columns?.includes(xKey)
            ? 'number'
            : 'category',
        yScale: 'number',
        showTooltip: true,
        showLegend: true,
        isAggregated: false,
        isDerived: false,
        dataSource: 'raw_records',
        data: chartData,
      } as ChartConfig,
    ];
  }

  onChartTypeChange(value: ChartType): void {
    this.chartTypeDropdown = {
      ...this.chartTypeDropdown,
      selectedValue: value,
    };

    this.buildChartFromSelection();
  }

  onXAxisChange(value: string): void {
    this.xAxisDropdown = {
      ...this.xAxisDropdown,
      selectedValue: value,
    };

    this.buildChartFromSelection();
  }

  onYAxisChange(value: string): void {
    this.yAxisDropdown = {
      ...this.yAxisDropdown,
      selectedValue: value,
    };

    this.buildChartFromSelection();
  }

  onChartTitleChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.chartTitle = value;

    if (!this.chartSuggestions[0]) return;

    this.chartSuggestions = [
      {
        ...this.chartSuggestions[0],
        title: value,
      },
    ];
  }

  private updateSheetDropdown(): void {
    this.sheetDropdown = {
      ...this.sheetDropdown,
      selectedValue: this.selectedSheetName,
      options: ((this.result as any)?.available_sheets || []).map((sheet: string) => ({
        label: sheet,
        value: sheet,
      })),
    };
  }
  private buildBigNumbers(): void {
    if (!this.currentSheet?.ai_insights) return;
  console.log('===== DEBUG buildBigNumbers =====');
  console.log('Current Sheet:', this.selectedSheetName);
  console.log('AI Data Raw:', this.currentSheet.ai_insights);
    try {
      const aiData =
        typeof this.currentSheet.ai_insights === 'string'
          ? JSON.parse(this.currentSheet.ai_insights)
          : this.currentSheet.ai_insights;

      // استخدم الكاردات من AI مباشرة
      if (aiData.kpi_cards && Array.isArray(aiData.kpi_cards)) {
        this.bigNumbers = aiData.kpi_cards.map((card: any) => {
          let metricType = this.normalizeMetricType(card.metricType);

          return {
            label: card.label,
            value: card.value,
            description: card.description,
            metricType,
            icon: this.resolveMetricIcon(metricType),
            color: this.resolveMetricColor(metricType),
            background: this.resolveMetricBackground(metricType),
          };
        });

        // التوصيات الذكية
        this.smartInsights = aiData.smart_insights ?? null;
        return;
      }

      // إذا لم توجد AI cards استخدم fallback
      if (aiData.smart_insights) {
        this.smartInsights = aiData.smart_insights;
      }

      const entries = Object.entries(this.currentSheet?.numeric_kpis ?? {}).slice(0, 4);

      this.bigNumbers = entries
        .flatMap(([column, kpi]: [string, any]) => [
          this.createKpiCard(`إجمالي ${column}`, kpi.sum, 'مجموع القيم', 'generic'),
          this.createKpiCard(`متوسط ${column}`, kpi.average, 'متوسط القيم', 'average'),
          this.createKpiCard(`أعلى ${column}`, kpi.max, 'أعلى قيمة', 'max'),
          this.createKpiCard(`أقل ${column}`, kpi.min, 'أقل قيمة', 'min'),
        ])
        .slice(0, 4);
    } catch (error) {
      console.error('Failed to parse AI insights. Using fallback logic.', error);
    }
  }

  private createKpiCard(
    label: string,
    value: string | number,
    description: string,
    metricType: MetricType
  ) {
    return {
      label,
      value,
      description,
      metricType,
      icon: this.resolveMetricIcon(metricType),
      color: this.resolveMetricColor(metricType),
      background: this.resolveMetricBackground(metricType),
    };
  }

  private normalizeMetricType(metricType?: string): MetricType {
    const allowed: MetricType[] = [
      'revenue',
      'quantity',
      'average',
      'max',
      'min',
      'discount',
      'count',
      'growth',
      'profit',
      'price',
      'generic',
    ];

    return allowed.includes(metricType as MetricType)
      ? (metricType as MetricType)
      : 'generic';
  }

  private resolveMetricColor(metricType?: string): string {
    switch (this.normalizeMetricType(metricType)) {
      case 'revenue': return '#3E7B6B';
      case 'quantity': return '#5B9F77';
      case 'average': return '#8B7FD6';
      case 'max': return '#D9A441';
      case 'min': return '#D884B6';
      case 'discount': return '#E07A7A';
      case 'count': return '#6A9FD8';
      case 'growth': return '#63B7B0';
      case 'profit': return '#4C9B6B';
      case 'price': return '#5B8FB9';
      default: return '#94A3B8';
    }
  }

  private resolveMetricBackground(metricType?: string): string {
    switch (this.normalizeMetricType(metricType)) {
      case 'revenue': return '#E8F5F0';
      case 'quantity': return '#EEF9F1';
      case 'average': return '#F4F0FD';
      case 'max': return '#FFF7E8';
      case 'min': return '#FFF0F8';
      case 'discount': return '#FFF1F1';
      case 'count': return '#EEF5FD';
      case 'growth': return '#EDF9F8';
      case 'profit': return '#EDF8F1';
      case 'price': return '#EEF5FB';
      default: return '#F8FAFC';
    }
  }

  private resolveMetricIcon(metricType?: string): string {
    switch (metricType) {
      case 'revenue': return '/icons/revenue.svg';
      case 'quantity': return '/icons/quantity.svg';
      case 'average': return '/icons/average.svg';
      case 'max': return '/icons/max.svg';
      case 'min': return '/icons/min.svg';
      case 'discount': return '/icons/discount.svg';
      case 'profit': return '/icons/money-up.svg';
      case 'price': return '/icons/price.svg';
      case 'generic': return '/icons/Vector.svg'; 
      default: return '/icons/Vector.svg';
    }
  }
}