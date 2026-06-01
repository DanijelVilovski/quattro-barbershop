import { Component, inject, computed, OnInit } from '@angular/core';
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
export class MyAppointmentsComponent implements OnInit {
  private auth = inject(AuthService);
  private bookingService = inject(BookingService);
  private barberService = inject(BarberService);

  ngOnInit() {
    const user = this.auth.currentUser();
    if (user) this.bookingService.loadUserAppointments(user.id, user.email);
  }

  myAppointments = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return [];
    const now = new Date();
    return this.bookingService.getUserAppointments(user.email, user.id).filter((apt) => {
      const [day, month, year] = apt.date.split('/');
      return new Date(`${year}-${month}-${day}T${apt.time}`) >= now;
    });
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
