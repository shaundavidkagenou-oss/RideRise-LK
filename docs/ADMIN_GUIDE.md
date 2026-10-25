# Studio administration guide

Everything below is performed inside the app: sign in with an administrator account, open
**Explore → Studio admin** (or the 🛠️ Admin button in the header). Moderators see the
report queue and content tools; administrators additionally get rank, catalog and official
event publishing. Every action is written to `admin_audit_logs` with the acting account.

| Role | Can do |
|---|---|
| `rider` | Community features only. No access to `/api/admin/*` (verified by tests). |
| `moderator` | View metrics, resolve reports, hide/remove content, review reported messages, verify catalog entries |
| `admin` | Everything above **plus** rank configuration, creating catalog entries, publishing official Shaun David Studios events, promoting roles |

To grant a role (Phase 1 uses the database; Phase 2 will add an in-app role manager):

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('backend/riderise_lk.sqlite');
db.prepare(\"UPDATE users_private SET role='admin' WHERE email=?\").run('someone@shaundavidstudios.lk');"
```

---

## 1. Reports & moderation

1. Open **Studio admin → Report queue**. Pending reports are red-bordered.
2. Click **Review** → choose a decision:
   - **Action taken** — removes the reported post/comment, restricts the guild, and (only if
     you tick the box) suspends the reported account with your note as the suspension reason.
   - **Dismiss** — no violation found.
3. Write a resolution note. The reporter automatically receives a *Safety Report Reviewed*
   notification, and the decision is audited.
4. **Content moderation** lists posts in `pending_review` (e.g. content flagged with road or
   traffic keywords) and `hidden` posts. Use **Restore** or **Remove**.

Policy reminders:

- Review reported messages only — never browse private conversations proactively.
- Suspension requires a clear, documented reason; serious violations only.
- Nudity, threats, harassment and conduct toward minors: remove and suspend immediately.
- Repeated guild violations → set `guilds.moderation_status='restricted'` (via the report
  flow) and notify the owner.

Moderation states for posts: `pending_review` → `visible` → `hidden` → `removed`.
Hidden/removed content disappears from all feeds and profile counts immediately.

---

## 2. Rider ranks

**Studio admin → Rider ranks → Edit** (or **+ Add rank level**).

Fields: name, description, minimum XP threshold. Creating a rank appends the next level
automatically; its colour and badge icon can be set later through the same endpoint with
`badge_icon`/`color_hex` (API: `POST /api/admin/ranks`).

Guidance:

- Keep thresholds monotonically increasing (e.g. 0 / 150 / 350 / 650 / 1050 / 1600 / 2400).
- XP is **never** awarded by the client. The engine (`backend/services.js`) clamps each
  action to a server-defined maximum and refuses unknown action types — verified by tests.
- Never introduce rewards for dangerous riding, road stunts, streaks or escalation.
- Rank names are cosmetic; changing them retroactively updates every profile's label because
  profiles reference `rank_id`, not a copied name.

---

## 3. Stunt tutorials

The 21 modules are seeded from `backend/seed.js` (4 categories: Fundamentals, Beginner
freestyle, Intermediate, Advanced). Each module carries: difficulty, prerequisites, bicycle
suitability, protective gear, safe environment, inspection checklist, learning stages,
common errors, stop conditions, coaching reminder, technique diagram and quiz.

To add or edit a module:

1. Edit the `stuntModules` array in `backend/seed.js`, **or** insert directly:
   ```sql
   INSERT INTO stunt_modules (id, slug, category, title, difficulty, xp_reward,
     prerequisites_json, bike_suitability, protective_gear_json, safe_environment,
     inspection_checklist_json, learning_stages_json, common_errors_json,
     stop_conditions_json, coaching_reminder, diagram_type, quiz_questions_json,
     requires_safety_ack, display_order)
   VALUES ('mod_fund_7', 'surface-assessment', 'fundamentals', 'Assessing Surface Grip', ...);
   ```
2. Content rules that must not be broken:
   - Always name a **safe, legal, controlled** practice environment.
   - Always include **stop conditions** and a **coaching reminder** for advanced content.
   - Advanced modules must set `requires_safety_ack = 1` and prerequisites.
   - Never instruct practice on public roads, in traffic or near pedestrians.
   - Never promise that an online tutorial guarantees safety.
3. Quiz answers use `correctIndex` (0-based). Completion requires all checklist items, any
   required safety acknowledgement, and a **100%** quiz score — enforced server-side.
4. `display_order` controls library ordering; categories render in the fixed four-group
   layout.

Unlocking: a module is locked until every prerequisite module is completed, and the UI
shows exactly which modules are missing.

---

## 4. Sri Lankan bicycle-parts catalog

**Studio admin → Parts catalog verification**, or API `POST /api/admin/parts`.

Honesty rules (these are enforced by the UI and documented to users):

- Only tick **Price verified today** when a real, current LKR price has been confirmed with
  the retailer. Leave it unchecked and the app displays **“Price not verified”** — it will
  never show an invented amount.
- Always fill the **compatibility warning** (axle size, brake post type, headset standard,
  thread pitch, clearance, certification caveats).
- `last_verified_date` is stamped automatically for verified rows.
- Do not claim a product is certified or safe without evidence from the manufacturer.
- Phase 1 is an information service: no payments, no delivery promises, no commissions.

Fields: name, brand/reference, category (one of the nine), compatible bike types,
description, retailer, source/contact, availability, compatibility warning, price, verified
flag. Update an existing row by sending its `id`.

---

## 5. Official events

**Studio admin → Official event publisher** (admin role only).

Provide title, date, registration deadline, district, venue, capacity and description. The
event is created with `is_official_studio_event = 1` and appears in the Events tab marked
**OFFICIAL STUDIO EVENT**. Community-created meetups are labelled **COMMUNITY MEETUP** and
can never be marked official by riders.

Statuses: `featured`, `upcoming`, `past`, `cancelled`. Set `status='cancelled'` and add a
`cancellation_notice` message when an event is called off — registered riders see it
immediately and registration closes.

Safety content requirements for every official event:

- Eligibility (age, guardian consent for 16–17, experience level).
- Equipment & safety requirements (certified helmet, bar-ends, working brakes, inspection).
- Organiser contact (use `safety@shaundavidstudios.lk` or a monitored address).

After the event: add a recap (consented results/photos only). Never publish attendee
contact details or live locations.

---

## 6. Guilds

Guilds are user-created; staff intervene only through reports.

- Report queue → target `guild` → **Action taken** sets `moderation_status='restricted'`,
  hiding the guild from discovery.
- Owners manage members, approvals, announcements and privacy within the app.
- Guild owners/moderators can see only public profile fields (username, display name,
  district, rank) — never emails, dates of birth or private messages. This is enforced in
  the API response shape (verified by tests).

---

## 7. Legal documents

`legal_documents` holds Terms, Privacy Policy, Community Guidelines and the draft Safety
Notice. To publish a reviewed version:

```sql
UPDATE legal_documents
SET content_markdown = :reviewedText, version = '1.1', updated_at = :now,
    updated_by_admin_id = 'usr_studio'   -- the studio account that owns official content
WHERE slug = 'terms_of_service';
```

Bump `version` and keep the Safety Notice text verbatim unless counsel approves changes.
The onboarding wizard re-prompts users when the accepted version differs (Phase 2 hook;
Phase 1 records the accepted version on the account).

---

## 8. Operational metrics

The admin console shows: active riders, youth accounts (16–17), bicycle profiles, bikes with
safety flags, pending reports, posts awaiting review, visible posts, active guilds, verified
vs unverified catalog rows. Metrics never include message contents or private account fields.
