// RideRise LK by Shaun David Studios — Core Server-Side Engines
// 1. Transparent Bike Build Rating Calculator (0-100, separate from Rider Rank & Cosmetic Score)
// 2. Server-Validated Rider Rank & Safe XP Progression Engine

const CRITICAL_DEFECT_LABELS = {
  cracks: 'Structural cracks in frame, fork, or handlebars',
  damaged_parts: 'Bent or damaged structural components (rims, cranks, stem, pedals)',
  loose_bolts: 'Loose stem bolts, axle nuts, crank bolts, or headset play',
  worn_tires: 'Severely worn tire tread, exposed cords, or damaged sidewalls',
  faulty_brakes: 'Non-functioning, slipping, or frayed braking system',
  missing_bar_ends: 'Missing handlebar end plugs (high risk of impact injury)'
};

function calculateBikeBuildRating(input) {
  const defects = Array.isArray(input.safety_defects)
    ? input.safety_defects.filter((d) => d && d !== 'none')
    : [];

  const hasCriticalDefect = defects.some((d) =>
    ['cracks', 'damaged_parts', 'loose_bolts', 'worn_tires', 'faulty_brakes', 'missing_bar_ends'].includes(d)
  ) || input.maintenance_condition === 'Poor';

  // 1. Safety & Structural Integrity (0 - 30 pts)
  let safetyPoints = 30;
  const safetyNotes = [];
  if (defects.length === 0) {
    safetyNotes.push('No known structural or mechanical safety defects reported (+30/30).');
  } else {
    for (const d of defects) {
      if (d === 'cracks') safetyPoints -= 25;
      else if (d === 'damaged_parts') safetyPoints -= 18;
      else if (d === 'faulty_brakes') safetyPoints -= 18;
      else if (d === 'loose_bolts') safetyPoints -= 14;
      else if (d === 'worn_tires') safetyPoints -= 12;
      else if (d === 'missing_bar_ends') safetyPoints -= 8;
      else safetyPoints -= 10;
    }
    safetyPoints = Math.max(0, safetyPoints);
    safetyNotes.push(
      `Reported safety issues (${defects.map((d) => CRITICAL_DEFECT_LABELS[d] || d).join('; ')}) reduced structural safety score.`
    );
  }

  if (input.brake_type && input.brake_type.toLowerCase().includes('brakeless')) {
    safetyPoints = Math.min(safetyPoints, 18);
    safetyNotes.push(
      'Brakeless setup detected: Restricted to closed skateparks only. Never ride brakeless on public roads or near pedestrians.'
    );
  }

  // 2. Maintenance & Mechanical Condition (0 - 25 pts)
  const conditionMap = {
    'Excellent': 25,
    'Good': 21,
    'Fair': 14,
    'Needs Service': 6,
    'Poor': 0
  };
  const maintenancePoints = conditionMap[input.maintenance_condition] ?? 12;
  const maintenanceNotes = [
    `Self-reported maintenance condition: "${input.maintenance_condition || 'Unspecified'}" (${maintenancePoints}/25).`
  ];

  // 3. Use-Case & Discipline Compatibility (0 - 20 pts)
  // Evaluates whether bike type, frame material, tires, and wheels match the intended riding environment
  // Does NOT reward expensive brands or carbon over steel; rewards appropriate geometry/durability for the discipline.
  let compatibilityPoints = 14;
  const compatibilityNotes = [];
  const bikeType = (input.bike_type || '').toLowerCase();
  const primaryUse = (input.primary_use || '').toLowerCase();
  const frameMat = (input.frame_material || '').toLowerCase();
  const wheelSpec = (input.wheel_rim_spec || '').toLowerCase();

  if (
    (bikeType.includes('bmx') || bikeType.includes('freestyle')) &&
    (primaryUse.includes('street') || primaryUse.includes('skatepark'))
  ) {
    compatibilityPoints += 4;
    compatibilityNotes.push('BMX / Freestyle geometry aligns well with street or skatepark sessions.');
  } else if (
    (bikeType.includes('dirt') || bikeType.includes('mountain')) &&
    (primaryUse.includes('dirt') || primaryUse.includes('general'))
  ) {
    compatibilityPoints += 4;
    compatibilityNotes.push('MTB / Dirt Jumper configuration matches trail or general terrain.');
  } else {
    compatibilityPoints += 2;
    compatibilityNotes.push('General compatibility verified; ensure tire pressure and gearing match surface.');
  }

  if (wheelSpec.includes('double-wall') || wheelSpec.includes('double wall')) {
    compatibilityPoints += 2;
    compatibilityNotes.push('Double-wall rims provide appropriate impact resistance for stunt learning.');
  } else if (wheelSpec.includes('single-wall') && (primaryUse.includes('street') || primaryUse.includes('skatepark'))) {
    compatibilityNotes.push('Advisory: Single-wall rims may bend under repeated hopping/drop impacts; inspect spoke tension often.');
  }

  if (frameMat.includes('carbon') && primaryUse.includes('street')) {
    compatibilityPoints = Math.max(8, compatibilityPoints - 4);
    compatibilityNotes.push('Caution: Carbon fibre frames are vulnerable to point-impact crushing on street ledges/rails.');
  }
  compatibilityPoints = Math.min(20, compatibilityPoints);

  // 4. Build Completeness & Documentation (0 - 15 pts)
  const specFields = [
    input.bike_type,
    input.frame_material,
    input.frame_brand,
    input.fork_spec,
    input.tire_spec,
    input.wheel_rim_spec,
    input.handlebar_grip_spec,
    input.drivetrain_spec,
    input.brake_type,
    input.primary_use
  ];
  const filledSpecs = specFields.filter((v) => v && String(v).trim().length > 0).length;
  const photos = input.photos && typeof input.photos === 'object' ? input.photos : {};
  const photoSlots = ['frame', 'drivetrain', 'tires', 'brakes', 'complete'].filter((k) => photos[k]);
  let completenessPoints = Math.round((filledSpecs / specFields.length) * 10) + Math.min(5, photoSlots.length);
  completenessPoints = Math.min(15, completenessPoints);
  const completenessNotes = [
    `${filledSpecs}/${specFields.length} questionnaire sections answered and ${photoSlots.length}/5 verification photo slots populated (${completenessPoints}/15).`
  ];

  // 5. Component Specification Clarity (0 - 10 pts)
  // Rewards knowing one's components (for proper torque/maintenance), while gracefully accepting "I don't know"
  const unknownCount = specFields.filter(
    (v) => !v || String(v).toLowerCase().includes("don't know") || String(v).toLowerCase() === 'unknown'
  ).length;
  const clarityPoints = Math.max(2, 10 - unknownCount * 2);
  const clarityNotes = [
    unknownCount === 0
      ? 'All component specifications clearly identified for maintenance reference (10/10).'
      : `${unknownCount} component(s) marked as "I don't know" (${clarityPoints}/10). Identifying exact specs helps ensure safe part replacement.`
  ];

  let rawTotal = safetyPoints + maintenancePoints + compatibilityPoints + completenessPoints + clarityPoints;

  // CRITICAL SAFETY RULE: Never give a high rating if critical safety defects exist, even with expensive parts!
  let safetyCapApplied = false;
  if (hasCriticalDefect && rawTotal > 39) {
    rawTotal = 39; // Capped in 'Inspection Required / Unsafe to Ride' band
    safetyCapApplied = true;
  }

  let safetyRecommendation =
    'Routine pre-ride check recommended: verify tire inflation, handlebar alignment, crank tightness, and brake response before every session.';
  if (hasCriticalDefect) {
    const defectDescriptions = defects.map((d) => CRITICAL_DEFECT_LABELS[d] || d);
    safetyRecommendation =
      'CRITICAL SAFETY NOTICE — DO NOT RIDE FOR STUNTS: You reported ' +
      (defectDescriptions.length > 0 ? defectDescriptions.join(', ') : 'poor mechanical condition') +
      '. Expensive or branded components do NOT compensate for structural damage or faulty brakes. Inspect and repair this bicycle with a qualified mechanic before riding.';
  }

  return {
    build_score: rawTotal,
    has_critical_safety_defect: hasCriticalDefect ? 1 : 0,
    safety_recommendation: safetyRecommendation,
    verification_status: 'unverified_user_reported',
    cosmetic_rating: input.cosmetic_rating ? Math.min(5, Math.max(1, Number(input.cosmetic_rating))) : null,
    breakdown: {
      safety_structural: { score: safetyPoints, max: 30, notes: safetyNotes },
      maintenance_condition: { score: maintenancePoints, max: 25, notes: maintenanceNotes },
      use_case_compatibility: { score: compatibilityPoints, max: 20, notes: compatibilityNotes },
      build_completeness: { score: completenessPoints, max: 15, notes: completenessNotes },
      component_clarity: { score: clarityPoints, max: 10, notes: clarityNotes },
      safety_cap_applied: safetyCapApplied,
      disclaimer:
        'Unverified User Submission: Score reflects self-reported build completeness, compatibility, and maintenance condition. Brand prestige and cosmetic ratings are excluded from the Bike Build Rating.'
    }
  };
}

function recalculateUserRank(db, userId) {
  const profile = db.prepare('SELECT xp, rank_id FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) return null;
  const ranks = db.prepare('SELECT * FROM ranks ORDER BY min_xp ASC').all();
  let matchedRank = ranks[0];
  for (const r of ranks) {
    if (profile.xp >= r.min_xp) {
      matchedRank = r;
    }
  }
  if (matchedRank && matchedRank.id !== profile.rank_id) {
    db.prepare('UPDATE profiles SET rank_id = ?, updated_at = ? WHERE user_id = ?').run(
      matchedRank.id,
      new Date().toISOString(),
      userId
    );
  }
  return matchedRank;
}

const ALLOWED_SAFE_XP_ACTIONS = {
  stunt_module_completed: { maxDelta: 100, label: 'Completed Stunt-Learning Module & Safety Quiz' },
  safety_checklist_completed: { maxDelta: 25, label: 'Completed Pre-Ride 7-Point Safety Inspection' },
  official_event_registered: { maxDelta: 30, label: 'Registered for Official Shaun David Studios Event' },
  constructive_post_published: { maxDelta: 15, label: 'Published Constructive Community Build / Guide' },
  bike_questionnaire_completed: { maxDelta: 35, label: 'Completed Guided Bicycle Safety & Build Questionnaire' },
  achievement_unlocked: { maxDelta: 100, label: 'Unlocked Safe Riding Achievement' }
};

function awardValidatedXp(db, { userId, actionType, xpDelta, description, referenceId }) {
  const rule = ALLOWED_SAFE_XP_ACTIONS[actionType];
  if (!rule) {
    throw new Error(`Invalid or unsafe XP action type: ${actionType}`);
  }
  const safeDelta = Math.max(0, Math.min(Number(xpDelta) || 0, rule.maxDelta));
  if (safeDelta <= 0) return null;

  // Prevent duplicate XP farming for the same reference_id + action_type
  if (referenceId) {
    const existing = db
      .prepare('SELECT id FROM xp_activity_log WHERE user_id = ? AND action_type = ? AND reference_id = ?')
      .get(userId, actionType, referenceId);
    if (existing) {
      return { duplicate: true, xpAdded: 0 };
    }
  }

  const now = new Date().toISOString();
  const logId = 'xplog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  db.prepare(
    'INSERT INTO xp_activity_log (id, user_id, action_type, xp_delta, description, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(logId, userId, actionType, safeDelta, description || rule.label, referenceId || null, now);

  db.prepare('UPDATE profiles SET xp = xp + ?, updated_at = ? WHERE user_id = ?').run(safeDelta, now, userId);
  const newRank = recalculateUserRank(db, userId);

  return { duplicate: false, xpAdded: safeDelta, newRank };
}

module.exports = {
  CRITICAL_DEFECT_LABELS,
  calculateBikeBuildRating,
  recalculateUserRank,
  awardValidatedXp
};
