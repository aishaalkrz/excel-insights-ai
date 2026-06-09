import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AnalysisStateService } from '../../services/analysis-state.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dashboard.component',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  standalone: true,
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  result: any = null;

  private analysisState = inject(AnalysisStateService);
  private router = inject(Router);

  ngOnInit(): void {
    this.result = this.analysisState.getResult();

    if (!this.result) {
      this.router.navigate(['/']);
    }
  }

  getKpiKeys(): string[] {
    return this.result?.numeric_kpis
      ? Object.keys(this.result.numeric_kpis)
      : [];
  }

  getSampleColumns(): string[] {
    return this.result?.sample_data?.length
      ? Object.keys(this.result.sample_data[0])
      : [];
  }

  goBack(): void {
    this.analysisState.clearResult();
    this.router.navigate(['/']);
  }
}