import { deriveShifts } from './shiftDerivation.mjs';

export interface Env {
  DB: D1Database;
  TIMEZONE: string;
  PAY_PERIOD_ANCHOR_DATE: string;
  PAYROLL_RECIPIENTS: string;
  EMAIL_FROM: string;
  BOOTSTRAP_TOKEN: string;
}

type PunchEvent = {
  id: string;
  userId: string;
  userName: string;
  eventType: 'IN' | 'OUT';
  eventTime: number;
  memo: string;
};

type ShiftReportRow = {
  user: string;
  start: string;
  end: string | null;
  duration: number | null;
  in_note: string;
  out_note: string;
  open_shift: boolean;
};

type UserSchema = {
  displayNameColumn: string;
  adminWhereClause: string;
  adminInsert: { column: string; value: string | number };
  pinColumn: string;
  failedAttemptsColumn: string | null;
  lockoutColumn: string | null;
  activeColumn: string | null;
};

const LOCKOUT_FAILURES = 4;
const LOCKOUT_MS = 30 * 60 * 1000;

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Helps avoid caching of sensitive responses by browsers/proxies.
      'cache-control': 'no-store',
    },
    ...init,
  });

/**
 * Shared-token guard (for admin/report endpoints).
 * Accepts:
 *  - Authorization: Bearer <token>
 *  - x-api-key: <token>
 *  - x-bootstrap-token: <token>   (kept for backwards-compat with your bootstrap route)
 */
const requireBootstrapToken = (request: Request, env: Env) => {
  const token =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-api-key') ??
    request.headers.get('x-bootstrap-token');

  if (!env.BOOTSTRAP_TOKEN || !token || token !== env.BOOTSTRAP_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
};

const parseDateInput = (value: string | null) => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  return { year, month, day };
};

const zonedTimeToUtcMs = (
  {
    year,
    month,
    day,
    hour,
    minute,
    second,
  }: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  timeZone: string,
) => {
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const tzDate = new Date(utcDate.toLocaleString('en-US', { timeZone }));
  const offset = utcDate.getTime() - tzDate.getTime();
  return utcDate.getTime() + offset;
};

const getRangeBounds = (start: string | null, end: string | null, timeZone: string) => {
  const startDate = parseDateInput(start);
  const endDate = parseDateInput(end);
  if (!startDate || !endDate) {
    return null;
  }

  const startMs = zonedTimeToUtcMs(
    { ...startDate, hour: 0, minute: 0, second: 0 },
    timeZone,
  );

  const nextDate = new Date(Date.UTC(endDate.year, endDate.month - 1, endDate.day + 1));
  const endMsExclusive = zonedTimeToUtcMs(
    {
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );

  return { startMs, endMsExclusive };
};

const formatDateTime = (epochMs: number, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

const roundHours = (ms: number) => Math.round((ms / 36e5) * 100) / 100;

const escapeCsv = (value: string | number | boolean | null) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const toCsv = (rows: ShiftReportRow[]) => {
  const headers = ['user', 'start', 'end', 'duration', 'in_note', 'out_note', 'open_shift'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.user,
        row.start,
        row.end ?? '',
        row.duration ?? '',
        row.in_note,
        row.out_note,
        row.open_shift,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
};

const buildReportRows = (
  shifts: Array<{
    userName: string;
    startEvent: PunchEvent;
    endEvent: PunchEvent | null;
    openShift: boolean;
  }>,
  timeZone: string,
): ShiftReportRow[] =>
  shifts.map((shift) => {
    const start = formatDateTime(shift.startEvent.eventTime, timeZone);
    const end = shift.endEvent ? formatDateTime(shift.endEvent.eventTime, timeZone) : null;
    const duration = shift.endEvent
      ? roundHours(shift.endEvent.eventTime - shift.startEvent.eventTime)
      : null;
    return {
      user: shift.userName,
      start,
      end,
      duration,
      in_note: shift.startEvent.memo || '',
      out_note: shift.endEvent?.memo || '',
      open_shift: shift.openShift,
    };
  });

const parseJsonBody = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const hashPin = async (pin: string) => {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256$${hex}`;
};

const pinsMatch = async (pin: string, storedPinHash: string) => {
  if (storedPinHash.startsWith('sha256$')) {
    return (await hashPin(pin)) === storedPinHash;
  }
  return pin === storedPinHash;
};

const getTableColumns = async (env: Env, tableName: string) => {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return new Set((results ?? []).map((row) => row.name));
};

const getUserSchema = async (env: Env): Promise<UserSchema> => {
  const columns = await getTableColumns(env, 'users');
  const displayNameColumn = columns.has('display_name') ? 'display_name' : 'name';
  const pinColumn = columns.has('pin_hash') ? 'pin_hash' : 'pin';
  const failedAttemptsColumn = columns.has('failed_pin_attempts')
    ? 'failed_pin_attempts'
    : columns.has('failed_attempts')
      ? 'failed_attempts'
      : null;
  const lockoutColumn = columns.has('lockout_until_epoch_ms')
    ? 'lockout_until_epoch_ms'
    : columns.has('lockout_until_utc')
      ? 'lockout_until_utc'
      : columns.has('lockout_until')
        ? 'lockout_until'
        : null;
  const activeColumn = columns.has('is_active') ? 'is_active' : columns.has('enabled') ? 'enabled' : null;

  if (columns.has('role')) {
    return {
      displayNameColumn,
      adminWhereClause: "role = 'admin'",
      adminInsert: { column: 'role', value: 'admin' },
      pinColumn,
      failedAttemptsColumn,
      lockoutColumn,
      activeColumn,
    };
  }

  if (columns.has('is_admin')) {
    return {
      displayNameColumn,
      adminWhereClause: 'is_admin = 1',
      adminInsert: { column: 'is_admin', value: 1 },
      pinColumn,
      failedAttemptsColumn,
      lockoutColumn,
      activeColumn,
    };
  }

  throw new Error('Unable to determine admin column in users table.');
};

const readLockoutTime = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const maybeNumber = Number(value);
  if (Number.isFinite(maybeNumber)) return maybeNumber;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const timeZone = env.TIMEZONE || 'America/Toronto';

    if (url.pathname === '/health') {
      let databaseReady = false;
      try {
        await env.DB.prepare('SELECT 1 AS ok').first();
        databaseReady = true;
      } catch {
        databaseReady = false;
      }

      return jsonResponse({
        status: databaseReady ? 'ok' : 'degraded',
        readiness: {
          database: databaseReady ? 'ok' : 'error',
          bootstrapTokenConfigured: Boolean(env.BOOTSTRAP_TOKEN),
        },
        config: {
          timezone: env.TIMEZONE,
          payPeriodAnchorDate: env.PAY_PERIOD_ANCHOR_DATE,
          payrollRecipients: env.PAYROLL_RECIPIENTS.split(',')
            .map((email) => email.trim())
            .filter(Boolean),
          emailFrom: env.EMAIL_FROM,
        },
      });
    }

    if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
      // Guard bootstrap with token (now centralized).
      const denied = requireBootstrapToken(request, env);
      if (denied) return denied;

      const body = (await parseJsonBody(request)) as { token?: string; name?: string; pin?: string } | null;

      // NOTE: We no longer accept the token from body here, because it encourages
      // logging/accidental leakage in request bodies. If you *want* to keep it,
      // you can add body?.token back into requireBootstrapToken.
      // If you rely on body.token today, re-enable it by uncommenting in requireBootstrapToken.

      const userSchema = await getUserSchema(env);
      const adminCountRow = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM users WHERE ${userSchema.adminWhereClause}`,
      ).first<{ count: number }>();

      if ((adminCountRow?.count ?? 0) > 0) {
        return jsonResponse({ error: 'Bootstrap is disabled once an admin exists.' }, { status: 409 });
      }

      const name = body?.name?.trim() ?? '';
      const pin = body?.pin?.trim() ?? '';
      if (!name || !/^\d{4}$/.test(pin)) {
        return jsonResponse({ error: 'name and a 4-digit pin are required.' }, { status: 400 });
      }

      const pinHash = await hashPin(pin);
      const nowIso = new Date().toISOString();
      const columns = ['id', userSchema.displayNameColumn, userSchema.pinColumn, userSchema.adminInsert.column];
      const values: Array<string | number | null> = [crypto.randomUUID(), name, pinHash, userSchema.adminInsert.value];

      if (userSchema.failedAttemptsColumn) {
        columns.push(userSchema.failedAttemptsColumn);
        values.push(0);
      }
      if (userSchema.lockoutColumn) {
        columns.push(userSchema.lockoutColumn);
        values.push(null);
      }
      if (userSchema.activeColumn) {
        columns.push(userSchema.activeColumn);
        values.push(1);
      }

      const userColumns = await getTableColumns(env, 'users');
      if (userColumns.has('created_at')) {
        columns.push('created_at');
        values.push(nowIso);
      }
      if (userColumns.has('updated_at')) {
        columns.push('updated_at');
        values.push(nowIso);
      }

      await env.DB.prepare(
        `INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      )
        .bind(...values)
        .run();

      return jsonResponse({ ok: true, adminCreated: name });
    }

    if (url.pathname === '/api/auth/pin' && request.method === 'POST') {
      const body = (await parseJsonBody(request)) as { userId?: string; pin?: string } | null;
      const userId = body?.userId?.trim() ?? '';
      const pin = body?.pin?.trim() ?? '';

      if (!userId || !/^\d{4}$/.test(pin)) {
        return jsonResponse({ error: 'userId and 4-digit pin are required.' }, { status: 400 });
      }

      const userSchema = await getUserSchema(env);
      const whereParts = ['id = ?'];
      if (userSchema.activeColumn) {
        whereParts.push(`${userSchema.activeColumn} = 1`);
      }

      const user = await env.DB.prepare(
        `SELECT id,
                ${userSchema.displayNameColumn} AS displayName,
                ${userSchema.pinColumn} AS pinHash,
                ${userSchema.adminWhereClause} AS isAdmin
                ${userSchema.failedAttemptsColumn ? `, ${userSchema.failedAttemptsColumn} AS failedAttempts` : ', 0 AS failedAttempts'}
                ${userSchema.lockoutColumn ? `, ${userSchema.lockoutColumn} AS lockoutUntil` : ', NULL AS lockoutUntil'}
         FROM users
         WHERE ${whereParts.join(' AND ')}
         LIMIT 1`,
      )
        .bind(userId)
        .first<{
          id: string;
          displayName: string;
          pinHash: string;
          isAdmin: number;
          failedAttempts: number;
          lockoutUntil: unknown;
        }>();

      if (!user) {
        return jsonResponse({ error: 'Invalid credentials.' }, { status: 401 });
      }

      const nowMs = Date.now();
      const lockoutUntil = readLockoutTime(user.lockoutUntil);
      if (lockoutUntil && lockoutUntil > nowMs) {
        return jsonResponse(
          {
            error: 'Account is temporarily locked.',
            lockoutUntil: new Date(lockoutUntil).toISOString(),
          },
          { status: 423 },
        );
      }

      const ok = await pinsMatch(pin, user.pinHash);
      if (ok) {
        if (userSchema.failedAttemptsColumn || userSchema.lockoutColumn) {
          const updates: string[] = [];
          const params: Array<string | number | null> = [];
          if (userSchema.failedAttemptsColumn) {
            updates.push(`${userSchema.failedAttemptsColumn} = ?`);
            params.push(0);
          }
          if (userSchema.lockoutColumn) {
            updates.push(`${userSchema.lockoutColumn} = ?`);
            params.push(null);
          }
          if (updates.length > 0) {
            await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
              .bind(...params, user.id)
              .run();
          }
        }

        return jsonResponse({
          ok: true,
          user: {
            id: user.id,
            displayName: user.displayName,
            isAdmin: Boolean(user.isAdmin),
          },
        });
      }

      const nextFailures = (user.failedAttempts ?? 0) + 1;
      const shouldLock = nextFailures >= LOCKOUT_FAILURES;
      const nextLockoutUntilMs = shouldLock ? nowMs + LOCKOUT_MS : null;

      if (userSchema.failedAttemptsColumn || userSchema.lockoutColumn) {
        const updates: string[] = [];
        const params: Array<string | number | null> = [];

        if (userSchema.failedAttemptsColumn) {
          updates.push(`${userSchema.failedAttemptsColumn} = ?`);
          params.push(nextFailures);
        }
        if (userSchema.lockoutColumn) {
          updates.push(`${userSchema.lockoutColumn} = ?`);
          params.push(
            userSchema.lockoutColumn === 'lockout_until_utc' && nextLockoutUntilMs
              ? new Date(nextLockoutUntilMs).toISOString()
              : nextLockoutUntilMs,
          );
        }

        if (updates.length > 0) {
          await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
            .bind(...params, user.id)
            .run();
        }
      }

      return jsonResponse(
        {
          error: shouldLock ? 'Account is temporarily locked.' : 'Invalid credentials.',
          attemptsRemaining: Math.max(LOCKOUT_FAILURES - nextFailures, 0),
          lockoutUntil: nextLockoutUntilMs ? new Date(nextLockoutUntilMs).toISOString() : null,
        },
        { status: shouldLock ? 423 : 401 },
      );
    }

    if (url.pathname === '/api/punch' && request.method === 'POST') {
      const body = (await parseJsonBody(request)) as {
        userId?: string;
        eventType?: 'IN' | 'OUT';
        note?: string;
      } | null;
      const userId = body?.userId?.trim() ?? '';

      if (!userId) {
        return jsonResponse({ error: 'userId is required.' }, { status: 400 });
      }

      const requestedType = body?.eventType;
      if (requestedType && requestedType !== 'IN' && requestedType !== 'OUT') {
        return jsonResponse({ error: 'eventType must be IN or OUT if provided.' }, { status: 400 });
      }

      const note = body?.note?.trim() ?? '';
      const userSchema = await getUserSchema(env);
      const whereParts = ['id = ?'];
      if (userSchema.activeColumn) {
        whereParts.push(`${userSchema.activeColumn} = 1`);
      }

      const user = await env.DB.prepare(
        `SELECT id, ${userSchema.displayNameColumn} AS displayName
         FROM users
         WHERE ${whereParts.join(' AND ')}
         LIMIT 1`,
      )
        .bind(userId)
        .first<{ id: string; displayName: string }>();

      if (!user) {
        return jsonResponse({ error: 'User not found.' }, { status: 404 });
      }

      const lastEvent = await env.DB.prepare(
        `SELECT event_type as eventType, event_time as eventTime
         FROM punch_events
         WHERE user_id = ?
         ORDER BY event_time DESC
         LIMIT 1`,
      )
        .bind(user.id)
        .first<{ eventType: 'IN' | 'OUT'; eventTime: number }>();

      const eventType = requestedType ?? (lastEvent?.eventType === 'IN' ? 'OUT' : 'IN');
      if (eventType === 'IN' && lastEvent?.eventType === 'IN') {
        return jsonResponse(
          {
            error: 'Cannot punch IN twice in a row.',
            lastEvent,
          },
          { status: 409 },
        );
      }

      const eventTime = Date.now();
      const eventId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO punch_events (id, user_id, event_type, event_time, memo)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(eventId, user.id, eventType, eventTime, note)
        .run();

      return jsonResponse({
        ok: true,
        event: {
          id: eventId,
          userId: user.id,
          userName: user.displayName,
          eventType,
          eventTime,
          note,
        },
      });
    }

    if (url.pathname === '/api/report' || url.pathname === '/api/report.csv') {
      // Protect reports with the shared token.
      const denied = requireBootstrapToken(request, env);
      if (denied) return denied;

      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      const range = getRangeBounds(start, end, timeZone);

      if (!range) {
        return jsonResponse(
          { error: 'Invalid or missing start/end query parameters (YYYY-MM-DD).' },
          { status: 400 },
        );
      }

      const { startMs, endMsExclusive } = range;
      const userSchema = await getUserSchema(env);
      const { results } = await env.DB.prepare(
        `SELECT punch_events.id as id,
                punch_events.user_id as userId,
                users.${userSchema.displayNameColumn} as userName,
                punch_events.event_type as eventType,
                punch_events.event_time as eventTime,
                punch_events.memo as memo
         FROM punch_events
         JOIN users ON users.id = punch_events.user_id
         WHERE punch_events.event_time >= ?
           AND punch_events.event_time < ?
         ORDER BY punch_events.user_id, punch_events.event_time`,
      )
        .bind(startMs, endMsExclusive)
        .all<PunchEvent>();

      const { shifts, anomalies } = deriveShifts(results ?? []);
      const rows = buildReportRows(shifts, timeZone);

      if (url.pathname === '/api/report.csv') {
        return new Response(toCsv(rows), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      return jsonResponse({
        range: {
          start,
          end,
          timeZone,
        },
        shifts: rows,
        anomalies,
      });
    }

    if (url.pathname === '/') {
      return jsonResponse({
        name: 'WRO Timeclock API',
        message: 'See /health for status.',
      });
    }

    return jsonResponse({ error: 'Not Found' }, { status: 404 });
  },
};
