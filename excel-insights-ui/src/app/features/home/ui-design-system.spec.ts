import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeComponent } from './home.component';
import { FeaturesComponent } from './features/features.component';
import { HowItWorksComponent } from './how-it-works/how-it-works.component';
import { PricingComponent } from './pricing/pricing.component';
import { DashboardComponent } from '../dashboard/dashboard.component';
import { NavbarComponent } from '../../shared/components/navbar/navbar.component';
import { DataTableModalComponent } from '../../shared/components/model/data-table-modal.component';
import { ExcelService } from '../../services/excel.service';
import { AnalysisStateService } from '../../services/analysis-state.service';
import { AnalysisResult } from '../../models/analysis-result.model';

describe('Shared UI design system interactions', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('keeps upload selection, loading feedback and successful navigation working', async () => {
    const response = new Subject<AnalysisResult>();
    const uploadFile = vi.fn(() => response.asObservable());
    await TestBed.configureTestingModule({ imports: [HomeComponent], providers: [
      provideRouter([]), { provide: ExcelService, useValue: { uploadFile } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(HomeComponent);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const save = vi.spyOn(TestBed.inject(AnalysisStateService), 'setResult');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type=file]');
    const file = new File(['mock'], 'بيانات.xlsx');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.upload-btn').textContent).toContain(file.name);
    fixture.nativeElement.querySelector('.analyze-outline').click();
    fixture.detectChanges();
    expect(uploadFile).toHaveBeenCalledWith(file);
    expect(fixture.nativeElement.querySelector('.hero-actions').getAttribute('aria-busy')).toBe('true');
    expect(fixture.nativeElement.querySelector('[role=status]')).not.toBeNull();
    const result = { filename: file.name } as AnalysisResult;
    response.next(result); response.complete();
    fixture.detectChanges();
    expect(save).toHaveBeenCalledWith(result);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(fixture.componentInstance.loading).toBe(false);
  });

  it('announces upload errors and re-enables the controls', async () => {
    const response = new Subject<AnalysisResult>();
    await TestBed.configureTestingModule({ imports: [HomeComponent], providers: [
      provideRouter([]), { provide: ExcelService, useValue: { uploadFile: () => response } },
    ] }).compileComponents();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.componentInstance.selectedFile = new File(['mock'], 'data.xlsx');
    fixture.componentInstance.analyzeData();
    response.error(new Error('mock unavailable'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('حدث خطأ');
    expect(fixture.nativeElement.querySelector('.upload-btn').disabled).toBe(false);
  });

  it('exposes mobile navigation state and keeps closed links out of keyboard navigation', async () => {
    await TestBed.configureTestingModule({ imports: [NavbarComponent], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(NavbarComponent); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.mobile-menu')?.hasAttribute('inert')).toBe(true);
    (root.querySelector('.menu-btn') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(root.querySelector('.menu-btn')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.mobile-menu')?.hasAttribute('inert')).toBe(false);
    (root.querySelector('.close-menu') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(root.querySelector('.mobile-menu')?.hasAttribute('inert')).toBe(true);
  });

  it('preserves modal pagination and sheet selection', async () => {
    await TestBed.configureTestingModule({ imports: [DataTableModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(DataTableModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('availableSheets', ['First', 'Second']);
    fixture.componentRef.setInput('activeSheet', 'First');
    fixture.componentRef.setInput('columns', ['Price']);
    fixture.componentRef.setInput('records', Array.from({length: 15}, (_, Price) => ({Price})));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="التالي"]').click(); fixture.detectChanges();
    expect(fixture.componentInstance.pageStart).toBe(11);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(5);
    const changed = vi.spyOn(fixture.componentInstance.sheetChange, 'emit');
    fixture.nativeElement.querySelectorAll('.sheet-tabs button')[1].click();
    expect(changed).toHaveBeenCalledWith('Second');
  });

  it('keeps KPI accents stable when cards change order, without changing their values', async () => {
    vi.spyOn(DashboardComponent.prototype, 'ngOnInit').mockImplementation(() => {});
    await TestBed.configureTestingModule({ imports: [DashboardComponent], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    component.result = {} as AnalysisResult;
    component.currentSheet = {columns: [], records: [], row_count: 0, column_count: 0};
    component.bigNumbers = ['revenue', 'average', 'profit', 'generic'].map((metricType, i) => ({
      label: metricType, value: i === 0 ? 0 : -i, description: '', metricType: metricType as any, icon: '',
    }));
    fixture.detectChanges();
    const tones = (root: HTMLElement) => Object.fromEntries([...root.querySelectorAll('.big-number-card')].map((el: any) => [
      el.querySelector('.kpi-label').textContent.trim(), el.classList.contains('kpi--secondary'),
    ]));
    expect(tones(fixture.nativeElement)).toEqual({ revenue: false, average: true, profit: false, generic: true });
    const reordered = TestBed.createComponent(DashboardComponent);
    reordered.componentInstance.result = component.result;
    reordered.componentInstance.currentSheet = component.currentSheet;
    reordered.componentInstance.bigNumbers = [...component.bigNumbers].reverse();
    reordered.detectChanges();
    expect(tones(reordered.nativeElement)).toEqual({ revenue: false, average: true, profit: false, generic: true });
    expect(reordered.nativeElement.querySelectorAll('.big-number-card strong')[3].textContent.trim()).toBe('0');
  });

  for (const page of [FeaturesComponent, HowItWorksComponent, PricingComponent]) {
    it(`renders ${page.name} with its existing Arabic content`, async () => {
      await TestBed.configureTestingModule({ imports: [page] }).compileComponents();
      const fixture = TestBed.createComponent(page); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h1').textContent.trim().length).toBeGreaterThan(10);
      expect(fixture.nativeElement.querySelector('[dir=rtl]')).not.toBeNull();
    });
  }
});
