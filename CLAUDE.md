# Quattro Barbershop — Project Knowledge

Angular 20 SPA + Supabase, deployed on Vercel. Serbian-language UI. Two barbers,
public booking flow, per-barber admin panel.

Last verified against production: **2026-08-12**.

---

## 1. Environments — read this first

There are **two entirely separate Supabase projects**:

| | project ref | config file |
|---|---|---|
| dev | `fwhuipombndvqulkdcno` | `src/environments/environment.ts` |
| prod | `mwltlxtabdukhyyprdaq` | `src/environments/environment.prod.ts` |

`angular.json` swaps the file via `fileReplacements` for the `production`
configuration, and **`defaultConfiguration` for `build` is `production`**.

Consequences:

- `npm start` / `ng serve` → development config → **dev DB**
- `npm run build` / `ng build` / **any Vercel deploy** → production config → **prod DB**
- Vercel does not distinguish branches. Preview deploys also hit **prod**.

The `sb_publishable_*` (anon) keys are committed in both environment files. That is
normal for a Supabase frontend — they are designed to be public. The `sb_secret_*`
service-role key must never enter the repo; it belongs in Vercel env vars or edge
function secrets only.

**Edge functions are per-project.** A function deployed to prod does not exist in dev.
Same for function secrets.

---

## 2. Architecture

Angular 20, standalone components, signals for state, no NgRx. SCSS. Routes are lazy
loaded in `src/app/app.routes.ts`, guarded by `authGuard` / `adminGuard`.

All services are `providedIn: 'root'` (singletons for the whole SPA session):

| service | role |
|---|---|
| `SupabaseService` | thin wrapper around the supabase-js client |
| `AuthService` | session restore, login, profile → `currentUser` signal |
| `BarberService` | barbers + schedules + closures store, all schedule maths |
| `BookingService` | `appointments` signal, create/cancel, email triggers |
| `EmailService` | invokes the `send-email` edge function |
| `ToastService` | **holds one toast at a time** — a new one overwrites the previous |

### Bootstrap chain (important)

`AppComponent` injects `BookingService` (only to call `handleCancelLinkFromUrl()`),
which injects `BarberService`, whose constructor calls `loadAll()`. So **schedule data
loads at app bootstrap on every route, including public pages**.

### `BarberService.loadAll()` contract

- Guarded by a `loaded` flag plus a shared in-flight promise, so concurrent and repeat
  callers do **not** refetch.
- Mutations (`setWorkDay`, `removeWorkDay`, `setGlobalDuration`, the three time-off
  methods, the two closure methods) each reload their own slice via `loadBarbers()` or
  `loadShopClosures()`.
- Therefore `AdminComponent.refresh()` must **not** fetch — it only recomputes views.
  Adding a fetch back there re-introduces duplicate request bursts.

### Shared-state constraint

`barbers()[n].schedule.workDays` is a **single dictionary** consumed by the admin
calendar, Moj Raspored, the Termini tab, *and the public booking page*. Because
`BarberService` is a root singleton, narrowing that dict for one screen narrows it for
all of them. Any per-month or per-barber scoping must **merge** into the cache, never
replace it.

Two related traps:

- `Moj Raspored` derives its month navigation *from loaded data*
  (`monthKeys = Object.keys(scheduleByMonth)`), so fetching only one month would leave
  the month arrows with a single destination.
- `getCalendarMonth` pads the grid with adjacent-month days, so a strict
  calendar-month fetch leaves padding cells wrongly showing "Nije konfigurisan".

---

## 3. Database schema (prod, verified 2026-08-12)

`public/SchedulingSchema` is a **stale** hand-written dump — do not trust it. It also
sits in `public/`, which `angular.json` copies wholesale into the build, so it is
served publicly at `https://<site>/SchedulingSchema`.

```
profiles           id uuid PK → auth.users, first_name, last_name, phone,
                   role text (user|admin), barber_id int NULL, created_at
barbers            id serial PK, global_duration int, created_at
barber_work_days   id serial PK, barber_id → barbers, work_date date, active bool,
                   start_time text, end_time text, duration int NULL (per-day
                   override), breaks jsonb, UNIQUE(barber_id, work_date)
barber_time_off    id uuid PK, barber_id → barbers, start_date, end_date,
                   reason (godisnji_odmor|bolovanje|ostalo), note
shop_closures      id uuid PK, closure_date date UNIQUE, reason
appointments       id uuid PK, barber_id → barbers, user_id uuid NULL → auth.users,
                   appointment_date date, appointment_time text, services text[],
                   total_price numeric(10,2), user_name/user_email/user_phone text,
                   status text (confirmed|cancelled), created_at,
                   cancel_token uuid UNIQUE
```

**`barbers` holds no name.** The columns `name`, `role`, `description`, `color`,
`avatar_url` were removed. Barber names come from `profiles.first_name` joined via
`profiles.barber_id` (`BarberService.loadBarbers`). Colours are assigned
programmatically by array index (`BARBER_COLORS`).

Trigger: `on_auth_user_created` on `auth.users` → `handle_new_user()` inserts a
`profiles` row from `raw_user_meta_data`.

Indexes on `appointments`:

- `idx_appointments_lookup (barber_id, appointment_date, status)`
- `idx_appointments_cancel_token (cancel_token)`
- `appointments_confirmed_slot_uniq` — **partial unique** on
  `(barber_id, appointment_date, appointment_time) WHERE status = 'confirmed'`.
  Added 2026-08-12. Partial so cancelling frees the slot for rebooking.

### RLS

**Row Level Security is DISABLED on all six tables.** Policies exist but are inert,
and several are `FOR ALL TO anon USING (true) WITH CHECK (true)` — so enabling RLS
without rewriting them would change nothing. The publishable key, which ships in the
JS bundle, therefore grants full read/write on every table including customer PII.

If you ever enable RLS: `profiles` currently has no anon-read policy, but
`BarberService.loadBarbers` reads `profiles.first_name` anonymously to get barber
names. Without a replacement policy (`barber_id IS NOT NULL`) every barber name on the
site becomes `Barber 1` / `Barber 2`.

---

## 4. Data facts (2026-08-12)

- **4 admin profiles for 2 real barbers.** The two with `barber_id: null` are the
  developer's test accounts (`danivilovski@gmail.com`,
  `danijel.vilovski@sotexsolutions.com`, last sign-in 1 June). Real admins:
  Goran Cvikic → `barber_id 1`, Danilo Markovic → `barber_id 2`.
- `barbers.global_duration`: barber 1 = 15 min, barber 2 = 30 min.
- ~2,350 `appointments` (~650/month), 174 `barber_work_days` (~48/month,
  48 kB raw / 3.6 kB gzipped).
- **PostgREST caps responses at 1000 rows.** Paginate with `Range` headers when
  counting or exporting; a query that silently returns exactly 1000 is truncated.

### Query scoping

- `appointments` reads **are** scoped — admin fetches one barber + one day, the booking
  page one barber + a date range. Both hit `idx_appointments_lookup`.
- `barber_work_days` / `barber_time_off` / `shop_closures` reads are **unbounded** (all
  history, all barbers). Deliberately left as-is: 3.6 kB gzipped today, ~27 kB
  projected in two years. Scoping it requires the merge-cache work described in §2.

---

## 5. Dates and times

- `appointment_date` is a `date`; `appointment_time` is **text** `"HH:MM"`. There is no
  timezone stored anywhere. Everything is implicitly Europe/Belgrade wall-clock time.
- Display format is `DD/MM/YYYY`, internal format ISO `YYYY-MM-DD`. Conversions live in
  `BookingService.mapRow` / `displayToIso` and `BarberService.formatIsoToDisplay` /
  `toIsoDate`.
- `displayToIso` emits `YYYY/MM/DD` with slashes for inserts; Postgres accepts it.
- Client-side checks (`BookingService.canCancel`) use browser-local time, which is
  Belgrade for real users — so they are correct. **Server-side code is not** (see §7).

### Booking-day quirk

`getBookingDaysForBarber` is asymmetric: barber 1 gets the current Mon–Sun week
(`getCurrentWeekDays`, next week if today is Sunday); barber 2 gets today + 2 days.

### Services

`BarberService.ALL_SERVICES` is **hardcoded in TypeScript**, not in the DB — 10 entries,
3 for barber 1 and 7 for barber 2. `HAIRCUT_SERVICE_IDS = [1,4,5,6]`: at least one is
required to book. `SERVICE_GROUPS` makes some barber-2 services mutually exclusive.
`admin.ts` also hardcodes `BARBER1_DEFAULT_BREAKS` (six 15-min breaks), applied only
when configuring a day for barber 1.

---

## 6. Work completed 2026-08-12

### Admin slowness / "must refresh three times"

`loadAll()` ran three times per admin page load (bootstrap + `ngOnInit` + `refresh()`),
~15 requests, producing supabase-js
`NavigatorLockAcquireTimeoutError: … auth-token` from auth-token lock contention.
Combined with queries that swallowed their errors, any transient failure rendered a
silently blank admin page recoverable only by reload.

Fixed: `loadAll()` dedupes; `refresh()` no longer fetches; all five schedule queries
throw and surface one toast; the appointments load is awaited behind a
`loadingAppointments` flag.

Request counts: page load 15 → 5, save a day 11 → 5, month navigation 5 → 0.

### Double booking

11 slots in prod held two confirmed appointments each, both customers holding
confirmation emails. Root cause: availability was checked against a cached client-side
list with no re-validation and **no DB constraint**. Sub-minute `created_at` gaps were
genuine races; multi-day gaps were stale-cache bookings, including from the admin form.

Fixed: the 11 historical duplicates were resolved (earliest booking kept, later one
cancelled), `appointments_confirmed_slot_uniq` was added, and `23505` now maps to
*"Izabrani termin nije dostupan. Izaberite drugo vreme."* The public booking page
returns the user to step 3 with refreshed availability; the admin form closes and
refreshes. Neither sends a confirmation email on failure.

### Cancelled appointment not clearing from admin

A cancellation made from the customer's email link never reached the barber's open
admin page — no Realtime, no polling, and `loadAppointmentsForBarber` only ran on tab
switch or day navigation.

Fixed: a 30 s poll while the Termini tab is open, plus immediate refresh on
`visibilitychange`/`focus`. Background refreshes are *silent* (no loading placeholder,
which would otherwise blank the grid every 30 s). A detail modal whose appointment was
cancelled elsewhere closes itself. `ngOnDestroy` clears the interval and listeners.

---

## 7. Known issues — deliberately deferred

Documented, not fixed. None of these are in progress.

1. **Edge function 2-hour rule is defeated by a timezone bug.**
   `supabase/functions/cancel-appointment/index.ts` does
   `new Date(apt.appointment_date + 'T00:00:00')` — a date-time form with no offset,
   parsed as *local* time, and the runtime is UTC. The computed appointment time lands
   2 h late in summer (1 h in winter), so `msUntil` is inflated and the check
   `msUntil < 2h` almost never fires. **Email cancellations are effectively
   unrestricted in summer and limited to 1 h in winter.** The in-app cancel button is
   unaffected (it uses browser-local time and is correct).
2. **RLS disabled on all tables**, with blanket `anon` policies underneath (§3).
3. **`public/SchedulingSchema` is stale and publicly served** (§3).
4. **Unvalidated `token` interpolated into a service-role PostgREST URL**
   (`cancel-appointment`, the lookup fetch). No working exploit was found — appended
   params AND with the token filter, so the result set cannot be widened — but it is
   the wrong shape. A UUID regex check would also turn today's `lookup_failed` 500 on a
   malformed token into a clean 400.
5. **Customer PII in edge function logs** — the full appointment row (name, email,
   phone) and the raw request body are logged on every cancellation.
6. **"Max 2 appointments per day" is a racy client-side check** (`booking.ts`). Not
   fixable with a unique index; it needs a trigger or an RPC.
7. **`profiles[0]` for the barber name** in the edge function is non-deterministic if
   two profiles ever link to the same `barber_id`.
8. **The cancel token is stripped from the URL before the function is invoked**, so a
   failed cancellation cannot be retried by refreshing.
9. **No `/cancel-appointment` route** — it falls through `**` to a home redirect. It
   works because `handleCancelLinkFromUrl` reads `window.location.search` at bootstrap,
   but it races the router's redirect.
10. **`send-email` is not in the repo** — dashboard-only, unversioned, unreviewed.
11. **Only the Termini tab polls.** Kalendar and Moj Raspored show schedule data, which
    changes rarely, and do not auto-refresh.
12. **An OpenStreetMap iframe loads on the admin page**, competing for connections
    during initial load.

---

## 8. How to inspect things

### Full schema dump (read-only, run in the SQL editor)

Returns one text column with tables, columns, constraints, RLS status, policies,
triggers, functions, views and enums. See the query used on 2026-08-12 — it unions
`pg_class`/`pg_attribute`/`pg_constraint`/`pg_indexes`/`pg_policies`/`pg_trigger`/
`pg_proc` and orders by section.

### REST introspection with the publishable key

```bash
# row count (note the 1000-row cap — paginate with Range for more)
curl -s -I "$URL/rest/v1/<table>?select=id" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range
```

`auth.users` is **not** reachable this way (404) — email addresses and
`last_sign_in_at` are only visible in Dashboard → Authentication → Users.

### Edge functions

```bash
npx supabase login
npx supabase functions download <name> --project-ref <ref>
```

Remember they are per-project: downloading from prod tells you nothing about dev.

---

## 9. Conventions

- **All user-facing strings are Serbian.** Match the existing tone; errors are plain
  and actionable rather than technical.
- Prettier: `printWidth: 100`, `singleQuote: true`, Angular parser for HTML
  (config lives in `package.json`).
- Angular signals for state; `@if` / `@for` template control flow (not `*ngIf`).
- `ToastService` shows one toast at a time — do not fire several in a row expecting all
  to be read.
- Commit messages in this repo are historically just `.` — no established convention.

## 10. Local files not in git

`supabase/.temp/` (CLI state) and `.claude/settings.local.json` (per-machine approval
log) are gitignored. `supabase/functions/` **is** tracked.
