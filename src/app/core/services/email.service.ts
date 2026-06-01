import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EmailService {
  private supa = inject(SupabaseService);

  private async send(type: string, to: string, data: Record<string, any>): Promise<void> {
    console.log('[EmailService] send START', { type, to, data });
    try {
      const { data: result, error } = await this.supa.client.functions.invoke('send-email', {
        body: { type, to, data },
      });
      if (error) {
        console.error('[EmailService] edge function error:', { type, to, error });
      } else {
        console.log('[EmailService] send SUCCESS', { type, to, result });
      }
    } catch (err) {
      console.error('[EmailService] unexpected error:', { type, to, err });
    }
  }

  async sendAppointmentConfirmation(
    email: string,
    data: {
      barber: string;
      date: string;
      time: string;
      services: string;
      price: number;
      cancelUrl?: string;
    },
  ): Promise<void> {
    await this.send('appointment_confirmed', email, data);
  }

  async sendAppointmentCancellation(
    email: string,
    data: {
      barber: string;
      date: string;
      time: string;
    },
  ): Promise<void> {
    await this.send('appointment_cancelled', email, data);
  }

  async sendWelcome(email: string, name: string): Promise<void> {
    await this.send('welcome', email, {
      name,
      siteUrl: window.location.origin,
    });
  }
}
