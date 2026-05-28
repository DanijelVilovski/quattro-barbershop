import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { NavbarComponent } from './shared/components/navbar/navbar';
import { FooterComponent } from './shared/components/footer/footer';
import { ToastComponent } from './shared/components/toast/toast';
import { filter } from 'rxjs';
import { BookingService } from './core/services/booking.service'; // ← adjust path if your folders differ

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit {
  isAdminRoute = false;
  private booking = inject(BookingService);

  constructor(private router: Router) {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        this.isAdminRoute = e.url.startsWith('/admin') && !e.url.startsWith('/admin-login');
        window.scrollTo(0, 0);
      });
  }

  ngOnInit() {
    this.booking.handleCancelLinkFromUrl();
  }
}