// RideRise LK Phase 2 — Events: calendar, filtering, capacity + waiting lists,
// private check-in, results/galleries, and studio-official event designation.
'use strict';

const crypto = require('node:crypto');
const { nowIso, newId, clamp, parseJson } = require('./core');

module.exports = function registerEvents2(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, notifier, auditAdmin } = ctx;

  function eventRow(row, userId) {
    const going = db.prepare("SELECT COUNT(*) AS c FROM event_registrations WHERE event_id = ? AND status = 'registered'").get(row.id).c;
    const waitlist = db.prepare("SELECT COUNT(*) AS c FROM event_registrations WHERE event_id = ? AND status = 'waitlist'").get(row.id).c;
    const mine = userId
      ? db.prepare('SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ?').get(row.id, userId)
      : null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category || 'community',
      schedule_text: row.schedule_text,
      event_date: row.event_date,
      district: row.district,
      venue: row.venue,
      registration_deadline: row.registration_deadline,
      cancellation_deadline: row.cancellation_deadline,
      capacity: row.capacity,
      going_count: going,
      waitlist_count: waitlist,
      spots_left: Math.max(0, row.capacity - going),
      status: row.status,
      is_official_studio_event: Boolean(row.is_official_studio_event),
      featured_on_home: Boolean(row.featured_on_home),
      organizer_name: row.organizer_name || 'Community organizer',
      organizer_contact: row.organizer_contact,
      eligibility_requirements: row.eligibility_requirements,
      equipment_safety_requirements: row.equipment_safety_requirements,
      rules_text: row.rules_text,
      safety_requirements: row.safety_requirements,
      minor_policy: row.minor_policy,
      announcements: parseJson(row.announcements_json, []),
      cancellation_notice: row.cancellation_notice,
      post_event_recap: row.post_event_recap,
      waitlist_enabled: Boolean(row.waitlist_enabled),
      my_registration: mine
        ? { status: mine.status, checked_in_at: mine.checked_in_at, registered_at: mine.registered_at, ticket_code: mine.ticket_code }
        : null
    };
  }

  return async function handle(req, res, pathname, parsedUrl) {
    /* -------------------------------- calendar ------------------------------- */
    if (pathname === '/api/events/calendar' && req.method === 'GET') {
      const viewer = getAuthUser(req);
      const from = parsedUrl.searchParams.get('from');
      const to = parsedUrl.searchParams.get('to');
      const district = parsedUrl.searchParams.get('district') || '';
      const category = parsedUrl.searchParams.get('category') || '';
      const official = parsedUrl.searchParams.get('official');
      const scope = parsedUrl.searchParams.get('scope') || 'all';

      let rows = db.prepare("SELECT * FROM studio_events WHERE status != 'cancelled'").all();
      if (from) rows = rows.filter((r) => r.event_date >= from);
      if (to) rows = rows.filter((r) => r.event_date <= to);
      if (district) rows = rows.filter((r) => r.district === district);
      if (category) rows = rows.filter((r) => (r.category || 'community') === category);
      if (official === '1') rows = rows.filter((r) => r.is_official_studio_event);
      if (official === '0') rows = rows.filter((r) => !r.is_official_studio_event);

      const guildEvents = [];
      if (viewer && scope !== 'official') {
        const memberships = db
          .prepare("SELECT guild_id FROM guild_memberships WHERE user_id = ? AND status = 'active'")
          .all(viewer.id);
        for (const m of memberships) {
          const g = db.prepare('SELECT id, name FROM guilds WHERE id = ?').get(m.guild_id);
          if (!g) continue;
          const list = db
            .prepare("SELECT * FROM guild_events WHERE guild_id = ? AND status = 'scheduled'")
            .all(m.guild_id);
          for (const ge of list) {
            guildEvents.push({
              id: ge.id,
              guild_id: g.id,
              guild_name: g.name,
              title: ge.title,
              description: ge.description,
              category: ge.category,
              starts_at: ge.starts_at,
              ends_at: ge.ends_at,
              venue: ge.venue,
              district: ge.district,
              capacity: ge.capacity,
              going_count: db.prepare("SELECT COUNT(*) AS c FROM guild_event_rsvps WHERE event_id = ? AND status = 'going'").get(ge.id).c,
              my_rsvp: (db.prepare('SELECT status FROM guild_event_rsvps WHERE event_id = ? AND user_id = ?').get(ge.id, viewer.id) || {}).status || null,
              is_official_studio_event: false,
              kind: 'guild'
            });
          }
        }
      }

      const events = rows
        .filter((r) => !district || r.district === district)
        .map((r) => eventRow(r, viewer ? viewer.id : null))
        .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));

      return sendJson(res, 200, {
        events,
        guild_events: guildEvents.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))),
        districts: [...new Set(rows.map((r) => r.district))].sort(),
        categories: [...new Set(rows.map((r) => r.category || 'community'))].sort(),
        distinction_note:
          '“Official Shaun David Studios Event” badges appear only on events published by studio administrators. Community and guild events are separate and never carry the studio badge.',
        generated_at: nowIso()
      }), true;
    }

    /* ---------------------------------- mine --------------------------------- */
    if (pathname === '/api/events/v2/mine' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const regs = db
        .prepare('SELECT r.*, e.* FROM event_registrations r JOIN studio_events e ON e.id = r.event_id WHERE r.user_id = ? ORDER BY e.event_date ASC')
        .all(user.id);
      return sendJson(res, 200, {
        registrations: regs.map((r) => ({
          event_id: r.event_id,
          title: r.title,
          event_date: r.event_date,
          district: r.district,
          venue: r.venue,
          status: r.status === 'waitlist' ? 'waitlist' : r.status,
          checked_in_at: r.checked_in_at,
          ticket_code: r.ticket_code,
          is_official_studio_event: Boolean(r.is_official_studio_event)
        }))
      }), true;
    }

    /* -------------------------------- detail --------------------------------- */
    const eventMatch = pathname.match(/^\/api\/events\/v2\/([^/]+)(?:\/([a-z-]+))?$/);
    if (eventMatch) {
      const eventId = decodeURIComponent(eventMatch[1]);
      const action = eventMatch[2] || '';
      const user = getAuthUser(req);
      const row = db.prepare('SELECT * FROM studio_events WHERE id = ?').get(eventId);
      if (!row) return sendJson(res, 404, { error: 'EVENT_NOT_FOUND' }), true;

      if (!action && req.method === 'GET') {
        const announcements = db
          .prepare('SELECT * FROM event_announcements WHERE event_id = ? ORDER BY created_at DESC')
          .all(eventId);
        const gallery = db
          .prepare('SELECT * FROM event_gallery WHERE event_id = ? AND approved = 1 ORDER BY created_at DESC LIMIT 60')
          .all(eventId);
        const results = db.prepare('SELECT * FROM event_results WHERE event_id = ? ORDER BY placement ASC').all(eventId);
        const registrants = user && user.role === 'admin'
          ? db
              .prepare(
                `SELECT r.*, p.username, p.display_name FROM event_registrations r
                 JOIN profiles p ON p.user_id = r.user_id WHERE r.event_id = ? ORDER BY r.registered_at ASC`
              )
              .all(eventId)
          : [];
        return sendJson(res, 200, {
          event: eventRow(row, user ? user.id : null),
          announcements,
          gallery,
          results,
          registrants,
          checkin_note: 'Check-in uses a short event code shared by the organizer at the venue. No GPS position is collected or published.'
        }), true;
      }

      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;

      if ((action === 'register' || action === 'cancel') && req.method === 'POST') {
        if (row.status === 'cancelled') {
          return sendJson(res, 400, { error: 'EVENT_CANCELLED', message: 'This event was cancelled by the organizer.' }), true;
        }
        if (action === 'cancel') {
          db.prepare(
            `INSERT INTO event_registrations (event_id, user_id, status, emergency_ack, registered_at)
             VALUES (?, ?, 'cancelled', 1, ?)
             ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'cancelled'`
          ).run(eventId, user.id, nowIso());
          const next = db
            .prepare("SELECT * FROM event_registrations WHERE event_id = ? AND status = 'waitlist' ORDER BY registered_at ASC LIMIT 1")
            .get(eventId);
          if (next) {
            db.prepare("UPDATE event_registrations SET status = 'registered' WHERE event_id = ? AND user_id = ?").run(eventId, next.user_id);
            notifier.notify({
              userId: next.user_id,
              type: 'event_reminder',
              title: `You are off the waitlist: ${row.title}`,
              body: 'A place opened up and you are now registered.',
              referenceType: 'event',
              referenceId: eventId,
              deepLink: '#/events'
            });
          }
          return sendJson(res, 200, { status: 'cancelled', message: 'Registration cancelled.' }), true;
        }

        if (!checkRateLimit(`event:register:${user.id}`, 20, 60)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED' }), true;
        }
        const existing = db.prepare('SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ?').get(eventId, user.id);
        if (existing && existing.status === 'registered') {
          return sendJson(res, 200, { status: 'registered', message: 'You are already registered for this event.' }), true;
        }
        if (row.registration_deadline && row.registration_deadline < nowIso().slice(0, 10)) {
          return sendJson(res, 400, { error: 'REGISTRATION_CLOSED', message: 'Registration for this event has closed.' }), true;
        }
        const going = db.prepare("SELECT COUNT(*) AS c FROM event_registrations WHERE event_id = ? AND status = 'registered'").get(eventId).c;
        if (going >= row.capacity) {
          if (!row.waitlist_enabled) {
            return sendJson(res, 409, { error: 'EVENT_FULL', message: 'This event is full and has no waiting list.' }), true;
          }
          db.prepare(
            `INSERT INTO event_registrations (event_id, user_id, status, emergency_ack, registered_at)
             VALUES (?, ?, 'waitlist', 1, ?)
             ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'waitlist'`
          ).run(eventId, user.id, nowIso());
          return sendJson(res, 200, { status: 'waitlist', message: 'Event is full — you were added to the waiting list.' }), true;
        }
        const ticket = crypto.randomBytes(4).toString('hex').toUpperCase();
        db.prepare(
          `INSERT INTO event_registrations (event_id, user_id, status, emergency_ack, registered_at, ticket_code)
           VALUES (?, ?, 'registered', 1, ?, ?)
           ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'registered', ticket_code = excluded.ticket_code`
        ).run(eventId, user.id, nowIso(), ticket);
        notifier.notify({
          userId: user.id,
          type: 'event_reminder',
          title: `Registered: ${row.title}`,
          body: `${row.event_date} · ${row.venue}. Your ticket code is ${ticket}.`,
          referenceType: 'event',
          referenceId: eventId,
          deepLink: '#/events'
        });
        return sendJson(res, 200, {
          status: 'registered',
          ticket_code: ticket,
          message: 'You are registered. Review the event rules and safety requirements before attending.'
        }), true;
      }

      if (action === 'checkin' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const reg = db.prepare('SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ?').get(eventId, user.id);
        if (!reg || reg.status !== 'registered') {
          return sendJson(res, 403, { error: 'NOT_REGISTERED', message: 'Register for the event before checking in.' }), true;
        }
        if (reg.checked_in_at) {
          return sendJson(res, 200, { checked_in_at: reg.checked_in_at, message: 'You are already checked in.' }), true;
        }
        const code = String(body.code || '').trim().toUpperCase();
        const expected = row.checkin_code;
        if (!expected) {
          return sendJson(res, 400, { error: 'CHECKIN_NOT_OPEN', message: 'Check-in is not open yet. The organizer will share the code at the venue.' }), true;
        }
        if (code !== expected.toUpperCase()) {
          return sendJson(res, 400, { error: 'INVALID_CHECKIN_CODE', message: 'That check-in code is not correct. Ask the organizer.' }), true;
        }
        db.prepare('UPDATE event_registrations SET checked_in_at = ? WHERE event_id = ? AND user_id = ?').run(nowIso(), eventId, user.id);
        return sendJson(res, 200, {
          checked_in_at: nowIso(),
          message: 'Checked in. Your location was not collected or shared.',
          privacy_note: 'Check-in stores only a timestamp. No GPS coordinate is requested, stored or published.'
        }), true;
      }
    }

    /* ----------------------- admin event management -------------------------- */
    if (pathname.startsWith('/api/admin/events')) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      if (!['admin', 'moderator'].includes(user.role)) {
        return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Event management requires a studio staff role.' }), true;
      }

      if (pathname === '/api/admin/events' && req.method === 'GET') {
        const events = db.prepare('SELECT * FROM studio_events ORDER BY event_date DESC').all().map((e) => eventRow(e, user.id));
        return sendJson(res, 200, { events, can_designate_official: user.role === 'admin' }), true;
      }

      if (pathname === '/api/admin/events' && req.method === 'POST') {
        // Studio-console events are official by definition in the Phase 1 contract;
        // moderators manage community events through the guild tools instead.
        if (user.role !== 'admin') {
          return sendJson(res, 403, {
            error: 'OFFICIAL_STUDIO_ADMIN_ONLY',
            message: 'Only a studio administrator can publish a Shaun David Studios event or feature one on the home screen.'
          }), true;
        }
        const body = await readJsonBody(req);
        const wantsOfficial = body.is_official_studio_event !== false;
        const title = String(body.title || '').trim().slice(0, 160);
        const date = String(body.event_date || '').trim();
        if (title.length < 3 || !date || Number.isNaN(new Date(date).getTime())) {
          return sendJson(res, 400, { error: 'INVALID_EVENT', message: 'A title and a valid event date are required.' }), true;
        }
        const id = body.id || newId('evt');
        const existing = body.id ? db.prepare('SELECT * FROM studio_events WHERE id = ?').get(body.id) : null;
        const checkinCode = String(body.checkin_code || (existing && existing.checkin_code) || crypto.randomBytes(3).toString('hex').toUpperCase());
        const official = wantsOfficial || (existing ? Boolean(existing.is_official_studio_event) : false);
        const organizerName = official ? 'Shaun David Studios' : String(body.organizer_name || (existing && existing.organizer_name) || 'Community organizer');
        const values = [
          title,
          String(body.banner_type || (existing && existing.banner_type) || 'sunset_jam'),
          String(body.description || (existing && existing.description) || ''),
          String(body.schedule_text || (existing && existing.schedule_text) || date),
          date,
          String(body.district || (existing && existing.district) || 'Colombo'),
          String(body.venue || (existing && existing.venue) || ''),
          String(body.registration_deadline || (existing && existing.registration_deadline) || date),
          clamp(body.capacity || (existing && existing.capacity) || 60, 2, 5000),
          official ? 1 : 0,
          String(body.status || (existing && existing.status) || 'upcoming'),
          String(body.cancellation_notice || (existing && existing.cancellation_notice) || ''),
          String(body.eligibility_requirements || (existing && existing.eligibility_requirements) || ''),
          String(body.equipment_safety_requirements || (existing && existing.equipment_safety_requirements) || ''),
          String(body.organizer_contact || (existing && existing.organizer_contact) || ''),
          JSON.stringify(body.announcements || (existing ? parseJson(existing.announcements_json, []) : [])),
          String(body.post_event_recap || (existing && existing.post_event_recap) || ''),
          user.id,
          String(body.category || (existing && existing.category) || 'community'),
          organizerName,
          String(body.rules_text || (existing && existing.rules_text) || ''),
          String(body.safety_requirements || (existing && existing.safety_requirements) || ''),
          body.featured_on_home === true ? 1 : existing ? existing.featured_on_home : 0,
          body.waitlist_enabled === false ? 0 : 1,
          checkinCode,
          String(body.cancellation_deadline || (existing && existing.cancellation_deadline) || ''),
          String(body.minor_policy || (existing && existing.minor_policy) || ''),
          nowIso()
        ];
        if (existing) {
          db.prepare(
            `UPDATE studio_events SET title = ?, banner_type = ?, description = ?, schedule_text = ?, event_date = ?, district = ?,
               venue = ?, registration_deadline = ?, capacity = ?, is_official_studio_event = ?, status = ?, cancellation_notice = ?,
               eligibility_requirements = ?, equipment_safety_requirements = ?, organizer_contact = ?, announcements_json = ?,
               post_event_recap = ?, created_by_admin_id = ?, category = ?, organizer_name = ?, rules_text = ?,
               safety_requirements = ?, featured_on_home = ?, waitlist_enabled = ?, checkin_code = ?, cancellation_deadline = ?,
               minor_policy = ?, updated_at = ? WHERE id = ?`
          ).run(...values, id);
        } else {
          db.prepare(
            `INSERT INTO studio_events (id, title, banner_type, description, schedule_text, event_date, district, venue,
               registration_deadline, capacity, is_official_studio_event, status, cancellation_notice, eligibility_requirements,
               equipment_safety_requirements, organizer_contact, announcements_json, post_event_recap, created_by_admin_id,
               category, organizer_name, rules_text, safety_requirements, featured_on_home, waitlist_enabled, checkin_code,
               cancellation_deadline, minor_policy, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id, ...values, nowIso());
        }
        auditAdmin(user.id, existing ? 'event_updated' : 'event_created', 'event', id, title, {
          official,
          featured: body.featured_on_home === true
        });
        if (body.notify_members === true) {
          const riders = db.prepare("SELECT id FROM users_private WHERE account_status = 'active' LIMIT 5000").all();
          for (const r of riders) {
            notifier.notify({
              userId: r.id,
              type: 'event_announcement',
              title: official ? `Official studio event: ${title}` : `Community event: ${title}`,
              body: `${date} · ${body.venue || body.district || 'Sri Lanka'}`,
              referenceType: 'event',
              referenceId: id,
              deepLink: '#/events'
            });
          }
        }
        return sendJson(res, existing ? 200 : 201, {
          id,
          eventId: id,
          checkin_code: checkinCode,
          message: `Event ${existing ? 'updated' : 'published'}.`
        }), true;
      }

      const adminEventMatch = pathname.match(/^\/api\/admin\/events\/([^/]+)\/(feature|announce|results|gallery|remind)$/);
      if (adminEventMatch && req.method === 'POST') {
        const eventId = decodeURIComponent(adminEventMatch[1]);
        const action = adminEventMatch[2];
        const event = db.prepare('SELECT * FROM studio_events WHERE id = ?').get(eventId);
        if (!event) return sendJson(res, 404, { error: 'EVENT_NOT_FOUND' }), true;
        const body = await readJsonBody(req);

        if (action === 'feature') {
          if (user.role !== 'admin') return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only studio admins can feature events on the home screen.' }), true;
          if (body.featured === true && !event.is_official_studio_event) {
            return sendJson(res, 400, { error: 'NOT_OFFICIAL', message: 'Only official studio events can be featured on the home screen.' }), true;
          }
          db.prepare('UPDATE studio_events SET featured_on_home = ? WHERE id = ?').run(body.featured === true ? 1 : 0, eventId);
          auditAdmin(user.id, 'event_featured', 'event', eventId, event.title, { featured: body.featured === true });
          return sendJson(res, 200, { featured_on_home: body.featured === true }), true;
        }

        if (action === 'announce') {
          const title = String(body.title || '').trim().slice(0, 140);
          const text = String(body.body || '').trim().slice(0, 3000);
          if (title.length < 3 || text.length < 3) return sendJson(res, 400, { error: 'INVALID_ANNOUNCEMENT' }), true;
          const id = newId('eva');
          db.prepare('INSERT INTO event_announcements (id, event_id, title, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            id,
            eventId,
            title,
            text,
            user.id,
            nowIso()
          );
          const anns = db.prepare('SELECT * FROM event_announcements WHERE event_id = ? ORDER BY created_at DESC').all(eventId);
          const regs = db.prepare("SELECT user_id FROM event_registrations WHERE event_id = ? AND status = 'registered'").all(eventId);
          for (const r of regs) {
            notifier.notify({
              userId: r.user_id,
              type: 'event_announcement',
              title: `${event.title}: ${title}`,
              body: text.slice(0, 160),
              referenceType: 'event',
              referenceId: eventId,
              deepLink: '#/events'
            });
          }
          auditAdmin(user.id, 'event_announced', 'event', eventId, title, { recipients: regs.length });
          return sendJson(res, 201, { id, announcements: anns, message: `Announcement sent to ${regs.length} registrants.` }), true;
        }

        if (action === 'results') {
          if (user.role !== 'admin') return sendJson(res, 403, { error: 'FORBIDDEN' }), true;
          const entries = Array.isArray(body.results) ? body.results.slice(0, 100) : [];
          db.prepare('DELETE FROM event_results WHERE event_id = ?').run(eventId);
          for (const e of entries) {
            db.prepare(
              'INSERT INTO event_results (id, event_id, category, rider_name, placement, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(newId('evr'), eventId, String(e.category || 'open'), String(e.rider_name || '').slice(0, 120), Number(e.placement) || null, String(e.note || '').slice(0, 300), nowIso());
          }
          auditAdmin(user.id, 'event_results_published', 'event', eventId, event.title, { count: entries.length });
          return sendJson(res, 200, { message: 'Results saved.' }), true;
        }

        if (action === 'gallery') {
          const url = String(body.media_url || '').trim();
          if (!/^https:\/\//.test(url) && !url.startsWith('/assets/')) {
            return sendJson(res, 400, { error: 'INVALID_MEDIA_URL', message: 'Gallery media must be an HTTPS URL.' }), true;
          }
          const id = newId('evg');
          db.prepare('INSERT INTO event_gallery (id, event_id, media_url, caption, uploaded_by, approved, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
            id,
            eventId,
            url,
            String(body.caption || '').slice(0, 200),
            user.id,
            nowIso()
          );
          auditAdmin(user.id, 'event_gallery_updated', 'event', eventId, event.title, {});
          return sendJson(res, 201, { id, message: 'Gallery image added.' }), true;
        }

        if (action === 'remind') {
          const regs = db.prepare("SELECT user_id FROM event_registrations WHERE event_id = ? AND status = 'registered'").all(eventId);
          let sent = 0;
          for (const r of regs) {
            const created = notifier.notify({
              userId: r.user_id,
              type: 'event_reminder',
              title: `Reminder: ${event.title}`,
              body: `${event.event_date} · ${event.venue}. Bring your helmet and check your bike before travelling.`,
              referenceType: 'event',
              referenceId: eventId,
              deepLink: '#/events'
            });
            if (created) sent++;
          }
          auditAdmin(user.id, 'event_reminder_sent', 'event', eventId, event.title, { sent });
          return sendJson(res, 200, { message: `Reminder queued for ${sent} registrants.`, sent }), true;
        }
      }
    }

    return false;
  };
};
