// RideRise LK by Shaun David Studios — Authentic Phase 1 Database Seeder
const { calculateBikeBuildRating } = require('./services');

const DRAFT_SAFETY_NOTICE_VERBATIM = `Bicycle riding and stunt riding involve inherent risks, including serious injury, permanent disability, or death. RideRise LK provides community features and educational information; it does not supervise individual riding activities, certify a rider's ability, or guarantee that user-generated information is accurate or safe. Users should ride only in lawful, suitable, controlled environments, use appropriate protective equipment, inspect their bicycles, and seek qualified instruction. Do not perform stunts on busy roads, among traffic, or near pedestrians. Participation in riding activities is voluntary and at the user's own risk to the extent permitted by applicable law. Nothing in these terms excludes or limits any responsibility that cannot legally be excluded. Shaun David Studios does not guarantee the safety of third-party sellers, products, events, or user posts.`;

/**
 * Product content is always seeded: ranks, achievements, the 21-module stunt library, its
 * learning pathways, the draft legal documents and one non-personal studio account.
 *
 * Sample community content (riders, bikes, guilds, posts, messages, events, catalog prices,
 * moderation queue) is opt-in and development-only:
 *
 *   SEED_DEMO=1  seed the sample community too (local development, tests)
 *   unset        product content only — what every real deployment gets
 *
 * The sample riders are inert: their Firebase UIDs are local placeholders that no real
 * Firebase project can issue, so they cannot be signed into by anyone.
 */
function resolveDemoSeed(explicit) {
  // Production never receives sample riders, sample posts or sample prices, whatever the
  // environment says. Sample content exists only for local development and the test suite.
  if (process.env.NODE_ENV === 'production') return false;
  if (typeof explicit === 'boolean') return explicit;
  return String(process.env.SEED_DEMO || '').trim() === '1';
}

function seedDatabase(db, options = {}) {
  const existingRanks = db.prepare('SELECT COUNT(*) as c FROM ranks').get().c;
  if (existingRanks > 0) return;

  const demo = resolveDemoSeed(options.demo);
  const now = '2026-10-25T05:00:00.000Z';

  // 1. Seed 7 Configurable Rider Ranks
  const ranks = [
    {
      id: 'rank_1',
      level_order: 1,
      name: 'Rookie Rider',
      min_xp: 0,
      badge_icon: 'shield-seedling',
      color_hex: '#94A3B8',
      description: 'Beginning the journey: focused on bike fit, helmet habit, braking fundamentals, and pre-ride inspection.'
    },
    {
      id: 'rank_2',
      level_order: 2,
      name: 'Street Explorer',
      min_xp: 150,
      badge_icon: 'compass-wheel',
      color_hex: '#38BDF8',
      description: 'Consistent safety checks, basic trackstand balance, and positive community participation.'
    },
    {
      id: 'rank_3',
      level_order: 3,
      name: 'Balance Builder',
      min_xp: 350,
      badge_icon: 'scale-balance',
      color_hex: '#10B981',
      description: 'Demonstrates solid low-speed control, safe turning mechanics, and front-wheel lift control.'
    },
    {
      id: 'rank_4',
      level_order: 4,
      name: 'Trick Apprentice',
      min_xp: 650,
      badge_icon: 'bolt-sprocket',
      color_hex: '#F59E0B',
      description: 'Completed beginner freestyle progressions, bunny-hop fundamentals, and skatepark flow etiquette.'
    },
    {
      id: 'rank_5',
      level_order: 5,
      name: 'Stunt Specialist',
      min_xp: 1050,
      badge_icon: 'star-crank',
      color_hex: '#FF6B00',
      description: 'Mastered intermediate control drills, manual balance, and bike maintenance mentorship.'
    },
    {
      id: 'rank_6',
      level_order: 6,
      name: 'Freestyle Elite',
      min_xp: 1600,
      badge_icon: 'crown-flame',
      color_hex: '#FFB800',
      description: 'Exemplary technical understanding, safety leadership, and community guild contributor.'
    },
    {
      id: 'rank_7',
      level_order: 7,
      name: 'Ride Legend',
      min_xp: 2400,
      badge_icon: 'trophy-lotus',
      color_hex: '#FFD700',
      description: 'Pinnacle ambassador of Sri Lankan bicycle stunt culture, safety advocacy, and rider education.'
    }
  ];

  const insertRank = db.prepare(
    'INSERT INTO ranks (id, level_order, name, min_xp, badge_icon, color_hex, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const r of ranks) {
    insertRank.run(r.id, r.level_order, r.name, r.min_xp, r.badge_icon, r.color_hex, r.description);
  }

  // 2. Seed Achievements
  const achievements = [
    {
      id: 'ach_safety_first',
      code: 'SAFETY_FIRST',
      title: 'Safety First Inspector',
      description: 'Completed the 7-point Pre-Ride Bicycle Safety Checklist and verified helmet & brake readiness.',
      xp_reward: 35,
      icon: 'helmet-check',
      category: 'safety'
    },
    {
      id: 'ach_fundamentals_grad',
      code: 'FUNDAMENTALS_GRAD',
      title: 'Fundamentals Graduate',
      description: 'Completed core Fundamentals modules with passing safety quiz scores.',
      xp_reward: 60,
      icon: 'book-sprocket',
      category: 'learning'
    },
    {
      id: 'ach_build_documented',
      code: 'BUILD_DOCUMENTED',
      title: 'Transparent Wrench',
      description: 'Completed the 13-part Bicycle Profile & Build Rating Questionnaire with honest condition disclosures.',
      xp_reward: 45,
      icon: 'wrench-badge',
      category: 'maintenance'
    },
    {
      id: 'ach_community_helper',
      code: 'COMMUNITY_HELPER',
      title: 'Lanka Pit Crew Helper',
      description: 'Shared helpful maintenance tips or answered fellow riders’ technical questions positively.',
      xp_reward: 50,
      icon: 'hands-helping',
      category: 'community'
    },
    {
      id: 'ach_guild_rider',
      code: 'GUILD_RIDER',
      title: 'Guild Team Player',
      description: 'Joined or founded a Sri Lankan riding guild and upheld Community Guidelines.',
      xp_reward: 40,
      icon: 'shield-guild',
      category: 'guild'
    },
    {
      id: 'ach_studio_event',
      code: 'STUDIO_EVENT',
      title: 'Studio Session Participant',
      description: 'Registered for an official Shaun David Studios safety clinic or community jam.',
      xp_reward: 50,
      icon: 'calendar-star',
      category: 'events'
    }
  ];

  const insertAch = db.prepare(
    'INSERT INTO achievements (id, code, title, description, xp_reward, icon, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const a of achievements) {
    insertAch.run(a.id, a.code, a.title, a.description, a.xp_reward, a.icon, a.category);
  }

  // 3. Seed Users & Profiles (Strict separation of users_private and profiles)
  // Production gets exactly one account: "Shaun David Studios", the author of official content
  // and the identity the admin console links to. It has no password and cannot sign in through
  // Firebase; console access uses the separate admin credential.
  const sampleUsers = demo ? [
    {
      id: 'usr_admin_nethmi',
      google_sub: 'google_oauth_sub_admin_001',
      firebase_uid: 'demo-uid-admin-001',
      email: 'nethmi.admin@shaundavidstudios.lk',
      dob_private: '1997-04-12',
      is_minor: 0,
      role: 'admin',
      username: 'nethmi_sds',
      display_name: 'Nethmi Jayawardena (Studio Admin)',
      bio: 'Lead Community & Safety Coordinator at Shaun David Studios. Dedicated to safe BMX progression and mechanics across Sri Lanka.',
      district: 'Colombo',
      preferred_riding_area: 'Independence Square & Viharamahadevi Park Perimeter (Designated Zones)',
      xp: 2550,
      rank_id: 'rank_7',
      profile_visibility: 'public',
      hide_from_leaderboards: 0
    },
    {
      id: 'usr_kasun',
      google_sub: 'google_oauth_sub_kasun_002',
      firebase_uid: 'demo-uid-kasun-002',
      email: 'kasun.perera.private@example.com',
      dob_private: '2001-08-19',
      is_minor: 0,
      role: 'rider',
      username: 'kasun_bmx_lk',
      display_name: 'Kasun Perera',
      bio: '20" Chromoly street & park rider from Southern Province. Happy to help beginners dial in their bunny hops and U-brakes!',
      district: 'Kalutara (incl. Bentota)',
      preferred_riding_area: 'Bentota Coastal Practice Court & Galle Skate Spot',
      xp: 1720,
      rank_id: 'rank_6',
      profile_visibility: 'public',
      hide_from_leaderboards: 0
    },
    {
      id: 'usr_roshan',
      google_sub: 'google_oauth_sub_roshan_003',
      firebase_uid: 'demo-uid-roshan-003',
      email: 'roshan.fernando.private@example.com',
      dob_private: '2003-11-05',
      is_minor: 0,
      role: 'moderator',
      username: 'roshan_dirtjump',
      display_name: 'Roshan Fernando',
      bio: '26" Dirt Jumper & MTB trail builder in Kandy. Always check your spoke tension and wear a certified helmet.',
      district: 'Kandy',
      preferred_riding_area: 'Hanthana Lower Practice Pump Track',
      xp: 1180,
      rank_id: 'rank_5',
      profile_visibility: 'public',
      hide_from_leaderboards: 0
    },
    {
      id: 'usr_dilshan_minor',
      google_sub: 'google_oauth_sub_dilshan_004',
      firebase_uid: 'demo-uid-dilshan-004',
      email: 'dilshan.student.private@example.com',
      dob_private: '2009-06-15', // 17 years old in Oct 2026 -> minor safeguards active!
      is_minor: 1,
      role: 'rider',
      username: 'dilshan_rides',
      display_name: 'Dilshan S.',
      bio: 'Learning fundamentals and balance drills on my first 20" freestyle bike.',
      district: 'Galle',
      preferred_riding_area: 'Galle Municipal Court (Weekend Practice)',
      xp: 240,
      rank_id: 'rank_2',
      profile_visibility: 'friends',
      hide_from_leaderboards: 1
    }
  ] : [
    {
      id: 'usr_studio',
      google_sub: 'studio_account_local',
      email: 'support@shaundavidstudios.lk',
      // System account, not a person: the date exists only to satisfy the 16+ schema.
      dob_private: '1990-01-01',
      is_minor: 0,
      role: 'admin',
      username: 'shaundavidstudios',
      display_name: 'Shaun David Studios',
      bio: 'Official RideRise LK studio account — announcements, safety notices and moderation.',
      district: 'Colombo',
      preferred_riding_area: 'Studio account (no public riding location)',
      xp: 0,
      rank_id: 'rank_1',
      profile_visibility: 'public',
      hide_from_leaderboards: 1
    }
  ];

  const insertPrivateUser = db.prepare(`
    INSERT INTO users_private (
      id, google_sub, firebase_uid, auth_provider, email_verified_at, email, dob_private,
      is_minor, age_confirmed, age_confirmed_at, terms_accepted_version, terms_accepted_at,
      privacy_accepted_at, guidelines_accepted_at, safety_notice_accepted_at,
      onboarding_completed, role, account_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '1.0', ?, ?, ?, ?, 1, ?, 'active', ?, ?)
  `);

  const insertProfile = db.prepare(`
    INSERT INTO profiles (
      user_id, username, display_name, bio, avatar_url, district, preferred_riding_area,
      xp, rank_id, profile_visibility, hide_from_leaderboards, allow_friend_requests,
      allow_messages_from, notifications_enabled, reduced_motion, locale, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'friends_only', 1, 0, 'en', ?, ?)
  `);

  for (const u of sampleUsers) {
    const firebaseUid = u.firebase_uid || null;
    insertPrivateUser.run(
      u.id,
      u.google_sub,
      firebaseUid,
      firebaseUid ? 'firebase' : 'legacy',
      firebaseUid ? now : null,
      u.email,
      u.dob_private,
      u.is_minor,
      now,
      now,
      now,
      now,
      now,
      u.role,
      now,
      now
    );
    insertProfile.run(
      u.id,
      u.username,
      u.display_name,
      u.bio,
      '/assets/brand/riderise_logo.png',
      u.district,
      u.preferred_riding_area,
      u.xp,
      u.rank_id,
      u.profile_visibility,
      u.hide_from_leaderboards,
      now,
      now
    );
  }

  if (demo) {
  // Award sample achievements
  const insertUserAch = db.prepare(
    'INSERT INTO user_achievements (id, user_id, achievement_id, awarded_at, awarded_reason) VALUES (?, ?, ?, ?, ?)'
  );
  insertUserAch.run('ua_1', 'usr_kasun', 'ach_safety_first', now, 'Completed pre-ride safety checklist');
  insertUserAch.run('ua_2', 'usr_kasun', 'ach_fundamentals_grad', now, 'Completed all 6 Fundamentals modules');
  insertUserAch.run('ua_3', 'usr_kasun', 'ach_build_documented', now, 'Completed full 13-question Bike Build profile');
  insertUserAch.run('ua_4', 'usr_kasun', 'ach_guild_rider', now, 'Founded Southern Coast BMX Guild');
  insertUserAch.run('ua_5', 'usr_roshan', 'ach_safety_first', now, 'Completed pre-ride safety checklist');
  insertUserAch.run('ua_6', 'usr_dilshan_minor', 'ach_safety_first', now, 'Completed pre-ride safety checklist');

  // Seed XP Activity logs
  const insertXpLog = db.prepare(
    'INSERT INTO xp_activity_log (id, user_id, action_type, xp_delta, description, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertXpLog.run('xpl_1', 'usr_kasun', 'safety_checklist_completed', 25, 'Completed Pre-Ride 7-Point Safety Checklist', 'chk_init', now);
  insertXpLog.run('xpl_2', 'usr_kasun', 'stunt_module_completed', 50, 'Completed Module: Bunny-Hop Preparation & Fundamentals', 'mod_fund_6', now);
  insertXpLog.run('xpl_3', 'usr_kasun', 'bike_questionnaire_completed', 35, 'Completed Guided Bicycle Build & Safety Questionnaire', 'bike_kasun_1', now);
  insertXpLog.run('xpl_4', 'usr_kasun', 'official_event_registered', 30, 'Registered for Bentota Sunset BMX Clinic & Safety Jam', 'evt_sds_1', now);
  }

  if (demo) {
  // 4. Seed Bicycles with transparent 13-question Bike Build Ratings
  const sampleBikes = [
    {
      id: 'bike_kasun_1',
      user_id: 'usr_kasun',
      name: 'Southern Sunset 20.75" Custom BMX',
      is_primary: 1,
      bike_type: 'BMX',
      frame_material: 'Chromoly steel (4130 CrMo)',
      frame_brand: 'WeThePeople',
      frame_model: 'Justice 20.75" Full 4130',
      fork_spec: 'SaltPlus 4130 Chromoly tapered fork, 26mm offset',
      tire_spec: 'Odyssey Path Pro 20 x 2.40" (65 PSI street/park)',
      wheel_rim_spec: '20" Double-wall 36H alloy rims, sealed female front & 9T cassette rear hub',
      handlebar_grip_spec: '9.25" 2-piece Chromoly bars with ODI Longneck flangeless grips & nylon bar-ends',
      drivetrain_spec: '3-piece tubular 170mm CrMo 8-spline cranks, 25T alloy sprocket, half-link chain, nylon platform pedals',
      brake_type: 'Rear Odyssey Springfield U-Brake with linear cable',
      maintenance_condition: 'Excellent',
      safety_defects: [],
      primary_use: 'Skatepark',
      photos: {
        frame: '/assets/brand/riderise_logo.png',
        drivetrain: '/assets/brand/riderise_logo.png',
        tires: '/assets/brand/riderise_logo.png',
        brakes: '/assets/brand/riderise_logo.png',
        complete: '/assets/brand/riderise_logo.png'
      },
      cosmetic_rating: 5
    },
    {
      id: 'bike_kasun_2',
      user_id: 'usr_kasun',
      name: 'Old Practice Frame (Needs Repair — Comparison Demo)',
      is_primary: 0,
      bike_type: 'Freestyle Bike',
      frame_material: 'Chromoly steel (4130 CrMo)',
      frame_brand: 'Sunday',
      frame_model: 'Soundwave V3 (High-end aftermarket frame with reported hairline crack)',
      fork_spec: 'Odyssey R25 Chromoly Fork',
      tire_spec: 'Maxxis Grifter 20 x 2.30" (worn rear tread)',
      wheel_rim_spec: 'Double-wall 36H rims, sealed hubs',
      handlebar_grip_spec: '9.0" 4130 bars (missing right bar-end plug)',
      drivetrain_spec: '3-piece CrMo cranks, 25T-9T gearing',
      brake_type: 'Rear U-Brake (cable frayed)',
      maintenance_condition: 'Needs Service',
      safety_defects: ['cracks', 'faulty_brakes', 'missing_bar_ends'],
      primary_use: 'Street riding',
      photos: {
        complete: '/assets/brand/riderise_logo.png',
        frame: '/assets/brand/riderise_logo.png'
      },
      cosmetic_rating: 4
    },
    {
      id: 'bike_roshan_1',
      user_id: 'usr_roshan',
      name: 'Hanthana 26" Dirt Jumper Build',
      is_primary: 1,
      bike_type: 'Dirt Jumper',
      frame_material: 'Aluminium (6061-T6 Hydroformed)',
      frame_brand: 'Polygon',
      frame_model: 'Trid 26" DJ Frame',
      fork_spec: '100mm Air Dirt Jump Suspension Fork, 15x100mm thru-axle',
      tire_spec: 'Maxxis DTH 26 x 2.30" Skinwall',
      wheel_rim_spec: '26" Double-wall 32H pinned alloy rims, sealed disc hubs',
      handlebar_grip_spec: '760mm 31.8mm alloy riser bar with lock-on grips & alloy end caps',
      drivetrain_spec: 'Single-speed 32T-14T drivetrain with 2-piece hollow spindle crankset & sealed alloy pedals',
      brake_type: 'Rear Shimano MT200 Hydraulic Disc Brake (160mm rotor)',
      maintenance_condition: 'Good',
      safety_defects: [],
      primary_use: 'Dirt trails',
      photos: {
        frame: '/assets/brand/riderise_logo.png',
        drivetrain: '/assets/brand/riderise_logo.png',
        tires: '/assets/brand/riderise_logo.png',
        brakes: '/assets/brand/riderise_logo.png',
        complete: '/assets/brand/riderise_logo.png'
      },
      cosmetic_rating: 4
    }
  ];

  const insertBike = db.prepare(`
    INSERT INTO bicycles (
      id, user_id, name, is_primary, bike_type, frame_material, frame_brand, frame_model,
      fork_spec, tire_spec, wheel_rim_spec, handlebar_grip_spec, drivetrain_spec, brake_type,
      maintenance_condition, safety_defects_json, primary_use, photos_json, cosmetic_rating,
      build_score, score_breakdown_json, has_critical_safety_defect, safety_recommendation,
      verification_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const b of sampleBikes) {
    const rating = calculateBikeBuildRating(b);
    insertBike.run(
      b.id,
      b.user_id,
      b.name,
      b.is_primary,
      b.bike_type,
      b.frame_material,
      b.frame_brand,
      b.frame_model,
      b.fork_spec,
      b.tire_spec,
      b.wheel_rim_spec,
      b.handlebar_grip_spec,
      b.drivetrain_spec,
      b.brake_type,
      b.maintenance_condition,
      JSON.stringify(b.safety_defects),
      b.primary_use,
      JSON.stringify(b.photos),
      b.cosmetic_rating,
      rating.build_score,
      JSON.stringify(rating.breakdown),
      rating.has_critical_safety_defect,
      rating.safety_recommendation,
      rating.verification_status,
      now,
      now
    );
  }

  db.prepare('UPDATE profiles SET primary_bike_id = ? WHERE user_id = ?').run('bike_kasun_1', 'usr_kasun');
  db.prepare('UPDATE profiles SET primary_bike_id = ? WHERE user_id = ?').run('bike_roshan_1', 'usr_roshan');

  // 5. Seed Guilds (Public & Approval-Based Private)
  const guilds = [
    {
      id: 'gld_southern_bmx',
      name: 'Southern Coast BMX & Freestyle',
      emblem: 'sunset-wave',
      description: 'Bentota, Kalutara, Galle & Matara riders focused on flatground progressions, park sessions, and bike maintenance clinics.',
      category: 'BMX & Park Flow',
      district: 'Kalutara (incl. Bentota)',
      privacy_type: 'public',
      owner_id: 'usr_kasun',
      member_limit: 50,
      announcement: 'Saturday 4:30 PM Pre-Ride Safety Check & Bunny-Hop Clinic at Bentota Coastal Court. Helmets & bar-end plugs mandatory!'
    },
    {
      id: 'gld_colombo_builders',
      name: 'Colombo Custom Bike Builders',
      emblem: 'sprocket-crown',
      description: 'Dedicated to wheel truing, brake dialing, chromoly frame maintenance, and clean Sri Lankan custom bicycle builds.',
      category: 'Bike Customization & Mechanics',
      district: 'Colombo',
      privacy_type: 'public',
      owner_id: 'usr_admin_nethmi',
      member_limit: 50,
      announcement: 'New guide posted on inspecting 3-piece crank spindles and bottom bracket bearings after monsoon rides.'
    },
    {
      id: 'gld_kandy_dirt',
      name: 'Hill Country Pump & Trail Guild',
      emblem: 'mountain-shield',
      description: 'Approval-based guild for Kandy & Central Province dirt jumper and pump-track riders practicing in supervised off-road parks.',
      category: 'Dirt & Pump Track',
      district: 'Kandy',
      privacy_type: 'private',
      owner_id: 'usr_roshan',
      member_limit: 35,
      announcement: 'Private guild session notes: Trail surface inspection required after rain before any small drop drills.'
    }
  ];

  const insertGuild = db.prepare(`
    INSERT INTO guilds (
      id, name, emblem, description, category, district, privacy_type,
      owner_id, member_limit, announcement, moderation_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?)
  `);
  const insertGuildMember = db.prepare(`
    INSERT INTO guild_memberships (guild_id, user_id, role, status, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const g of guilds) {
    insertGuild.run(
      g.id, g.name, g.emblem, g.description, g.category, g.district,
      g.privacy_type, g.owner_id, g.member_limit, g.announcement, now
    );
  }
  insertGuildMember.run('gld_southern_bmx', 'usr_kasun', 'owner', 'active', now);
  insertGuildMember.run('gld_southern_bmx', 'usr_admin_nethmi', 'moderator', 'active', now);
  insertGuildMember.run('gld_southern_bmx', 'usr_dilshan_minor', 'member', 'active', now);
  insertGuildMember.run('gld_colombo_builders', 'usr_admin_nethmi', 'owner', 'active', now);
  insertGuildMember.run('gld_colombo_builders', 'usr_kasun', 'member', 'active', now);
  insertGuildMember.run('gld_colombo_builders', 'usr_roshan', 'moderator', 'active', now);
  insertGuildMember.run('gld_kandy_dirt', 'usr_roshan', 'owner', 'active', now);
  insertGuildMember.run('gld_kandy_dirt', 'usr_kasun', 'member', 'pending_approval', now);

  // Guild chat messages
  const insertGuildMsg = db.prepare(
    'INSERT INTO guild_messages (id, guild_id, sender_id, body, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertGuildMsg.run(
    'gmsg_1',
    'gld_southern_bmx',
    'usr_kasun',
    'Welcome to Southern Coast BMX! Remember: bring a spare 15mm socket and check your bar-ends before Saturday practice.',
    'visible',
    now
  );
  insertGuildMsg.run(
    'gmsg_2',
    'gld_southern_bmx',
    'usr_admin_nethmi',
    'Pinned reminder: Shaun David Studios coaches will bring a portable pump and torque wrench to the Bentota court.',
    'visible',
    now
  );

  // 6. Seed Community Posts & Comments
  const posts = [
    {
      id: 'post_1',
      user_id: 'usr_kasun',
      category: 'build_showcase',
      title: 'Dialed in my 20.75" Southern Sunset BMX Build for Park Sessions',
      body: 'Finally completed my full 4130 Chromoly setup with Odyssey Springfield U-brakes and 2.40" tires at 65 PSI. Scored 98/100 on the RideRise Bike Build Questionnaire after replacing my bar-end plugs and truing the rear double-wall rim. Happy to answer any setup questions for riders in Kalutara/Bentota!',
      tags: ['BMXBuild', 'Chromoly4130', 'BrakeSafety', 'SouthernProvince'],
      media_urls: ['/assets/brand/riderise_logo.png'],
      media_type: 'image',
      bike_id: 'bike_kasun_1',
      guild_id: 'gld_southern_bmx',
      likes_count: 2,
      comments_count: 2
    },
    {
      id: 'post_2',
      user_id: 'usr_roshan',
      category: 'maintenance_upgrade',
      title: 'How to Inspect Your Frame Headtube & Crank Spindle After Wet Season Rides',
      body: 'Humidity in Sri Lanka can corrode unsealed bearings quickly. Here is my 4-step maintenance checklist: 1) Clean bottom bracket shell and check for play. 2) Inspect headtube welds under bright light for hairline cracks. 3) Verify stem bolt torque evenly in a cross pattern. 4) Check brake pad wear and rotor cleanliness before any practice session.',
      tags: ['BikeMaintenance', 'SafetyCheck', 'SriLankaRiders', 'DirtJumper'],
      media_urls: [],
      media_type: 'none',
      bike_id: 'bike_roshan_1',
      guild_id: 'gld_colombo_builders',
      likes_count: 2,
      comments_count: 1
    },
    {
      id: 'post_3',
      user_id: 'usr_admin_nethmi',
      category: 'skill_progress',
      title: 'Official Guide: Why We Progress From Trackstands to Low Bunny-Hops in Closed Courts',
      body: 'At Shaun David Studios, Rider Rank XP is earned through verified knowledge, bike maintenance, and structured drills in safe, off-road areas — never by riding in traffic or taking reckless risks. Check out the updated Stunt-Learning Library for step-by-step body position diagrams!',
      tags: ['RideRiseLK', 'SafeProgression', 'StuntLibrary', 'ShaunDavidStudios'],
      media_urls: ['/assets/brand/riderise_logo.png'],
      media_type: 'image',
      bike_id: null,
      guild_id: null,
      likes_count: 3,
      comments_count: 0
    },
    {
      id: 'post_4',
      user_id: 'usr_dilshan_minor',
      category: 'community_qa',
      title: 'Question: Best tire pressure for learning flatground front-wheel lifts and manuals?',
      body: 'Hi everyone! I just finished the Correct Braking and Balance modules in the Fundamentals pathway. My 20x2.35 tires are rated 40–65 PSI. What pressure helps give a stable platform on a smooth practice court without feeling bouncy?',
      tags: ['BeginnerQuestion', 'ManualBalance', 'TirePressure'],
      media_urls: [],
      media_type: 'none',
      bike_id: null,
      guild_id: 'gld_southern_bmx',
      likes_count: 1,
      comments_count: 1
    }
  ];

  const insertPost = db.prepare(`
    INSERT INTO posts (
      id, user_id, category, title, body, tags_json, media_urls_json, media_type,
      bike_id, guild_id, moderation_status, likes_count, comments_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?, ?, ?)
  `);
  for (const p of posts) {
    insertPost.run(
      p.id, p.user_id, p.category, p.title, p.body, JSON.stringify(p.tags),
      JSON.stringify(p.media_urls), p.media_type, p.bike_id, p.guild_id,
      p.likes_count, p.comments_count, now, now
    );
  }

  const insertComment = db.prepare(`
    INSERT INTO comments (id, post_id, user_id, parent_comment_id, body, moderation_status, created_at)
    VALUES (?, ?, ?, ?, ?, 'visible', ?)
  `);
  insertComment.run('cmt_1', 'post_1', 'usr_roshan', null, 'Clean setup @kasun_bmx_lk! Love seeing a properly dialed rear U-brake and bar-ends.', now);
  insertComment.run('cmt_2', 'post_1', 'usr_kasun', 'cmt_1', 'Thanks @roshan_dirtjump! Linear brake cable makes modulation super predictable.', now);
  insertComment.run('cmt_3', 'post_2', 'usr_admin_nethmi', null, 'Essential advice for monsoon season maintenance. Bookmarked!', now);
  insertComment.run('cmt_4', 'post_4', 'usr_kasun', null, 'Around 50–55 PSI is a great sweet spot for smooth courts — stable sidewall support without harsh rebound.', now);

  // Likes & Bookmarks
  const insertLike = db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)');
  insertLike.run('post_1', 'usr_roshan', now);
  insertLike.run('post_1', 'usr_admin_nethmi', now);
  insertLike.run('post_2', 'usr_kasun', now);
  insertLike.run('post_2', 'usr_admin_nethmi', now);
  insertLike.run('post_3', 'usr_kasun', now);
  insertLike.run('post_3', 'usr_roshan', now);
  insertLike.run('post_3', 'usr_dilshan_minor', now);
  insertLike.run('post_4', 'usr_kasun', now);

  // 7. Seed Friendships & Private Conversations (Teen Safety: only accepted friends can DM)
  const insertFriendship = db.prepare(
    'INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertFriendship.run('fr_1', 'usr_kasun', 'usr_roshan', 'accepted', now, now);
  insertFriendship.run('fr_2', 'usr_kasun', 'usr_admin_nethmi', 'accepted', now, now);
  insertFriendship.run('fr_3', 'usr_dilshan_minor', 'usr_kasun', 'pending', now, now);

  const insertConvo = db.prepare(
    'INSERT INTO conversations (id, user_a_id, user_b_id, muted_by_a, muted_by_b, last_message_at, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)'
  );
  insertConvo.run('conv_kasun_roshan', 'usr_kasun', 'usr_roshan', now, now);

  const insertMsg = db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, body, attachment_url, delivery_status, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertMsg.run(
    'msg_1',
    'conv_kasun_roshan',
    'usr_roshan',
    'Hey Kasun! Are you attending the Shaun David Studios safety & flatground clinic in Bentota next weekend?',
    '',
    'read',
    'visible',
    now
  );
  insertMsg.run(
    'msg_2',
    'conv_kasun_roshan',
    'usr_kasun',
    'Yes! Already registered on the Events tab. Bringing extra allen keys and a floor pump for the crew.',
    '',
    'delivered',
    'visible',
    now
  );

  } // end demo community content

  // 8. Seed Complete Stunt-Learning Library (All 4 Required Categories & 21 Modules)
  const stuntModules = [
    // CATEGORY 1: FUNDAMENTALS (6 modules)
    {
      id: 'mod_fund_1',
      slug: 'bike-fit-and-basic-controls',
      category: 'fundamentals',
      title: 'Bike Fit and Basic Controls',
      difficulty: 'Beginner (Level 1)',
      xp_reward: 35,
      prerequisites: [],
      bike_suitability: 'All Bicycles (BMX, MTB, Dirt Jumper, Freestyle)',
      protective_gear: ['Certified Bicycle/BMX Helmet (snug two-finger brow fit)', 'Closed-toe flat-soled shoes', 'Riding gloves'],
      safe_environment: 'Flat, paved, vehicle-free courtyard, driveway, or empty community sports court.',
      inspection_checklist: [
        'Handlebars are aligned perpendicular to the front wheel and stem bolts are tightened to spec.',
        'Plastic or rubber bar-end plugs are securely installed on both handlebar ends.',
        'Brake lever is reachable with one or two fingers without losing grip on the bar.',
        'Tire pressure matches the sidewall rating and both axle nuts/quick-releases are tight.'
      ],
      learning_stages: [
        'Stage 1 — Neutral Ready Stance: Stand on level pedals (3 o’clock and 9 o’clock) with knees and elbows slightly bent to absorb movement.',
        'Stage 2 — Cockpit Reach Check: Ensure your wrists stay flat over the grips and your chest can move freely over the stem and behind the saddle.',
        'Stage 3 — One-Finger Brake Covering: Roll slowly at walking pace while keeping your index finger resting lightly on the brake lever.'
      ],
      common_errors: [
        'Locking elbows and knees rigid — prevents the bike from moving smoothly beneath you.',
        'Looking straight down at the front tire — keep your chin up and eyes looking 5–8 meters ahead.'
      ],
      stop_conditions: [
        'Stop immediately if the handlebars twist independently of the fork or if the headset clicks.',
        'Stop if the saddle height prevents you from lowering your hips during maneuvers.'
      ],
      coaching_reminder: 'An online guide cannot verify your bicycle’s mechanical torque. Have a qualified bicycle mechanic or in-person coach check your stem and brake setup.',
      diagram_type: 'bike_fit',
      requires_safety_ack: 0,
      display_order: 1,
      quiz_questions: [
        {
          q: 'Where should your pedals be positioned in the Neutral Ready Stance when coasting?',
          options: ['Vertical (12 and 6 o’clock)', 'Level / horizontal (3 and 9 o’clock)', 'Both feet off the pedals'],
          correctIndex: 1
        },
        {
          q: 'Why are handlebar end plugs mandatory before any riding session?',
          options: ['They make the bike faster', 'They prevent severe puncture injuries if the bike falls', 'They increase tire pressure'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_fund_2',
      slug: 'correct-braking',
      category: 'fundamentals',
      title: 'Correct Braking & Modulation',
      difficulty: 'Beginner (Level 1)',
      xp_reward: 35,
      prerequisites: ['mod_fund_1'],
      bike_suitability: 'Any bicycle fitted with working rear (and/or front) brakes',
      protective_gear: ['Certified Helmet', 'Gloves', 'Closed-toe shoes'],
      safe_environment: 'Dry, flat, clean surface free of gravel, sand, wet leaves, traffic, and pedestrians.',
      inspection_checklist: [
        'Brake pads contact the rim braking surface or disc rotor squarely without rubbing the tire sidewall.',
        'Brake cable has no frayed strands and lever returns crisply when released.',
        'Lever does not bottom out against the grip when pulled firmly.'
      ],
      learning_stages: [
        'Stage 1 — Progressive Rear Brake Squeeze: Roll at a slow jog speed, shift hips slightly back, and gradually squeeze the rear brake to come to a smooth, skid-free stop.',
        'Stage 2 — Weight Shift Against Deceleration: Drop your heels and brace with your legs while keeping arms relaxed as you decelerate.',
        'Stage 3 — Target Box Stopping: Place two chalk marks 2 meters apart and practice stopping smoothly with your front axle inside the box.'
      ],
      common_errors: [
        'Grabbing a handful of front brake with weight forward — can pitch the rider over the handlebars.',
        'Skidding the rear tire intentionally — reduces stopping control and wears flat spots into tires.'
      ],
      stop_conditions: [
        'Stop immediately if brakes squeal due to oil contamination, fail to engage, or if the surface becomes wet.'
      ],
      coaching_reminder: 'Practice emergency stopping drills regularly in a closed court before attempting any speed or obstacle skills.',
      diagram_type: 'braking_modulation',
      requires_safety_ack: 0,
      display_order: 2,
      quiz_questions: [
        {
          q: 'What body movement keeps you stable when applying the brakes firmly?',
          options: ['Leaning chest forward over the front tire', 'Dropping heels and shifting hips back low behind the saddle', 'Standing straight up with locked knees'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_fund_3',
      slug: 'balance-and-low-speed-control',
      category: 'fundamentals',
      title: 'Balance and Low-Speed Control (Trackstand Prep)',
      difficulty: 'Beginner (Level 1)',
      xp_reward: 40,
      prerequisites: ['mod_fund_1', 'mod_fund_2'],
      bike_suitability: 'BMX, MTB, Dirt Jumper, Freestyle Bike',
      protective_gear: ['Certified Helmet', 'Shin/knee guards recommended', 'Flat-soled shoes'],
      safe_environment: 'Level or very slight uphill paved court away from roads and obstacles.',
      inspection_checklist: [
        'Chain tension is proper (no sudden slack jumps when applying pedal pressure).',
        'Tires are inflated evenly so the front tire does not fold at low speed.'
      ],
      learning_stages: [
        'Stage 1 — Slow-Roll Corridor: Ride as slowly as possible along a 10-meter line without putting a foot down.',
        'Stage 2 — 45-Degree Front Wheel Turn: Come to a gentle stop on a slight incline, turn the front wheel ~45° toward your forward foot, and balance using gentle pedal pressure.',
        'Stage 3 — Controlled Foot-Down Exit: Practice stepping cleanly off the pedal to the ground whenever balance tips.'
      ],
      common_errors: [
        'Staring at the front hub instead of a fixed point 3 meters ahead.',
        'Using clipped-in pedals when learning low-speed balance — always use flat pedals.'
      ],
      stop_conditions: [
        'Stop if fatigued or if ankles/wrists feel strained.'
      ],
      coaching_reminder: 'Low-speed balance is the foundation of all bike control. Take breaks and never rush.',
      diagram_type: 'trackstand_balance',
      requires_safety_ack: 0,
      display_order: 3,
      quiz_questions: [
        {
          q: 'During a basic trackstand, which way should you angle your front wheel?',
          options: ['Straight ahead at 0 degrees', 'Approximately 45 degrees toward your forward foot', '90 degrees sideways'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_fund_4',
      slug: 'safe-turning',
      category: 'fundamentals',
      title: 'Safe Turning & Cornering Mechanics',
      difficulty: 'Beginner (Level 1)',
      xp_reward: 40,
      prerequisites: ['mod_fund_2'],
      bike_suitability: 'All Bicycles',
      protective_gear: ['Certified Helmet', 'Gloves', 'Knee/Elbow pads'],
      safe_environment: 'Clean asphalt or concrete court swept free of loose sand or gravel.',
      inspection_checklist: [
        'Tire side knobs or shoulder tread are intact with no cracking.',
        'Headset bearings turn smoothly without binding.'
      ],
      learning_stages: [
        'Stage 1 — Braking Before the Turn: Complete all speed adjustments in a straight line BEFORE leaning into the turn.',
        'Stage 2 — Outside Foot Down (or Level Stance on Smooth Banks): Prevents the inside pedal from striking the ground.',
        'Stage 3 — Look Through the Exit: Turn your head and eyes toward where you want to go, allowing the bike to lean slightly underneath your torso.'
      ],
      common_errors: [
        'Pedaling mid-corner with the inside pedal low — causes dangerous pedal strikes.',
        'Grabbing the front brake while leaned over on dusty pavement.'
      ],
      stop_conditions: [
        'Stop if sand, oil, or rain is present on the turning surface.'
      ],
      coaching_reminder: 'Ask an experienced coach to observe your body alignment through figure-8 cone drills.',
      diagram_type: 'safe_turning',
      requires_safety_ack: 0,
      display_order: 4,
      quiz_questions: [
        {
          q: 'Why must you avoid having your inside pedal down at 6 o’clock during a sharp turn?',
          options: ['It wears out the chain', 'The pedal can strike the ground and lift the rear wheel', 'It bends the handlebars'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_fund_5',
      slug: 'front-wheel-lift-fundamentals',
      category: 'fundamentals',
      title: 'Front-Wheel Lift Fundamentals',
      difficulty: 'Beginner (Level 2)',
      xp_reward: 45,
      prerequisites: ['mod_fund_2', 'mod_fund_3'],
      bike_suitability: 'BMX, Dirt Jumper, MTB, Freestyle Bike',
      protective_gear: ['Certified Helmet', 'Gloves', 'Knee & Shin Pads'],
      safe_environment: 'Flat, enclosed practice area with plenty of run-out space.',
      inspection_checklist: [
        'Rear brake works reliably and your index finger is covering the rear brake lever.',
        'Stem faceplate bolts and handlebar clamp are secure.'
      ],
      learning_stages: [
        'Stage 1 — Pre-Load Compression: Bend elbows and knees, bringing your chest down toward the handlebars.',
        'Stage 2 — Weight Shift Back (Not Arm Yanking): Push against the bars to straighten your arms while shifting your hips back over the rear hub.',
        'Stage 3 — Rear Brake Safety Feather: Practice tapping the rear brake while the front wheel is 10–15 cm off the ground so it sets down gently.'
      ],
      common_errors: [
        'Bending elbows and pulling the bars to your chest with your head still forward — lifts the wheel poorly and strains shoulders.',
        'Forgetting to cover the rear brake lever — the rear brake prevents looping out backward.'
      ],
      stop_conditions: [
        'Stop if your rear brake is not functioning properly or if you feel off-balance.'
      ],
      coaching_reminder: 'Never practice wheel lifts on public streets or sidewalks. Always practice the rear-brake loop-out prevention reflex first.',
      diagram_type: 'front_wheel_lift',
      requires_safety_ack: 0,
      display_order: 5,
      quiz_questions: [
        {
          q: 'What is the primary control that prevents looping out backward during a front-wheel lift?',
          options: ['Pedaling harder', 'Feathering/squeezing the rear brake', 'Turning the handlebars'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_fund_6',
      slug: 'bunny-hop-preparation-and-fundamentals',
      category: 'fundamentals',
      title: 'Bunny-Hop Preparation and Fundamentals',
      difficulty: 'Beginner (Level 2)',
      xp_reward: 50,
      prerequisites: ['mod_fund_5'],
      bike_suitability: 'BMX, Dirt Jumper, Freestyle Bike, Hardtail MTB',
      protective_gear: ['Certified Helmet', 'Shin guards', 'Knee pads', 'Gloves'],
      safe_environment: 'Flat, smooth off-road practice court using a chalk line or flat cardboard strip (never hard obstacles at first).',
      inspection_checklist: [
        'Both wheels have even spoke tension and axle nuts/bolts are secure.',
        'Pedals have intact grip pins and shoe soles are dry.'
      ],
      learning_stages: [
        'Stage 1 — The "J" Motion Breakdown: Understand that a proper bunny hop lifts the front wheel first, then scoops the rear wheel up — not both wheels simultaneously.',
        'Stage 2 — Rear-Wheel Scoop Practice: While rolling slowly, tilt toes slightly down, press backward into the pedals, and bend knees to feel the rear tire unweight.',
        'Stage 3 — Combining Lift + Scoop Over a Chalk Line: Perform a controlled front lift (10 cm), then extend hips up toward the bars while drawing knees up to level the bike.'
      ],
      common_errors: [
        'Jumping straight up while pulling both wheels at once (the "English hop") — limits control and can pull feet off flat pedals.',
        'Landing stiff-legged — always absorb the landing through bent knees and ankles.'
      ],
      stop_conditions: [
        'Stop if your feet slip off the pedals or if the rear wheel slams sideways.'
      ],
      coaching_reminder: 'Master hopping over a painted chalk line consistently before ever placing a soft foam marker on the ground.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 0,
      display_order: 6,
      quiz_questions: [
        {
          q: 'In what sequence do the wheels leave the ground in a proper freestyle bunny hop?',
          options: ['Rear wheel first, then front wheel', 'Front wheel first via weight shift, followed by scooping the rear wheel up', 'Both wheels at the exact same millisecond'],
          correctIndex: 1
        }
      ]
    },

    // CATEGORY 2: BEGINNER FREESTYLE SKILLS (6 modules)
    {
      id: 'mod_beg_1',
      slug: 'bunny-hop-progression',
      category: 'beginner_freestyle',
      title: 'Bunny Hop Progression (Timing & Soft Landing)',
      difficulty: 'Beginner Freestyle',
      xp_reward: 55,
      prerequisites: ['mod_fund_6'],
      bike_suitability: 'BMX, Dirt Jumper, Freestyle Bike',
      protective_gear: ['Certified Helmet', 'Shin & Knee Guards', 'Gloves'],
      safe_environment: 'Enclosed skatepark flat bank or smooth practice court using a collapsible cardboard tube.',
      inspection_checklist: ['Crank bolts, pedals, and stem bolts checked with hex key before session.'],
      learning_stages: [
        'Stage 1 — Approach Speed Consistency: Roll at a steady, comfortable pace with level pedals.',
        'Stage 2 — Hip-to-Stem Extension: After the front wheel rises, drive hips upward toward the stem while pushing bars slightly forward to level the tires in mid-air.',
        'Stage 3 — Two-Wheel Absorbed Landing: Touch both tires down together (or rear slightly first) with knees flexing smoothly.'
      ],
      common_errors: ['Rushing the scoop before the front wheel reaches peak height.'],
      stop_conditions: ['Stop if wrist soreness occurs or if tire pressure is too low (risk of pinch flats).'],
      coaching_reminder: 'Focus on smooth, quiet landings rather than chasing height.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 0,
      display_order: 7,
      quiz_questions: [
        {
          q: 'What indicates a well-controlled bunny hop landing?',
          options: ['A loud metallic slam', 'A quiet landing absorbed through bent knees and ankles', 'Landing heavily on the front wheel only'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_beg_2',
      slug: 'manual-balance-fundamentals',
      category: 'beginner_freestyle',
      title: 'Manual Balance Fundamentals',
      difficulty: 'Beginner Freestyle',
      xp_reward: 55,
      prerequisites: ['mod_fund_5'],
      bike_suitability: 'BMX, Dirt Jumper, MTB',
      protective_gear: ['Certified Helmet', 'Knee & Shin Pads', 'Gloves'],
      safe_environment: 'Flat, smooth, closed practice pad with clear space behind and ahead.',
      inspection_checklist: ['Rear brake responsiveness verified; brake lever covered by index finger at all times.'],
      learning_stages: [
        'Stage 1 — L-Shaped Hip Drop: Drop chest down first, then slide hips straight back and low over the rear tire with arms straight.',
        'Stage 2 — Knee Bend Balance Point: Use subtle knee bends (not arm pulls) to keep the rear axle under your center of mass for 2–3 bike lengths.',
        'Stage 3 — Controlled Brake Tap Exit: Tap the rear brake intentionally to bring the front wheel down cleanly.'
      ],
      common_errors: ['Standing too tall with hips high — makes the balance point unstable and narrow.'],
      stop_conditions: ['Stop immediately if rear brake cable slips or if practicing near any pedestrians.'],
      coaching_reminder: 'Never practice manuals in traffic, parking lanes, or near bystanders.',
      diagram_type: 'front_wheel_lift',
      requires_safety_ack: 0,
      display_order: 8,
      quiz_questions: [
        {
          q: 'How do you adjust your balance during a coasting manual?',
          options: ['By bending and extending your knees with straight arms while covering the rear brake', 'By violently jerking the handlebars with bent arms', 'By closing your eyes'],
          correctIndex: 0
        }
      ]
    },
    {
      id: 'mod_beg_3',
      slug: 'controlled-wheel-lift-practice',
      category: 'beginner_freestyle',
      title: 'Controlled Wheel-Lift Practice (Front & Rear Placement)',
      difficulty: 'Beginner Freestyle',
      xp_reward: 50,
      prerequisites: ['mod_fund_5', 'mod_fund_6'],
      bike_suitability: 'BMX, Dirt Jumper, Hardtail MTB',
      protective_gear: ['Certified Helmet', 'Shin Guards', 'Gloves'],
      safe_environment: 'Closed court with painted chalk lines.',
      inspection_checklist: ['Verify tire pressure and spoke tension on both wheels.'],
      learning_stages: [
        'Stage 1 — Front Axle Line Placement: Lift the front tire smoothly over a chalk line and set it down without touching the line.',
        'Stage 2 — Rear Axle Unweighting: As the rear tire approaches the chalk line, shift weight forward slightly and scoop the pedals to lift the rear tire over the line.',
        'Stage 3 — Sequential Step-Up Simulation: Combine the front lift and delayed rear lift smoothly at low speed.'
      ],
      common_errors: ['Locking the front brake to lift the rear wheel — use pedal scoop and weight transfer instead.'],
      stop_conditions: ['Stop if rear tire impacts hard or if hands slip on grips.'],
      coaching_reminder: 'Precision over chalk lines prevents pinched tubes and bent rims later.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 0,
      display_order: 9,
      quiz_questions: [
        {
          q: 'What is the safest tool to practice wheel placement timing over?',
          options: ['A busy roadside curb', 'A painted chalk line on a closed court', 'Moving obstacles'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_beg_4',
      slug: 'small-low-height-obstacle-practice',
      category: 'beginner_freestyle',
      title: 'Small, Low-Height Obstacle Practice (< 10 cm)',
      difficulty: 'Beginner Freestyle',
      xp_reward: 55,
      prerequisites: ['mod_beg_1', 'mod_beg_3'],
      bike_suitability: 'BMX, Dirt Jumper, Freestyle Bike',
      protective_gear: ['Certified Helmet', 'Shin & Knee Guards', 'Elbow Pads', 'Gloves'],
      safe_environment: 'Designated skatepark or enclosed practice court using a collapsible foam brick or 5–10 cm wooden roller.',
      inspection_checklist: ['Tires inflated to 55–65 PSI (BMX) to prevent rim strikes; axles tight.'],
      learning_stages: [
        'Stage 1 — Sight the Take-Off Line: Look at the takeoff spot 30 cm before the foam marker, then shift your gaze to the landing spot beyond it.',
        'Stage 2 — Commit With Even Speed: Maintain a relaxed jogging pace; do not brake at the last second.',
        'Stage 3 — Level Clearance & Roll-Away: Clear the foam marker and roll out straight for 5 meters before stopping.'
      ],
      common_errors: ['Staring directly at the obstacle during takeoff — causes late rear-wheel lift.'],
      stop_conditions: ['Stop if clipping the obstacle repeatedly; return to chalk-line drills.'],
      coaching_reminder: 'Always use collapsible foam or cardboard markers so a clipped wheel does not cause a crash.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 0,
      display_order: 10,
      quiz_questions: [
        {
          q: 'Why should beginner obstacle drills use collapsible foam or cardboard instead of bricks or curbs?',
          options: ['Foam is heavier', 'If a wheel clips a collapsible marker, it gives way safely instead of stopping the wheel abruptly', 'Bricks are too small'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_beg_5',
      slug: 'basic-fakie-concepts',
      category: 'beginner_freestyle',
      title: 'Basic Fakie Concepts (Rolling Backward Control)',
      difficulty: 'Beginner Freestyle',
      xp_reward: 60,
      prerequisites: ['mod_fund_3', 'mod_beg_3'],
      bike_suitability: 'BMX or Freestyle Bike (Note: Cassette hubs require backpedaling; Freecoaster hubs coast without pedaling)',
      protective_gear: ['Certified Helmet', 'Knee & Elbow Pads', 'Shin Guards', 'Gloves'],
      safe_environment: 'Enclosed skatepark with a gentle mellow bank and completely clear area behind the rider.',
      inspection_checklist: ['Know whether your rear hub is a cassette or freecoaster; verify chain tension and bar-ends.'],
      learning_stages: [
        'Stage 1 — Gentle Bank Rollback: Roll halfway up a mellow bank at slow speed, let gravity stop you, and shift hips slightly back as you begin rolling backward.',
        'Stage 2 — Backpedal Cadence (Cassette Hub): Pedal backward smoothly at the exact speed of the rear wheel for 1–2 revolutions.',
        'Stage 3 — Half-Cab / Carve Pivot Exit: Carve the handlebars gently 45° and use pedal pressure to pivot the front wheel back to forward travel.'
      ],
      common_errors: ['Backpedaling too fast or stopping the pedals on a cassette hub — locks the rear wheel instantly.'],
      stop_conditions: ['Stop if other riders are behind the bank or if surface is slick.'],
      coaching_reminder: 'Always check behind you and yield to other park users before rolling up a bank.',
      diagram_type: 'trackstand_balance',
      requires_safety_ack: 0,
      display_order: 11,
      quiz_questions: [
        {
          q: 'On a standard cassette hub BMX, what happens if you stop backpedaling while rolling backward in a fakie?',
          options: ['The bike coasts freely', 'The hub engages and stops/lifts the bike abruptly', 'The front brake activates'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_beg_6',
      slug: 'skatepark-etiquette-and-flow',
      category: 'beginner_freestyle',
      title: 'Introductory Skatepark Etiquette and Flow',
      difficulty: 'Beginner Freestyle',
      xp_reward: 50,
      prerequisites: ['mod_fund_1'],
      bike_suitability: 'All park-suitable bicycles (plastic pegs/pedals recommended where required by park rules)',
      protective_gear: ['Certified Helmet (mandatory)', 'Knee & Elbow Pads', 'Gloves'],
      safe_environment: 'Public or private skatepark / pump track.',
      inspection_checklist: ['No leaking grease/oil, bar-ends installed, loose accessories removed.'],
      learning_stages: [
        'Stage 1 — Observe Flow Lines First: Stand on the outer deck for 3 minutes before dropping in to watch existing riders’ lines and speeds.',
        'Stage 2 — Taking Turns & Eye Contact: Wait at the deck, make eye contact, and take 45–60 second runs without "snaking" another rider.',
        'Stage 3 — Clear Landing Zones Immediately: Never sit on ledges, copings, or landing ramps; move off the riding surface to rest or adjust gear.'
      ],
      common_errors: ['Stopping at the bottom of a ramp or blind landing where another rider is mid-run.'],
      stop_conditions: ['Wait out your turn if the park is overcrowded or wet.'],
      coaching_reminder: 'Respecting skateboarders, rollerbladers, and younger riders builds a thriving Sri Lankan park community.',
      diagram_type: 'safe_turning',
      requires_safety_ack: 0,
      display_order: 12,
      quiz_questions: [
        {
          q: 'Where should you rest or check your phone at a skatepark?',
          options: ['Sitting on top of a grind ledge', 'At the bottom of a landing ramp', 'Completely off the riding surface in the designated spectator/rest area'],
          correctIndex: 2
        }
      ]
    },

    // CATEGORY 3: INTERMEDIATE LEARNING PATHWAYS (6 modules)
    {
      id: 'mod_int_1',
      slug: 'bunny-hop-improvement',
      category: 'intermediate',
      title: 'Bunny-Hop Improvement (Pre-Load & Tuck Control)',
      difficulty: 'Intermediate',
      xp_reward: 65,
      prerequisites: ['mod_beg_1', 'mod_beg_4'],
      bike_suitability: '4130 Chromoly BMX, Dirt Jumper, or Freestyle Bike with double-wall rims',
      protective_gear: ['Certified Helmet', 'Shin & Knee Guards', 'Gloves', 'Ankle support'],
      safe_environment: 'Designated skatepark or practice court with adjustable collapsible hurdle.',
      inspection_checklist: ['Inspect frame headtube, downtube gusset, and crank arms for any signs of fatigue or cracks.'],
      learning_stages: [
        'Stage 1 — Explosive Hip Drive: Drive hips fully to the handlebars before tucking knees.',
        'Stage 2 — Forward Bar Push & Knee Tuck: Push bars forward while bending knees to bring the rear tire up level with the front tire.',
        'Stage 3 — Controlled Downward Extension: Extend legs slightly to meet the ground smoothly rather than dropping dead-weight.'
      ],
      common_errors: ['Pulling with bent arms instead of driving hips to the bars first.'],
      stop_conditions: ['Stop if rims are out of true or if wrists feel impact fatigue.'],
      coaching_reminder: 'Film your side-profile stance or work with a coach to verify your hip extension timing.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 0,
      display_order: 13,
      quiz_questions: [
        {
          q: 'What brings the rear wheel up to match the front wheel height at the apex of an intermediate bunny hop?',
          options: ['Pushing the handlebars forward while tucking knees up', 'Leaning your head over the front axle', 'Pulling the rear brake'],
          correctIndex: 0
        }
      ]
    },
    {
      id: 'mod_int_2',
      slug: 'manual-progression',
      category: 'intermediate',
      title: 'Manual Progression (Distance & Surface Transitions)',
      difficulty: 'Intermediate',
      xp_reward: 65,
      prerequisites: ['mod_beg_2'],
      bike_suitability: 'BMX, Dirt Jumper, MTB with working rear brake',
      protective_gear: ['Certified Helmet', 'Knee & Shin Guards', 'Gloves'],
      safe_environment: 'Closed skatepark manual pad or marked flat court.',
      inspection_checklist: ['Rear brake pad alignment and cable tension verified before every run.'],
      learning_stages: [
        'Stage 1 — 2-Marker Manual Box: Enter the manual at marker A and set the front wheel down cleanly at marker B (5 meters).',
        'Stage 2 — Hip Micro-Corrections: Keep shoulders steady and use hip slides of 2–4 cm to stay in the sweet spot.',
        'Stage 3 — Intentional Loop-Out Drill (Onto Feet): At walking speed on grass/mat, practice stepping off onto your feet safely if the bike tips past vertical.'
      ],
      common_errors: ['Looking down at the stem instead of looking past the end of the manual pad.'],
      stop_conditions: ['Stop if rear brake performance degrades.'],
      coaching_reminder: 'Practicing the low-speed step-off drill builds confidence and prevents tailbone falls.',
      diagram_type: 'front_wheel_lift',
      requires_safety_ack: 0,
      display_order: 14,
      quiz_questions: [
        {
          q: 'Why is practicing an intentional low-speed step-off onto your feet important for manual progression?',
          options: ['It wears out shoes', 'It trains a safe muscle-memory exit if the bike ever tips past the balance point', 'It increases tire speed'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_int_3',
      slug: 'small-controlled-drops',
      category: 'intermediate',
      title: 'Small Controlled Drops (Skatepark Bank / 20–30 cm Ledge)',
      difficulty: 'Intermediate',
      xp_reward: 70,
      prerequisites: ['mod_beg_4', 'mod_int_1'],
      bike_suitability: 'Full Chromoly BMX or Dirt Jumper with double-wall rims',
      protective_gear: ['Certified Helmet', 'Knee Pads', 'Elbow Pads', 'Shin Guards', 'Gloves'],
      safe_environment: 'Supervised skatepark ledge (20–30 cm) with a clean, flat, unobstructed landing zone.',
      inspection_checklist: ['Inspect fork dropouts, axle nuts, stem bolts, and tire pressure (60+ PSI for BMX).'],
      learning_stages: [
        'Stage 1 — Speed & Unweight Check: Roll at moderate speed and push the bike slightly forward/hips back as the front axle reaches the edge so the front wheel does not dive.',
        'Stage 2 — Level Two-Wheel Touchdown: Keep pedals level and aim for both tires to touch down together.',
        'Stage 3 — Deep Leg Absorption: Let your knees and hips act as shock absorbers through 50% of their range of motion.'
      ],
      common_errors: ['Rolling off too slowly without unweighting the front wheel — causes dangerous nose-diving.'],
      stop_conditions: ['Do not attempt if your bike has single-wall rims, hi-ten steel forks with wear, or any structural defects.'],
      coaching_reminder: 'Never drop off street stairs or blind ledges into pedestrian walkways.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 1,
      display_order: 15,
      quiz_questions: [
        {
          q: 'What happens if you roll slowly off a drop without shifting your hips back to keep the front wheel level?',
          options: ['The front wheel dives downward toward a nose-heavy impact', 'The bike floats upward', 'Nothing changes'],
          correctIndex: 0
        }
      ]
    },
    {
      id: 'mod_int_4',
      slug: 'introductory-rotation-concepts',
      category: 'intermediate',
      title: 'Introductory Rotation Concepts (Carve & 90°/180° Flat Prep)',
      difficulty: 'Intermediate',
      xp_reward: 70,
      prerequisites: ['mod_beg_5', 'mod_int_1'],
      bike_suitability: 'BMX / Freestyle Bike with double-wall rims',
      protective_gear: ['Certified Helmet', 'Knee & Shin Guards', 'Ankle Braces', 'Gloves'],
      safe_environment: 'Smooth, flat skatepark floor or mellow bank.',
      inspection_checklist: ['Rear wheel spokes must be evenly tensioned to handle lateral landing forces.'],
      learning_stages: [
        'Stage 1 — Determine Spin Direction: Usually spin toward your back foot (e.g., left foot forward spins clockwise / right).',
        'Stage 2 — Pre-Carve & Head Turn: Carve gently 15° into the spin and turn your head and shoulders to spot the landing.',
        'Stage 3 — 90° Quartet Drills: Practice hopping 90° cleanly before attempting a full 180° into fakie.'
      ],
      common_errors: ['Stopping your head turn mid-air — where your head looks, your shoulders and hips follow.'],
      stop_conditions: ['Stop immediately if landing sideways puts lateral stress on a loose wheel.'],
      coaching_reminder: 'Progress in 45° and 90° increments on a mellow bank with an instructor before flatground 180s.',
      diagram_type: 'safe_turning',
      requires_safety_ack: 1,
      display_order: 16,
      quiz_questions: [
        {
          q: 'What guides your shoulders and bike rotation during a 90° or 180° hop?',
          options: ['Looking down at your rear hub', 'Turning your head and eyes in the direction of rotation to spot the landing', 'Closing your eyes'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_int_5',
      slug: 'bike-control-drills-and-body-position',
      category: 'intermediate',
      title: 'Bike-Control Drills and Body-Position Practice',
      difficulty: 'Intermediate',
      xp_reward: 60,
      prerequisites: ['mod_fund_4', 'mod_beg_6'],
      bike_suitability: 'BMX, Dirt Jumper, MTB',
      protective_gear: ['Certified Helmet', 'Knee & Elbow Pads', 'Gloves'],
      safe_environment: 'Pump track or skatepark transition rollers.',
      inspection_checklist: ['Tire pressure matched to pump track surface; brakes and grips secure.'],
      learning_stages: [
        'Stage 1 — Pumping Transitions without Pedaling: Unweight on the up-slope of rollers and press smoothly with legs/arms down the back slope.',
        'Stage 2 — Hip Hinge Isolation: Keep your head at a relatively constant height while the bike rises and falls underneath your body.',
        'Stage 3 — Speed Control via Pump & Braking: Link 3 rollers smoothly and stop in a designated target box.'
      ],
      common_errors: ['Pushing down into the face of the up-slope — kills momentum and jars wrists.'],
      stop_conditions: ['Stop when breathing heavily; fatigue leads to timing errors on pump tracks.'],
      coaching_reminder: 'Pump tracks are the safest way to build flow and endurance without high-impact landings.',
      diagram_type: 'safe_turning',
      requires_safety_ack: 0,
      display_order: 17,
      quiz_questions: [
        {
          q: 'When riding over a pump track roller, when do you press downward into the bike to generate smooth momentum?',
          options: ['Into the upward face of the roller', 'Down the backside (down-slope) of the roller after unweighting over the crest', 'While stopped at the bottom'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_int_6',
      slug: 'structured-progression-to-advanced',
      category: 'intermediate',
      title: 'Structured Progression & Readiness Assessment',
      difficulty: 'Intermediate',
      xp_reward: 65,
      prerequisites: ['mod_int_1', 'mod_int_2', 'mod_int_3'],
      bike_suitability: 'Inspected 4130 Chromoly BMX or Dirt Jumper (0 Safety Defects)',
      protective_gear: ['Full-face or Certified Skate Helmet', 'Knee/Shin/Elbow Pads', 'Gloves'],
      safe_environment: 'Coach-supervised training facility.',
      inspection_checklist: ['Complete 13-point RideRise Bike Build Questionnaire with zero structural defects.'],
      learning_stages: [
        'Stage 1 — 10-for-10 Consistency Rule: Never move to a harder variation until you can land the prerequisite drill cleanly 10 times out of 10 in a controlled setting.',
        'Stage 2 — Mental & Environmental Assessment: Evaluate sleep, hydration, weather, surface grip, and bike condition before every session.',
        'Stage 3 — Working with a Coach: Learn how to break complex goals into micro-drills using foam pits or resi-ramps.'
      ],
      common_errors: ['Skipping fundamentals due to peer pressure or social media comparison.'],
      stop_conditions: ['Always call it a day on a clean fundamental make rather than pushing when exhausted.'],
      coaching_reminder: 'RideRise LK never rewards reckless streaks. Walking away from a session healthy so you can ride tomorrow is true progression.',
      diagram_type: 'bike_fit',
      requires_safety_ack: 1,
      display_order: 18,
      quiz_questions: [
        {
          q: 'What is the "10-for-10 Consistency Rule" in structured progression?',
          options: ['Attempting 10 dangerous tricks in 10 minutes', 'Demonstrating clean, controlled mastery of a prerequisite drill 10 out of 10 times before progressing under supervision', 'Riding 10 hours without water'],
          correctIndex: 1
        }
      ]
    },

    // CATEGORY 4: ADVANCED LEARNING PATHWAYS (3 modules — Coach-Supervised Educational Pathways Only)
    {
      id: 'mod_adv_1',
      slug: 'advanced-freestyle-concepts',
      category: 'advanced',
      title: 'Advanced Freestyle Concepts (Coach-Supervised Pathway)',
      difficulty: 'Advanced (Coach Supervision Required)',
      xp_reward: 80,
      prerequisites: ['mod_int_4', 'mod_int_6'],
      bike_suitability: 'Full 4130 Chromoly Heat-Treated BMX or Certified Dirt Jumper with Double-Wall Rims',
      protective_gear: ['Certified Full-Face or ASTM BMX Helmet', 'Knee & Shin Guards', 'Elbow Guards', 'Mouthguard', 'Ankle Braces', 'Gloves'],
      safe_environment: 'ONLY inside a supervised training facility, foam pit, resi-mat skatepark, or with an accredited in-person coach. Never on public streets.',
      inspection_checklist: [
        'Full torque check of stem, cranks, axles, and pedals performed before session.',
        'Zero cracks, dents, or play in headset/bottom bracket verified by a mechanic.',
        'Qualified in-person coach or spotter is present at the training facility.'
      ],
      learning_stages: [
        'Stage 1 — Theoretical Physics & Spotter Briefing: Analyze takeoff angles, pop timing, and bail procedures with your in-person coach before mounting the bike.',
        'Stage 2 — Foam Pit / Resi-Ramp Isolation: Practice aerial body positioning exclusively into a foam pit or padded resi-landing under direct coach supervision.',
        'Stage 3 — Video Frame Analysis: Review posture, head alignment, and landing absorption with your coach before repeating.'
      ],
      common_errors: [
        'Attempting advanced maneuvers without a coach, foam pit/padded landing, or full protective gear.',
        'Practicing on hard concrete street spots where a slip carries high injury risk.'
      ],
      stop_conditions: [
        'STOP IMMEDIATELY if no qualified coach is present, if protective gear is missing, or if any equipment wear is detected.'
      ],
      coaching_reminder: 'MANDATORY NOTICE: Advanced freestyle modules are educational reference pathways ONLY for riders working with qualified in-person coaches in padded/supervised facilities. An app tutorial never guarantees safety.',
      diagram_type: 'bunny_hop',
      requires_safety_ack: 1,
      display_order: 19,
      quiz_questions: [
        {
          q: 'Where should advanced freestyle concepts be practiced?',
          options: ['On public streets and staircases', 'Only in a coach-supervised training facility (such as a foam pit or resi-ramp park) with full protective gear', 'Alone in an unlit parking lot'],
          correctIndex: 1
        }
      ]
    },
    {
      id: 'mod_adv_2',
      slug: 'coach-supervised-drops-and-rotations',
      category: 'advanced',
      title: 'Larger Drops & Rotations (Coach-Supervised Educational Pathway)',
      difficulty: 'Advanced (Coach Supervision Required)',
      xp_reward: 85,
      prerequisites: ['mod_int_3', 'mod_int_4', 'mod_adv_1'],
      bike_suitability: 'Heat-Treated 4130 CrMo BMX / Pro DJ Frame — Mechanic Inspected',
      protective_gear: ['Full-Face Helmet', 'Spine/Chest Protector', 'Knee/Shin/Elbow Guards', 'Ankle Braces', 'Gloves'],
      safe_environment: 'Coach-supervised skatepark transition / resi-ramp facility ONLY. Strictly prohibited on roads, roofs, stairs, or public property.',
      inspection_checklist: [
        'Spoke tension meter check on both wheels.',
        'Weld inspection at headtube, bottom bracket, and dropouts.',
        'In-person coach approval and emergency action plan active.'
      ],
      learning_stages: [
        'Stage 1 — Transition Bank-to-Bank Analysis: Understand how transition landings reduce vertical G-force compared to flat landings.',
        'Stage 2 — Axis & Spotting Mechanics: Review 360° head-spotting mechanics on a trampoline or foam pit with a coach.',
        'Stage 3 — Supervised Resi-Mat Progression: Incrementally transfer coach-approved drills onto a padded resi-landing.'
      ],
      common_errors: [
        'Landing high rotations to flat concrete — destroys wheels, frames, and joints.',
        'Attempting progressions without completed intermediate mastery and coach sign-off.'
      ],
      stop_conditions: [
        'STOP IMMEDIATELY if you feel any hesitation, fatigue, equipment play, or lack coach supervision.'
      ],
      coaching_reminder: 'Do not attempt larger drops or rotations without qualified, in-person coaching and padded training facilities.',
      diagram_type: 'safe_turning',
      requires_safety_ack: 1,
      display_order: 20,
      quiz_questions: [
        {
          q: 'Why do supervised training facilities use sloped transition landings (or resi-ramps) instead of flat concrete for advanced skills?',
          options: ['Because sloped transitions redirect downward energy into forward roll, reducing harsh vertical impact forces', 'Because flat concrete is too soft', 'They do not make any difference'],
          correctIndex: 0
        }
      ]
    },
    {
      id: 'mod_adv_3',
      slug: 'technique-analysis-equipment-inspection',
      category: 'advanced',
      title: 'Technique Analysis, Equipment Inspection & Progression Requirements',
      difficulty: 'Advanced (Technical & Safety Mastery)',
      xp_reward: 85,
      prerequisites: ['mod_int_6', 'mod_adv_1'],
      bike_suitability: 'All Stunt & Freestyle Bicycles',
      protective_gear: ['Certified Helmet', 'Full Protective Gear'],
      safe_environment: 'Workshop & Supervised Coaching Facility.',
      inspection_checklist: [
        'Complete dye-penetrant or bright-light magnifier inspection of frame welds.',
        'Inspect handlebar knurling and stem clamping surface for slippage.',
        'Verify crank spindle splines and pedal thread integrity.'
      ],
      learning_stages: [
        'Stage 1 — Fatigue Life of Bicycle Metals: Understand why 4130 Chromoly, 6061-T6 Aluminium, and Hi-Ten Steel all have finite fatigue lifespans under stunt loads.',
        'Stage 2 — Post-Impact Quarantine Rule: Any handlebar, fork, or helmet that suffers a severe crash must be retired and replaced, even if no crack is visible to the naked eye.',
        'Stage 3 — Mentoring Younger Riders Safely: Guide 16–17 year old and rookie riders toward helmet habits, brake safety, and closed-court fundamentals.'
      ],
      common_errors: [
        'Continuing to ride a helmet after a hard impact — EPS foam crushes once and cannot protect again.',
        'Assuming an expensive brand name makes a bent fork safe to ride.'
      ],
      stop_conditions: [
        'Retire any component or helmet immediately after a severe impact.'
      ],
      coaching_reminder: 'True Ride Legends protect the community by enforcing equipment inspections and safe riding culture.',
      diagram_type: 'bike_fit',
      requires_safety_ack: 1,
      display_order: 21,
      quiz_questions: [
        {
          q: 'What must you do with a bicycle helmet after it sustains one significant crash impact?',
          options: ['Keep using it if the outer plastic looks shiny', 'Replace it immediately, because the internal impact foam compresses permanently on impact', 'Paint over any scratches'],
          correctIndex: 1
        }
      ]
    }
  ];

  const insertModule = db.prepare(`
    INSERT INTO stunt_modules (
      id, slug, category, title, difficulty, xp_reward, prerequisites_json, bike_suitability,
      protective_gear_json, safe_environment, inspection_checklist_json, learning_stages_json,
      common_errors_json, stop_conditions_json, coaching_reminder, diagram_type,
      quiz_questions_json, requires_safety_ack, display_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of stuntModules) {
    insertModule.run(
      m.id, m.slug, m.category, m.title, m.difficulty, m.xp_reward,
      JSON.stringify(m.prerequisites), m.bike_suitability, JSON.stringify(m.protective_gear),
      m.safe_environment, JSON.stringify(m.inspection_checklist), JSON.stringify(m.learning_stages),
      JSON.stringify(m.common_errors), JSON.stringify(m.stop_conditions), m.coaching_reminder,
      m.diagram_type, JSON.stringify(m.quiz_questions), m.requires_safety_ack, m.display_order
    );
  }

  if (demo) {
  // Seed sample user progress
  const insertProgress = db.prepare(`
    INSERT INTO user_stunt_progress (user_id, module_id, status, checklist_completed, safety_ack_at, quiz_score, completed_at)
    VALUES (?, ?, 'completed', 1, ?, 100, ?)
  `);
  for (const modId of ['mod_fund_1', 'mod_fund_2', 'mod_fund_3', 'mod_fund_4', 'mod_fund_5', 'mod_fund_6', 'mod_beg_1', 'mod_beg_2']) {
    insertProgress.run('usr_kasun', modId, now, now);
  }
  insertProgress.run('usr_dilshan_minor', 'mod_fund_1', now, now);
  insertProgress.run('usr_dilshan_minor', 'mod_fund_2', now, now);
  }

  // 9. Seed Sri Lankan Bicycle-Parts Catalog (parts are demo-only: production prices must be
  // entered and verified by the studio, never invented) (All 9 Categories, honest verified vs "Price not verified" labels)
  if (demo) {
  const partsCatalog = [
    {
      id: 'part_1',
      name: 'Full 4130 Chromoly 20.75" Street/Park BMX Frame + Tapered Fork Set',
      brand: 'WeThePeople / SaltPlus Reference Spec',
      category: 'frames_forks',
      compatible_bike_types: '20" BMX / Freestyle',
      description: 'Heat-treated 4130 Chromoly tubing with integrated 45x45° headtube, Mid BB shell, and removable U-brake mounts.',
      price_lkr: null,
      price_verified: 0,
      retailer_name: 'Colombo Specialty BMX Importers (Verify Directly)',
      source_contact: 'Catalog Information Service — Contact local authorized distributor for current import pricing',
      availability: 'Import / Special Order — Verify Stock',
      compatibility_warning: 'Requires Integrated 1-1/8" headset, Mid bottom bracket, and 14mm rear axle hub. Never weld or drill holes into frame tubing.',
      last_verified_date: '2026-10-15'
    },
    {
      id: 'part_2',
      name: '9.0" 2-Piece 4130 Chromoly BMX Handlebars + Top-Load Stem & Bar-Ends',
      brand: 'Odyssey / ODI Reference Spec',
      category: 'handlebars_stems_grips',
      compatible_bike_types: '20" BMX / 26" Dirt Jumper (with 22.2mm clamp)',
      description: '22.2mm clamping diameter 2-piece bars paired with flangeless rubber grips and heavy-duty nylon bar-end plugs.',
      price_lkr: 24500,
      price_verified: 1,
      retailer_name: 'Lanka Pro Cycle Workshop — Colombo 04 (Admin Verified Reference)',
      source_contact: 'Verified by Shaun David Studios Catalog Admin',
      availability: 'In Stock (Verified at last audit)',
      compatibility_warning: '22.2mm BMX bars will NOT fit 31.8mm MTB stems without a proper shim. Always install bar-end plugs before riding.',
      last_verified_date: '2026-10-20'
    },
    {
      id: 'part_3',
      name: '20 x 2.40" High-Pressure Street/Park Tire & Double-Wall 36H Wheelset Reference',
      brand: 'Odyssey / Maxxis Reference Spec',
      category: 'tires_wheels_hubs',
      compatible_bike_types: '20" BMX (Check frame/fork tire clearance for 2.40" width)',
      description: 'Dual-ply sidewall 20x2.40" tire (up to 65–100 PSI depending on casing) and 36-spoke double-wall pinned/welded rim specification.',
      price_lkr: 14800,
      price_verified: 1,
      retailer_name: 'Southern Cycle & BMX Supply — Galle Road (Admin Verified Reference)',
      source_contact: 'Verified by Shaun David Studios Catalog Admin',
      availability: 'Limited Stock (Verified at last audit)',
      compatibility_warning: 'Older BMX frames and U-brakes may rub against 2.40" wide tires; measure frame chainstay clearance before mounting.',
      last_verified_date: '2026-10-22'
    },
    {
      id: 'part_4',
      name: '3-Piece Tubular 4130 CrMo Crankset (170mm, 19mm 8-Spline) + Sealed Nylon Pedals',
      brand: 'Salt / Shadow Conspiracy Reference Spec',
      category: 'drivetrain_cranks_pedals',
      compatible_bike_types: 'BMX / Freestyle / Dirt Jumper',
      description: 'Heat-treated 3-piece tubular chromoly crank arms with 19mm chromoly spindle, 25T alloy sprocket compatibility, and wide nylon platform pedals.',
      price_lkr: null,
      price_verified: 0,
      retailer_name: 'Sri Lanka Cycle Parts Directory (Price Not Verified)',
      source_contact: 'Verify bottom bracket standard (Mid, Spanish, Euro, or American) with your bike shop before ordering',
      availability: 'Price & Stock Not Verified',
      compatibility_warning: '9/16" pedal threads fit 3-piece and 2-piece cranks; 1/2" pedal threads only fit 1-piece cranks. Never force mismatched pedal threads.',
      last_verified_date: '2026-10-10'
    },
    {
      id: 'part_5',
      name: 'Rear U-Brake Caliper Kit with Linear Slic Cable & Clear Soft Brake Pads',
      brand: 'Odyssey Springfield / Dia-Compe Reference Spec',
      category: 'brakes_cables_levers',
      compatible_bike_types: 'BMX / Freestyle frames with U-brake bosses',
      description: 'Hinged one-Finger lever, linear housing (prevents cable bind during bar turns), low-profile U-brake arms, and high-friction pads.',
      price_lkr: 11200,
      price_verified: 1,
      retailer_name: 'Lanka Pro Cycle Workshop — Colombo 04 (Admin Verified Reference)',
      source_contact: 'Verified by Shaun David Studios Catalog Admin',
      availability: 'In Stock (Verified at last audit)',
      compatibility_warning: 'U-brake posts are positioned differently from V-brake posts. Never mount V-brake arms onto U-brake frame mounts.',
      last_verified_date: '2026-10-21'
    },
    {
      id: 'part_6',
      name: 'Sealed Integrated 1-1/8" Headset (45x45°) + Pivotal Padded Seat & Seatpost',
      brand: 'BSD / Fiend Reference Spec',
      category: 'headsets_seats',
      compatible_bike_types: 'BMX / Dirt Jumper with Campagnolo-spec 45x45° integrated headtube',
      description: 'Sealed angular contact headset bearings with 15mm dust cap, plus mid-padded Pivotal saddle and 25.4mm alloy Pivotal post.',
      price_lkr: null,
      price_verified: 0,
      retailer_name: 'Sri Lanka Cycle Parts Directory (Price Not Verified)',
      source_contact: 'Check headtube type (Integrated vs Standard Press-Fit Cup) before purchase',
      availability: 'Price & Stock Not Verified',
      compatibility_warning: 'Always insert the seatpost past the engraved MINIMUM INSERTION line to prevent frame seat-tube cracking.',
      last_verified_date: '2026-10-12'
    },
    {
      id: 'part_7',
      name: 'Chromoly Core BMX Pegs with Replaceable Nylon/Plastic Sleeves (14mm + 3/8" Adapter)',
      brand: 'Cult / Merritt Reference Spec',
      category: 'pegs_accessories',
      compatible_bike_types: 'BMX axles with at least 15mm of thread engagement or female axle bolts',
      description: '4.5" length 4130 inner core with low-friction nylon sleeve suitable for skatepark rules.',
      price_lkr: 8900,
      price_verified: 1,
      retailer_name: 'Southern Cycle & BMX Supply — Galle Road (Admin Verified Reference)',
      source_contact: 'Verified by Shaun David Studios Catalog Admin',
      availability: 'In Stock (Verified at last audit)',
      compatibility_warning: 'WARNING: Never install axle pegs on quick-release hubs or thin 10mm multi-speed road/MTB axles — they can shear under weight. Never carry passengers on pegs.',
      last_verified_date: '2026-10-22'
    },
    {
      id: 'part_8',
      name: 'Dual-Certified BMX/Skate Helmet (ASTM F1492 / CPSC) + Hard-Cap Knee & Shin Guards',
      brand: 'Triple Eight / Pro-Tec / TSG Reference Spec',
      category: 'protective_gear',
      compatible_bike_types: 'All Riders (BMX, MTB, Dirt Jumper, Freestyle)',
      description: 'Multi-impact ASTM F1492 / CPSC dual-certified hardshell helmet with sweat-wicking liner, paired with EVA foam + polycarbonate knee/shin guards.',
      price_lkr: 19500,
      price_verified: 1,
      retailer_name: 'Shaun David Studios Partner Safety Gear Reference — Colombo / Bentota',
      source_contact: 'safety@shaundavidstudios.lk',
      availability: 'Available (Verified at last audit)',
      compatibility_warning: 'Inspect inside the helmet for legitimate CPSC / EN1078 / ASTM certification stickers. Uncertified novelty shells do not protect against head trauma.',
      last_verified_date: '2026-10-24'
    },
    {
      id: 'part_9',
      name: 'BMX & MTB Multi-Tool Kit (17mm Deep Socket, 6mm/8mm Hex, Spoke Wrench & Floor Pump)',
      brand: 'Park Tool / Topeak Reference Spec',
      category: 'tools_maintenance',
      compatible_bike_types: 'All Bicycles',
      description: '17mm deep socket with extension for axle nuts/pegs, hardened 4/5/6/8mm hex keys, chain breaker, 3.23mm spoke wrench, and 160 PSI gauge pump.',
      price_lkr: 12400,
      price_verified: 1,
      retailer_name: 'Lanka Pro Cycle Workshop — Colombo 04 (Admin Verified Reference)',
      source_contact: 'Verified by Shaun David Studios Catalog Admin',
      availability: 'In Stock (Verified at last audit)',
      compatibility_warning: 'Use the correct metric hex size (usually 6mm or 8mm) for stem and crank bolts; using worn or imperial tools strips bolt heads.',
      last_verified_date: '2026-10-23'
    }
  ];

  const insertPart = db.prepare(`
    INSERT INTO parts_catalog (
      id, name, brand, category, compatible_bike_types, description, image_url,
      price_lkr, price_verified, retailer_name, source_contact, availability,
      compatibility_warning, last_verified_date, updated_by_admin_id
    ) VALUES (?, ?, ?, ?, ?, ?, '/assets/brand/riderise_logo.png', ?, ?, ?, ?, ?, ?, ?, 'usr_admin_nethmi')
  `);
  for (const p of partsCatalog) {
    insertPart.run(
      p.id, p.name, p.brand, p.category, p.compatible_bike_types, p.description,
      p.price_lkr, p.price_verified, p.retailer_name, p.source_contact,
      p.availability, p.compatibility_warning, p.last_verified_date
    );
  }
  } // end demo catalog

  // 10. Seed Official Shaun David Studios Events + Community Event (demo-only: real events are
  // created by studio staff in the admin console)
  if (demo) {
  const studioEvents = [
    {
      id: 'evt_sds_1',
      title: 'Bentota Sunset BMX Clinic & Pre-Ride Safety Jam',
      banner_type: 'sunset_jam',
      description: 'Official Shaun David Studios weekend skill clinic focusing on bike setup checks, braking modulation, trackstands, and beginner bunny-hop coaching in a closed coastal court.',
      schedule_text: 'Saturday, 14 Nov 2026 • 3:30 PM Tech Inspection • 4:00 PM – 6:30 PM Coached Progression Sessions',
      event_date: '2026-11-14',
      district: 'Kalutara (incl. Bentota)',
      venue: 'Bentota Coastal Sports Court (Closed Paved Arena)',
      registration_deadline: '2026-11-12',
      capacity: 45,
      is_official_studio_event: 1,
      status: 'featured',
      eligibility_requirements: 'Riders aged 16 and above. Riders aged 16–17 must bring signed parent/guardian consent form provided upon registration.',
      equipment_safety_requirements: 'Mandatory certified helmet, closed-toe shoes, handlebar end plugs installed, and passes pre-session 7-point mechanic inspection.',
      organizer_contact: 'Shaun David Studios Events Team — safety@shaundavidstudios.lk',
      announcements: [
        'Free spoke-tension and stem-torque inspection desk opens at 3:30 PM!',
        'Hydration station and shaded rest tent provided for all registered riders.'
      ],
      post_event_recap: ''
    },
    {
      id: 'evt_sds_2',
      title: 'Colombo Custom Bike Build Showcase & Mechanics Workshop',
      banner_type: 'colombo_workshop',
      description: 'Learn wheel truing, U-brake / hydraulic disc setup, and bottom bracket maintenance with Shaun David Studios mechanics and senior builders.',
      schedule_text: 'Sunday, 29 Nov 2026 • 9:30 AM – 1:00 PM',
      event_date: '2026-11-29',
      district: 'Colombo',
      venue: 'Colombo Youth & Sports Pavilion Hall B',
      registration_deadline: '2026-11-26',
      capacity: 60,
      is_official_studio_event: 1,
      status: 'upcoming',
      eligibility_requirements: 'Open to registered RideRise LK members aged 16+.',
      equipment_safety_requirements: 'Bring your bicycle clean and dry if participating in the guided inspection clinic.',
      organizer_contact: 'Shaun David Studios — support@shaundavidstudios.lk',
      announcements: [
        'Every attendee receives a printed Pre-Ride Safety & Torque Reference Card.'
      ],
      post_event_recap: ''
    },
    {
      id: 'evt_sds_3',
      title: 'Galle Fort Perimeter Skatepark Flow & Etiquette Session (Past Recap)',
      banner_type: 'past_recap',
      description: 'Completed official studio session introducing 32 Southern Province riders to park flow lines, turn-taking etiquette, and safe landing absorption.',
      schedule_text: 'Completed • Saturday, 10 Oct 2026',
      event_date: '2026-10-10',
      district: 'Galle',
      venue: 'Galle Municipal Skate & Practice Court',
      registration_deadline: '2026-10-08',
      capacity: 35,
      is_official_studio_event: 1,
      status: 'past',
      eligibility_requirements: 'Riders aged 16+ with accepted waiver.',
      equipment_safety_requirements: 'Helmet, bar-end plugs, and knee pads mandatory.',
      organizer_contact: 'Shaun David Studios — safety@shaundavidstudios.lk',
      announcements: [
        'Event completed with 0 injuries and 32 bikes passing mechanical inspection!'
      ],
      post_event_recap: 'Consented Highlights: 32 riders completed the Fundamentals & Park Etiquette clinic. Special recognition to Kasun Perera and Nethmi Jayawardena for assisting 12 rookie riders with U-brake adjustments and bar-end installations.'
    },
    {
      id: 'evt_comm_1',
      title: 'Kandy Hill Country Pump-Track Morning Practice (Community Hosted)',
      banner_type: 'community_meetup',
      description: 'Community-organized morning pump-track flow practice in Kandy. Note: This is a community-created meetup, not an official Shaun David Studios hosted event.',
      schedule_text: 'Sunday, 22 Nov 2026 • 8:00 AM – 10:30 AM',
      event_date: '2026-11-22',
      district: 'Kandy',
      venue: 'Hanthana Lower Practice Pump Track',
      registration_deadline: '2026-11-20',
      capacity: 25,
      is_official_studio_event: 0,
      status: 'upcoming',
      eligibility_requirements: 'Riders aged 16+ only.',
      equipment_safety_requirements: 'Helmet and working rear brake required.',
      organizer_contact: 'Hosted by Guild @roshan_dirtjump (Community Event)',
      announcements: ['Weather check will be posted 24 hours prior in Guild Chat.'],
      post_event_recap: ''
    }
  ];

  const insertEvent = db.prepare(`
    INSERT INTO studio_events (
      id, title, banner_type, description, schedule_text, event_date, district, venue,
      registration_deadline, capacity, is_official_studio_event, status, eligibility_requirements,
      equipment_safety_requirements, organizer_contact, announcements_json, post_event_recap,
      created_by_admin_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr_admin_nethmi', ?)
  `);
  for (const e of studioEvents) {
    insertEvent.run(
      e.id, e.title, e.banner_type, e.description, e.schedule_text, e.event_date,
      e.district, e.venue, e.registration_deadline, e.capacity, e.is_official_studio_event,
      e.status, e.eligibility_requirements, e.equipment_safety_requirements,
      e.organizer_contact, JSON.stringify(e.announcements), e.post_event_recap, now
    );
  }

  const insertEventReg = db.prepare(
    'INSERT INTO event_registrations (event_id, user_id, status, emergency_ack, registered_at) VALUES (?, ?, ?, 1, ?)'
  );
  insertEventReg.run('evt_sds_1', 'usr_kasun', 'registered', now);
  insertEventReg.run('evt_sds_1', 'usr_admin_nethmi', 'registered', now);
  insertEventReg.run('evt_sds_2', 'usr_roshan', 'registered', now);
  } // end demo events

  // 11. Seed Legal & Safety Documents (Including Verbatim Draft Safety Notice from Section 15)
  const legalDocs = [
    {
      slug: 'safety_notice',
      title: 'Draft Safety Notice (Subject to Legal Review)',
      version: '1.0-draft',
      content_markdown: `### MANDATORY SAFETY NOTICE (DRAFT — SUBJECT TO LEGAL REVIEW)

"${DRAFT_SAFETY_NOTICE_VERBATIM}"

### Critical Safety Statement
Users must **never** treat a social feature, tutorial, leaderboard, bike build score, or another person's advice on RideRise LK as a guarantee of physical safety. Always inspect your bicycle before every ride, wear a properly fitted certified helmet and protective gear, ride only in lawful controlled environments away from traffic and pedestrians, and seek qualified in-person instruction.`
    },
    {
      slug: 'terms_of_service',
      title: 'Terms of Service (Draft — Subject to Legal Review)',
      version: '1.0-draft',
      content_markdown: `### RideRise LK Terms of Service — Shaun David Studios
*Notice: This document is a working Phase 1 legal draft subject to review by qualified Sri Lankan legal counsel before commercial release.*

1. **Eligibility & Age Requirement (16+)**: RideRise LK is intended solely for users aged **16 years and older**. Users aged 16–17 receive heightened default privacy protections and should review these terms with a parent or legal guardian. Note that a user's age declaration during onboarding is not a guarantee of identity verification; Shaun David Studios enforces proportionate abuse-prevention and moderation safeguards across all accounts.
2. **Draft Safety Notice**:
   > "${DRAFT_SAFETY_NOTICE_VERBATIM}"
3. **No Guarantee of Physical Safety**: You must never treat a social feature, stunt tutorial, leaderboard rank, Bike Build Rating, parts listing, or another user's post as a certification or guarantee of physical safety.
4. **Prohibited Conduct**: You may not post or promote riding in moving traffic, illegal road stunts, dangerous stunt challenges, bullying, harassment, threats, doxxing, impersonation, scams, or unwanted contact toward minors.
5. **Parts Catalog & Marketplace Rules**: The Sri Lankan Bicycle-Parts Catalog is an informational discovery directory. Unverified prices are explicitly labeled *"Price not verified"*. RideRise LK Phase 1 does not process payments or guarantee third-party sellers.`
    },
    {
      slug: 'privacy_policy',
      title: 'Privacy Policy & Data Retention (Draft — Subject to Legal Review)',
      version: '1.0-draft',
      content_markdown: `### RideRise LK Privacy Policy — Shaun David Studios
*Notice: Subject to formal legal review.*

1. **Information We Collect & Why**:
   - **Google Authentication**: We use Google OAuth / Firebase Authentication to verify your account without ever asking for or storing your Google password.
   - **Private Eligibility Data (\`users_private\`)**: Your email address and optional date of birth (used solely to confirm 16+ eligibility and apply 16–17 minor safeguards) are stored in a strictly separated private table and are **never** displayed on public profiles.
   - **Public Profile & Bicycle Data**: Your chosen username, display name, district (never your home address), bicycle build specifications, and public posts are visible according to your chosen privacy settings (\`public\`, \`friends\`, or \`private\`).
2. **Location Privacy & Phase 2 Preview**:
   - Phase 1 does **not** collect GPS coordinates, attach EXIF location tags to uploaded photos, or share live locations.
   - Future Phase 2 live-map and guild telemetry features will require explicit, separate opt-in consent.
3. **Media & Messages Storage**:
   - Private 1-to-1 messages are restricted to accepted friends only. Administrators do not browse private messages except when a specific conversation or message is formally reported for safety violations.
4. **Push Notifications & Permissions**:
   - Notification preferences can be toggled at any time in Settings.
5. **Account Deletion & Data Retention**:
   - You may permanently delete your account at any time via **Profile → Settings → Delete Account**. Account deletion cascades and removes your profile, bicycles, posts, friendships, and messages immediately. Safety audit logs of resolved abuse reports are retained for up to 90 days for abuse prevention.
6. **Contact Shaun David Studios**:
   - Safety & Moderation: \`safety@shaundavidstudios.lk\`
   - Privacy & Data Requests: \`privacy@shaundavidstudios.lk\``
    },
    {
      slug: 'community_guidelines',
      title: 'Community Guidelines & Teen Safety Charter',
      version: '1.0',
      content_markdown: `### RideRise LK Community Guidelines
1. **Helmet & Closed-Spot Culture**: Celebrate bike control, mechanical craftsmanship, and closed-park progression. Posts depicting reckless riding in moving traffic or endangering pedestrians will be removed.
2. **Zero Tolerance for Bullying, Harassment & Exploitation**: Harassment, threats, hate speech, impersonation, non-consensual imagery, or inappropriate conduct toward 16–17 year old riders results in immediate suspension.
3. **Protect Personal Privacy**: Never post your home address, school uniform badge, phone number, NIC number, or another person's private identifying details.
4. **Honest Bike & Parts Information**: Never claim a cracked frame or faulty brake is safe to ride, and never misrepresent unverified bicycle parts in community posts.`
    }
  ];

  const insertLegal = db.prepare(`
    INSERT INTO legal_documents (slug, title, version, content_markdown, updated_at, updated_by_admin_id)
    VALUES (?, ?, ?, ?, ?, '${demo ? 'usr_admin_nethmi' : 'usr_studio'}')
  `);
  for (const doc of legalDocs) {
    insertLegal.run(doc.slug, doc.title, doc.version, doc.content_markdown, now);
  }

  if (demo) {
  // 12. Seed a sample pending report & notifications for testing Admin Moderation
  db.prepare(`
    INSERT INTO reports (
      id, reporter_id, target_type, target_id, reason_category, details, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    'rep_sample_1',
    'usr_roshan',
    'post',
    'post_4',
    'other',
    'Routine moderation queue check: Verify beginner tire pressure question has accurate safety guidance attached.',
    now
  );

  const insertNotif = db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  insertNotif.run(
    'notif_1',
    'usr_kasun',
    'friend_request',
    'New Friend Request',
    '@dilshan_rides sent you a friend request.',
    'friendship',
    'fr_3',
    now
  );
  insertNotif.run(
    'notif_2',
    'usr_kasun',
    'event_reminder',
    'Official Studio Event Reminder',
    'Bentota Sunset BMX Clinic & Pre-Ride Safety Jam: Remember to bring your helmet and check bar-end plugs!',
    'event',
    'evt_sds_1',
    now
  );
  } // end demo moderation queue
}

module.exports = {
  DRAFT_SAFETY_NOTICE_VERBATIM,
  seedDatabase,
  resolveDemoSeed
};
