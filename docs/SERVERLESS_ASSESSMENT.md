# "Can we just delete the server?" — an honest assessment

You asked whether the app can keep all its features with no server behind it. The short answer is
**no — not without deleting the features themselves.** This page records why, with the actual
numbers from this repository, so the decision is not guesswork. It also lists the one serious
alternative and what it would cost.

---

## 1. HTTPS is not the problem

It feels like "the HTTPS shit" is the obstacle. It is not. HTTPS is two lines that a machine
writes for itself:

```
rideriselk.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy fetches a free certificate, renews it forever, and the app gets `https://`. Nobody types a
certificate or pays for one. The real requirement is much simpler and less negotiable: **there has
to be one machine, somewhere, that is on when riders are not.**

---

## 2. Why the server cannot be removed without removing features

The API is where the app's shared state lives. In this repo:

| Measure | Count |
|---|---|
| Client calls into the API (`api('/api/…')`) | **219 call sites**, **148 distinct endpoints** |
| Server route handlers | **52** |
| Backend code | **11,455 lines** across `backend/` |
| Automated tests covering that behaviour | **107** |

Those endpoints are not plumbing. They are the product:

- **The feed, messaging, guilds, events, marketplace** — every rider must see the *same* rows. That
  requires one database that everyone talks to. A phone cannot hold the shared copy.
- **Accounts and identity** — the server verifies the Firebase ID token (signature against Google's
  certificates, `iss`/`aud`/`exp`) before any session exists. Without that, anyone can claim to be
  another rider.
- **Moderation, bans, appeals, reporting** — a blocked rider must be blocked *everywhere*. Enforce
  it on the phone and the phone's owner can edit it.
- **Studio RBAC** — a normal account must never gain admin, and admin actions are audited. That
  check has to happen where the data is written, not where the request is made.
- **Rate limits, spam limits, age gates (16+)**, XP/rank awards, verified price data, event
  capacity and waiting lists, the walkie-talkie transmission floor: all decided server-side.

Delete the server and every one of those either disappears or moves onto the device, where it is
advisory rather than enforced. For an app aimed at 16–17-year-olds, moving moderation and identity
onto the client is a **safety downgrade**, not a packaging shortcut.

---

## 3. What the real "serverless" migration would be

The only honest way to remove the machine is to move all of that into a managed backend. For this
app that means **Firebase** (you already use it for authentication):

| Piece | Today | Would become |
|---|---|---|
| Database | SQLite on the server | Firestore collections + documents |
| Auth checks | server verifies the token | Firestore **security rules** |
| Feed/messaging/guilds/events | REST + SSE | Firestore listeners |
| Moderation, bans, RBAC, XP, rankings | server code | **Cloud Functions** (needs the Blaze plan → **credit card**) or security rules |
| Voice signalling / walkie-talkie floor | server-held state | needs a signalling service anyway |
| Catalogue with "price not verified" rules | server-side validation | rules + admin claims |

Scale of the job, honestly: **148 client endpoints and 11,455 lines of backend logic** to
re-express, plus a rewrite of the realtime layer, plus re-testing all 107 suites. This is a
multi-week project, it would leave the app *more* dependent on a Google account rather than less,
and the free Firestore tier (50k document reads/day) is not obviously enough for a community feed.

It is doable. It is not a way to escape hosting — it is a way to rent someone else's hosting at the
cost of a rewrite. If you ever want it, say so and I will scope it properly first, with a
feature-by-feature plan.

---

## 4. What actually solves your problem

You do not need to delete the server. You need **one free host with no credit card**. That exists:

- **[`ALWAYSDATA_STEP_BY_STEP.md`](ALWAYSDATA_STEP_BY_STEP.md)** — Node 24, a real disk, free
  HTTPS, no card, no time limit, `https://yourname.alwaysdata.net`. About 15 minutes. Your PC stays
  off.
- **[`FREE_HOSTING_OPTIONS.md`](FREE_HOSTING_OPTIONS.md)** — the full comparison, including what
  cannot work (Render loses the database, Koyeb closed, serverless needs a rewrite).

The server is ~11,000 lines because the app does a lot. It runs in **60 MB of RAM** and needs
**5 MB of disk**. It fits on the smallest free tier that exists — it just needs *one*.

---

## 5. If you would rather have fewer features than a host

There is a middle option I can build: a **solo mode** where the app opens without any server and
everything that is local still works — learning pathways, the parts catalogue, the bike-build
calculator, stunts, safety guidance, event listings you imported — and the community parts say
plainly "connect a community server to post and message". Sample data would not pretend to be real
riders.

That keeps maybe a third of the app and none of the social core. It is a real option, not a
consolation prize. Say the word and I will scope what it covers before writing code.

---

## Summary

| Question | Answer |
|---|---|
| Can we remove HTTPS? | It is already free and automatic; removing it does nothing |
| Can we remove the server? | Only by removing accounts, feed, messaging, guilds, moderation and admin |
| Is there a free host with no card? | **Yes — alwaysdata free** (step-by-step guide included) |
| Is there a rewrite that removes hosting? | Firestore + Cloud Functions; weeks of work, and Functions need a card |
| Is there a smaller app with no server? | A "solo mode" — I can scope it on request |
