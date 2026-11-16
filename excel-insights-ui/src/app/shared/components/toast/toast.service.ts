import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  message: string;
  type: 'success' | 'error' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  toast = signal<ToastMessage | null>(null);
  
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTime: number = 0;
  private remainingTime: number = 4000; // مدة التوست الافتراضية (4 ثواني)
  private readonly defaultDuration = 4000;

  success(message: string) {
    this.show(message, 'success');
  }

  error(message: string) {
    this.show(message, 'error');
  }

  info(message: string) {
    this.show(message, 'info');
  }

  private show(message: string, type: ToastMessage['type']) {
    this.clearTimer(); // تنظيف أي مؤقت سابق
    this.toast.set({ message, type });
    this.remainingTime = this.defaultDuration; // إعادة ضبط الوقت
    this.startTimer();
  }

  // 1. دالة لإغلاق التوست يدوياً (لزر الإغلاق)
  clear() {
    this.clearTimer();
    this.toast.set(null);
  }

  // 2. دالة لإيقاف المؤقت عند تمرير الماوس
  pauseTimer() {
    this.clearTimer();
    const timePassed = Date.now() - this.startTime;
    this.remainingTime = Math.max(0, this.remainingTime - timePassed);
  }

  // 3. دالة لاستئناف المؤقت عند إبعاد الماوس
  resumeTimer() {
    if (this.toast() !== null) {
      this.startTimer();
    }
  }

  private startTimer() {
    this.startTime = Date.now();
    this.timer = setTimeout(() => {
      this.clear();
    }, this.remainingTime);
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}