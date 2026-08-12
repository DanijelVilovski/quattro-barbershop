import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  console.log('SERVICE_ROLE_KEY present:', !!SERVICE_ROLE_KEY, 'length:', SERVICE_ROLE_KEY?.length || 0);
  try {
    const rawBody = await req.text();
    console.log('Raw body received:', JSON.stringify(rawBody), 'length:', rawBody.length);
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch (e) {
      console.error('JSON parse failed. Raw body was:', rawBody);
      return json({
        error: 'invalid_body',
        raw: rawBody
      }, 400);
    }
    const { token } = parsed;
    if (!token || typeof token !== 'string') {
      return json({
        error: 'invalid_token'
      }, 400);
    }
    // === Raw PostgREST lookup ===
    const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/appointments?cancel_token=eq.${token}&select=*`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      }
    });
    console.log('Lookup status:', lookupRes.status);
    const lookupBody = await lookupRes.text();
    console.log('Lookup body:', lookupBody);
    if (!lookupRes.ok) {
      return json({
        error: 'lookup_failed',
        detail: lookupBody
      }, 500);
    }
    const appointments = JSON.parse(lookupBody);
    const apt = appointments[0];
    if (!apt) return json({
      error: 'not_found'
    }, 404);
    if (apt.status === 'cancelled') {
      return json({
        error: 'already_cancelled'
      }, 409);
    }
    // 2-hour rule
    const [h, m] = apt.appointment_time.split(':').map(Number);
    const aptDateTime = new Date(apt.appointment_date + 'T00:00:00');
    aptDateTime.setHours(h, m, 0, 0);
    const msUntil = aptDateTime.getTime() - Date.now();
    if (msUntil < 2 * 60 * 60 * 1000) {
      return json({
        error: 'too_late'
      }, 422);
    }
    // === Raw PostgREST update ===
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/appointments?id=eq.${apt.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        status: 'cancelled'
      })
    });
    console.log('Update status:', updateRes.status);
    if (!updateRes.ok) {
      const updateBody = await updateRes.text();
      console.error('Update failed:', updateBody);
      return json({
        error: 'update_failed',
        detail: updateBody
      }, 500);
    }
    // === Raw PostgREST profile lookup ===
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?barber_id=eq.${apt.barber_id}&select=first_name,last_name`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      }
    });
    let barberName = 'Barber';
    if (profileRes.ok) {
      const profiles = await profileRes.json();
      const first = profiles[0]?.first_name?.trim();
      if (first) barberName = first;
    }
    const dDate = new Date(apt.appointment_date + 'T00:00:00');
    const displayDate = `${pad(dDate.getDate())}/${pad(dDate.getMonth() + 1)}/${dDate.getFullYear()}`;
    // Fire-and-forget cancellation email
    fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        type: 'appointment_cancelled',
        to: apt.user_email,
        data: {
          barber: barberName,
          date: displayDate,
          time: apt.appointment_time
        }
      })
    }).catch((e)=>console.error('email send failed:', e));
    return json({
      success: true,
      appointment: {
        barber: barberName,
        date: displayDate,
        time: apt.appointment_time
      }
    });
  } catch (err) {
    console.error('cancel-appointment error:', err);
    return json({
      error: err.message
    }, 500);
  }
});
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}
function pad(n) {
  return String(n).padStart(2, '0');
}
