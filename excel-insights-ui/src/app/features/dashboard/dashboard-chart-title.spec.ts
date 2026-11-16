import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AnalysisResult } from '../../models/analysis-result.model';

describe('Dashboard chart title synchronization', () => {
  afterEach(() => vi.restoreAllMocks());

  function sheet(category: string, records = 3) {
    return {
      numeric_columns: ['Price', 'Quantity'], text_columns: [category], date_columns: [],
      columns: [category, 'Price', 'Quantity'], row_count: records, column_count: 3,
      field_metadata: [], chart_suggestions: [] as unknown[],
      records: Array.from({ length: records }, (_, i) => ({ [category]: `${category}-${i}`, Price: i + 1, Quantity: 2 * i })),
    };
  }

  async function create(currentSheet = sheet('Region')) {
    vi.spyOn(DashboardComponent.prototype, 'ngOnInit').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [DashboardComponent], providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.result = { filename: 'sales.xlsx', sheets: { First: currentSheet } } as unknown as AnalysisResult;
    component.currentSheet = currentSheet;
    component.selectedSheetName = 'First';
    (component as any).initializeChartBuilder();
    fixture.detectChanges();
    return { fixture, component };
  }

  // Components are OnPush by default in Angular 22; direct method calls do not
  // mark the view dirty the way template events do.
  function refresh(fixture: ComponentFixture<DashboardComponent>) {
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
  }

  function typeTitle(fixture: ComponentFixture<DashboardComponent>, value: string) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#chart-title-input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    return input;
  }

  const heading = (fixture: ComponentFixture<DashboardComponent>) => fixture.nativeElement.querySelector('.chart-preview-head h2').textContent.trim();

  it('generates a title from the selected axes and keeps input, heading and config in sync', async () => {
    const { fixture, component } = await create();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#chart-title-input');
    expect(component.chartTitle).toBe('Price حسب Region');
    expect(input.value).toBe('Price حسب Region');
    expect(heading(fixture)).toBe('Price حسب Region');
    expect(component.chartSuggestions[0].title).toBe('Price حسب Region');
    expect(fixture.nativeElement.querySelector('.title-mode')).not.toBeNull();
  });

  it('updates the automatic title when the chart type or axes change', async () => {
    const { fixture, component } = await create();
    component.onYAxisChange('Quantity');
    expect(component.chartSuggestions[0].title).toBe('Quantity حسب Region');
    component.onChartTypeChange('pie');
    expect(component.chartSuggestions[0].title).toBe('توزيع Quantity حسب Region');
    component.onChartTypeChange('scatter');
    expect(component.chartSuggestions[0].title).toBe('Quantity مقابل Price');
    refresh(fixture);
    expect(heading(fixture)).toBe('Quantity مقابل Price');
    expect(fixture.nativeElement.querySelector('#chart-title-input').value).toBe('Quantity مقابل Price');
  });

  it('preserves a manually edited title across type and axis changes', async () => {
    const { fixture, component } = await create();
    typeTitle(fixture, 'Regional pricing');
    expect(component.isChartTitleCustom).toBe(true);
    expect(component.chartSuggestions[0].title).toBe('Regional pricing');

    component.onChartTypeChange('dot');
    component.onYAxisChange('Quantity');
    refresh(fixture);
    expect(component.chartSuggestions[0].title).toBe('Regional pricing');
    expect(heading(fixture)).toBe('Regional pricing');
    expect(fixture.nativeElement.querySelector('#chart-title-input').value).toBe('Regional pricing');
  });

  it('returns to the automatic title through the reset action', async () => {
    const { fixture, component } = await create();
    typeTitle(fixture, 'Custom');
    component.onYAxisChange('Quantity');
    refresh(fixture);
    const reset: HTMLButtonElement = fixture.nativeElement.querySelector('.title-reset');
    expect(reset).not.toBeNull();
    reset.click();
    fixture.detectChanges();
    expect(component.isChartTitleCustom).toBe(false);
    expect(component.chartSuggestions[0].title).toBe('Quantity حسب Region');
    expect(fixture.nativeElement.querySelector('#chart-title-input').value).toBe('Quantity حسب Region');
    expect(fixture.nativeElement.querySelector('.title-reset')).toBeNull();
  });

  it('treats a cleared input as automatic and refills it on blur', async () => {
    const { fixture, component } = await create();
    typeTitle(fixture, 'Custom');
    const input = typeTitle(fixture, '   ');
    expect(component.isChartTitleCustom).toBe(false);
    expect(component.chartSuggestions[0].title).toBe('Price حسب Region');
    expect(heading(fixture)).toBe('Price حسب Region');
    input.dispatchEvent(new Event('blur'));
    refresh(fixture);
    expect(input.value).toBe('Price حسب Region');
  });

  it('switches sheets to the new sheet\'s automatic title and full records', async () => {
    const { fixture, component } = await create();
    typeTitle(fixture, 'First sheet title');
    const second = sheet('City', 5);
    (component.result as any).sheets.Second = second;
    component.onSheetChange('Second');
    refresh(fixture);
    expect(component.isChartTitleCustom).toBe(false);
    expect(component.chartSuggestions[0].title).toBe('Price حسب City');
    expect(component.chartSuggestions[0].data).toBe(second.records);
    expect(heading(fixture)).toBe('Price حسب City');
    component.onSheetChange('First');
    expect(component.chartSuggestions[0].title).toBe('Price حسب Region');
  });

  it('keeps a backend suggestion title only while its type and axes are unchanged', async () => {
    const data = sheet('Region');
    data.chart_suggestions = [{ title: 'Sales by region', type: 'bar', xKey: 'Region', yKey: 'Price', data: [] }];
    const { component } = await create(data);
    expect(component.chartSuggestions[0].title).toBe('Sales by region');
    component.onYAxisChange('Quantity');
    expect(component.chartSuggestions[0].title).toBe('Quantity حسب Region');
    component.onYAxisChange('Price');
    expect(component.chartSuggestions[0].title).toBe('Sales by region');
  });

  it('expands the preview for export and excludes interactive toggles', async () => {
    const { fixture, component } = await create();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    const card: HTMLElement = fixture.nativeElement.querySelector('.chart-preview-card');
    component.exportChart();
    refresh(fixture);
    expect(card.classList).toContain('is-exporting');
    expect(fixture.nativeElement.querySelector('.export-chart-btn').disabled).toBe(true);

    const filter = (component as any).exportFilter as (node: HTMLElement) => boolean;
    const toggle = document.createElement('button');
    toggle.className = 'legend-more export-exclude';
    expect(filter(toggle)).toBe(false);
    expect(filter(card)).toBe(true);
    expect(filter(document.createTextNode('text') as unknown as HTMLElement)).toBe(true);
  });
});
