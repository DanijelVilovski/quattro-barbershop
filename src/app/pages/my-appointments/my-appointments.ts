import { Component, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { BookingService } from '../../core/services/booking.service';
import { Appointment } from '../../core/models/models';
import { BarberService } from '../../core/services/barber.service';

@Component({
  selector: 'app-my-appointments',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './my-appointments.html',
  styleUrls: ['./my-appointments.scss'],
})
export class MyAppointmentsComponent {
  private auth = inject(AuthService);
  private bookingService = inject(BookingService);
  private barberService = inject(BarberService);

  myAppointments = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return [];
    return this.bookingService.getUserAppointments(user.email);
  });

  canCancel(apt: Appointment): boolean {
    return this.bookingService.canCancel(apt);
  }

  cancel(id: string) {
    this.bookingService.cancelAppointment(id);
  }

  getBarberName(barberId: number): string {
    return this.barberService.getBarberById(barberId)?.name ?? '';
  }
}
