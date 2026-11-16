import {
  Component, computed, ElementRef, HostListener,
  input, output, signal, ViewChild
} from '@angular/core';
import { DropdownConfig, DropdownOption } from './dropdown.model';

let nextDropdownId = 0;

@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [],
  templateUrl: './dropdown.component.html',
  styleUrl: './dropdown.component.scss',
})
export class DropdownComponent<T = string> {
  config = input.required<DropdownConfig<T>>();
  selectionChange = output<T>();

  @ViewChild('dropdownRef') dropdownRef!: ElementRef;
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;

  private readonly id = `app-dropdown-${nextDropdownId++}`;
  readonly labelId = `${this.id}-label`;
  readonly valueId = `${this.id}-value`;
  readonly listboxId = `${this.id}-listbox`;

  isOpen = signal(false);
  searchQuery = signal('');

  selectedLabel = computed(() => {
    const selected = this.config().options.find(
      o => o.value === this.config().selectedValue
    );
    return selected?.label ?? this.config().placeholder ?? '';
  });

  selectedOption = computed(() =>
    this.config().options.find(o => o.value === this.config().selectedValue)
  );
  
  filteredGroups = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const options = this.config().options;
    const grouped = this.config().grouped ?? false;

    const filtered = q
      ? options.filter(o => o.label.toLowerCase().includes(q))
      : options;

    if (!grouped) {
      return [{ type: 'other', label: '', options: filtered }];
    }

    const groups: { type: string; label: string; options: DropdownOption<T>[] }[] = [
      { type: 'text',   label: 'نص',    options: [] },
      { type: 'number', label: 'أرقام', options: [] },
      { type: 'date',   label: 'تاريخ', options: [] },
      { type: 'other',  label: 'أخرى',  options: [] },
    ];

    for (const opt of filtered) {
      const dataType = (opt as DropdownOption<T> & { dataType?: string }).dataType
        ?? detectType(String(opt.value));
      const group = groups.find(g => g.type === dataType) ?? groups[3];
      group.options.push(opt);
    }

    return groups.filter(g => g.options.length > 0);
  });

  toggleDropdown(): void {
    if (!this.config().disabled) {
      this.isOpen.update(v => !v);
      if (this.isOpen()) this.searchQuery.set('');
    }
  }

  selectOption(option: DropdownOption<T>): void {
    this.close(true);
    this.selectionChange.emit(option.value);
  }

  close(restoreFocus = false): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.searchQuery.set('');
    if (restoreFocus) this.trigger?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (!this.dropdownRef?.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  }
}

function detectType(value: string): string {
  if (!isNaN(Number(value)) && value.trim() !== '') return 'number';
  if (!isNaN(Date.parse(value)) && /\d{4}|\d{2}\/\d{2}/.test(value)) return 'date';
  return 'text';
}
