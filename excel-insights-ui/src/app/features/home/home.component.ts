import { Component, inject } from '@angular/core';
import { ExcelService } from '../../services/excel.service';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AnalysisStateService } from '../../services/analysis-state.service';

@Component({
  selector: 'app-home',
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  selectedFile: File | null = null;
  selectedFileName = '';
  loading = false;
  errorMessage = '';

  private excelService = inject(ExcelService);
  private analysisState = inject(AnalysisStateService);
  private router = inject(Router);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    this.selectedFile = input.files[0];
    this.selectedFileName = this.selectedFile.name;
    this.errorMessage = '';
  }

  analyzeData(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'يرجى رفع ملف Excel أو CSV أولاً.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    this.excelService.uploadFile(this.selectedFile).subscribe({
      next: (response) => {
        this.analysisState.setResult(response);
        localStorage.setItem('analysisResult', JSON.stringify(response));
        this.loading = false;
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        console.error(error);
        this.errorMessage = 'حدث خطأ أثناء تحليل الملف. يرجى المحاولة مرة أخرى.';
        this.loading = false;
      }
    });
  }
}