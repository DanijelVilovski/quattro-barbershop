import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { BarberService } from '../../core/services/barber.service';
import { BookingService } from '../../core/services/booking.service';
import { ToastService } from '../../core/services/toast.service';
import {
  Barber,
  Appointment,
  CalendarDay,
  DaySchedule,
  BarberTimeOff,
  TIME_OFF_REASONS,
  TimeOffReason,
  ScheduleListItem,
} from '../../core/models/models';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent implements OnInit {
  bs = inject(BarberService);
  auth = inject(AuthService);
  bookingService = inject(BookingService);
  private toast = inject(ToastService);
  private router = inject(Router);

  currentBarber = signal<Barber | null>(null);
  activeTab = signal<'calendar' | 'schedule' | 'appointments' | 'timeoff'>('calendar');

  // Calendar
  calYear = signal(new Date().getFullYear());
  calMonth = signal(new Date().getMonth());
  calendarDays: CalendarDay[] = [];
  selectedCalDays = signal<Set<string>>(new Set());
  today = new Date(new Date().setHours(0, 0, 0, 0));
  todayIso = this.bs.toIsoDate(new Date());

  // Submission guards
  savingDay = signal(false);
  deletingDay = signal(false);
  submittingBooking = signal(false);

  // Day editor modal
  showDayModal = signal(false);
  editIso = '';
  editIsNew = false;
  editForm: DaySchedule & { duration: number | null } = {
    active: true,
    start: '12:00',
    end: '20:00',
    duration: null,
    breaks: [],
  };

  // Schedule list
  scheduleByMonth: { [key: string]: ScheduleListItem[] } = {};
  monthKeys: string[] = [];
  scheduleMonthIndex = signal(0);

  // Time off
  newTimeOff = { startDate: '', endDate: '', reason: 'godisnji_odmor' as TimeOffReason, note: '' };
  editingTimeOff = signal<BarberTimeOff | null>(null);
  timeOffReasons = TIME_OFF_REASONS;
  offDaysList: {
    id: string;
    type: string;
    date: string;
    endDate: string;
    label: string;
    note?: string;
    raw?: BarberTimeOff;
  }[] = [];

  // Closures
  newClosure = { date: '', reason: '' };

  // Appointments tab
  appointmentViewDate = signal(this.bs.toIsoDate(new Date()));
  selectedAppointment = signal<Appointment | null>(null);
  bookingSlot = signal<string | null>(null);
  bookingServices = signal<Set<number>>(new Set());
  bookingName = '';
  bookingEmail = '';
  bookingPhone = '';

  timeOptions: string[] = [];

  tabs = [
    { id: 'calendar' as const, label: 'Kalendar', icon: '📅' },
    { id: 'schedule' as const, label: 'Moj Raspored', icon: '📋' },
    { id: 'appointments' as const, label: 'Termini', icon: '🕐' },
    { id: 'timeoff' as const, label: 'Odsustva i zatvaranje lokala', icon: '🏖️' },
  ];

  async ngOnInit() {
    this.timeOptions = this.bs.getTimeOptions();
    await this.bs.loadAll();
    const barbers = this.bs.barbers();
    const user = this.auth.currentUser();
    const match = barbers.find((b) => b.id === user?.barberId);
    this.currentBarber.set(match ?? barbers[0]);
    await this.refresh();
  }

  /** Refresh all computed views */
  private async refresh() {
    await this.bs.loadAll();
    const barber = this.currentBarber();
    if (!barber) return;

    const fresh = this.bs.getBarberById(barber.id);
    if (fresh) this.currentBarber.set(fresh);

    this.calendarDays = this.bs.getCalendarMonth(
      this.calYear(),
      this.calMonth(),
      this.currentBarber()!,
    );
    this.scheduleByMonth = this.bs.getScheduleByMonth(this.currentBarber()!);
    this.monthKeys = Object.keys(this.scheduleByMonth).sort();

    // Default to current month
    const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const currentIdx = this.monthKeys.indexOf(currentMonthKey);
    if (currentIdx >= 0 && this.scheduleMonthIndex() === 0) {
      this.scheduleMonthIndex.set(currentIdx);
    } else if (this.scheduleMonthIndex() >= this.monthKeys.length) {
      this.scheduleMonthIndex.set(Math.max(0, this.monthKeys.length - 1));
    }

    this.buildOffDaysList();
  }

  private buildOffDaysList() {
    const barber = this.currentBarber();
    if (!barber) {
      this.offDaysList = [];
      return;
    }

    const todayIso = this.bs.toIsoDate(new Date());
    const items: typeof this.offDaysList = [];

    barber.schedule.timeOff
      .filter((to) => to.endDate >= todayIso)
      .forEach((to) => {
        items.push({
          id: to.id,
          type: 'time_off',
          date: to.startDate,
          endDate: to.endDate,
          label: this.bs.getTimeOffLabel(to.reason),
          note: to.note,
          raw: to,
        });
      });

    items.sort((a, b) => a.date.localeCompare(b.date));
    this.offDaysList = items;
  }

  // ══════ CALENDAR ══════
  async prevMonth() {
    if (this.calMonth() === 0) {
      this.calMonth.set(11);
      this.calYear.update((y) => y - 1);
    } else {
      this.calMonth.update((m) => m - 1);
    }
    this.clearSelection();
    await this.refresh();
  }

  async nextMonth() {
    if (this.calMonth() === 11) {
      this.calMonth.set(0);
      this.calYear.update((y) => y + 1);
    } else {
      this.calMonth.update((m) => m + 1);
    }
    this.clearSelection();
    await this.refresh();
  }

  onCalendarDayClick(day: CalendarDay) {
    if (!day.isCurrentMonth) return;
    if (day.blocked) {
      this.toast.error(`${day.statusLabel} — izmena nije moguća`);
      return;
    }
    if (day.date < this.today) return;
    if (day.dayOfWeek === 0) return;

    const selected = new Set(this.selectedCalDays());
    if (selected.has(day.isoDate)) {
      selected.delete(day.isoDate);
    } else {
      selected.add(day.isoDate);
    }
    this.selectedCalDays.set(selected);
  }

  isCalDaySelected(isoDate: string): boolean {
    return this.selectedCalDays().has(isoDate);
  }

  clearSelection() {
    this.selectedCalDays.set(new Set());
  }

  configureSelectedDays() {
    const selected = this.selectedCalDays();
    if (selected.size === 0) return;

    const firstIso = Array.from(selected).sort()[0];
    const existing = this.currentBarber()?.schedule.workDays[firstIso];

    this.editIso = '';
    this.editIsNew = false;
    if (existing) {
      this.editForm = {
        active: existing.active,
        start: existing.start,
        end: existing.end,
        duration: existing.duration || null,
        breaks: JSON.parse(JSON.stringify(existing.breaks || [])),
      };
    } else {
      this.editForm = { active: true, start: '12:00', end: '20:00', duration: null, breaks: [] };
    }
    this.showDayModal.set(true);
  }

  getCalDayBg(day: CalendarDay): string {
    if (day.dayOfWeek === 0) return 'var(--bg-secondary)';
    if (this.isCalDaySelected(day.isoDate)) return 'rgba(249, 115, 22, 0.25)';
    switch (day.status) {
      case 'working':
        return 'rgba(34, 197, 94, 0.15)';
      case 'off_configured':
      case 'off':
      case 'closure':
        return 'rgba(159, 18, 57, 0.2)';
      default:
        return 'var(--bg-secondary)';
    }
  }

  getCalDayBorder(day: CalendarDay): string {
    if (day.dayOfWeek === 0) return '2px solid transparent';
    if (day.isToday) return '2px solid var(--orange)';
    if (this.isCalDaySelected(day.isoDate)) return '2px solid var(--orange)';
    switch (day.status) {
      case 'working':
        return '2px solid rgba(34, 197, 94, 0.4)';
      case 'off_configured':
      case 'off':
      case 'closure':
        return '2px solid rgba(159, 18, 57, 0.5)';
      default:
        return '2px solid transparent';
    }
  }

  // ══════ DAY EDITOR ══════
  openEditor(isoDate: string) {
    this.clearSelection();
    this.editIso = isoDate;
    this.editIsNew = false;
    const existing = this.currentBarber()?.schedule.workDays[isoDate];
    if (existing) {
      this.editForm = {
        active: existing.active,
        start: existing.start,
        end: existing.end,
        duration: existing.duration || null,
        breaks: JSON.parse(JSON.stringify(existing.breaks || [])),
      };
    } else {
      this.editForm = { active: true, start: '12:00', end: '20:00', duration: null, breaks: [] };
    }
    this.showDayModal.set(true);
  }

  openNewDayEditor() {
    this.clearSelection();
    this.editIso = '';
    this.editIsNew = true;
    this.editForm = { active: true, start: '12:00', end: '20:00', duration: null, breaks: [] };
    this.showDayModal.set(true);
  }

  async saveDay() {
    if (this.savingDay()) return;
    const barber = this.currentBarber();
    if (!barber) return;
    this.savingDay.set(true);

    const config: DaySchedule = {
      active: this.editForm.active,
      start: this.editForm.start,
      end: this.editForm.end,
      duration: this.editForm.duration,
      breaks: JSON.parse(JSON.stringify(this.editForm.breaks)),
    };

    const selected = this.selectedCalDays();

    try {
      if (selected.size > 0) {
        for (const iso of selected) {
          await this.bs.setWorkDay(barber.id, iso, {
            ...config,
            breaks: JSON.parse(JSON.stringify(config.breaks)),
          });
        }
        this.showDayModal.set(false);
        this.clearSelection();
        await this.refresh();
        this.toast.success(`${selected.size} dana konfigurisano!`);
      } else if (this.editIsNew && this.editIso) {
        await this.bs.setWorkDay(barber.id, this.editIso, config);
        this.showDayModal.set(false);
        await this.refresh();
        this.toast.success('Dan sačuvan!');
      } else if (this.editIso) {
        await this.bs.setWorkDay(barber.id, this.editIso, config);
        this.showDayModal.set(false);
        await this.refresh();
        this.toast.success('Dan sačuvan!');
      }
    } finally {
      this.savingDay.set(false);
    }
  }

  async deleteDay() {
    if (this.deletingDay()) return;
    const barber = this.currentBarber();
    if (!barber) return;
    this.deletingDay.set(true);

    const selected = this.selectedCalDays();

    try {
      if (selected.size > 0) {
        for (const iso of selected) {
          await this.bs.removeWorkDay(barber.id, iso);
        }
        this.showDayModal.set(false);
        this.clearSelection();
        await this.refresh();
        this.toast.success(`${selected.size} dana uklonjeno!`);
      } else if (this.editIso) {
        await this.bs.removeWorkDay(barber.id, this.editIso);
        this.showDayModal.set(false);
        await this.refresh();
        this.toast.success('Konfiguracija uklonjena.');
      }
    } finally {
      this.deletingDay.set(false);
    }
  }

  getEditPreviewSlots(): string[] {
    if (!this.editForm.active) return [];
    return this.bs.generateSlots(
      this.editForm as DaySchedule,
      this.currentBarber()?.schedule.globalDuration || 30,
    );
  }

  // ══════ GLOBAL DURATION ══════
  async setGlobalDuration(d: number) {
    const barber = this.currentBarber();
    if (!barber) return;
    await this.bs.setGlobalDuration(barber.id, d);
    await this.refresh();
    this.toast.success(`Trajanje postavljeno na ${d} min`);
  }

  // ══════ SCHEDULE MONTH NAV ══════
  get currentScheduleMonth(): string | null {
    return this.monthKeys[this.scheduleMonthIndex()] ?? null;
  }

  prevScheduleMonth() {
    if (this.scheduleMonthIndex() > 0) {
      this.scheduleMonthIndex.update((i) => i - 1);
    }
  }

  nextScheduleMonth() {
    if (this.scheduleMonthIndex() < this.monthKeys.length - 1) {
      this.scheduleMonthIndex.update((i) => i + 1);
    }
  }

  // ══════ TIME OFF ══════
  async addTimeOff() {
    const barber = this.currentBarber();
    if (!barber) return;
    await this.bs.addBarberTimeOff(barber.id, {
      startDate: this.newTimeOff.startDate,
      endDate: this.newTimeOff.endDate || this.newTimeOff.startDate,
      reason: this.newTimeOff.reason,
      note: this.newTimeOff.note || undefined,
    });
    this.newTimeOff = { startDate: '', endDate: '', reason: 'godisnji_odmor', note: '' };
    await this.refresh();
    this.toast.success('Odsustvo dodato!');
  }

  startEditTimeOff(item: (typeof this.offDaysList)[0]) {
    if (item.raw) {
      this.editingTimeOff.set({ ...item.raw });
    }
  }

  async saveEditTimeOff() {
    const barber = this.currentBarber();
    const edited = this.editingTimeOff();
    if (!barber || !edited) return;
    await this.bs.updateBarberTimeOff(barber.id, edited);
    this.editingTimeOff.set(null);
    await this.refresh();
    this.toast.success('Izmenjeno!');
  }

  async deleteOffDay(item: (typeof this.offDaysList)[0]) {
    const barber = this.currentBarber();
    if (!barber) return;
    await this.bs.removeBarberTimeOff(barber.id, item.id);
    await this.refresh();
    this.toast.success('Uklonjeno.');
  }

  // ══════ CLOSURES ══════
  async addClosure() {
    await this.bs.addShopClosure({ date: this.newClosure.date, reason: this.newClosure.reason });
    this.newClosure = { date: '', reason: '' };
    await this.refresh();
    this.toast.success('Zatvaranje dodato!');
  }

  async removeClosure(id: string) {
    await this.bs.removeShopClosure(id);
    await this.refresh();
    this.toast.success('Uklonjeno.');
  }

  // ══════ APPOINTMENTS ══════
  getAppointmentDaySlots(): string[] {
    const barber = this.currentBarber();
    if (!barber) return [];
    const resolved = this.bs.resolveScheduleForDate(barber, this.appointmentViewDate());
    if (!resolved.schedule?.active) return [];
    return this.bs.generateSlots(resolved.schedule, barber.schedule.globalDuration);
  }

  isSlotBooked(time: string): boolean {
    return this.getAppointmentForSlot(time) !== null;
  }

  getAppointmentForSlot(time: string): Appointment | null {
    const barber = this.currentBarber();
    if (!barber) return null;
    const displayDate = this.bs.formatIsoToDisplay(this.appointmentViewDate());
    return (
      this.bookingService
        .appointments()
        .find((a) => a.barberId === barber.id && a.date === displayDate && a.time === time) ?? null
    );
  }

  get isViewDatePast(): boolean {
    return this.appointmentViewDate() < this.todayIso;
  }

  onSlotClick(time: string) {
    if (this.isViewDatePast) return;
    const apt = this.getAppointmentForSlot(time);
    if (apt) {
      this.selectedAppointment.set(apt);
    } else {
      this.bookingServices.set(new Set());
      this.bookingName = '';
      this.bookingEmail = '';
      this.bookingPhone = '';
      this.bookingSlot.set(time);
    }
  }

  toggleBookingService(id: number) {
    const group = this.bs.getServiceGroup(id);
    const set = new Set(this.bookingServices());
    if (set.has(id)) {
      set.delete(id);
    } else {
      if (group) group.forEach((gId) => set.delete(gId));
      set.add(id);
    }
    this.bookingServices.set(set);
  }

  get currentBarberServices() {
    return this.bs.getServicesForBarber(this.currentBarber()?.id ?? 0);
  }

  get bookingTotalPrice(): number {
    return this.currentBarberServices.filter((s) => this.bookingServices().has(s.id)).reduce(
      (sum, s) => sum + s.price,
      0,
    );
  }

  async submitBooking() {
    if (this.submittingBooking()) return;
    const barber = this.currentBarber();
    const user = this.auth.currentUser();
    const slot = this.bookingSlot();
    if (!barber || !user || !slot) return;

    const services = this.bs.getServicesForBarber(barber.id).filter((s) => this.bookingServices().has(s.id));
    if (services.length === 0) {
      this.toast.error('Izaberite bar jednu uslugu.');
      return;
    }

    this.submittingBooking.set(true);
    try {
      const result = await this.bookingService.createAppointment({
        barberId: barber.id,
        date: this.bs.formatIsoToDisplay(this.appointmentViewDate()),
        time: slot,
        services: services.map((s) => s.name),
        totalPrice: this.bookingTotalPrice,
        userName: this.bookingName.trim(),
        userEmail: this.bookingEmail.trim(),
        userPhone: this.bookingPhone.trim(),
      }, true);

      if (result) {
        this.bookingSlot.set(null);
      }
    } finally {
      this.submittingBooking.set(false);
    }
  }

  async cancelSelectedAppointment() {
    const apt = this.selectedAppointment();
    if (!apt) return;
    const success = await this.bookingService.cancelAppointment(apt.id);
    if (success) {
      this.selectedAppointment.set(null);
      this.toast.success('Termin otkazan.');
    } else {
      this.toast.error('Otkazivanje nije moguće.');
    }
  }

  prevAppointmentDay() {
    const d = new Date(this.appointmentViewDate() + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    this.appointmentViewDate.set(this.bs.toIsoDate(d));
  }

  nextAppointmentDay() {
    const d = new Date(this.appointmentViewDate() + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    this.appointmentViewDate.set(this.bs.toIsoDate(d));
  }

  // ══════ HELPERS ══════
  getMonthLabel(mk: string): string {
    const [y, m] = mk.split('-');
    return `${this.bs.MONTH_NAMES[parseInt(m) - 1]} ${y}`;
  }

  getDateNum(iso: string): number {
    return parseInt(iso.split('-')[2]);
  }

  getDayLabel(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return `${this.bs.DAY_NAMES[d.getDay()]}`;
  }

  getDayNameFromIso(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return this.bs.DAY_NAMES[d.getDay()];
  }

  getStatusLabel(type: string): string {
    const map: Record<string, string> = {
      working: 'Radi',
      off_configured: 'Neradan',
      time_off: 'Odsustvo',
      closure: 'Zatvoreno',
    };
    return map[type] || type;
  }

  async logout() {
    await this.auth.logout();
    this.router.navigate(['/home']);
  }

  goHome() {
    this.router.navigate(['/home']);
  }
}
