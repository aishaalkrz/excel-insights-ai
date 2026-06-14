import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ExcelService {

  private prodUrl = 'https://excel-insights-ai-production.up.railway.app';
  private localUrl = 'http://127.0.0.1:8000';

  private apiUrl: string;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {

    if (isPlatformBrowser(this.platformId)) {
      this.apiUrl =
        window.location.hostname === 'localhost'
          ? this.localUrl
          : this.prodUrl;
    } else {
      this.apiUrl = this.prodUrl;
    }
  }

  uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post(`${this.apiUrl}/upload/`, formData);
  }
}