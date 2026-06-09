import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AnalysisStateService {
  private analysisResult: any = null;

  setResult(result: any): void {
    this.analysisResult = result;
  }

  getResult(): any {
    return this.analysisResult;
  }

  clearResult(): void {
    this.analysisResult = null;
  }
}