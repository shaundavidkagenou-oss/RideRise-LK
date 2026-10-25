# Phase 2 — Studio administrator guide

This guide covers the Phase 2 console: moderation, appeals, users, feedback, news, official
events, the tutorial CMS, catalogue verification, broadcast and the audit trail.

---

## 1. Signing in

1. Open the app → **Admin** (visible only to accounts with the `admin` or `moderator` role),
   or go directly to `#/admin`.
2. Sign in with the **studio credential**. On the first boot of an empty database the server
   uses `ADMIN_USERNAME`/`ADMIN_PASSWORD` (12+ characters) if you set them, otherwise it
   generates a strong password, prints it **once** in the server log and forces a change at
   first sign-in. No default password is shipped.
   The credential is linked to the first `admin`/`moderator` profile in `users_private`; if
   that profile is removed, the next boot re-links it automatically.
3. **Studio Console → 🔑 Password** and store it in a password manager before inviting real
   riders. A Firebase rider account cannot reach this console: its role comes from the
   database and a regular account is always `rider`.

Password rules: minimum 12 characters, not the bootstrap value, stored in the studio
password manager. Five failed attempts lock the account for 15 minutes; every attempt is
logged. If a deployment somehow still has `must_change_password = 1`, every moderation write
is refused with `PASSWORD_CHANGE_REQUIRED` until it is cleared.

### Roles

| Capability | Moderator | Studio admin |
|---|---|---|
| View dashboard, reports, appeals, feedback | yes | yes |
| Warn / suspend / ban riders, remove content | yes | yes |
| Resolve appeals | yes | yes |
| Publish studio news, broadcast | yes | yes |
| Publish official studio events, feature on home | **no** | yes |
| Verify catalogue prices, edit tutorials | yes | yes |
| See rider email addresses | **no** (masked) | yes |

## 2. Overview

Shows counts for active riders, riders aged 16–17, suspended accounts, pending reports,
pending appeals, new feedback, riders sharing location, voice participants, published news
and catalogue entries with unverified prices. It also shows which guilds currently have
consent-based sharing and the most recent moderation actions.

Location coordinates are never shown in this console — only how many members are sharing.

## 3. Reports and appeals

1. Open **Reports & appeals**. Critical and high-severity reports are highlighted.
2. Press **Review** and choose:
   - **Dismiss** — no violation (write the reason; the reporter sees it).
   - **Remove content** — post/comment/message is hidden, a tombstone remains.
   - **Warn** — rider receives a formal warning.
   - **Suspend** — temporary loss of access for the number of days entered.
   - **Ban** — permanent until an appeal succeeds.
3. Every action requires a resolution note and is written to `admin_action_log` with your
   account id.

Voice-room and walkie-talkie reports include the room id and the reported rider; audio is
never recorded, so moderation relies on reports, logs of participation and witness accounts.
Say so plainly if a reporter expects a recording.

### Appeals

Riders can appeal a suspension or ban from the app. **Resolve** lets you uphold or overturn
with a note. Overturning restores the account immediately and notifies the rider.

### Escalation

1. Dismiss, warn, or remove content for first-time minor issues.
2. Suspend for repeated harassment, spam or dangerous public content.
3. Ban for threats, sexual content involving minors, doxxing, impersonation of the studio,
   or repeated suspensions. Escalate to the studio owner and, where the law requires it,
   to the Sri Lanka Police / NCPA. Do not negotiate with the reported account in private.

## 4. Riders

Search by username, display name or email, filter by status, then:

- **Inspect** — status, role, minor flag, ban reason, recent moderation, internal notes and
  (for reported content) recent messages.
- **Warn**, **Ban** (with reason) and **Restore**.

Bans take effect on the next request: tokens stop working and `/api/auth/session` returns
`ACCOUNT_SUSPENDED`. Restoring clears the restriction and lets the rider sign in again.

Riders aged 16–17 are marked. Do not publish their images, school details or exact
locations, and do not share their contact details with other members.

## 5. Feedback inbox

Every message from the in-app feedback form lands here with category, priority, contact
email and status. Move items to **Working** then **Resolved** with a reply note; ticking the
notify option sends the rider an in-app notification. Treat safety reports as urgent even if
the rider marked them “general”.

## 6. News

**News & events → Publish studio news**: headline, body, category, optional pin, optional
notification to all active riders. Publishing is audit-logged and appears at `#/news`.
Unpublish to hide without deleting history.

## 7. Official events

Only a studio **admin** can create or edit an event from this console, and every event
created here carries the **Official Shaun David Studios Event** badge. Fill in date, district,
venue, capacity, category, description and safety requirements. The server generates a
6-character check-in code — share it only with riders who attend.

- **Feature home** — places the official event on the home surface; only official events can
  be featured.
- **Announce** — sends a titled announcement to registered riders.
- **Remind** — sends an event reminder notification.

Community and guild events are created by members/owners and never receive the official
badge. The studio badge cannot be applied to a user-created event, and no rider can
impersonate the studio: names containing “Shaun David Studios” in a community event are
rejected or require an admin edit.

Minors and in-person events: keep the guardian-consent wording, publish the safety rules,
and do not collect participant locations. Check-in records a timestamp only.

## 8. Tutorial CMS

**Tutorials** lists every module with track, status and version.

- **Edit** opens title, difficulty, track, category, XP, video URL, coaching reminder,
  learning objectives (one per line), inspection checklist (one per line) and the quiz as
  JSON: `[{"prompt":"…","options":["a","b"],"correctIndex":1,"explanation":"…"}]`.
- **Publish / Unpublish** controls visibility. Drafts are editable without exposing them.
- Saving increments the version and records who changed it.

Editorial rules:

- Every advanced module must stay framed as a **reference**, not a guarantee.
- Include practice, PPE and coaching reminders; never add risk-based incentives or
  “trick of the day” competitions.
- Never send `correctIndex` to the client — it is stripped server-side.
- Verify video links are yours or properly licensed. Do not embed third-party content
  without permission.

## 9. Catalogue

**Catalogue** lists components. For each entry:

- **Verify price** — enter the LKR price you personally confirmed and the source (retailer,
  phone call, visit). The server stamps today's date and appends price history. Leave blank
  to keep “Price not verified”. Never guess.
- **Unlist / Relist** — hides an entry without deleting its history.
- **Add retailer** — name and optional product URL; only verified, real retailer pages.
- **Add a new entry** — brand, model, category, description, retailer; price only if verified.

Prices, stock, certifications and reviews must never be invented, scraped from sites that
forbid it, or presented as safety ratings. Show “Check compatibility” instead of claiming
fit.

## 10. Broadcast

Send a titled message to all active riders, only riders aged 16–17, or studio staff. Use it
for safety notices and maintenance windows. It creates an in-app notification for every
recipient and attempts push for devices with registered tokens.

## 11. Audit and push diagnostics

- **Audit log** — append-only list of administrator actions with actor, target, reason and
  timestamp. Export it before any external review.
- **Push status** — configured/unconfigured, project id, delivery attempts and failures.
  **Send test push** only succeeds when FCM is configured and your device token is
  registered.

## 12. Routine checks

**Daily:** report queue, feedback inbox, voice/map incident reports.
**Weekly:** appeals, unverified catalogue prices, news freshness, audit gaps.
**Monthly:** prune stale device tokens, review suspensions, confirm backups and restore
once, re-read the privacy page, rotate administrator passwords if staff change.

## 13. Administrator safety

- Use the console on a trusted device; sign out on shared machines.
- Never ask a rider for their password, OTP or bank details, and never send login links.
- Do not view private conversations unless a report references them — and record why.
- Never share screenshots containing rider personal data.
- Report credential compromise immediately: reset the password (Firebase reset email), sign out everywhere,
  review the audit log.
