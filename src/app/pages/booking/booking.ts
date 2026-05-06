import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BarberService } from '../../core/services/barber.service';
import { BookingService } from '../../core/services/booking.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { Barber, BookingDay } from '../../core/models/models';

@Component({
  selector: 'app-booking',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './booking.html',
  styleUrl: './booking.scss',
})
export class BookingComponent implements OnInit {
  barberService = inject(BarberService);
  bookingService = inject(BookingService);
  auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  step = signal(1);
  days: BookingDay[] = [];
  stepLabels = ['Barber', 'Dan', 'Vreme', 'Detalji'];

  selectedDayIndex = signal<number | null>(null);
  selectedDay = computed(() =>
    this.selectedDayIndex() !== null ? this.days[this.selectedDayIndex()!] : null,
  );
  selectedBarber = signal<Barber | null>(null);
  selectedTime = signal<string | null>(null);
  selectedServices = signal<number[]>([]);

  availableSlots = computed(() => {
    const barber = this.selectedBarber();
    const day = this.selectedDay();
    if (!barber || !day) return [];
    const booked = this.bookingService.getBookedTimes(barber.id, day.dateStr);
    return this.barberService.getAvailableSlots(barber, day.isoDate, booked, day.label === 'Danas');
  });

  totalPrice = computed(() =>
    this.selectedServices().reduce((sum, id) => {
      const s = this.barberService.ALL_SERVICES.find((sv) => sv.id === id);
      return sum + (s?.price ?? 0);
    }, 0),
  );

  isSubmitting = signal(false);

  formIme = '';
  formPrezime = '';
  formEmail = '';
  formTelefon = '';

  ngOnInit() {
    this.prefillForm();
  }

  /** Get availability info for a day card (uses the already-selected barber) */
  getDayInfo(day: BookingDay): { enabled: boolean; totalSlots: number; closure: string | null } {
    if (day.dayOfWeek === 0) {
      return { enabled: false, totalSlots: 0, closure: null };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day.date < today) {
      return { enabled: false, totalSlots: 0, closure: null };
    }

    const closureEntry = this.barberService.shopClosures().find((c) => c.date === day.isoDate);
    if (closureEntry) {
      return { enabled: false, totalSlots: 0, closure: closureEntry.reason };
    }
    if (!day.isOpen) {
      return { enabled: false, totalSlots: 0, closure: null };
    }

    const barber = this.selectedBarber();
    if (!barber) return { enabled: false, totalSlots: 0, closure: null };

    const booked = this.bookingService.getBookedTimes(barber.id, day.dateStr);
    const totalSlots = this.barberService.getAvailableSlots(
      barber,
      day.isoDate,
      booked,
      day.label === 'Danas',
    ).length;

    return { enabled: totalSlots > 0, totalSlots, closure: null };
  }

  selectBarber(barber: Barber) {
    this.selectedBarber.set(barber);
    this.selectedServices.set([]);
    this.days = this.barberService.getBookingDaysForBarber(barber.id);
    this.step.set(2);
    window.scrollTo(0, 0);
  }
  selectDay(index: number) {
    this.selectedDayIndex.set(index);
    this.step.set(3);
    window.scrollTo(0, 0);
  }
  selectTime(time: string) {
    this.selectedTime.set(time);
    this.step.set(4);
    window.scrollTo(0, 0);
  }

  goBack() {
    const s = this.step();
    if (s === 2) {
      this.selectedBarber.set(null);
      this.selectedServices.set([]);
      this.days = [];
      this.step.set(1);
    } else if (s === 3) {
      this.selectedDayIndex.set(null);
      this.step.set(2);
    } else if (s === 4) {
      this.selectedTime.set(null);
      this.step.set(3);
    }
    window.scrollTo(0, 0);
  }

  toggleService(id: number) {
    const group = this.barberService.getServiceGroup(id);
    this.selectedServices.update((list) => {
      if (list.includes(id)) return list.filter((s) => s !== id);
      const filtered = group ? list.filter((s) => !group.includes(s)) : list;
      return [...filtered, id];
    });
  }

  prefillForm() {
    const user = this.auth.currentUser();
    if (user) {
      this.formIme = user.firstName;
      this.formPrezime = user.lastName;
      this.formEmail = user.email;
      this.formTelefon = user.phone;
    }
  }

  canSubmit(): boolean {
    return (
      this.formIme.trim() !== '' &&
      this.formEmail.trim() !== '' &&
      this.formTelefon.trim() !== '' &&
      this.selectedServices().length > 0
    );
  }

  async submit() {
    if (!this.canSubmit()) {
      this.toast.error('Molimo popunite sva obavezna polja');
      return;
    }

    const day = this.selectedDay()!;
    const barber = this.selectedBarber()!;
    const email = this.formEmail.trim();

    const appointmentsOnDay = this.bookingService
      .getUserAppointments(email)
      .filter((a) => a.date === day.dateStr);

    if (appointmentsOnDay.length >= 2) {
      this.toast.error('Nije moguće zakazati više od 2 termina u jednom danu');
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.bookingService.createAppointment({
        barberId: barber.id,
        date: day.dateStr,
        time: this.selectedTime()!,
        services: this.selectedServices().map(
          (id) => this.barberService.ALL_SERVICES.find((s) => s.id === id)!.name,
        ),
        totalPrice: this.totalPrice(),
        userName: `${this.formIme} ${this.formPrezime}`.trim(),
        userEmail: email,
        userPhone: this.formTelefon,
      });

      this.router.navigate([this.auth.isLoggedIn() ? '/my-appointments' : '/home']);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
