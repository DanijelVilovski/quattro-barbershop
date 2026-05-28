import { Injectable, signal, inject } from '@angular/core';
import { Appointment } from '../models/models';
import { ToastService } from './toast.service';
import { SupabaseService } from './supabase.service';
import { EmailService } from './email.service';
import { BarberService } from './barber.service';
import { consumerPollProducersForChange } from '@angular/core/primitives/signals';

@Injectable({ providedIn: 'root' })
export class BookingService {
  appointments = signal<Appointment[]>([]);

  private toast = inject(ToastService);
  private supa = inject(SupabaseService);
  private email = inject(EmailService);
  private barberSvc = inject(BarberService);

  constructor() {
    this.loadAppointments();
  }

  /** Load all confirmed appointments */
  async loadAppointments(): Promise<void> {
    const { data, error } = await this.supa
      .from('appointments')
      .select('*')
      .eq('status', 'confirmed')
      .order('appointment_date', { ascending: true });

    if (error) {
      console.error('Failed to load appointments:', error);
      return;
    }

    this.appointments.set((data || []).map((row) => this.mapRow(row)));
  }

  /** Create a new appointment */
  async createAppointment(
    data: Omit<Appointment, 'id' | 'createdAt'>,
    skipEmail = false,
  ): Promise<Appointment | null> {
    // Get current user ID if logged in
    const currentUser = await this.supa.getUser();

    const { data: row, error } = await this.supa
      .from('appointments')
      .insert({
        barber_id: data.barberId,
        appointment_date: this.displayToIso(data.date),
        appointment_time: data.time,
        services: data.services,
        total_price: data.totalPrice,
        user_name: data.userName,
        user_email: data.userEmail,
        user_phone: data.userPhone,
        user_id: currentUser?.id || null,
      })
      .select()
      .single();

    if (error) {
      this.toast.error('Greška pri zakazivanju: ' + error.message);
      return null;
    }

    const appointment = this.mapRow(row);
    this.appointments.update((list) => [...list, appointment]);
    this.toast.success('Termin zakazan!');

    if (!skipEmail) {
      this.email.sendAppointmentConfirmation(data.userEmail, {
        barber: this.getBarberName(data.barberId),
        date: data.date,
        time: data.time,
        services: data.services.join(', '),
        price: data.totalPrice,
        cancelUrl: `${window.location.origin}/cancel-appointment?token=${row.cancel_token}`,
      });
    }

    return appointment;
  }

  /** Cancel an appointment (soft delete via status) */
  async cancelAppointment(appointmentId: string): Promise<boolean> {
    const apt = this.appointments().find((a) => a.id === appointmentId);
    if (!apt) return false;

    if (!this.canCancel(apt)) {
      this.toast.error('Otkazivanje nije moguće manje od 2 sata pre termina');
      return false;
    }

    const { error } = await this.supa
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointmentId);

    if (error) {
      this.toast.error('Greška pri otkazivanju: ' + error.message);
      return false;
    }

    this.appointments.update((list) => list.filter((a) => a.id !== appointmentId));
    this.toast.success('Termin otkazan. Email potvrda poslata.');

    // Send cancellation email (fire and forget)
    this.email.sendAppointmentCancellation(apt.userEmail, {
      barber: this.getBarberName(apt.barberId),
      date: apt.date,
      time: apt.time,
    });

    return true;
  }

  /** Check if an appointment can be cancelled (2h rule) */
  canCancel(appointment: Appointment): boolean {
    const now = new Date();
    const [d, mo, y] = appointment.date.split('/').map(Number);
    const [h, m] = appointment.time.split(':').map(Number);
    const aptDate = new Date(y, mo - 1, d, h, m);
    return aptDate.getTime() - now.getTime() > 2 * 60 * 60 * 1000;
  }

  getUserAppointments(email: string): Appointment[] {
    return this.appointments().filter((a) => a.userEmail.toLowerCase() === email.toLowerCase());
  }

  getBarberAppointments(barberId: number): Appointment[] {
    return this.appointments().filter((a) => a.barberId === barberId);
  }

  getBookedTimes(barberId: number, dateStr: string): string[] {
    return this.appointments()
      .filter((a) => a.barberId === barberId && a.date === dateStr)
      .map((a) => a.time);
  }

  /** Handle cancel-token in URL (from email link) — called once on app load */
  async handleCancelLinkFromUrl(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;

    // Strip token from URL immediately so refresh doesn't re-trigger
    params.delete('token');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);

    try {
      const { data, error } = await this.supa.client.functions.invoke('cancel-appointment', {
        body: { token },
      });

      if (error || !data?.success) {
        const code = data?.error || 'unknown';
        this.toast.error(this.cancelErrorMessage(code));
        console.log(this.cancelErrorMessage)
        console.log(data?.error)
        console.log(data);
        return;
      }

      this.toast.success('Termin otkazan. Email potvrda poslata.');

      // Refresh the in-memory list in case the cancelled appointment was loaded
      await this.loadAppointments();
    } catch (err: any) {
      this.toast.error('Greška pri otkazivanju termina.');
      console.error('cancel via link error:', err);
    }
  }

  private cancelErrorMessage(code: string): string {
    switch (code) {
      case 'not_found': return 'Termin nije pronađen. Link je možda neispravan.';
      case 'already_cancelled': return 'Ovaj termin je već otkazan.';
      case 'too_late': return 'Otkazivanje nije moguće manje od 2 sata pre termina.';
      case 'invalid_token': return 'Nevažeći token.';
      default: return 'Došlo je do greške pri otkazivanju.';
    }
  }

  /** Map a Supabase row to our Appointment model */
  private mapRow(row: any): Appointment {
    const d = new Date(row.appointment_date + 'T00:00:00');
    return {
      id: row.id,
      barberId: row.barber_id,
      date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
      time: row.appointment_time,
      services: row.services || [],
      totalPrice: parseFloat(row.total_price),
      userName: row.user_name,
      userEmail: row.user_email,
      userPhone: row.user_phone,
      createdAt: new Date(row.created_at),
    };
  }

  /** Convert display date "07/04/2026" to ISO "2026/04/07" */
  private displayToIso(displayDate: string): string {
    const [d, m, y] = displayDate.split('/');
    return `${y}/${m}/${d}`;
  }

  private getBarberName(barberId: number): string {
    return this.barberSvc.getBarberById(barberId)?.name ?? 'Barber';
  }
}
