# Safety, youth protection and moderation

RideRise LK is a community and education product, not a coaching or certification service.
This document records how the safety requirements in the brief are implemented — and where
the app explicitly refuses to imply safety it cannot guarantee.

## 1. Safety Centre (permanent, discoverable everywhere)

`#/safety` is reachable from: the bottom navigation → header shield button, the stunt
library banner, bike profile cards, the feed banner, the post composer warning and the
Profile shortcuts. It contains:

1. The **draft safety notice, verbatim**, labelled *subject to legal review*.
2. The eight mandated rules: helmet, legal controlled area, never in traffic or near
   pedestrians, inspect before riding, progress gradually with qualified coaching, never
   ride impaired/distracted, stop when equipment is unsafe, follow laws and venue rules.
3. Sri Lankan emergency numbers (1990 Suwa Seriya, 119 Police, 110 Fire).
4. The **7-point pre-ride inspection** (helmet, bar-ends, brakes, tires, cranks/pedals,
   frame/fork, controlled area) which awards +25 XP **once per day**, server-enforced.
5. Reporting shortcuts and links into the stunt library.

## 2. Safety in the stunt library

All 21 modules include: difficulty, prerequisites, bicycle suitability, protective
equipment, safe practice environment, inspection checklist, staged progressions, common
errors, **stop conditions**, a coaching reminder and a quiz.

- **Fundamentals → Beginner → Intermediate → Advanced** must be completed in order; a locked
  module names the exact prerequisites still missing (server returns
  `PREREQUISITES_NOT_MET`).
- Advanced modules (advanced freestyle concepts, larger drops/rotations, technique analysis)
  require `requires_safety_ack`, cannot be completed without explicit acknowledgement, and
  state that practice is permitted **only** with qualified in-person coaching in a padded or
  supervised facility.
- No module instructs practice on roads, in traffic, near pedestrians, on unsuitable
  surfaces or in restricted areas.
- Every module finishes with a reminder that an online guide cannot guarantee safety.
- Beginners are taught the rear-brake loop-out reflex before any front-wheel lift, and
  obstacle drills use collapsible markers (never bricks or curbs).

## 3. Anti-incentive design for risky behaviour

Explicitly **not** implemented: streak rewards, "trick of the day" competitions, escalating
risk challenges, points for stunts in traffic, leaderboards based on trick difficulty.

XP is granted only for: completed learning modules (with quiz), pre-ride inspections,
completed bike questionnaires, constructive community posts, official event registration and
approved achievements. The engine (`backend/services.js`) uses an allow-list of action types,
clamps each delta to a maximum, and rejects unknown types — so even a compromised client
cannot mint XP for dangerous behaviour (test 28).

Content that mentions road/traffic stunting keywords is automatically set to
`pending_review` and hidden from all feeds until a moderator reviews it (test 15).

## 4. Age-appropriate design (16–17)

- Minimum age 16 enforced server-side; a DOB under 16 returns `403 UNDER_MINIMUM_AGE`.
- Self-declaration is described honestly in the app as **not** identity verification, with
  moderation and rate limits layered on top.
- 16–17 accounts default to `profile_visibility = 'friends'` and
  `hide_from_leaderboards = 1` (test 6), and can opt into more openness themselves.
- No requirement to publish a face photo, real name, exact location or contact details —
  display name, avatar and district-only location are all optional/limited.
- Private messaging is **friends-only in both directions**; non-friends cannot open a thread,
  send links or attachments (tests 18, FLOW 7).
- Blocking is bidirectional and immediately stops profile views, friend requests and
  messages; blocked profiles return 404 to the blocker's counterpart.
- Reports cover bullying, threats, impersonation, unwanted sexual content, suspicious PII
  requests, dangerous road stunts and marketplace scams.
- Guild owners/moderators can never see member emails, DOB or private messages
  (test 19 asserts no `@example.com` appears in member payloads).

## 5. Moderation workflow

```
rider reports content ──▶ reports(status=pending)
                              │  moderator opens Studio admin → Report queue
                              ▼
                   resolve(decision, note)
        ┌─────────────────────┴─────────────────────┐
   action_taken                                dismissed
   ├─ post/comment → moderation_status='removed'   └─ closes with note
   ├─ guild → moderation_status='restricted'
   └─ optional user suspension + reason
                    │
                    ├─ reporter notified ("Safety Report Reviewed")
                    └─ admin_audit_logs row
```

- Moderation states: `pending_review → visible → hidden → removed`.
- Suspension (`account_status='suspended'`) blocks sign-in with the stated reason and the
  safety contact address.
- Private messages are reviewed **only** when formally reported; moderators have no inbox
  browsing UI and the admin metrics never include message content.
- Least privilege: moderators cannot publish official events or edit ranks (test 23).
- Transparency: reporters always get a resolution notification.

## 6. Privacy controls

| Data | Public? | Control |
|---|---|---|
| Username, display name, avatar, bio, district | Yes (per visibility) | `profile_visibility` public/friends/private |
| Preferred riding area | Yes (free text, no coordinates) | Editable, deletable |
| Email, DOB, OAuth subject | **Never** | `users_private`, never serialised publicly |
| Phone number | Not collected | — |
| Precise location | Not collected | No GPS, EXIF stripped on upload |
| Private messages | Participants only | Friends-only + block + report |
| Leaderboard participation | Optional | `hide_from_leaderboards` |
| Friend requests / messages | Delegated | `allow_friend_requests`, `allow_messages_from` |

Consent points: four legal documents accepted during onboarding (recorded with versions and
timestamps), factual notification that data is stored, explicit safety acknowledgement for
advanced modules, and clear consent text before any future sensitive permission (the
notification permission is requested in-context from Settings, not at launch).

## 7. Bike Build Rating safety semantics

- Five weighted categories: structural safety (30), maintenance (25), use-case compatibility
  (20), completeness (15), component clarity (10).
- Any reported critical defect (cracks, damaged parts, loose bolts, worn tires, faulty brakes,
  missing bar-ends) or "Poor" condition sets `has_critical_safety_defect` and caps the score
  at **39/100**, regardless of how expensive the parts are or how high the cosmetic rating.
- Brakeless setups are capped at 18/30 for structural safety with an explicit
  "skatepark only, never on public roads" warning.
- Brand prestige, price, carbon fibre and appearance never raise the score; carbon on street
  builds is actively penalised with an impact-damage caution.
- Every score is marked **unverified user submission** with a reminder that a photograph or a
  questionnaire cannot prove a bike is safe.

## 8. Catalog honesty & purchase safety

- Unverified prices render as **“Price not verified”** — never an invented number.
- `last_verified_date` is visible on every listing.
- Every listing carries a compatibility warning (axle size, brake post standard, headset
  standard, thread pitch, thread engagement, minimum insertion, certification caveats).
- No certification or safety claims are made without manufacturer evidence.
- Phase 1 states plainly that it does not process payments or guarantee sellers, and that
  RideRise LK earns no commission.

## 9. Events safety

Official events require eligibility, guardian consent for 16–17 year-olds, equipment and
safety requirements, organiser contact and a mechanical inspection gate. Cancellations show a
notice and close registration. Attendee lists, contacts and locations are never published;
post-event recaps require participant consent.

## 10. What the app does not claim

- That a declaration of age is verification.
- That a tutorial, leaderboard, badge, rank or bike score guarantees safety.
- That third-party sellers, products, events or user posts are safe or accurate.
- That the product is legally compliant in every jurisdiction — the legal documents are
  drafts pending review by qualified Sri Lankan counsel.
