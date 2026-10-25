import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AnalysisResult } from '../../models/analysis-result.model';

describe('Dashboard fallback KPI accents', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the fallback sum in green and its statistics in slate without changing values', async () => {
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
      numeric_kpis: { price: { sum: 120, average: 30, max: 50, min: 10 } },
    };
    (component as any).buildBigNumbers();
    fixture.detectChanges();

    const cards = [...fixture.nativeElement.querySelectorAll('.big-number-card')] as HTMLElement[];
    expect(cards.map(card => card.querySelector('strong')!.textContent!.trim())).toEqual(['120', '30', '50', '10']);
    expect(cards.map(card => card.classList.contains('kpi--secondary'))).toEqual([false, true, true, true]);
    expect(component.bigNumbers.map(kpi => kpi.metricType)).toEqual(['generic', 'average', 'max', 'min']);
  });
});
