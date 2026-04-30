import { Injectable, signal } from '@angular/core';
import {
  Barber,
  BarberSchedule,
  BarberService as BarberServiceModel,
  BarberTimeOff,
  BookingDay,
  CalendarDay,
  DaySchedule,
  ScheduleListItem,
  ShopClosure,
  TIME_OFF_REASONS,
  TimeOffReason,
} from '../models/models';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class BarberService {
  readonly DAY_NAMES = ['Nedelja', 'Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota'];
  readonly DAY_SHORT = ['Ned', 'Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub'];
  readonly MONTH_NAMES = [
    'Januar',
    'Februar',
    'Mart',
    'April',
    'Maj',
    'Jun',
    'Jul',
    'Avgust',
    'Septembar',
    'Oktobar',
    'Novembar',
    'Decembar',
  ];

  readonly ALL_SERVICES: BarberServiceModel[] = [
    { id: 1, barberId: 1, name: 'Muško šišanje', price: 800 },
    { id: 2, barberId: 1, name: 'Skraćivanje brade', price: 200 },
    { id: 3, barberId: 1, name: 'Pranje kose', price: 200 },
    { id: 4, barberId: 2, name: 'Šišanje mašinica', price: 1100 },
    { id: 5, barberId: 2, name: 'Šišanje mašinica + Makaze', price: 1200 },
    { id: 6, barberId: 2, name: 'Šišanje nula', price: 500 },
    { id: 7, barberId: 2, name: 'Brada kratka', price: 400 },
    { id: 8, barberId: 2, name: 'Brada duga', price: 500 },
    { id: 9, barberId: 2, name: 'Shaver', price: 200 },
    { id: 10, barberId: 2, name: 'Pranje kose', price: 200 },
  ];

  // Groups of mutually exclusive services (radio-button behavior within each group)
  readonly SERVICE_GROUPS: { barberId: number; ids: number[] }[] = [
    { barberId: 2, ids: [4, 5, 6] },
    { barberId: 2, ids: [7, 8] },
  ];

  getServicesForBarber(barberId: number): BarberServiceModel[] {
    return this.ALL_SERVICES.filter((s) => s.barberId === barberId);
  }

  getServiceGroup(serviceId: number): number[] | null {
    const group = this.SERVICE_GROUPS.find((g) => g.ids.includes(serviceId));
    return group ? group.ids : null;
  }

  readonly DURATIONS = [15, 30, 45];

  // Programmatic colors assigned by index
  private readonly BARBER_COLORS: [string, string][] = [
    ['#eab308', '#ca8a04'],
    ['#eab308', '#ca8a04'],
    ['#6b7280', '#4b5563'],
    ['#4b5563', '#374151'],
    ['#9ca3af', '#6b7280'],
    ['#374151', '#1f2937'],
  ];

  barbers = signal<Barber[]>([]);
  shopClosures = signal<ShopClosure[]>([]);

  constructor(private supa: SupabaseService) {
    this.loadAll();
  }

  // ════════════════════════════════
  //  DATA LOADING
  // ════════════════════════════════

  async loadAll(): Promise<void> {
    await Promise.all([this.loadBarbers(), this.loadShopClosures()]);
  }

  private async loadBarbers(): Promise<void> {
    // Load barbers
    const { data: barberRows } = await this.supa.from('barbers').select('*').order('id');
    if (!barberRows) return;

    // Load profiles linked to barbers
    const { data: profileRows } = await this.supa
      .from('profiles')
      .select('first_name, last_name, barber_id')
      .not('barber_id', 'is', null);

    const barberIds = barberRows.map((b) => b.id);

    const [workDaysRes, timeOffRes] = await Promise.all([
      this.supa.from('barber_work_days').select('*').in('barber_id', barberIds).order('work_date'),
      this.supa.from('barber_time_off').select('*').in('barber_id', barberIds).order('start_date'),
    ]);

    const barbers: Barber[] = barberRows.map((row, index) => {
      const profile = (profileRows || []).find((p) => p.barber_id === row.id);
      const name = profile ? profile.first_name : `Barber ${row.id}`;

      const workDays: { [iso: string]: DaySchedule } = {};
      (workDaysRes.data || [])
        .filter((wd) => wd.barber_id === row.id)
        .forEach((wd) => {
          workDays[wd.work_date] = {
            active: wd.active,
            start: wd.start_time,
            end: wd.end_time,
            duration: wd.duration,
            breaks: wd.breaks || [],
          };
        });

      const timeOff: BarberTimeOff[] = (timeOffRes.data || [])
        .filter((to) => to.barber_id === row.id)
        .map((to) => ({
          id: to.id,
          startDate: to.start_date,
          endDate: to.end_date,
          reason: to.reason as TimeOffReason,
          note: to.note || undefined,
        }));

      return {
        id: row.id,
        name,
        role: 'Barber',
        color: this.BARBER_COLORS[index % this.BARBER_COLORS.length][0],
        colorDark: this.BARBER_COLORS[index % this.BARBER_COLORS.length][1],
        globalDuration: row.global_duration,
        schedule: {
          globalDuration: row.global_duration,
          workDays,
          timeOff,
        },
      };
    });

    this.barbers.set(barbers);
  }

  private async loadShopClosures(): Promise<void> {
    const { data } = await this.supa.from('shop_closures').select('*').order('closure_date');

    this.shopClosures.set(
      (data || []).map((row) => ({
        id: row.id,
        date: row.closure_date,
        reason: row.reason,
      })),
    );
  }

  // ════════════════════════════════
  //  DATE RESOLUTION
  // ════════════════════════════════

  resolveScheduleForDate(
    barber: Barber,
    isoDate: string,
  ): { schedule: DaySchedule | null; reason?: string } {
    const closure = this.shopClosures().find((c) => c.date === isoDate);
    if (closure) return { schedule: null, reason: `Lokal zatvoren: ${closure.reason}` };

    const timeOff = barber.schedule.timeOff.find(
      (to) => isoDate >= to.startDate && isoDate <= to.endDate,
    );
    if (timeOff) return { schedule: null, reason: this.getTimeOffLabel(timeOff.reason) };

    const workDay = barber.schedule.workDays[isoDate];
    if (workDay) return { schedule: workDay };

    return { schedule: null, reason: 'Nije konfigurisan' };
  }

  getTimeOffLabel(reason: string): string {
    return TIME_OFF_REASONS.find((r) => r.value === reason)?.label || reason;
  }

  // ════════════════════════════════
  //  BOOKING DAYS
  // ════════════════════════════════

  getBookingDays(): BookingDay[] {
    const days: BookingDay[] = [];
    const labels = ['Danas', 'Sutra', 'Prekosutra'];
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = this.toIsoDate(d);
      days.push({
        date: d,
        dayOfWeek: d.getDay(),
        label: labels[i],
        dateStr: this.toDisplayDate(d),
        isoDate: iso,
        dayName: this.DAY_NAMES[d.getDay()],
        isOpen: !this.shopClosures().some((c) => c.date === iso),
      });
    }
    return days;
  }

  // ════════════════════════════════
  //  SLOT GENERATION
  // ════════════════════════════════

  generateSlots(dayConfig: DaySchedule, globalDuration: number): string[] {
    if (!dayConfig?.active) return [];
    const duration = dayConfig.duration || globalDuration;
    const slots: string[] = [];
    const [sh, sm] = dayConfig.start.split(':').map(Number);
    const [eh, em] = dayConfig.end.split(':').map(Number);
    for (let m = sh * 60 + sm; m + duration <= eh * 60 + em; m += duration) {
      const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const inBreak = (dayConfig.breaks || []).some((b) => {
        const [bsh, bsm] = b.start.split(':').map(Number);
        const [beh, bem] = b.end.split(':').map(Number);
        return m < beh * 60 + bem && m + duration > bsh * 60 + bsm;
      });
      if (!inBreak) slots.push(t);
    }
    return slots;
  }

  getAvailableSlots(
    barber: Barber,
    isoDate: string,
    bookedTimes: string[],
    isToday: boolean,
  ): string[] {
    const resolved = this.resolveScheduleForDate(barber, isoDate);
    if (!resolved.schedule?.active) return [];
    const all = this.generateSlots(resolved.schedule, barber.schedule.globalDuration);
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    return all.filter((t) => {
      if (bookedTimes.includes(t)) return false;
      if (isToday) {
        const [h, m] = t.split(':').map(Number);
        if (h * 60 + m <= curMin) return false;
      }
      return true;
    });
  }

  // ════════════════════════════════
  //  CALENDAR
  // ════════════════════════════════

  getCalendarMonth(year: number, month: number, barber: Barber): CalendarDay[] {
    const days: CalendarDay[] = [];
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let pad = first.getDay() - 1;
    if (pad < 0) pad = 6;
    for (let i = pad - 1; i >= 0; i--)
      days.push(this.buildCalDay(new Date(year, month, -i), false, today, barber));
    for (let d = 1; d <= last.getDate(); d++)
      days.push(this.buildCalDay(new Date(year, month, d), true, today, barber));
    const rem = 7 - (days.length % 7);
    if (rem < 7)
      for (let i = 1; i <= rem; i++)
        days.push(this.buildCalDay(new Date(year, month + 1, i), false, today, barber));
    return days;
  }

  private buildCalDay(date: Date, isCur: boolean, today: Date, barber: Barber): CalendarDay {
    const iso = this.toIsoDate(date);
    const resolved = this.resolveScheduleForDate(barber, iso);
    let status: CalendarDay['status'] = 'none',
      statusLabel = 'Nije konfigurisan',
      blocked = false;
    const cl = this.shopClosures().find((c) => c.date === iso);
    if (cl) {
      status = 'closure';
      statusLabel = cl.reason;
      blocked = true;
    } else if (barber.schedule.timeOff.find((t) => iso >= t.startDate && iso <= t.endDate)) {
      const to = barber.schedule.timeOff.find((t) => iso >= t.startDate && iso <= t.endDate)!;
      status = 'off';
      statusLabel = this.getTimeOffLabel(to.reason);
      blocked = true;
    } else if (barber.schedule.workDays[iso]) {
      const wd = barber.schedule.workDays[iso];
      status = wd.active ? 'working' : 'off_configured';
      statusLabel = wd.active ? `${wd.start}–${wd.end}` : 'Neradni dan';
    }
    return {
      date,
      isoDate: iso,
      dayOfMonth: date.getDate(),
      dayOfWeek: date.getDay(),
      isCurrentMonth: isCur,
      isToday: date.getTime() === today.getTime(),
      status,
      statusLabel,
      schedule: resolved.schedule,
      blocked,
    };
  }

  getScheduleByMonth(barber: Barber): { [key: string]: ScheduleListItem[] } {
    const itemMap: { [iso: string]: ScheduleListItem } = {};
    const gd = barber.schedule.globalDuration;
    Object.entries(barber.schedule.workDays).forEach(([iso, conf]) => {
      itemMap[iso] = {
        iso,
        type: conf.active ? 'working' : 'off_configured',
        label: conf.active ? `${conf.start} – ${conf.end}` : 'Neradni dan',
        sublabel: conf.active ? `${this.generateSlots(conf, gd).length} termina` : '',
        conf,
        editable: true,
      };
    });
    barber.schedule.timeOff.forEach((to) => {
      const s = new Date(to.startDate + 'T00:00:00'),
        e = new Date(to.endDate + 'T00:00:00'),
        cur = new Date(s);
      while (cur <= e) {
        const iso = this.toIsoDate(cur);
        itemMap[iso] = {
          iso,
          type: 'time_off',
          label: this.getTimeOffLabel(to.reason),
          sublabel: to.note || '',
          conf: null,
          editable: false,
        };
        cur.setDate(cur.getDate() + 1);
      }
    });
    this.shopClosures().forEach((cl) => {
      itemMap[cl.date] = {
        iso: cl.date,
        type: 'closure',
        label: 'Lokal zatvoren',
        sublabel: cl.reason,
        conf: null,
        editable: false,
      };
    });
    const items = Object.values(itemMap).sort((a, b) => a.iso.localeCompare(b.iso));
    const grouped: { [k: string]: ScheduleListItem[] } = {};
    items.forEach((item) => {
      const [y, m] = item.iso.split('-');
      const k = `${y}-${m}`;
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(item);
    });
    return grouped;
  }

  // ════════════════════════════════
  //  MUTATIONS (write to Supabase)
  // ════════════════════════════════

  async setWorkDay(barberId: number, isoDate: string, config: DaySchedule): Promise<void> {
    await this.supa.from('barber_work_days').upsert(
      {
        barber_id: barberId,
        work_date: isoDate,
        active: config.active,
        start_time: config.start,
        end_time: config.end,
        duration: config.duration || null,
        breaks: config.breaks || [],
      },
      { onConflict: 'barber_id,work_date' },
    );

    await this.loadBarbers();
  }

  async removeWorkDay(barberId: number, isoDate: string): Promise<void> {
    await this.supa
      .from('barber_work_days')
      .delete()
      .eq('barber_id', barberId)
      .eq('work_date', isoDate);

    await this.loadBarbers();
  }

  async setGlobalDuration(barberId: number, duration: number): Promise<void> {
    await this.supa.from('barbers').update({ global_duration: duration }).eq('id', barberId);

    await this.loadBarbers();
  }

  async addBarberTimeOff(barberId: number, timeOff: Omit<BarberTimeOff, 'id'>): Promise<void> {
    await this.supa.from('barber_time_off').insert({
      barber_id: barberId,
      start_date: timeOff.startDate,
      end_date: timeOff.endDate,
      reason: timeOff.reason,
      note: timeOff.note || null,
    });

    await this.loadBarbers();
  }

  async updateBarberTimeOff(barberId: number, updated: BarberTimeOff): Promise<void> {
    await this.supa
      .from('barber_time_off')
      .update({
        start_date: updated.startDate,
        end_date: updated.endDate,
        reason: updated.reason,
        note: updated.note || null,
      })
      .eq('id', updated.id);

    await this.loadBarbers();
  }

  async removeBarberTimeOff(barberId: number, timeOffId: string): Promise<void> {
    await this.supa.from('barber_time_off').delete().eq('id', timeOffId);

    await this.loadBarbers();
  }

  async addShopClosure(closure: Omit<ShopClosure, 'id'>): Promise<void> {
    await this.supa.from('shop_closures').insert({
      closure_date: closure.date,
      reason: closure.reason,
    });

    await this.loadShopClosures();
  }

  async removeShopClosure(id: string): Promise<void> {
    await this.supa.from('shop_closures').delete().eq('id', id);

    await this.loadShopClosures();
  }

  updateBarberSchedule(barberId: number, schedule: BarberSchedule): void {
    this.barbers.update((list) => list.map((b) => (b.id === barberId ? { ...b, schedule } : b)));
  }

  // ════════════════════════════════
  //  HELPERS
  // ════════════════════════════════

  getBarberById(id: number): Barber | undefined {
    return this.barbers().find((b) => b.id === id);
  }

  getTimeOptions(): string[] {
    const o: string[] = [];
    for (let h = 6; h <= 22; h++)
      for (let m = 0; m < 60; m += 15)
        o.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    return o;
  }

  toIsoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  toDisplayDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  formatIsoToDisplay(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
}
