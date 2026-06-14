import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ExcelService {

  // Production API (Railway)
  private prodUrl = 'https://excel-insights-ai-production.up.railway.app';

  // Local API (for dev)
  private localUrl = 'http://127.0.0.1:8000';

  // Auto switch between local & production
  private apiUrl =
    window.location.hostname === 'localhost'
      ? this.localUrl
      : this.prodUrl;

  constructor(private http: HttpClient) {}

  // Upload Excel/CSV file
  uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<any>(
      `${this.apiUrl}/upload/`,
      formData
    );
  }

  healthCheck(): Observable<any> {
    return this.http.get(`${this.apiUrl}/`);
  }
}