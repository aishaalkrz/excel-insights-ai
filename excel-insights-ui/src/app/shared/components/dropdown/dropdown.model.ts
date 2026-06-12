export interface DropdownOption<T = string> {
  label: string;
  value: T;
  icon?: string;
  dataType?: 'text' | 'number' | 'date' | 'other';
}

export interface DropdownConfig<T = string> {
  label: string;
  placeholder?: string;
  selectedValue?: T;
  disabled?: boolean;
  grouped?: boolean;
  showIcons?: boolean;
  options: DropdownOption<T>[];

  hideLabel?: boolean;
  placement?: 'bottom' | 'top';
}