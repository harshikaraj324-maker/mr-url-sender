const NEON_HOST = 'ep-lingering-haze-aquknql6-pooler.c-8.us-east-1.aws.neon.tech';
const NEON_CONN = 'postgresql://neondb_owner:npg_kP9BDgTWj0xf@ep-lingering-haze-aquknql6-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require';
const MR_PANEL  = 'https://mr-panel.pages.dev';
const API_KEY   = 'hcWfExkF8WgQN/3CkD7opBqaZ+IGgFZj781uzzt6Q3dQQdYFA9r0Z9KlaWi9ZjOdPUNQWdLxZGx6lGYMpUUh8Q==';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sql(query, params = []) {
  const r = await fetch('https://' + NEON_HOST + '/sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': NEON_CONN,
    },
    body: JSON.stringify({ query, params }),
  });
  const j = await r.json();
  if (j.message && !j.rows) throw new Error(j.message);
  return j.rows || [];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, '').replace(/^\//, '');

  try {
    /* ── stats ───────────────────────────────────────────── */
    if (path === 'stats') {
      const [[apps],[devs],[msgs],[online],[fcmOk]] = await Promise.all([
        sql('SELECT COUNT(*) cnt FROM apps'),
        sql('SELECT COUNT(*) cnt FROM devices'),
        sql('SELECT COUNT(*) cnt FROM messages'),
        sql("SELECT COUNT(*) cnt FROM devices WHERE status='online'"),
        sql('SELECT COUNT(*) cnt FROM devices WHERE fcm_token IS NOT NULL'),
      ]);
      return json({
        apps:     +apps.cnt,
        devices:  +devs.cnt,
        messages: +msgs.cnt,
        online:   +online.cnt,
        fcmReady: +fcmOk.cnt,
      });
    }

    /* ── apps ─────────────────────────────────────────────── */
    if (path === 'apps') {
      const rows = await sql(`
        SELECT a.app_id, a.name, a.status,
               COUNT(d.id)::int                                          AS device_count,
               COUNT(CASE WHEN d.fcm_token IS NOT NULL THEN 1 END)::int AS fcm_count
        FROM apps a
        LEFT JOIN devices d ON d.app_id = a.app_id
        GROUP BY a.id, a.app_id, a.name, a.status
        ORDER BY a.id
      `);
      return json(rows.map(r => ({
        appId:       r.app_id,
        name:        r.name,
        status:      r.status,
        deviceCount: r.device_count,
        fcmCount:    r.fcm_count,
      })));
    }

    /* ── devices ──────────────────────────────────────────── */
    if (path === 'devices') {
      const appId = url.searchParams.get('appId');
      const rows  = appId
        ? await sql(
            'SELECT device_id,app_id,name,status,fcm_token,sim1_phone,sim2_phone FROM devices WHERE app_id=$1 ORDER BY name',
            [appId]
          )
        : await sql(
            'SELECT device_id,app_id,name,status,(fcm_token IS NOT NULL) AS has_fcm FROM devices ORDER BY app_id,name'
          );
      return json(rows.map(r => ({
        deviceId: r.device_id,
        appId:    r.app_id,
        name:     r.name,
        status:   r.status,
        hasFcm:   !!(r.fcm_token || r.has_fcm),
        sim1:     r.sim1_phone || null,
        sim2:     r.sim2_phone || null,
      })));
    }

    /* ── fcm/send ─────────────────────────────────────────── */
    if (path === 'fcm/send' && request.method === 'POST') {
      const body = await request.json();
      const r = await fetch(MR_PANEL + '/api/fcm/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body:    JSON.stringify(body),
      });
      return json(await r.json(), r.status);
    }

    return json({ error: 'Not found' }, 404);

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}