import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AnalysisResult } from '../../models/analysis-result.model';

type BuilderSheet = Pick<AnalysisResult,
  'numeric_columns' | 'text_columns' | 'date_columns' | 'columns' | 'row_count' |
  'column_count' | 'field_metadata' | 'records' | 'chart_suggestions'>;

describe('Dashboard identifier-aware chart initialization', () => {
  afterEach(() => vi.restoreAllMocks());

  function sheet(numericColumns: string[], identifiers: string[] = []): BuilderSheet {
    return {
      numeric_columns: numericColumns, text_columns: [], date_columns: [],
      columns: numericColumns, row_count: 2, column_count: numericColumns.length,
      field_metadata: numericColumns.map(name => ({
        name, type: 'number' as const,
        ...(identifiers.includes(name) ? { is_identifier: true } : {}),
      })),
      records: [
        Object.fromEntries(numericColumns.map((name, index) => [name, index + 1])),
        Object.fromEntries(numericColumns.map((name, index) => [name, index + 2])),
      ],
      chart_suggestions: [],
    };
  }

  async function create(currentSheet: ReturnType<typeof sheet>) {
    vi.spyOn(DashboardComponent.prototype, 'ngOnInit').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [DashboardComponent], providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.result = { filename: 'mock.xlsx' } as AnalysisResult;
    component.currentSheet = currentSheet;
    component.selectedSheetName = 'Sheet1';
    (component as any).initializeChartBuilder();
    return { fixture, component };
  }

  it('selects Price rather than Order ID as the automatic measure', async () => {
    const { component } = await create(sheet(['order_id', 'Price'], ['order_id']));
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(component.xAxisDropdown.selectedValue).toBe('Price');
    expect(component.chartSuggestions[0].yKey).toBe('Price');
    expect(component.yAxisDropdown.options.map(option => option.value)).toEqual(['order_id', 'Price']);
    expect(component.xAxisDropdown.options.map(option => option.value)).toEqual(['order_id', 'Price']);
  });

  it('leaves identifier-only data uninitialized and displays the empty state', async () => {
    const { fixture, component } = await create(sheet(['order_id', 'customer_id'], ['order_id', 'customer_id']));
    expect(component.yAxisDropdown.selectedValue).toBe('');
    expect(component.xAxisDropdown.selectedValue).toBe('');
    expect(component.chartSuggestions).toEqual([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-smart-chart')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-view [role="status"]').textContent)
      .toContain('لا توجد مقاييس رقمية');
  });

  it('uses Arabic identifier metadata without name-based frontend inference', async () => {
    const { component } = await create(sheet(['رقم الطلب', 'معرف العميل', 'السعر'], ['رقم الطلب', 'معرف العميل']));
    expect(component.yAxisDropdown.selectedValue).toBe('السعر');
    expect(component.chartSuggestions[0].yKey).toBe('السعر');
    expect(component.yAxisDropdown.options.map(option => option.value)).toContain('رقم الطلب');
  });

  it('preserves automatic defaults when optional identifier metadata is absent', async () => {
    const { component } = await create(sheet(['Price', 'Quantity']));
    expect(component.xAxisDropdown.selectedValue).toBe('Price');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(component.chartSuggestions[0].type).toBe('bar');
    expect(component.chartSuggestions[0].data).toEqual(component.currentSheet.records);
  });

  it('allows explicit manual ID selection, including identifier-only data', async () => {
    const { component } = await create(sheet(['order_id', 'customer_id'], ['order_id', 'customer_id']));
    component.onXAxisChange('customer_id');
    component.onYAxisChange('order_id');
    expect(component.chartSuggestions[0].xKey).toBe('customer_id');
    expect(component.chartSuggestions[0].yKey).toBe('order_id');
  });

  it('preserves a valid backend chart suggestion', async () => {
    const data: BuilderSheet = {
      ...sheet(['order_id', 'Price'], ['order_id']),
      text_columns: ['category'],
      chart_suggestions: [{ title: 'Backend title', type: 'pie', xKey: 'category', yKey: 'Price', data: [] }],
    };
    const { component } = await create(data);
    expect(component.chartTitle).toBe('Backend title');
    expect(component.chartTypeDropdown.selectedValue).toBe('pie');
    expect(component.xAxisDropdown.selectedValue).toBe('category');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(component.chartSuggestions[0].data).toEqual(data.records);
    expect(component.chartSuggestions[0].showLegend).toBe(true);
  });

  it('clears stale selections, type, title and preview when switching to a sheet without measures', async () => {
    const measures = sheet(['Price']);
    const ids = sheet(['order_id'], ['order_id']);
    const { component, fixture } = await create(measures);
    component.result = {
      filename: 'mock.xlsx', available_sheets: ['Measures', 'IDs'],
      sheets: { Measures: measures, IDs: ids },
    } as unknown as AnalysisResult;
    component.onChartTypeChange('pie');
    component.onChartTitleChange({ target: { value: 'Old title' } } as unknown as Event);
    expect(component.chartSuggestions).toHaveLength(1);
    component.onSheetChange('IDs');
    expect(component.chartSuggestions).toEqual([]);
    expect(component.chartTitle).toBe('');
    expect(component.chartTypeDropdown.selectedValue).toBe('bar');
    expect(component.xAxisDropdown.selectedValue).toBe('');
    expect(component.yAxisDropdown.selectedValue).toBe('');
    expect(component.yAxisDropdown.options.map(option => option.value)).toEqual(['order_id']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-view [role="status"]')).not.toBeNull();
    component.onSheetChange('Measures');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(component.chartSuggestions[0].id).toBe('custom_Measures');
    expect(component.chartSuggestions[0].title).not.toBe('Old title');
  });

  it('clears a stale preview if the new sheet has no records', async () => {
    const { component } = await create(sheet(['Price']));
    component.result = {
      sheets: { Empty: { ...sheet(['Quantity']), records: [] } },
    } as unknown as AnalysisResult;
    component.onSheetChange('Empty');
    expect(component.chartSuggestions).toEqual([]);
    expect(component.yAxisDropdown.selectedValue).toBe('Quantity');
  });
});
