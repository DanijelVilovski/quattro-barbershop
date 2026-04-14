import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, Session, User as SupaUser } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private supabase: SupabaseClient;
  readonly anonKey = environment.supabaseKey;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  get client(): SupabaseClient & { supabaseUrl: string } {
    return Object.assign(this.supabase, { supabaseUrl: environment.supabaseUrl });
  }

  get auth() {
    return this.supabase.auth;
  }

  from(table: string) {
    return this.supabase.from(table);
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session;
  }

  async getUser(): Promise<SupaUser | null> {
    const { data } = await this.supabase.auth.getUser();
    return data.user;
  }
}
