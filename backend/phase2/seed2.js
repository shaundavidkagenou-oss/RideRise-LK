// RideRise LK Phase 2 — idempotent seed data. Adds learning pathways, guild
// voice channels, notification defaults, official studio news and event
// metadata without touching existing Phase 1 rows.
'use strict';

const { nowIso, newId } = require('./core');

const PATHWAYS = [
  {
    slug: 'foundations',
    title: 'Safe foundations',
    track: 'beginner',
    icon: '🧱',
    description:
      'Balance, braking and bike control before any trick. Every later pathway assumes these skills and this inspection routine.',
    match: (m) => m.category === 'fundamentals',
    order: 1
  },
  {
    slug: 'first-air',
    title: 'First air & beginner freestyle',
    track: 'beginner',
    icon: '🛫',
    description: 'Small, controlled manoeuvres in a legal skatepark or practice area, building on the foundations.',
    match: (m) => m.category === 'beginner_freestyle',
    order: 2
  },
  {
    slug: 'flow-progression',
    title: 'Intermediate flow',
    track: 'intermediate',
    icon: '🌊',
    description: 'Linked manoeuvres and higher commitment. Supervised practice in a controlled environment is strongly recommended.',
    match: (m) => m.category === 'intermediate',
    order: 3
  },
  {
    slug: 'advanced-air',
    title: 'Advanced air (coaching required)',
    track: 'advanced',
    icon: '🚀',
    description:
      'High-consequence manoeuvres. These are reference lessons, not certifications — work with a qualified coach and never on public roads.',
    match: (m) => m.category === 'advanced',
    order: 4
  },
  {
    slug: 'maintenance-inspection',
    title: 'Maintenance & equipment inspection',
    track: 'maintenance',
    icon: '🔧',
    description:
      'A rider-maintainable inspection and care track. A mechanically sound bicycle is the single biggest safety factor you control.',
    match: () => false,
    order: 5
  }
];

function seedPhase2(db) {
  const now = nowIso();

  /* ------------------------------- pathways ------------------------------- */
  const insertPathway = db.prepare(
    `INSERT OR IGNORE INTO learning_pathways (id, slug, title, track, description, icon, display_order, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );
  for (const p of PATHWAYS) insertPathway.run(`pth_${p.slug}`, p.slug, p.title, p.track, p.description, p.icon, p.order);

  // Backfill the Phase 2 track column for Phase 1 modules that never had one.
  db.exec(`UPDATE stunt_modules
             SET track = CASE category
               WHEN 'intermediate' THEN 'intermediate'
               WHEN 'advanced' THEN 'advanced'
               ELSE 'beginner' END
           WHERE updated_at IS NULL`);

  const modules = db.prepare("SELECT * FROM stunt_modules WHERE status = 'published'").all();
  const linkModule = db.prepare(
    'INSERT OR IGNORE INTO learning_pathway_modules (pathway_id, module_id, display_order) VALUES (?, ?, ?)'
  );
  for (const p of PATHWAYS) {
    if (p.slug === 'maintenance-inspection') continue;
    modules.filter(p.match).forEach((m, index) => linkModule.run(`pth_${p.slug}`, m.id, index + 1));
  }

  // Maintenance track: a real, text-only inspection pathway built from the
  // Phase 1 safety checklist. No invented video or product content.
  const maintenanceModules = [
    {
      id: 'stm_maint_pre_ride',
      slug: 'pre-ride-inspection',
      title: 'Pre-ride inspection routine',
      difficulty: 'Beginner',
      track: 'maintenance',
      xp: 30,
      order: 900
    },
    {
      id: 'stm_maint_brakes',
      slug: 'brake-check-and-adjustment-basics',
      title: 'Brake check and adjustment basics',
      difficulty: 'Beginner',
      track: 'maintenance',
      xp: 30,
      order: 901
    },
    {
      id: 'stm_maint_drivetrain',
      slug: 'drivetrain-clean-and-lube',
      title: 'Drivetrain cleaning and lubrication',
      difficulty: 'Beginner',
      track: 'maintenance',
      xp: 25,
      order: 902
    },
    {
      id: 'stm_maint_tires',
      slug: 'tire-pressure-and-wear',
      title: 'Tire pressure, tread and sidewall checks',
      difficulty: 'Beginner',
      track: 'maintenance',
      xp: 25,
      order: 903
    }
  ];

  const insertMaintenance = db.prepare(
    `INSERT OR IGNORE INTO stunt_modules (
       id, slug, category, track, title, difficulty, xp_reward, prerequisites_json, bike_suitability,
       protective_gear_json, safe_environment, inspection_checklist_json, learning_stages_json,
       common_errors_json, stop_conditions_json, coaching_reminder, diagram_type, quiz_questions_json,
       requires_safety_ack, display_order, learning_objectives_json, why_prerequisites_json,
       requires_supervision, status, version, updated_at, visibility)
     VALUES (?, ?, 'fundamentals', ?, ?, ?, ?, '[]', 'Any bicycle you ride',
       '[]', 'At home or a workshop, before you ride',
       ?, ?, ?, ?, ?, 'inspection', ?, 0, ?, ?, '[]', 0, 'published', 1, ?, 'learning_only')`
  );

  const maintenanceContent = {
    stm_maint_pre_ride: {
      checklist: [
        'Spin both wheels and look for wobble, loose spokes or damaged rims',
        'Squeeze both brakes — levers should firm up well before the bar',
        'Check tyre pressure and sidewalls for cracks or embedded glass',
        'Rock the bike and feel for headset or stem play',
        'Check that the handlebar end plugs are fitted',
        'Lift the bike and spin the cranks — no grinding or skipping',
        'Confirm the seat post and quick releases are tight'
      ],
      stages: [
        'Do this in the same order every ride so nothing is skipped.',
        'Fix or flag anything that fails before moving the bike.',
        'If you are not confident, ask a qualified mechanic — do not improvise on brakes or steering.'
      ],
      errors: [
        'Checking only the front brake and assuming the rear is fine',
        'Riding with missing bar end plugs after a fall',
        'Ignoring a cracked sidewall because the tyre still holds air'
      ],
      stop: [
        'Any crack in the frame, fork or handlebar',
        'A brake that does not stop the bike reliably',
        'Loose headset or stem that cannot be tightened to spec'
      ],
      quiz: [
        {
          prompt: 'You find a small crack where the fork meets the crown. What do you do?',
          options: ['Ride gently and watch it', 'Stop riding and have it inspected by a qualified mechanic', 'Cover it with tape'],
          correctIndex: 1,
          explanation: 'Fork cracks can fail without warning. Stop riding and get professional inspection.'
        },
        {
          prompt: 'Correctly adjusted brakes should feel…',
          options: ['Spongy until the lever touches the bar', 'Firm well before the lever reaches the bar', 'Completely solid with zero travel'],
          correctIndex: 1,
          explanation: 'You need firm braking well before the lever bottoms out, with some modulation travel left.'
        }
      ]
    },
    stm_maint_brakes: {
      checklist: [
        'Inspect pads for wear beyond the manufacturer limit',
        'Check cables for fraying, kinks or rust',
        'Verify both brake arms return freely',
        'Test braking at walking speed in a safe, empty area'
      ],
      stages: [
        'Understand your brake type before adjusting anything.',
        'Change one thing at a time and re-test at walking speed.',
        'If a brake cannot be adjusted to stop reliably, replace the pads/cable or visit a shop.'
      ],
      errors: ['Over-tightening a cable and removing all modulation', 'Adjusting pads with the wheel removed', 'Mixing brake pad compounds incorrectly'],
      stop: ['Frayed cable that cannot be replaced immediately', 'Any hydraulic leak', 'Braking performance that changes between rides'],
      quiz: [
        {
          prompt: 'What is the safest first step when brakes feel weak?',
          options: ['Ride faster to test them', 'Inspect pads, cables and adjustment at walking speed in a safe area', 'Only use the rear brake'],
          correctIndex: 1,
          explanation: 'Diagnose at low speed in a safe area before any real riding.'
        }
      ]
    },
    stm_maint_drivetrain: {
      checklist: [
        'Check chain wear with a gauge or shop measurement',
        'Clean the chain with a suitable degreaser away from drains',
        'Apply chain lubricant appropriate to your conditions',
        'Wipe excess lubricant and check shifting through the gears'
      ],
      stages: ['Clean before lubricating.', 'One drop per link is enough.', 'Check the chain for stiff links and wear.'],
      errors: ['Over-lubricating and attracting grit', 'Using the wrong lubricant for wet conditions', 'Ignoring a worn chain that damages the cassette'],
      stop: ['A chain worn beyond the replacement limit', 'A cracked chain link', 'A bottom bracket with significant play'],
      quiz: [
        {
          prompt: 'A worn chain should be…',
          options: ['Left until it breaks', 'Replaced before it damages the cassette and chainrings', 'Oiled more often'],
          correctIndex: 1,
          explanation: 'Replacing a worn chain early protects the rest of the drivetrain.'
        }
      ]
    },
    stm_maint_tires: {
      checklist: [
        'Check the pressure stated on the tyre sidewall or rim',
        'Inspect tread and sidewalls for cuts, bulges or embedded debris',
        'Check rim tape and spokes through the tyre bead',
        'Confirm both wheels are seated and quick releases are closed'
      ],
      stages: ['Match pressure to your weight and terrain.', 'Remove embedded glass with the tyre deflated.', 'Replace tyres with sidewall damage.'],
      errors: ['Running extremely low pressure and denting rims', 'Riding with a bulging sidewall', 'Forgetting to close a quick release'],
      stop: ['Any sidewall bulge or cut through the casing', 'A rim dent that affects braking', 'Repeated pinch flats on the same rim'],
      quiz: [
        {
          prompt: 'A bulge in the tyre sidewall means…',
          options: ['It needs more air', 'The casing is damaged and the tyre should be replaced', 'It is fine for park riding'],
          correctIndex: 1,
          explanation: 'A bulge indicates casing damage and a risk of sudden failure.'
        }
      ]
    }
  };

  for (const m of maintenanceModules) {
    const content = maintenanceContent[m.id];
    insertMaintenance.run(
      m.id,
      m.slug,
      m.track,
      m.title,
      m.difficulty,
      m.xp,
      JSON.stringify(content.checklist),
      JSON.stringify(content.stages),
      JSON.stringify(content.errors),
      JSON.stringify(content.stop),
      'A mechanically sound bicycle is your first safety system. If you are unsure, stop and ask a qualified mechanic.',
      JSON.stringify(content.quiz),
      m.order,
      JSON.stringify(['Understand what to inspect and why', 'Build a repeatable pre-ride routine']),
      now
    );
    linkModule.run('pth_maintenance-inspection', m.id, m.order - 899);
  }
  db.exec("UPDATE stunt_modules SET visibility = 'learning_only' WHERE id LIKE 'stm_maint_%'");

  /* --------------------------- guild defaults ----------------------------- */
  const guilds = db.prepare('SELECT * FROM guilds').all();
  const insertSettings = db.prepare(
    `INSERT OR IGNORE INTO guild_settings (guild_id, location_sharing_enabled, voice_enabled, walkie_enabled,
       activity_visible, rules_text, welcome_message, updated_at) VALUES (?, 1, 1, 1, 1, ?, ?, ?)`
  );
  const insertRoom = db.prepare(
    `INSERT OR IGNORE INTO voice_rooms (id, guild_id, name, kind, min_role, max_participants,
       max_transmission_seconds, is_active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  for (const g of guilds) {
    insertSettings.run(
      g.id,
      'Be respectful. No harassment, no dangerous stunts on public roads, no sharing another rider’s private information.',
      'Welcome! Inspect your bike, wear a helmet and ride within your limits.',
      now
    );
    const hasRooms = db.prepare('SELECT COUNT(*) AS c FROM voice_rooms WHERE guild_id = ?').get(g.id).c;
    if (!hasRooms) {
      insertRoom.run(newId('vrg'), g.id, 'Guild voice', 'group', 'member', 8, 30, g.owner_id, now);
      insertRoom.run(newId('vwr'), g.id, 'Walkie · Channel 1', 'walkie', 'member', 6, 30, g.owner_id, now);
      insertRoom.run(newId('vwr'), g.id, 'Walkie · Organisers', 'walkie', 'moderator', 6, 30, g.owner_id, now);
    }
  }

  /* ----------------------- notification preferences ----------------------- */
  const users = db.prepare('SELECT id FROM users_private').all();
  const insertPrefs = db.prepare(
    `INSERT OR IGNORE INTO notification_preferences (user_id, messages, friend_requests, guild_invites, events,
       moderation, news, show_previews, quiet_hours_start, quiet_hours_end, updated_at)
     VALUES (?, 1, 1, 1, 1, 1, 1, 1, NULL, NULL, ?)`
  );
  for (const u of users) insertPrefs.run(u.id, now);

  /* --------------------------- events metadata ---------------------------- */
  const events = db.prepare('SELECT * FROM studio_events').all();
  for (const e of events) {
    if (!e.checkin_code) {
      db.prepare('UPDATE studio_events SET checkin_code = ? WHERE id = ?').run(
        String(e.id).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || 'RIDE01',
        e.id
      );
    }
    if (!e.organizer_name) {
      db.prepare("UPDATE studio_events SET organizer_name = 'Shaun David Studios' WHERE id = ?").run(e.id);
    }
    if (e.is_official_studio_event && e.status !== 'past' && e.featured_on_home === 0) {
      const featured = db.prepare('SELECT COUNT(*) AS c FROM studio_events WHERE featured_on_home = 1').get().c;
      if (featured === 0) db.prepare('UPDATE studio_events SET featured_on_home = 1 WHERE id = ?').run(e.id);
    }
  }

  /* ------------------------------ studio news ----------------------------- */
  const newsCount = db.prepare('SELECT COUNT(*) AS c FROM studio_news').get().c;
  if (newsCount === 0) {
    const adminUser = db.prepare("SELECT id FROM users_private WHERE role = 'admin' LIMIT 1").get();
    const insertNews = db.prepare(
      `INSERT INTO studio_news (id, title, body, category, pinned, published, is_official, author_admin_id, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    );
    insertNews.run(
      newId('news'),
      'Phase 2 is live: guild maps, voice, walkie-talkie and learning pathways',
      'Guild maps are opt-in and approximate by default. Voice rooms and walkie-talkie channels use your guild membership for access, and nothing is recorded. Learning pathways now include a maintenance and inspection track.\n\nLive location sharing is off until you explicitly turn it on, shows an approximate area for riders aged 16–17, and stops automatically when the session ends.',
      'announcement',
      1,
      adminUser ? adminUser.id : null,
      now,
      now
    );
    insertNews.run(
      newId('news'),
      'Safety reminder: RideRise LK is education, not certification',
      'Completing a learning module does not mean a manoeuvre is safe for you. Practise in legal, controlled areas away from traffic and pedestrians, wear certified protective equipment, inspect your bicycle, and get qualified in-person coaching for advanced skills.\n\nNever ride stunts on public roads, in traffic, or near pedestrians.',
      'safety',
      0,
      adminUser ? adminUser.id : null,
      now,
      now
    );
  }

  /* ------------------------------- settings ------------------------------- */
  const settings = {
    'dm.retention_days': Number(process.env.DM_RETENTION_DAYS || 365),
    'map.default_provider': process.env.MAP_PROVIDER || 'openstreetmap',
    'voice.recording_enabled': false,
    'live_location.default_radius_m': 750,
    'live_location.minor_radius_m': 1500
  };
  const setSetting = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
  );
  for (const [key, value] of Object.entries(settings)) setSetting.run(key, JSON.stringify(value), now);
}

module.exports = { seedPhase2 };
