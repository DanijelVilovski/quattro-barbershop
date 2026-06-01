// ── Service offered by the barbershop ──
export interface BarberService {
  id: number;
  barberId: number;
  name: string;
  price: number;
}

// ── Break within a work day ──
export interface ScheduleBreak {
  start: string;
  end: string;
}

// ── Single day configuration ──
export interface DaySchedule {
  active: boolean;
  start: string;
  end: string;
  duration?: number | null; // per-day override, null = use global
  breaks: ScheduleBreak[];
}

// ── Barber time off entry ──
export type TimeOffReason = 'godisnji_odmor' | 'bolovanje' | 'ostalo';

export const TIME_OFF_REASONS: { value: TimeOffReason; label: string }[] = [
  { value: 'godisnji_odmor', label: 'Godišnji odmor' },
  { value: 'bolovanje', label: 'Bolovanje' },
  { value: 'ostalo', label: 'Ostalo' },
];

export interface BarberTimeOff {
  id: string;
  startDate: string; // "2026-04-15"
  endDate: string; // "2026-04-18"
  reason: TimeOffReason;
  note?: string;
}

// ── Shop-level closure ──
export interface ShopClosure {
  id: string;
  date: string; // "2026-04-15"
  reason: string; // "Državni praznik"
}

// ── Full barber schedule (calendar-first, no weekly template) ──
export interface BarberSchedule {
  globalDuration: number; // default appointment length
  workDays: { [isoDate: string]: DaySchedule }; // per-date configs
  timeOff: BarberTimeOff[];
}

// ── Barber profile ──
export interface Barber {
  id: number;
  name: string; // from profiles.first_name + last_name
  role: string; // "Barber" or custom from profile
  color: string;
  colorDark: string;
  globalDuration: number;
  schedule: BarberSchedule;
}

// ── Appointment ──
export interface Appointment {
  id: string;
  barberId: number;
  date: string;
  time: string;
  services: string[];
  totalPrice: number;
  userName: string;
  userEmail: string;
  userPhone: string;
  userId: string | null;
  createdAt: Date;
}

// ── User ──
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  isAdmin: boolean;
  barberId?: number | null;
}

// ── Day option for the booking calendar ──
export interface BookingDay {
  date: Date;
  dayOfWeek: number;
  label: string; // "Danas", "Sutra", "Prekosutra"
  dateStr: string; // "07/04/2026" display format
  isoDate: string; // "2026-04-07" for lookups
  dayName: string;
  isOpen: boolean;
}

// ── Shop hours config (for display only) ──
export interface ShopHours {
  day: number;
  open: boolean;
  start?: string;
  end?: string;
}

// ── Calendar day (for admin calendar view) ──
export interface CalendarDay {
  date: Date;
  isoDate: string;
  dayOfMonth: number;
  dayOfWeek: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  status: 'working' | 'off_configured' | 'off' | 'closure' | 'none';
  statusLabel: string;
  schedule: DaySchedule | null;
  blocked: boolean;
}

// ── Schedule list item (for Moj Raspored) ──
export interface ScheduleListItem {
  iso: string;
  type: 'working' | 'off_configured' | 'time_off' | 'closure';
  label: string;
  sublabel: string;
  conf: DaySchedule | null;
  editable: boolean;
}
