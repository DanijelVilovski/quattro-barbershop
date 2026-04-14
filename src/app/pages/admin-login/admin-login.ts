import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './admin-login.html',
  styleUrl: './admin-login.scss',
})
export class AdminLoginComponent {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  email = '';
  password = '';
  showPass = signal(false);

  async login() {
    if (!this.email || !this.password) {
      this.toast.error('Popunite sva polja');
      return;
    }

    const success = await this.auth.adminLogin(this.email, this.password);
    if (success) {
      this.router.navigate(['/admin']);
    }
  }
}
