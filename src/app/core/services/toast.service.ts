import { Injectable, signal } from '@angular/core';

export interface Toast {
  message: string;
  type: 'success' | 'error';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toast = signal<Toast | null>(null);

  private timeout: ReturnType<typeof setTimeout> | null = null;

  show(message: string, type: 'success' | 'error' = 'success') {
    if (this.timeout) clearTimeout(this.timeout);

    this.toast.set({ message, type });

    this.timeout = setTimeout(() => {
      this.toast.set(null);
      this.timeout = null;
    }, 3500);
  }

  success(message: string) {
    this.show(message, 'success');
  }

  error(message: string) {
    this.show(message, 'error');
  }
}
