import { HttpClient } from '@angular/common/http';
import { Injectable, Service } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
     providedIn: 'root'
})
export class ExcelService {
   private apiUrl = 'http://127.0.0.1:8000/upload/';

   constructor(private http: HttpClient) {}

   uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<any>(this.apiUrl, formData);
  }
}
