import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  firstName = '';
  lastName = '';
  email = '';
  phone = '';
  password = '';
  showPass = signal(false);

  canSubmit(): boolean {
    return this.firstName.trim() !== '' && this.email.trim() !== '' && this.password.length >= 6;
  }

  async register() {
    if (!this.canSubmit()) {
      this.toast.error('Popunite sva obavezna polja');
      return;
    }

    const success = await this.auth.register({
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      password: this.password,
    });

    if (success) {
      this.router.navigate(['/home']);
    }
  }
}
