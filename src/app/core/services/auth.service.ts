import { Injectable, signal, computed, inject, Injector } from '@angular/core';
import { User } from '../models/models';
import { ToastService } from './toast.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<User | null>(null);
  isLoggedIn = computed(() => this.currentUser() !== null);
  isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);

  /** Resolves when the initial session check is complete */
  sessionReady: Promise<void>;
  private resolveSession!: () => void;

  private toast = inject(ToastService);
  private supa = inject(SupabaseService);
  private injector = inject(Injector);

  constructor() {
    this.sessionReady = new Promise((resolve) => {
      this.resolveSession = resolve;
    });
    this.restoreSession();
  }

  async register(data: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
  }): Promise<boolean> {
    const { error, data: authData } = await this.supa.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          phone: data.phone,
        },
      },
    });

    if (error) {
      this.toast.error(error.message);
      return false;
    }

    if (authData.user) {
      await this.loadProfile(authData.user.id, authData.user.email ?? '');
    }

    this.toast.success(`Registracija uspešna!`);
    this.toast.success(`Proverite email kako biste potvrdili nalog.`);

    // Send welcome email (fire and forget)
    import('./email.service').then((m) => {
      const emailService = this.injector.get(m.EmailService);
      emailService.sendWelcome(data.email, data.firstName);
    });

    return true;
  }

  async login(email: string, password: string): Promise<boolean> {
    const { error, data } = await this.supa.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message === 'Email not confirmed') {
        this.toast.error(
          'Vaš email nije potvrđen. Molimo proverite inbox i kliknite na link za potvrdu.',
        );
      } else if (error.message === 'Invalid login credentials') {
        this.toast.error('Pogrešan email ili lozinka.');
      } else {
        this.toast.error('Došlo je do greške prilikom prijave. Pokušajte ponovo.');
      }
      return false;
    }

    await this.loadProfile(data.user.id, data.user.email ?? '');
    this.toast.success('Uspešna prijava!');
    return true;
  }

  async adminLogin(email: string, password: string): Promise<boolean> {
    const { error, data } = await this.supa.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      this.toast.error(error.message);
      return false;
    }

    // Verify admin role
    const { data: profile } = await this.supa
      .from('profiles')
      .select('role, barber_id')
      .eq('id', data.user.id)
      .single();

    if (profile?.role !== 'admin') {
      await this.supa.auth.signOut();
      this.toast.error('Nemate admin pristup');
      return false;
    }

    await this.loadProfile(data.user.id, data.user.email ?? ''); // <-- this line is missing
    this.toast.success(`Dobrodošli!`);
    return true;
  }

  async logout(): Promise<void> {
    await this.supa.auth.signOut();
    this.currentUser.set(null);
    this.toast.success('Uspešno ste se odjavili');
  }

  private async restoreSession() {
    try {
      const session = await this.supa.getSession();
      if (session?.user) {
        await this.loadProfile(session.user.id, session.user.email ?? '');
      }
    } catch (err) {
      console.error('Session restore error:', err);
    } finally {
      this.resolveSession();
    }
  }

  private async loadProfile(userId: string, email: string) {
    const { data: profile } = await this.supa
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profile) {
      this.currentUser.set({
        id: userId,
        firstName: profile.first_name,
        lastName: profile.last_name,
        email,
        phone: profile.phone,
        isAdmin: profile.role === 'admin',
        barberId: profile.barber_id ?? null,
      });
    }
  }
}
