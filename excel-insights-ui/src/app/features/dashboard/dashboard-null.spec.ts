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
});
