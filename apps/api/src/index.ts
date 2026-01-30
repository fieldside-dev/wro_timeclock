import { deriveShifts } from './shiftDerivation.mjs';

export interface Env {
  DB: D1Database;
  TIMEZONE: string;
  PAY_PERIOD_ANCHOR_DATE: string;
  PAYROLL_RECIPIENTS: string;
  EMAIL_FROM: string;
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

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    ...init,
  });

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const timeZone = env.TIMEZONE || 'America/Toronto';

    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'ok',
        timezone: env.TIMEZONE,
        payPeriodAnchorDate: env.PAY_PERIOD_ANCHOR_DATE,
        payrollRecipients: env.PAYROLL_RECIPIENTS.split(',')
          .map((email) => email.trim())
          .filter(Boolean),
        emailFrom: env.EMAIL_FROM,
      });
    }

    if (url.pathname === '/api/report' || url.pathname === '/api/report.csv') {
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
      const { results } = await env.DB.prepare(
        `SELECT punch_events.id as id,
                punch_events.user_id as userId,
                users.display_name as userName,
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
