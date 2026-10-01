import {
  Component,
  ElementRef,
  HostListener,
  computed,
  forwardRef,
  input,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface SelectOption {
  value: any;
  label: string;
  icon?: string;
  sub?: string;
}

@Component({
  selector: 'app-custom-select',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CustomSelectComponent),
      multi: true
    }
  ],
  templateUrl: './custom-select.component.html',
  styleUrls: ['./custom-select.component.css']
})
export class CustomSelectComponent implements ControlValueAccessor {
  options = input<any[]>([]);
  placeholder = input<string>('Select an option');
  size = input<'sm' | 'md'>('sm');
  disabled = input<boolean>(false);
  customClass = input<string>('');

  isOpen = signal<boolean>(false);
  openUpward = signal<boolean>(false);
  currentValue = signal<any>(null);

  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private elementRef: ElementRef) {}

  normalizedOptions = computed<SelectOption[]>(() => {
    const raw = this.options() || [];
    return raw.map(item => {
      if (item !== null && typeof item === 'object' && 'value' in item) {
        return {
          value: item.value,
          label: item.label ?? String(item.value),
          icon: item.icon,
          sub: item.sub
        };
      }
      return {
        value: item,
        label: this.formatLabel(item)
      };
    });
  });

  selectedOption = computed<SelectOption | null>(() => {
    const val = this.currentValue();
    const opts = this.normalizedOptions();
    const found = opts.find(o => String(o.value) === String(val));
    return found || (val != null ? { value: val, label: this.formatLabel(val) } : null);
  });

  hasSelection = computed<boolean>(() => {
    return this.currentValue() != null && this.currentValue() !== '';
  });

  private formatLabel(val: any): string {
    if (val == null) return '';
    const str = String(val);
    if (!str) return '';
    // Format camelCase or kebab-case or plain string to readable label
    return str
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  toggleOpen(event: MouseEvent) {
    if (this.disabled()) return;
    event.stopPropagation();
    event.preventDefault();

    if (!this.isOpen()) {
      // Check available space below
      const triggerEl = this.elementRef.nativeElement.querySelector('.custom-select-trigger');
      if (triggerEl) {
        const rect = triggerEl.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        this.openUpward.set(spaceBelow < 220 && rect.top > 220);
      }
      this.isOpen.set(true);
    } else {
      this.close();
    }
  }

  selectOption(opt: SelectOption, event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.currentValue.set(opt.value);
    this.onChange(opt.value);
    this.onTouched();
    this.close();
  }

  isSelected(opt: SelectOption): boolean {
    return String(opt.value) === String(this.currentValue());
  }

  close() {
    this.isOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.close();
    }
  }

  @HostListener('keydown.escape')
  onEscape() {
    this.close();
  }

  @HostListener('keydown.arrowdown', ['$event'])
  onArrowDown(event: Event) {
    if (!this.isOpen()) {
      this.isOpen.set(true);
      event.preventDefault();
      return;
    }
    const opts = this.normalizedOptions();
    if (!opts.length) return;
    const curIdx = opts.findIndex(o => String(o.value) === String(this.currentValue()));
    const nextIdx = curIdx < opts.length - 1 ? curIdx + 1 : 0;
    this.currentValue.set(opts[nextIdx].value);
    this.onChange(opts[nextIdx].value);
    event.preventDefault();
  }

  @HostListener('keydown.arrowup', ['$event'])
  onArrowUp(event: Event) {
    if (!this.isOpen()) {
      this.isOpen.set(true);
      event.preventDefault();
      return;
    }
    const opts = this.normalizedOptions();
    if (!opts.length) return;
    const curIdx = opts.findIndex(o => String(o.value) === String(this.currentValue()));
    const prevIdx = curIdx > 0 ? curIdx - 1 : opts.length - 1;
    this.currentValue.set(opts[prevIdx].value);
    this.onChange(opts[prevIdx].value);
    event.preventDefault();
  }

  @HostListener('keydown.enter', ['$event'])
  onEnter(event: Event) {
    if (this.isOpen()) {
      this.close();
      event.preventDefault();
    }
  }

  // ControlValueAccessor methods
  writeValue(value: any): void {
    this.currentValue.set(value);
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    // handled via disabled input
  }
}
