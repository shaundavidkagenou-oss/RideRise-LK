// RideRise LK Phase 2 — Studio administration: credential login, feedback inbox,
// bans/restrictions, content removal, appeals, news publishing, broadcast and
// moderation analytics. Every mutating action is written to an audit log.
'use strict';

const crypto = require('node:crypto');
const { nowIso, newId, clamp, parseJson } = require('./core');

const SCRYPT_KEYLEN = 64;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, expected] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expectedBuf = Buffer.from(expected, 'hex');
    if (expectedBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

module.exports = function registerAdmin(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, notifier, signToken, auditAdmin, pushSender } = ctx;

  /* ----------------------------- bootstrap account -------------------------- */
  function bootstrapAdminAccount() {
    const existing = db.prepare('SELECT * FROM admin_accounts LIMIT 1').get();
    if (existing) return existing;

    const isProduction = process.env.NODE_ENV === 'production';
    const envUser = process.env.ADMIN_USERNAME || '';
    const envPass = process.env.ADMIN_PASSWORD || '';
    const defaultUser = 'admin$123$';
    const defaultPass = 'admin$123$';

    let username = envUser || defaultUser;
    let password = envPass;
    let note = 'Environment-supplied credentials.';

    if (!password) {
      if (isProduction) {
        password = crypto.randomBytes(18).toString('base64url');
        note = 'No ADMIN_PASSWORD supplied in production: a random bootstrap password was generated and printed once to the server log.';
      } else {
        password = defaultPass;
        note =
          'Development bootstrap credential from the project brief. It MUST be changed at first login; production refuses this default.';
      }
    }

    const userId = db.prepare("SELECT id FROM users_private WHERE role = 'admin' LIMIT 1").get()?.id || null;
    const id = newId('adm');
    db.prepare(
      `INSERT INTO admin_accounts (id, username, password_hash, role, must_change_password, failed_attempts, created_at, updated_at, user_id)
       VALUES (?, ?, ?, 'admin', 1, 0, ?, ?, ?)`
    ).run(id, username, hashPassword(password), nowIso(), nowIso(), userId);

    if (password === defaultPass) {
      console.warn(
        '\n[RideRise LK] Admin bootstrap credential created.\n' +
          `  username: ${username}\n  password: ${defaultPass}\n` +
          '  This development default is public in the project brief and is BLOCKED from production use.\n' +
          '  You will be forced to set a new password on first login.\n'
      );
    } else {
      console.warn(`[RideRise LK] Admin bootstrap account "${username}" created. ${note} The password is not printed here.`);
    }
    return db.prepare('SELECT * FROM admin_accounts WHERE id = ?').get(id);
  }

  const bootstrap = bootstrapAdminAccount();

  function adminSession(user, adminAccount) {
    const mustChange = Boolean(adminAccount.must_change_password);
    return {
      token: signToken({
        userId: user.id,
        role: user.role,
        adminAccountId: adminAccount.id,
        adminCredentialSession: true
      }),
      must_change_password: mustChange,
      username: adminAccount.username,
      role: user.role,
      note: mustChange
        ? 'Set a new admin password before using moderation tools. The bootstrap credential is development-only.'
        : 'Signed in with a studio admin credential.'
    };
  }

  function recordFailedAttempt(account) {
    const attempts = Number(account.failed_attempts || 0) + 1;
    const lock = attempts >= MAX_FAILED;
    db.prepare('UPDATE admin_accounts SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(
      lock ? 0 : attempts,
      lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : account.locked_until,
      nowIso(),
      account.id
    );
    if (lock) {
      auditAdmin(account.id, 'admin_login_locked', 'admin_account', account.id, `Locked after ${MAX_FAILED} failed attempts`, {});
    }
  }

  function requireAdmin(req, res, { allowMustChange = false, write = false } = {}) {
    const user = getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'UNAUTHENTICATED', message: 'Sign in as studio staff to continue.' });
      return null;
    }
    if (!['admin', 'moderator'].includes(user.role)) {
      sendJson(res, 403, { error: 'FORBIDDEN', message: 'This area is restricted to studio administrators and moderators.' });
      return null;
    }
    const account = db.prepare('SELECT * FROM admin_accounts WHERE user_id = ?').get(user.id);
    const mustChange = account ? Boolean(account.must_change_password) : false;
    if (mustChange && !allowMustChange && write) {
      sendJson(res, 403, {
        error: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change the bootstrap administrator password before performing moderation actions.',
        must_change_password: true
      });
      return null;
    }
    return { user, account, mustChange };
  }

  function adminAudit(adminId, action, targetType, targetId, reason, metadata) {
    auditAdmin(adminId, action, targetType, targetId, reason, metadata);
  }

  return async function handle(req, res, pathname, parsedUrl) {
    if (!pathname.startsWith('/api/admin')) return false;

    /* ------------------------------- auth routes ---------------------------- */
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (!checkRateLimit(`admin:login:${req.socket.remoteAddress || 'unknown'}`, 12, 300)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many administrator sign-in attempts. Wait 5 minutes.' }), true;
      }
      const body = await readJsonBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const account = db.prepare('SELECT * FROM admin_accounts WHERE username = ?').get(username);
      if (!account) {
        return sendJson(res, 401, {
          error: 'ADMIN_LOGIN_FAILED',
          message: 'Incorrect administrator username or password. This attempt has been logged.'
        }), true;
      }
      if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
        return sendJson(res, 423, {
          error: 'ADMIN_ACCOUNT_LOCKED',
          message: `Too many failed attempts. Try again after ${new Date(account.locked_until).toUTCString()}.`
        }), true;
      }
      if (!verifyPassword(password, account.password_hash)) {
        recordFailedAttempt(account);
        return sendJson(res, 401, {
          error: 'ADMIN_LOGIN_FAILED',
          message: 'Incorrect administrator username or password. Repeated failures lock the account for 15 minutes.'
        }), true;
      }
      const user = db.prepare('SELECT * FROM users_private WHERE id = ?').get(account.user_id);
      if (!user || user.role === 'rider') {
        return sendJson(res, 403, {
          error: 'ADMIN_ACCOUNT_UNLINKED',
          message: 'This credential is not linked to an active studio administrator account. Contact the studio owner.'
        }), true;
      }
      db.prepare('UPDATE admin_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?').run(
        nowIso(),
        nowIso(),
        account.id
      );
      adminAudit(account.id, 'admin_login', 'admin_account', account.id, 'Password sign-in', {});
      return sendJson(res, 200, adminSession(user, account)), true;
    }

    if (pathname === '/api/admin/change-password' && req.method === 'POST') {
      const gate = requireAdmin(req, res, { allowMustChange: true });
      if (!gate) return true;
      const account = gate.account;
      if (!account) {
        return sendJson(res, 400, {
          error: 'NO_CREDENTIAL_ACCOUNT',
          message: 'This session signed in with Google. Manage the studio password in the server environment instead.'
        }), true;
      }
      const body = await readJsonBody(req);
      const current = String(body.current_password || '');
      const next = String(body.new_password || '');
      if (!verifyPassword(current, account.password_hash)) {
        return sendJson(res, 401, { error: 'CURRENT_PASSWORD_INCORRECT', message: 'Your current password is not correct.' }), true;
      }
      if (next.length < 12) {
        return sendJson(res, 400, { error: 'PASSWORD_TOO_SHORT', message: 'Use at least 12 characters. A passphrase is easiest to remember.' }), true;
      }
      if (['admin$123$', 'password', 'admin123456789'].includes(next)) {
        return sendJson(res, 400, { error: 'PASSWORD_TOO_WEAK', message: 'That password is publicly known. Choose something unique.' }), true;
      }
      db.prepare('UPDATE admin_accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(
        hashPassword(next),
        nowIso(),
        account.id
      );
      adminAudit(account.id, 'admin_password_changed', 'admin_account', account.id, 'Password rotated', {});
      return sendJson(res, 200, { message: 'Administrator password updated. Keep it in a password manager.', must_change_password: false }), true;
    }

    if (pathname === '/api/admin/me' && req.method === 'GET') {
      const gate = requireAdmin(req, res, { allowMustChange: true });
      if (!gate) return true;
      return sendJson(res, 200, {
        user: {
          id: gate.user.id,
          username: gate.user.username,
          display_name: gate.user.display_name,
          role: gate.user.role,
          email: gate.user.email
        },
        credential_account: gate.account ? { username: gate.account.username, last_login_at: gate.account.last_login_at } : null,
        must_change_password: gate.mustChange,
        push: pushSender ? pushSender.status() : { configured: false, reason: 'Push sender unavailable' }
      }), true;
    }

    if (pathname === '/api/admin/push/status' && req.method === 'GET') {
      const gate = requireAdmin(req, res, { allowMustChange: true });
      if (!gate) return true;
      const status = pushSender ? pushSender.status() : { configured: false, reason: 'not initialised' };
      const log = db.prepare('SELECT * FROM push_delivery_log ORDER BY created_at DESC LIMIT 40').all();
      return sendJson(res, 200, {
        ...status,
        recent: log,
        note: status.configured
          ? 'FCM HTTP v1 is configured. Real delivery attempts are logged below.'
          : `Push is not configured: ${status.reason}. In-app notifications still work. Follow docs/PHASE2_FIREBASE_SETUP.md.`
      }), true;
    }

    if (pathname === '/api/admin/push/test' && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const tokens = db.prepare('SELECT token, platform FROM device_tokens WHERE user_id = ?').all(gate.user.id);
      if (!tokens.length) {
        return sendJson(res, 400, {
          error: 'NO_DEVICE_TOKEN',
          message: 'This admin account has no registered device. Open the app on Android and allow notifications first.'
        }), true;
      }
      if (!pushSender) return sendJson(res, 503, { error: 'PUSH_UNAVAILABLE' }), true;
      const result = await pushSender.send(gate.user.id, tokens, {
        title: 'RideRise LK test push',
        body: 'If you can see this, FCM delivery is working.',
        deepLink: '#/notifications',
        type: 'system'
      });
      return sendJson(res, result.sent ? 200 : 503, {
        ...result,
        message: result.sent ? 'Test push handed to FCM.' : `Push not delivered: ${result.reason || result.status}`
      }), true;
    }

    /* ------------------------------ feedback inbox -------------------------- */
    if (pathname === '/api/admin/feedback' && req.method === 'GET') {
      const gate = requireAdmin(req, res);
      if (!gate) return true;
      const status = parsedUrl.searchParams.get('status') || '';
      const rows = db
        .prepare(
          `SELECT f.*, p.username, p.display_name FROM feedback_messages f
           LEFT JOIN profiles p ON p.user_id = f.user_id
           ${status ? 'WHERE f.status = ?' : ''} ORDER BY
             CASE f.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             f.created_at DESC LIMIT 200`
        )
        .all(...(status ? [status] : []));
      const counts = db.prepare('SELECT status, COUNT(*) AS c FROM feedback_messages GROUP BY status').all();
      return sendJson(res, 200, { feedback: rows, counts }), true;
    }

    const fbMatch = pathname.match(/^\/api\/admin\/feedback\/([^/]+)$/);
    if (fbMatch && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const id = decodeURIComponent(fbMatch[1]);
      const body = await readJsonBody(req);
      const row = db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(id);
      if (!row) return sendJson(res, 404, { error: 'FEEDBACK_NOT_FOUND' }), true;
      const status = ['new', 'read', 'in_progress', 'resolved'].includes(body.status) ? body.status : row.status;
      const priority = ['low', 'normal', 'high', 'urgent'].includes(body.priority) ? body.priority : row.priority;
      db.prepare(
        'UPDATE feedback_messages SET status = ?, priority = ?, admin_note = ?, assigned_admin_id = ?, updated_at = ? WHERE id = ?'
      ).run(status, priority, String(body.admin_note ?? row.admin_note).slice(0, 2000), gate.user.id, nowIso(), id);
      adminAudit(gate.user.id, 'feedback_updated', 'feedback', id, row.subject, { status, priority });
      if (row.user_id && body.notify_user === true) {
        notifier.notify({
          userId: row.user_id,
          type: 'moderation',
          title: `Your feedback was reviewed: ${row.subject}`,
          body: String(body.admin_note || 'The studio has updated your feedback.').slice(0, 300),
          referenceType: 'feedback',
          referenceId: id,
          deepLink: '#/notifications'
        });
      }
      return sendJson(res, 200, { message: 'Feedback updated.', status }), true;
    }

    /* ------------------------------- user admin ----------------------------- */
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const gate = requireAdmin(req, res, { allowMustChange: true });
      if (!gate) return true;
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
      const status = parsedUrl.searchParams.get('status') || '';
      let rows = db
        .prepare(
          `SELECT u.id, u.email, u.role, u.account_status, u.is_minor, u.created_at, u.banned_at, u.banned_by,
                  u.ban_reason, u.suspension_reason, u.suspension_until, u.restriction_until,
                  p.username, p.display_name, p.district, p.xp
           FROM users_private u LEFT JOIN profiles p ON p.user_id = u.id`
        )
        .all();
      if (q) rows = rows.filter((r) => `${r.username} ${r.display_name} ${r.email} ${r.id}`.toLowerCase().includes(q));
      if (status) rows = rows.filter((r) => r.account_status === status);
      rows.sort((a, b) => String(a.username).localeCompare(String(b.username)));
      const visible = rows.slice(0, 300).map((r2) =>
        gate.user.role === 'admin' ? r2 : { ...r2, email: '(visible to studio administrators only)' }
      );
      return sendJson(res, 200, { users: visible, total: rows.length, email_visible: gate.user.role === 'admin' }), true;
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/(ban|unban|suspend|warn|restore|role|note|activity)$/);
    if (userMatch && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const targetId = decodeURIComponent(userMatch[1]);
      const action = userMatch[2];
      const target = db.prepare('SELECT * FROM users_private WHERE id = ?').get(targetId);
      if (!target) return sendJson(res, 404, { error: 'USER_NOT_FOUND' }), true;
      if (target.id === gate.user.id && ['ban', 'suspend'].includes(action)) {
        return sendJson(res, 400, { error: 'SELF_MODERATION', message: 'You cannot restrict your own account.' }), true;
      }
      if (target.role === 'admin' && gate.user.role !== 'admin') {
        return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only a studio administrator can act on another administrator.' }), true;
      }
      const body = await readJsonBody(req);
      const reason = String(body.reason || '').slice(0, 500);
      const now = nowIso();
      if (action === 'ban') {
        if (!reason) return sendJson(res, 400, { error: 'REASON_REQUIRED', message: 'Record why the account is being banned.' }), true;
        db.prepare(
          "UPDATE users_private SET account_status = 'suspended', banned_at = ?, banned_by = ?, ban_reason = ?, suspension_reason = ?, suspension_until = NULL, updated_at = ? WHERE id = ?"
        ).run(now, gate.user.id, reason, reason, now, targetId);
        db.prepare('DELETE FROM live_location_sessions WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM voice_participants WHERE user_id = ?').run(targetId);
        adminAudit(gate.user.id, 'user_banned', 'user', targetId, reason, {});
        notifier.notify({
          userId: targetId,
          type: 'moderation',
          title: 'Your account has been suspended',
          body: `Reason: ${reason}. You can appeal this decision from the Safety Centre or by emailing safety@shaundavidstudios.lk.`,
          referenceType: 'appeal',
          referenceId: targetId,
          deepLink: '#/safety',
          skipPrefs: true
        });
        return sendJson(res, 200, { message: 'Account banned and live sessions terminated.' }), true;
      }
      if (action === 'suspend') {
        const days = clamp(body.days || 3, 1, 365);
        const until = new Date(Date.now() + days * 86_400_000).toISOString();
        db.prepare(
          "UPDATE users_private SET account_status = 'suspended', suspension_reason = ?, suspension_until = ?, updated_at = ? WHERE id = ?"
        ).run(reason || 'Community guideline violation', until, now, targetId);
        db.prepare('DELETE FROM live_location_sessions WHERE user_id = ?').run(targetId);
        adminAudit(gate.user.id, 'user_suspended', 'user', targetId, reason, { days, until });
        notifier.notify({
          userId: targetId,
          type: 'moderation',
          title: `Account suspended for ${days} day${days === 1 ? '' : 's'}`,
          body: `${reason || 'Community guideline violation'}. Ends ${until.slice(0, 10)}. You may appeal this decision.`,
          referenceType: 'appeal',
          referenceId: targetId,
          deepLink: '#/safety',
          skipPrefs: true
        });
        return sendJson(res, 200, { message: `Suspended until ${until}.`, suspension_until: until }), true;
      }
      if (action === 'warn') {
        db.prepare("UPDATE users_private SET account_status = CASE WHEN account_status = 'active' THEN 'warned' ELSE account_status END, updated_at = ? WHERE id = ?").run(now, targetId);
        adminAudit(gate.user.id, 'user_warned', 'user', targetId, reason, {});
        notifier.notify({
          userId: targetId,
          type: 'moderation',
          title: 'Community guidelines warning',
          body: reason || 'A moderator reviewed your content and issued a warning. Read the community rules to avoid further action.',
          referenceType: 'moderation',
          referenceId: targetId,
          deepLink: '#/safety',
          skipPrefs: true
        });
        return sendJson(res, 200, { message: 'Warning issued.' }), true;
      }
      if (action === 'unban' || action === 'restore') {
        db.prepare(
          "UPDATE users_private SET account_status = 'active', banned_at = NULL, banned_by = NULL, ban_reason = '', suspension_reason = NULL, suspension_until = NULL, restriction_until = NULL, updated_at = ? WHERE id = ?"
        ).run(now, targetId);
        adminAudit(gate.user.id, 'user_restored', 'user', targetId, reason, {});
        notifier.notify({
          userId: targetId,
          type: 'moderation',
          title: 'Account restored',
          body: 'Your account is active again. Please review the community guidelines.',
          referenceType: 'moderation',
          referenceId: targetId,
          deepLink: '#/home',
          skipPrefs: true
        });
        return sendJson(res, 200, { message: 'Account restored.' }), true;
      }
      if (action === 'role') {
        if (gate.user.role !== 'admin') return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only studio admins can change roles.' }), true;
        const role = ['rider', 'moderator', 'admin'].includes(body.role) ? body.role : null;
        if (!role) return sendJson(res, 400, { error: 'INVALID_ROLE' }), true;
        db.prepare('UPDATE users_private SET role = ?, updated_at = ? WHERE id = ?').run(role, now, targetId);
        adminAudit(gate.user.id, 'user_role_changed', 'user', targetId, `Role changed to ${role}`, { role });
        return sendJson(res, 200, { message: `Role updated to ${role}.`, role }), true;
      }
      if (action === 'note') {
        const note = String(body.note || '').trim();
        if (!note) return sendJson(res, 400, { error: 'NOTE_REQUIRED' }), true;
        db.prepare('INSERT INTO admin_notes (id, subject_user_id, admin_id, note, created_at) VALUES (?, ?, ?, ?, ?)').run(
          newId('anote'),
          targetId,
          gate.user.id,
          note.slice(0, 2000),
          nowIso()
        );
        adminAudit(gate.user.id, 'user_note_added', 'user', targetId, note.slice(0, 120), {});
        return sendJson(res, 201, { message: 'Internal note saved (visible to studio staff only).' }), true;
      }
      if (action === 'activity') {
        const notes = db.prepare('SELECT * FROM admin_notes WHERE subject_user_id = ? ORDER BY created_at DESC LIMIT 50').all(targetId);
        const reports = db.prepare('SELECT * FROM reports WHERE target_id = ? OR (target_type = ? AND target_id = ?) ORDER BY created_at DESC LIMIT 50').all(targetId, 'user', targetId);
        const actions = db.prepare('SELECT * FROM admin_action_log WHERE target_id = ? ORDER BY created_at DESC LIMIT 50').all(targetId);
        const messages = db
          .prepare(
            `SELECT m.id, m.body, m.created_at, m.moderation_status, m.deleted_at FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.sender_id = ? ORDER BY m.created_at DESC LIMIT 30`
          )
          .all(targetId);
        return sendJson(res, 200, {
          notes,
          reports,
          actions,
          recent_messages: messages,
          privacy_note: 'Only messages already surfaced by a report or moderation action should be reviewed. Casual browsing of private conversations is prohibited by studio policy.'
        }), true;
      }
    }

    /* ---------------------------- reports & appeals ------------------------- */
    if (pathname === '/api/admin/reports' && req.method === 'GET') {
      const gate = requireAdmin(req, res);
      if (!gate) return true;
      const status = parsedUrl.searchParams.get('status') || 'pending';
      const rows = db
        .prepare(
          `SELECT r.*, p.username AS reporter_username
           FROM reports r LEFT JOIN profiles p ON p.user_id = r.reporter_id
           WHERE (? = 'all' OR r.status = ?) ORDER BY
             CASE r.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             r.created_at DESC LIMIT 200`
        )
        .all(status, status)
        .map((r) => ({ ...r, context: parseJson(r.context_json, {}) }));
      const counts = db.prepare('SELECT status, COUNT(*) AS c FROM reports GROUP BY status').all();
      const appeals = db
        .prepare(
          `SELECT a.*, p.username FROM moderation_appeals a LEFT JOIN profiles p ON p.user_id = a.user_id
           WHERE a.status = 'pending' ORDER BY a.created_at DESC LIMIT 100`
        )
        .all();
      return sendJson(res, 200, { reports: rows, counts, appeals }), true;
    }

    const reportMatch = pathname.match(/^\/api\/admin\/reports\/([^/]+)\/action$/);
    if (reportMatch && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const reportId = decodeURIComponent(reportMatch[1]);
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
      if (!report) return sendJson(res, 404, { error: 'REPORT_NOT_FOUND' }), true;
      const body = await readJsonBody(req);
      const action = String(body.action || '');
      const note = String(body.note || '').slice(0, 1000);
      let outcome = 'action_taken';

      if (action === 'dismiss') {
        outcome = 'dismissed';
        db.prepare('UPDATE reports SET status = ?, resolution_note = ?, resolved_by_admin_id = ?, resolved_at = ? WHERE id = ?').run(
          outcome,
          note || 'Reviewed — no violation found.',
          gate.user.id,
          nowIso(),
          reportId
        );
        adminAudit(gate.user.id, 'report_dismissed', 'report', reportId, note, {});
        return sendJson(res, 200, { status: outcome, message: 'Report dismissed.' }), true;
      }

      if (action === 'delete_content') {
        if (report.target_type === 'post') {
          db.prepare("UPDATE posts SET moderation_status = 'removed' WHERE id = ?").run(report.target_id);
        } else if (report.target_type === 'comment') {
          db.prepare("UPDATE comments SET moderation_status = 'removed' WHERE id = ?").run(report.target_id);
        } else if (report.target_type === 'message') {
          db.prepare("UPDATE messages SET body = '', attachment_url = '', deleted_at = ?, deleted_by = ? WHERE id = ?").run(
            nowIso(),
            gate.user.id,
            report.target_id
          );
        } else if (report.target_type === 'guild_message') {
          db.prepare("UPDATE guild_messages SET moderation_status = 'removed' WHERE id = ?").run(report.target_id);
        } else if (report.target_type === 'guild_announcement') {
          db.prepare("UPDATE guild_announcements SET moderation_status = 'removed' WHERE id = ?").run(report.target_id);
        } else if (report.target_type === 'guild') {
          db.prepare("UPDATE guilds SET moderation_status = 'removed' WHERE id = ?").run(report.target_id);
        } else if (report.target_type === 'gallery') {
          db.prepare('UPDATE event_gallery SET approved = 0 WHERE id = ?').run(report.target_id);
        }
        adminAudit(gate.user.id, 'content_removed', report.target_type, report.target_id, note, { report_id: reportId });
      }

      const context = parseJson(report.context_json, {});
      const targetUserId =
        report.target_type === 'user'
          ? report.target_id
          : context.reported_user_id ||
            (report.target_type === 'message' || report.target_type === 'guild_message'
              ? (db.prepare('SELECT sender_id FROM messages WHERE id = ?').get(report.target_id) || {}).sender_id
              : null);

      if (['warn', 'suspend', 'ban'].includes(action) && targetUserId) {
        const severityPolicy = { warn: 0, suspend: 7, ban: 0 };
        db.prepare(
          "INSERT INTO admin_action_log (id, admin_id, action, target_type, target_id, reason, metadata_json, created_at) VALUES (?, ?, ?, 'user', ?, ?, ?, ?)"
        ).run(newId('aal'), gate.user.id, `moderation_${action}`, targetUserId, note, JSON.stringify({ report_id: reportId }), nowIso());
        if (action === 'ban') {
          db.prepare(
            "UPDATE users_private SET account_status = 'suspended', banned_at = ?, banned_by = ?, ban_reason = ?, suspension_reason = ?, suspension_until = NULL, updated_at = ? WHERE id = ?"
          ).run(nowIso(), gate.user.id, note || 'Community guidelines violation', note, nowIso(), targetUserId);
        } else if (action === 'suspend') {
          const until = new Date(Date.now() + (Number(body.days) || severityPolicy.suspend) * 86_400_000).toISOString();
          db.prepare(
            "UPDATE users_private SET account_status = 'suspended', suspension_reason = ?, suspension_until = ?, updated_at = ? WHERE id = ?"
          ).run(note || 'Community guidelines violation', until, nowIso(), targetUserId);
        } else {
          db.prepare("UPDATE users_private SET account_status = CASE WHEN account_status = 'active' THEN 'warned' ELSE account_status END, updated_at = ? WHERE id = ?").run(
            nowIso(),
            targetUserId
          );
        }
        db.prepare('DELETE FROM live_location_sessions WHERE user_id = ?').run(targetUserId);
        db.prepare('DELETE FROM voice_participants WHERE user_id = ?').run(targetUserId);
        notifier.notify({
          userId: targetUserId,
          type: 'moderation',
          title: action === 'warn' ? 'Community guidelines warning' : 'Account restriction applied',
          body: `${note || 'A moderator reviewed a report about your account.'} You can appeal from the Safety Centre.`,
          referenceType: 'appeal',
          referenceId: targetUserId,
          deepLink: '#/safety',
          skipPrefs: true
        });
      }

      db.prepare(
        'UPDATE reports SET status = ?, resolution_note = ?, resolved_by_admin_id = ?, resolved_at = ?, severity = ? WHERE id = ?'
      ).run(outcome, note, gate.user.id, nowIso(), body.escalate ? 'critical' : report.severity, reportId);
      adminAudit(gate.user.id, `report_${action}`, 'report', reportId, note, { target_user: targetUserId });
      notifier.notify({
        userId: report.reporter_id,
        type: 'moderation',
        title: 'Your report was reviewed',
        body: note || 'Thank you — the studio took action on the content you reported.',
        referenceType: 'report',
        referenceId: reportId,
        deepLink: '#/notifications'
      });
      return sendJson(res, 200, { status: outcome, message: 'Moderation action recorded.' }), true;
    }

    const appealMatch = pathname.match(/^\/api\/admin\/appeals\/([^/]+)\/resolve$/);
    if (appealMatch && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const id = decodeURIComponent(appealMatch[1]);
      const appeal = db.prepare('SELECT * FROM moderation_appeals WHERE id = ?').get(id);
      if (!appeal) return sendJson(res, 404, { error: 'APPEAL_NOT_FOUND' }), true;
      const body = await readJsonBody(req);
      const decision = body.decision === 'overturned' ? 'overturned' : 'upheld';
      db.prepare('UPDATE moderation_appeals SET status = ?, reviewer_id = ?, resolution = ?, resolved_at = ? WHERE id = ?').run(
        decision,
        gate.user.id,
        String(body.resolution || '').slice(0, 1000),
        nowIso(),
        id
      );
      if (decision === 'overturned') {
        db.prepare(
          "UPDATE users_private SET account_status = 'active', banned_at = NULL, ban_reason = '', suspension_reason = NULL, suspension_until = NULL, updated_at = ? WHERE id = ?"
        ).run(nowIso(), appeal.user_id);
      }
      adminAudit(gate.user.id, `appeal_${decision}`, 'moderation_appeal', id, String(body.resolution || ''), { user_id: appeal.user_id });
      notifier.notify({
        userId: appeal.user_id,
        type: 'moderation',
        title: `Appeal ${decision}`,
        body: String(body.resolution || (decision === 'overturned' ? 'Your appeal succeeded and the restriction was lifted.' : 'Your appeal was reviewed and the original decision stands.')).slice(0, 400),
        referenceType: 'appeal',
        referenceId: id,
        deepLink: '#/safety',
        skipPrefs: true
      });
      return sendJson(res, 200, { status: decision }), true;
    }

    /* ------------------------------ studio news ----------------------------- */
    if (pathname === '/api/admin/news') {
      const gate = requireAdmin(req, res, { allowMustChange: true });
      if (!gate) return true;
      if (req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM studio_news ORDER BY created_at DESC LIMIT 100').all();
        return sendJson(res, 200, { news: rows }), true;
      }
      if (req.method === 'POST') {
        const writeGate = requireAdmin(req, res, { write: true });
        if (!writeGate) return true;
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim().slice(0, 180);
        const text = String(body.body || '').trim().slice(0, 8000);
        if (title.length < 3 || text.length < 3) return sendJson(res, 400, { error: 'INVALID_NEWS' }), true;
        const id = body.id || newId('news');
        const existing = body.id ? db.prepare('SELECT * FROM studio_news WHERE id = ?').get(body.id) : null;
        if (existing) {
          db.prepare(
            'UPDATE studio_news SET title = ?, body = ?, category = ?, pinned = ?, published = ?, published_at = ? WHERE id = ?'
          ).run(
            title,
            text,
            String(body.category || existing.category),
            body.pinned ? 1 : 0,
            body.published === false ? 0 : 1,
            existing.published_at,
            id
          );
        } else {
          db.prepare(
            `INSERT INTO studio_news (id, title, body, category, pinned, published, is_official, author_admin_id, published_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
          ).run(
            id,
            title,
            text,
            String(body.category || 'announcement').slice(0, 40),
            body.pinned ? 1 : 0,
            body.published === false ? 0 : 1,
            gate.user.id,
            nowIso(),
            nowIso()
          );
        }
        adminAudit(gate.user.id, existing ? 'news_updated' : 'news_published', 'news', id, title, {});
        if (body.notify === true) {
          const riders = db.prepare("SELECT id FROM users_private WHERE account_status = 'active' LIMIT 5000").all();
          for (const r of riders) {
            notifier.notify({
              userId: r.id,
              type: 'news',
              title: `Studio news: ${title}`,
              body: text.slice(0, 160),
              referenceType: 'news',
              referenceId: id,
              deepLink: '#/news'
            });
          }
        }
        return sendJson(res, 200, { id, message: existing ? 'News updated.' : 'News published.' }), true;
      }
    }

    const newsMatch = pathname.match(/^\/api\/admin\/news\/([^/]+)\/(publish|unpublish|delete)$/);
    if (newsMatch && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const id = decodeURIComponent(newsMatch[1]);
      const action = newsMatch[2];
      const row = db.prepare('SELECT * FROM studio_news WHERE id = ?').get(id);
      if (!row) return sendJson(res, 404, { error: 'NEWS_NOT_FOUND' }), true;
      if (action === 'delete') db.prepare('DELETE FROM studio_news WHERE id = ?').run(id);
      else db.prepare('UPDATE studio_news SET published = ? WHERE id = ?').run(action === 'publish' ? 1 : 0, id);
      adminAudit(gate.user.id, `news_${action}`, 'news', id, row.title, {});
      return sendJson(res, 200, { message: `News ${action === 'delete' ? 'deleted' : action === 'publish' ? 'published' : 'unpublished'}.` }), true;
    }

    /* -------------------------------- broadcast ----------------------------- */
    if (pathname === '/api/admin/broadcast' && req.method === 'POST') {
      const gate = requireAdmin(req, res, { write: true });
      if (!gate) return true;
      const body = await readJsonBody(req);
      const title = String(body.title || '').trim().slice(0, 140);
      const text = String(body.body || '').trim().slice(0, 1000);
      if (title.length < 3 || text.length < 3) return sendJson(res, 400, { error: 'INVALID_BROADCAST' }), true;
      const audience = body.audience === 'minors' ? 'minors' : body.audience === 'admins' ? 'admins' : 'all';
      let recipients = db.prepare("SELECT id FROM users_private WHERE account_status = 'active'").all();
      if (audience === 'minors') recipients = recipients.filter((r) => db.prepare('SELECT is_minor FROM users_private WHERE id = ?').get(r.id).is_minor);
      if (audience === 'admins') recipients = recipients.filter((r) => ['admin', 'moderator'].includes(db.prepare('SELECT role FROM users_private WHERE id = ?').get(r.id).role));
      let sent = 0;
      for (const r of recipients) {
        if (notifier.notify({ userId: r.id, type: 'system', title, body: text, referenceType: 'broadcast', referenceId: '', deepLink: '#/notifications' })) {
          sent++;
        }
      }
      adminAudit(gate.user.id, 'broadcast_sent', 'broadcast', '', title, { audience, sent });
      return sendJson(res, 200, { sent, message: `Broadcast queued for ${sent} riders (${audience}).` }), true;
    }

    /* ------------------------------ staff activity -------------------------- */
    if (pathname === '/api/admin/audit' && req.method === 'GET') {
      const gate = requireAdmin(req, res);
      if (!gate) return true;
      const rows = db
        .prepare(
          `SELECT l.*, p.username AS admin_username FROM admin_action_log l
           LEFT JOIN profiles p ON p.user_id = l.admin_id ORDER BY l.created_at DESC LIMIT 200`
        )
        .all();
      return sendJson(res, 200, { audit: rows }), true;
    }

    if (pathname === '/api/admin/overview2' && req.method === 'GET') {
      const gate = requireAdmin(req, res);
      if (!gate) return true;
      const scalar = (sql, ...params) => Object.values(db.prepare(sql).get(...params))[0];
      const metrics = {
        active_riders: scalar("SELECT COUNT(*) FROM users_private WHERE account_status != 'deleted'"),
        minors: scalar('SELECT COUNT(*) FROM users_private WHERE is_minor = 1'),
        suspended: scalar("SELECT COUNT(*) FROM users_private WHERE account_status = 'suspended'"),
        pending_reports: scalar("SELECT COUNT(*) FROM reports WHERE status = 'pending'"),
        pending_appeals: scalar("SELECT COUNT(*) FROM moderation_appeals WHERE status = 'pending'"),
        new_feedback: scalar("SELECT COUNT(*) FROM feedback_messages WHERE status = 'new'"),
        live_members_sharing: scalar('SELECT COUNT(*) FROM live_location_sessions WHERE expires_at > ?', nowIso()),
        active_voice_participants: scalar('SELECT COUNT(*) FROM voice_participants'),
        published_news: scalar('SELECT COUNT(*) FROM studio_news WHERE published = 1'),
        unverified_price_listings: scalar('SELECT COUNT(*) FROM parts_catalog WHERE price_verified = 0 AND is_listed = 1')
      };
      const recentModeration = db.prepare('SELECT * FROM admin_action_log ORDER BY created_at DESC LIMIT 20').all();
      const sharing = db
        .prepare(
          `SELECT s.guild_id, g.name AS guild_name, COUNT(*) AS sharing_count
           FROM live_location_sessions s JOIN guilds g ON g.id = s.guild_id
           WHERE s.expires_at > ? GROUP BY s.guild_id`
        )
        .all(nowIso());
      return sendJson(res, 200, { metrics, recent_moderation: recentModeration, live_sharing_by_guild: sharing }), true;
    }

    return false;
  };
};

module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
