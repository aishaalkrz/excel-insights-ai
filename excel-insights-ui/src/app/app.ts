import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from "./shared/components/toast/toast.component";
import { ToastService } from './shared/components/toast/toast.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('excel-insights-ui');
  private toast = inject(ToastService);

}
