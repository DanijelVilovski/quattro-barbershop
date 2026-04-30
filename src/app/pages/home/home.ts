import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BarberService } from '../../core/services/barber.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
})
export class HomeComponent {
  barberService = inject(BarberService);

  getStyleType(barberId: number): string {
    if (barberId === 1) {
      return '(classic style)';
    } else if (barberId === 2) {
      return '(modern style)';
    }
    return '';
  }
}
