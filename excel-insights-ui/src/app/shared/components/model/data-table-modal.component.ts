import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, signal, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-data-table-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './data-table-modal.component.html',
  styleUrl: './data-table-modal.component.scss',
})
export class DataTableModalComponent implements OnChanges, OnDestroy {

  @Input() isOpen = false;
  @Input() filename = '';
  @Input() activeSheet = '';
  @Input() availableSheets: string[] = [];
  @Input() columns: string[] = [];
  @Input() records: Record<string, any>[] = [];

  @Output() close = new EventEmitter<void>();
  @Output() sheetChange = new EventEmitter<string>();

  currentPage = signal(1);
  pageSize = signal(10);

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['isOpen']) {
        document.body.style.overflow = this.isOpen ? 'hidden' : '';
        }

        if (changes['activeSheet'] || changes['records']) {
        this.currentPage.set(1);
        }
    }

    ngOnDestroy(): void {
        document.body.style.overflow = '';
    }
    get pageStart(): number {
        if (!this.records.length) return 0;
        return (this.currentPage() - 1) * this.pageSize() + 1;
    }

    get pageEnd(): number {
        return Math.min(this.currentPage() * this.pageSize(), this.records.length);
    }

    firstPage(): void {
        this.currentPage.set(1);
    }

    lastPage(): void {
        this.currentPage.set(this.totalPages);
    }

    get totalPages(): number {
        return Math.max(1, Math.ceil(this.records.length / this.pageSize()));
    }

  get pagedRecords(): Record<string, any>[] {
    const start = (this.currentPage() - 1) * this.pageSize();
    const end = start + this.pageSize();

    return this.records.slice(start, end);
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  selectSheet(sheet: string): void {
    if (!sheet || sheet === this.activeSheet) return;

    this.currentPage.set(1);
    this.sheetChange.emit(sheet);
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages) {
      this.currentPage.update((page) => page + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update((page) => page - 1);
    }
  }

  changePageSize(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);

    this.pageSize.set(value);
    this.currentPage.set(1);
  }
}