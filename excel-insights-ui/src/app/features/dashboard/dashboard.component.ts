import { Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';

import { AnalysisStateService } from '../../services/analysis-state.service';
import { AnalysisResult } from '../../models/analysis-result.model';
import { SmartChartComponent } from '../../shared/components/smart-chart/smart-chart.component';
import { DropdownComponent } from '../../shared/components/dropdown/dropdown.component';

import { ChartConfig, ChartType } from '../../shared/models/chart-config.model';
import { DropdownConfig } from '../../shared/components/dropdown/dropdown.model';
import { DataTableModalComponent } from '../../shared/components/model/data-table-modal.component';
import { FormsModule } from '@angular/forms';
import * as htmlToImage from 'html-to-image';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf'
import { ToastService } from '../../shared/components/toast/toast.service';

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

// KPI accents follow what a metric measures, so a card keeps its colour when
// the set or order of cards changes: outcome totals are green, descriptive
// statistics and unclassified metrics slate.
const METRIC_TONES: Record<MetricType, 'primary' | 'secondary'> = {
  revenue: 'primary',
  profit: 'primary',
  growth: 'primary',
  quantity: 'primary',
  count: 'primary',
  average: 'secondary',
  max: 'secondary',
  min: 'secondary',
  discount: 'secondary',
  price: 'secondary',
  generic: 'secondary',
};

// Fallback cards are typed `generic` (sum) or by statistic; the statistic
// decides their tone so the total stands out from the descriptive values.
type KpiStatistic = 'sum' | 'average' | 'max' | 'min';

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
  private toast = inject(ToastService);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  result: AnalysisResult | null = null;

  selectedSheetName = '';
  currentSheet: any = null;

  chartSuggestions: ChartConfig[] = [];
  smartInsights: any = null;
  uploadedAgo = '';
  // Text shown in the title input. While `isChartTitleCustom` is false it
  // follows `autoChartTitle`; a manual edit keeps it until reset.
  chartTitle = '';
  isChartTitleCustom = false;
  private suggestedTitle: Pick<ChartConfig, 'type' | 'xKey' | 'yKey' | 'title'> | null = null;

  isTableModalOpen = false;
  readonly isExportingChart = signal(false);
  readonly isExportingPdf = signal(false);

  chartTypeDropdown: DropdownConfig<ChartType> = {
    label: 'نوع الرسم',
    selectedValue: 'bar',
    grouped: false,
    showIcons: true,
    options: [
      { label: 'Bar', value: 'bar', icon: '/charts/bar.svg' },
      { label: 'Line', value: 'line', icon: '/charts/line.svg' },
      { label: 'Dot', value: 'dot', icon: '/charts/dot.svg' },
      { label: 'Scatter', value: 'scatter', icon: '/charts/dot.svg' },
      { label: 'Pie', value: 'pie', icon: '/charts/pie.svg' },
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
    hideLabel: true,
    selectedValue: '',
    grouped: false,
    showIcons: false,
    options: [],
  };

  bigNumbers: {
    label: string;
    value: string | number | null;
    description: string;
    metricType: MetricType;
    icon: string;
    statistic?: KpiStatistic;
  }[] = [];

  ngOnInit(): void {
    if (!this.isBrowser) return;

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

  kpiTone(kpi: { metricType: MetricType; statistic?: KpiStatistic }): 'primary' | 'secondary' {
    if (kpi.statistic) return kpi.statistic === 'sum' ? 'primary' : 'secondary';
    return METRIC_TONES[kpi.metricType] ?? 'secondary';
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
    if (!this.isBrowser) return;
    
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
    this.chartSuggestions = [];
    this.chartTitle = '';
    this.isChartTitleCustom = false;
    this.suggestedTitle = null;
    this.chartTypeDropdown = { ...this.chartTypeDropdown, selectedValue: 'bar' };
    this.xAxisDropdown = { ...this.xAxisDropdown, options: [], selectedValue: '' };
    this.yAxisDropdown = { ...this.yAxisDropdown, options: [], selectedValue: '' };
    if (!this.currentSheet) return;

    const suggestedChart = this.currentSheet.chart_suggestions?.[0];

    const { numericCols, measureCols, xCols, defaultXKey } = this.getAxisColumns();

    this.xAxisDropdown = {
      ...this.xAxisDropdown,
      options: this.toXAxisOptions(suggestedChart?.type === 'scatter' ? numericCols : xCols),
      selectedValue: suggestedChart?.xKey ?? defaultXKey,
    };

    this.yAxisDropdown = {
      ...this.yAxisDropdown,
      options: numericCols.map((col: string) => ({
        label: col,
        value: col,
        dataType: 'number' as const,
      })),
      selectedValue: suggestedChart?.yKey ?? measureCols[0] ?? '',
    };

    if (suggestedChart) {
      this.suggestedTitle = suggestedChart.title?.trim() ? suggestedChart : null;
      this.chartTypeDropdown = {
        ...this.chartTypeDropdown,
        selectedValue: suggestedChart.type,
      };
      this.syncAutoChartTitle();

      this.chartSuggestions = [
        {
          ...suggestedChart,
          title: this.effectiveChartTitle,
          showLegend: true,
          data: this.currentSheet.records || [],
          isSampled: false,
          sourceRecordCount: this.currentSheet.records?.length ?? 0,
        },
      ];

      return;
    }

    this.buildChartFromSelection();
  }

  /**
   * Title derived from the current chart type and X/Y selection. The backend
   * suggestion's own title is used only while its exact type and axes remain.
   */
  get autoChartTitle(): string {
    const type = this.chartTypeDropdown.selectedValue;
    const xKey = this.xAxisDropdown.selectedValue;
    const yKey = this.yAxisDropdown.selectedValue;
    if (!xKey || !yKey) return '';

    const suggestion = this.suggestedTitle;
    if (suggestion && suggestion.type === type && suggestion.xKey === xKey && suggestion.yKey === yKey) {
      return suggestion.title;
    }

    switch (type) {
      case 'pie': return `توزيع ${yKey} حسب ${xKey}`;
      case 'scatter': return `${yKey} مقابل ${xKey}`;
      default: return `${yKey} حسب ${xKey}`;
    }
  }

  /** The title used by the preview heading, the chart config, and exports. */
  get effectiveChartTitle(): string {
    return this.isChartTitleCustom ? this.chartTitle.trim() : this.autoChartTitle;
  }

  private syncAutoChartTitle(): void {
    if (!this.isChartTitleCustom) this.chartTitle = this.autoChartTitle;
  }

  private applyChartTitle(): void {
    const chart = this.chartSuggestions[0];
    const title = this.effectiveChartTitle;
    if (chart && chart.title !== title) this.chartSuggestions = [{ ...chart, title }];
  }

  private getAxisColumns() {
    const numericCols: string[] = this.currentSheet?.numeric_columns ?? [];
    const identifierColumns = new Set(
      (this.currentSheet?.field_metadata ?? [])
        .filter((field: AnalysisResult['field_metadata'][number]) => field.is_identifier === true)
        .map((field: AnalysisResult['field_metadata'][number]) => field.name)
    );
    const measureCols = numericCols.filter((col: string) => !identifierColumns.has(col));
    const xCols: string[] = [
      ...(this.currentSheet?.text_columns ?? []),
      ...(this.currentSheet?.date_columns ?? []),
      ...numericCols,
    ];
    const defaultXKey = xCols.find((col: string) => !identifierColumns.has(col)) ?? '';

    return { numericCols, measureCols, xCols, defaultXKey };
  }

  private toXAxisOptions(cols: string[]): DropdownConfig<string>['options'] {
    return cols.map((col: string) => ({
      label: col,
      value: col,
      dataType: this.currentSheet.date_columns?.includes(col)
        ? 'date'
        : this.currentSheet.numeric_columns?.includes(col)
          ? 'number'
          : 'text',
    }));
  }

  // Scatter plots one numeric value against another: restrict X to numeric
  // columns, keep valid numeric selections, and fill gaps with distinct measures.
  private applyScatterAxes(): void {
    const { numericCols, measureCols } = this.getAxisColumns();
    const isNumeric = (col?: string) => !!col && numericCols.includes(col);
    const pickMeasure = (exclude: string) => measureCols.find(col => col !== exclude) ?? '';

    const currentY = this.yAxisDropdown.selectedValue;
    const currentX = this.xAxisDropdown.selectedValue;
    let yKey = isNumeric(currentY) ? currentY! : '';
    let xKey = isNumeric(currentX) && currentX !== yKey ? currentX! : '';
    if (!yKey) yKey = pickMeasure(xKey);
    if (!xKey) xKey = pickMeasure(yKey);

    this.xAxisDropdown = {
      ...this.xAxisDropdown,
      options: this.toXAxisOptions(numericCols),
      selectedValue: xKey,
    };
    this.yAxisDropdown = { ...this.yAxisDropdown, selectedValue: yKey };
  }

  private restoreCategoryAxes(): void {
    const { measureCols, xCols, defaultXKey } = this.getAxisColumns();
    const currentX = this.xAxisDropdown.selectedValue;

    this.xAxisDropdown = {
      ...this.xAxisDropdown,
      options: this.toXAxisOptions(xCols),
      selectedValue: currentX && xCols.includes(currentX) ? currentX : defaultXKey,
    };
    if (!this.yAxisDropdown.selectedValue) {
      this.yAxisDropdown = { ...this.yAxisDropdown, selectedValue: measureCols[0] ?? '' };
    }
  }

  private buildChartFromSelection(): void {
    this.chartSuggestions = [];
    this.syncAutoChartTitle();
    if (!this.currentSheet?.records?.length) return;

    const type = this.chartTypeDropdown.selectedValue as ChartType;
    const xKey = this.xAxisDropdown.selectedValue;
    const yKey = this.yAxisDropdown.selectedValue;

    if (!type || !xKey || !yKey) return;
    if (type === 'scatter' && !(
      this.currentSheet.numeric_columns?.includes(xKey) &&
      this.currentSheet.numeric_columns?.includes(yKey)
    )) return;

    const chartData = this.currentSheet.records;

    this.chartSuggestions = [
      {
        id: `custom_${this.selectedSheetName}`,
        sheetName: this.selectedSheetName,
        title: this.effectiveChartTitle,
        type,
        xKey,
        yKey,
        categoryKey: xKey,
        valueKey: yKey,
        xAxisLabel: xKey,
        yAxisLabel: yKey,
        xScale: type === 'scatter'
          ? 'number'
          : this.currentSheet.date_columns?.includes(xKey)
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
    const previousType = this.chartTypeDropdown.selectedValue;
    this.chartTypeDropdown = {
      ...this.chartTypeDropdown,
      selectedValue: value,
    };

    if (value === 'scatter') {
      this.applyScatterAxes();
    } else if (previousType === 'scatter') {
      this.restoreCategoryAxes();
    }

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

  // An empty input (or one matching the automatic title) returns to automatic
  // mode; the input is refilled when it loses focus so typing is not disrupted.
  onChartTitleChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.chartTitle = value;
    this.isChartTitleCustom = value.trim() !== '' && value.trim() !== this.autoChartTitle;
    this.applyChartTitle();
  }

  onChartTitleBlur(): void {
    this.syncAutoChartTitle();
  }

  resetChartTitle(): void {
    this.isChartTitleCustom = false;
    this.syncAutoChartTitle();
    this.applyChartTitle();
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
          this.createKpiCard(`إجمالي ${column}`, kpi.sum, 'مجموع القيم', 'generic', 'sum'),
          this.createKpiCard(`متوسط ${column}`, kpi.average, 'متوسط القيم', 'average', 'average'),
          this.createKpiCard(`أعلى ${column}`, kpi.max, 'أعلى قيمة', 'max', 'max'),
          this.createKpiCard(`أقل ${column}`, kpi.min, 'أقل قيمة', 'min', 'min'),
        ])
        .slice(0, 4);
    } catch (error) {
      console.error('Failed to parse AI insights. Using fallback logic.', error);
    }
  }

  private createKpiCard(
    label: string,
    value: string | number | null,
    description: string,
    metricType: MetricType,
    statistic?: KpiStatistic
  ) {
    return {
      label,
      value,
      description,
      metricType,
      icon: this.resolveMetricIcon(metricType),
      statistic,
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

  // `is-exporting` expands the legend and data notice so the image is complete;
  // interactive toggles are marked `export-exclude` and left out of the image.
  private readonly exportFilter = (node: HTMLElement) =>
    !(node.classList?.contains('export-exclude'));

  // Read from the design tokens so the PDF matches the page background.
  private pageBackground(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--background').trim() || '#FFFFFF';
  }

  exportChart(): void {
    if (this.isExportingChart()) return;
    const chartElement = document.querySelector('.chart-preview-card');

    if (!(chartElement instanceof HTMLElement)) {
      this.toast.error('لم يتم العثور على الرسم');
      return;
    }

    this.isExportingChart.set(true);
    chartElement.classList.add('is-exporting');

    requestAnimationFrame(() => {
      const width = chartElement.offsetWidth;
      const height = chartElement.offsetHeight;

      htmlToImage.toPng(chartElement, {
        width,
        height,
        style: {
          backgroundColor: '#fff'
        },
        pixelRatio: 2,
        filter: this.exportFilter,
      })
      .then((dataUrl) => {
        saveAs(dataUrl, 'basira-chart.png');

        this.toast.success('تم تصدير الرسم بنجاح');
      })
      .catch((error) => {
        console.error('Error exporting chart:', error);

        this.toast.error('فشل تصدير الرسم');
      })
      .finally(() => {
        chartElement.classList.remove('is-exporting');
        this.isExportingChart.set(false);
      });
    });
  }
  exportDashboardPdf() {
    if (this.isExportingPdf()) return;
    const dashboardElement = document.getElementById('dashboard-export');

    if (!(dashboardElement instanceof HTMLElement)) return;

    this.isExportingPdf.set(true);
    dashboardElement.classList.add('pdf-mode', 'is-exporting');
    const finish = () => {
      dashboardElement.classList.remove('pdf-mode', 'is-exporting');
      this.isExportingPdf.set(false);
    };

    setTimeout(() => {
      htmlToImage.toPng(dashboardElement, {
        backgroundColor: this.pageBackground(),
        pixelRatio: 2,
        cacheBust: true,
        filter: this.exportFilter,
      })
      .then((dataUrl) => {
        const pdf = new jsPDF('p', 'mm', 'a4');

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        const margin = 6;
        const img = new Image();
        img.src = dataUrl;

        img.onload = () => {
          const availableWidth = pageWidth - margin * 2;
          const availableHeight = pageHeight - margin * 2;

          const widthRatio = availableWidth / img.width;
          const heightRatio = availableHeight / img.height;

          const ratio = Math.min(widthRatio, heightRatio);

          const renderWidth = img.width * ratio;
          const renderHeight = img.height * ratio;

          const x = (pageWidth - renderWidth) / 2;
          const y = margin;

          pdf.addImage(dataUrl, 'PNG', x, y, renderWidth, renderHeight);
          pdf.save('basira-report.pdf');
          this.toast.success('تم تصدير التقرير بنجاح');

          finish();
        };
        img.onerror = () => {
          finish();
          this.toast.error('فشل تصدير التقرير');
        };
      })
      .catch((error) => {
        finish();
        console.error('Error exporting dashboard PDF:', error);
        this.toast.error('فشل تصدير التقرير');
      });
    }, 600);
  }
}
