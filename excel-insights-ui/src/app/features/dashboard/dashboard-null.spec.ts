import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AnalysisResult } from '../../models/analysis-result.model';

describe('Dashboard nullable KPI rendering', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders unavailable values as a dash while retaining zero and valid numbers', async () => {
    vi.spyOn(DashboardComponent.prototype, 'ngOnInit').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [DashboardComponent], providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.result = {} as AnalysisResult;
    component.currentSheet = { columns: [], records: [], row_count: 0, column_count: 0 };
    component.bigNumbers = [null, 0, -5, 42].map((value, index) => ({
      label: `KPI ${index}`, value, description: '', metricType: 'generic',
      icon: '', color: '', background: '',
    }));
    fixture.detectChanges();
    const values = [...fixture.nativeElement.querySelectorAll('.big-number-card strong')]
      .map((el: any) => el.textContent.trim());
    expect(values).toEqual(['—', '0', '-5', '42']);
  });

  it('displays calculated KPIs when AI is unavailable', async () => {
    vi.spyOn(DashboardComponent.prototype, 'ngOnInit').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [DashboardComponent], providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.result = {} as AnalysisResult;
    component.currentSheet = {
      columns: [], records: [], row_count: 0, column_count: 0,
      ai_insights: { status: 'unavailable', smart_insights: null },
      numeric_kpis: { price: { sum: 0, average: -2.5, max: 10, min: null } },
    };
    (component as any).buildBigNumbers();
    fixture.detectChanges();
    const values = [...fixture.nativeElement.querySelectorAll('.big-number-card strong')]
      .map((el: any) => el.textContent.trim());
    expect(values).toEqual(['0', '-2.5', '10', '—']);
    expect(fixture.nativeElement.querySelector('.ai-insights')).toBeNull();
  });
});
