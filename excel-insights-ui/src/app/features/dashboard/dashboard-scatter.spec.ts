import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AnalysisResult } from '../../models/analysis-result.model';

type BuilderSheet = Pick<AnalysisResult,
  'numeric_columns' | 'text_columns' | 'date_columns' | 'columns' | 'row_count' |
  'column_count' | 'field_metadata' | 'records' | 'chart_suggestions'>;

describe('Dashboard scatter chart selection', () => {
  afterEach(() => vi.restoreAllMocks());

  function sheet(numericColumns: string[], identifiers: string[] = [], textColumns = ['category']): BuilderSheet {
    const columns = [...textColumns, ...numericColumns];
    return {
      numeric_columns: numericColumns, text_columns: textColumns, date_columns: [],
      columns, row_count: 3, column_count: columns.length,
      field_metadata: [
        ...textColumns.map(name => ({ name, type: 'text' as const })),
        ...numericColumns.map(name => ({
          name, type: 'number' as const,
          ...(identifiers.includes(name) ? { is_identifier: true } : {}),
        })),
      ],
      records: [0, 1, 2].map(row => Object.fromEntries([
        ...textColumns.map(name => [name, `${name}-${row}`]),
        ...numericColumns.map((name, index) => [name, (index + 1) * (row + 1)]),
      ])),
      chart_suggestions: [],
    };
  }

  async function create(currentSheet: BuilderSheet) {
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

  const values = (options: { value: string }[]) => options.map(option => option.value);

  it('uses English chart type labels', async () => {
    const { component } = await create(sheet(['Price', 'Quantity']));
    expect(component.chartTypeDropdown.options.map(option => [option.label, option.value])).toEqual([
      ['Bar', 'bar'], ['Line', 'line'], ['Dot', 'dot'], ['Scatter', 'scatter'], ['Pie', 'pie'],
    ]);
  });

  it('replaces a text X axis with a second numeric measure and renders points', async () => {
    const { component, fixture } = await create(sheet(['Price', 'Quantity']));
    expect(component.xAxisDropdown.selectedValue).toBe('category');
    component.onChartTypeChange('scatter');
    expect(component.xAxisDropdown.selectedValue).toBe('Quantity');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(values(component.xAxisDropdown.options)).toEqual(['Price', 'Quantity']);
    expect(component.chartSuggestions[0]).toMatchObject({ type: 'scatter', xKey: 'Quantity', yKey: 'Price', xScale: 'number' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.scatter-point').length).toBe(3);
  });

  it('prefers non-identifier measures while keeping identifiers selectable', async () => {
    const { component } = await create(sheet(['order_id', 'Price', 'Quantity'], ['order_id']));
    component.onChartTypeChange('scatter');
    expect(component.xAxisDropdown.selectedValue).toBe('Quantity');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(values(component.xAxisDropdown.options)).toContain('order_id');
    component.onXAxisChange('order_id');
    expect(component.chartSuggestions[0]).toMatchObject({ xKey: 'order_id', yKey: 'Price' });
  });

  it('preserves valid existing numeric selections', async () => {
    const { component } = await create(sheet(['Price', 'Quantity', 'Discount']));
    component.onXAxisChange('Discount');
    component.onYAxisChange('Quantity');
    component.onChartTypeChange('scatter');
    expect(component.xAxisDropdown.selectedValue).toBe('Discount');
    expect(component.yAxisDropdown.selectedValue).toBe('Quantity');
    expect(component.chartSuggestions[0]).toMatchObject({ xKey: 'Discount', yKey: 'Quantity' });
  });

  it('replaces an X axis that duplicates the Y measure', async () => {
    const { component } = await create(sheet(['Price', 'Quantity'], [], []));
    expect(component.xAxisDropdown.selectedValue).toBe('Price');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    component.onChartTypeChange('scatter');
    expect(component.xAxisDropdown.selectedValue).toBe('Quantity');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
  });

  it('does not build a scatter chart from a non-numeric axis', async () => {
    const { component } = await create(sheet(['Price', 'Quantity']));
    component.onChartTypeChange('scatter');
    component.onXAxisChange('category');
    expect(component.chartSuggestions).toEqual([]);
  });

  it('shows instructions when fewer than two suitable numeric columns exist', async () => {
    const { component, fixture } = await create(sheet(['order_id', 'Price'], ['order_id']));
    component.onChartTypeChange('scatter');
    expect(component.xAxisDropdown.selectedValue).toBe('');
    expect(component.yAxisDropdown.selectedValue).toBe('Price');
    expect(values(component.xAxisDropdown.options)).toEqual(['order_id', 'Price']);
    expect(component.chartSuggestions).toEqual([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-smart-chart')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-view [role="status"]').textContent)
      .toContain('يتطلب رسم التشتت عمودين رقميين');
  });

  it('restores category axis options when switching back from scatter', async () => {
    const { component } = await create(sheet(['Price', 'Quantity']));
    component.onChartTypeChange('scatter');
    component.onChartTypeChange('bar');
    expect(values(component.xAxisDropdown.options)).toEqual(['category', 'Price', 'Quantity']);
    expect(component.xAxisDropdown.selectedValue).toBe('Quantity');
    expect(component.chartSuggestions[0]).toMatchObject({ type: 'bar', xKey: 'Quantity', yKey: 'Price' });
  });

  it.each(['bar', 'line', 'dot', 'pie'] as const)(
    'restores a default X axis for %s after an insufficient scatter selection',
    async type => {
      const { component } = await create(sheet(['Price']));
      component.onChartTypeChange('scatter');
      expect(component.xAxisDropdown.selectedValue).toBe('');
      component.onChartTypeChange(type);
      expect(values(component.xAxisDropdown.options)).toEqual(['category', 'Price']);
      expect(component.xAxisDropdown.selectedValue).toBe('category');
      expect(component.chartSuggestions[0]).toMatchObject({ type, xKey: 'category', yKey: 'Price' });
    }
  );

  it('restricts X options for a FastAPI scatter suggestion', async () => {
    const data: BuilderSheet = {
      ...sheet(['Price', 'Quantity']),
      chart_suggestions: [{
        id: 'Sales_chart_3', title: 'Quantity حسب Price', type: 'scatter',
        xKey: 'Price', yKey: 'Quantity', xScale: 'number', yScale: 'number', data: [],
      }],
    };
    const { component, fixture } = await create(data);
    expect(values(component.xAxisDropdown.options)).toEqual(['Price', 'Quantity']);
    expect(component.xAxisDropdown.selectedValue).toBe('Price');
    expect(component.yAxisDropdown.selectedValue).toBe('Quantity');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.scatter-point').length).toBe(3);
  });
});
