import { DateTime } from "luxon";

interface Env {
  DB: D1Database;
  TIMEZONE?: string;
  PAY_PERIOD_ANCHOR_DATE?: string;
  PAYROLL_RECIPIENTS?: string;
  PAYROLL_SENDER?: string;
  ADMIN_API_KEY?: string;
}

interface PayPeriod {
  start: DateTime;
  end: DateTime;
}

interface ShiftRow {
  shift_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  start_time: string;
  end_time: string | null;
}

interface UserSummary {
  userId: string;
  userName: string;
  userEmail: string;
  totalHours: number;
  shiftCount: number;
  openShiftCount: number;
}

const PAY_PERIOD_DAYS = 14;

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runPayroll(env, { dryRun: false }));
  },
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/admin/send-payroll-summary") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      if (!isAdminRequest(request, env)) {
        return new Response("Unauthorized", { status: 401 });
      }

      const dryRun = url.searchParams.get("dry_run") === "true";
      const result = await runPayroll(env, { dryRun });
      return Response.json(result, { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};

function isAdminRequest(request: Request, env: Env) {
  if (!env.ADMIN_API_KEY) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length) === env.ADMIN_API_KEY;
  }

  return request.headers.get("x-admin-token") === env.ADMIN_API_KEY;
}

async function runPayroll(env: Env, { dryRun }: { dryRun: boolean }) {
  const timezone = env.TIMEZONE ?? "America/Toronto";
  const anchorDate = env.PAY_PERIOD_ANCHOR_DATE;
  if (!anchorDate) {
    throw new Error("PAY_PERIOD_ANCHOR_DATE must be set");
  }

  const payPeriod = getPayPeriodWindow(anchorDate, timezone);
  const payPeriodKey = {
    start: payPeriod.start.toISODate() ?? "",
    end: payPeriod.end.toISODate() ?? "",
  };

  if (!dryRun) {
    const alreadySent = await hasSentLog(env.DB, payPeriodKey.start, payPeriodKey.end);
    if (alreadySent) {
      return {
        status: "skipped",
        reason: "already_sent",
        pay_period: payPeriodKey,
      };
    }
  }

  const shifts = await fetchShifts(env.DB, payPeriod);
  const { summaries, csvContent } = buildPayrollReport(shifts, timezone);
  const recipients = parseRecipients(env.PAYROLL_RECIPIENTS);
  const sender = env.PAYROLL_SENDER ?? "payroll@example.com";

  const subject = `Payroll summary ${payPeriodKey.start} - ${payPeriodKey.end}`;
  const body = buildEmailBody(payPeriod, summaries, timezone);

  if (!dryRun) {
    if (recipients.length === 0) {
      throw new Error("PAYROLL_RECIPIENTS must include at least one recipient");
    }

    await sendEmail({
      recipients,
      sender,
      subject,
      body,
      csvContent,
      payPeriod,
    });
    await insertSentLog(env.DB, payPeriodKey.start, payPeriodKey.end);
  }

  return {
    status: dryRun ? "dry_run" : "sent",
    pay_period: payPeriodKey,
    recipient_count: recipients.length,
    shift_count: shifts.length,
    user_count: summaries.length,
    csv_preview: csvContent.split("\n").slice(0, 5),
  };
}

function getPayPeriodWindow(anchorDate: string, timezone: string): PayPeriod {
  const anchor = DateTime.fromISO(anchorDate, { zone: timezone }).startOf("day");
  if (!anchor.isValid) {
    throw new Error("PAY_PERIOD_ANCHOR_DATE must be a valid ISO date (YYYY-MM-DD)");
  }

  const now = DateTime.now().setZone(timezone).startOf("day");
  const diffDays = Math.floor(now.diff(anchor, "days").days);
  const periodsSinceAnchor = Math.floor(diffDays / PAY_PERIOD_DAYS);
  const start = anchor.plus({ days: periodsSinceAnchor * PAY_PERIOD_DAYS });
  const end = start.plus({ days: PAY_PERIOD_DAYS });

  return { start, end };
}

async function fetchShifts(db: D1Database, payPeriod: PayPeriod) {
  const startIso = payPeriod.start.toUTC().toISO();
  const endIso = payPeriod.end.toUTC().toISO();

  const result = await db
    .prepare(
      `
      SELECT
        shifts.id as shift_id,
        shifts.user_id as user_id,
        users.name as user_name,
        users.email as user_email,
        shifts.start_time as start_time,
        shifts.end_time as end_time
      FROM shifts
      LEFT JOIN users ON users.id = shifts.user_id
      WHERE shifts.start_time >= ?
        AND shifts.start_time < ?
      ORDER BY users.name, shifts.start_time
      `
    )
    .bind(startIso, endIso)
    .all<ShiftRow>();

  return result.results ?? [];
}

function buildPayrollReport(shifts: ShiftRow[], timezone: string) {
  const summariesByUser = new Map<string, UserSummary>();
  const rows: string[][] = [];

  rows.push([
    "user_id",
    "user_name",
    "user_email",
    "shift_start",
    "shift_end",
    "duration_hours",
    "is_open",
  ]);

  for (const shift of shifts) {
    const userName = shift.user_name ?? "Unknown";
    const userEmail = shift.user_email ?? "";
    const summaryKey = shift.user_id;
    const summary = summariesByUser.get(summaryKey) ?? {
      userId: shift.user_id,
      userName,
      userEmail,
      totalHours: 0,
      shiftCount: 0,
      openShiftCount: 0,
    };

    const start = DateTime.fromISO(shift.start_time, { zone: "utc" }).setZone(timezone);
    const end = shift.end_time
      ? DateTime.fromISO(shift.end_time, { zone: "utc" }).setZone(timezone)
      : null;
    const isOpen = !end;
    const durationHours = end ? end.diff(start, "hours").hours : 0;

    summary.shiftCount += 1;
    summary.openShiftCount += isOpen ? 1 : 0;
    summary.totalHours += durationHours;

    summariesByUser.set(summaryKey, summary);

    rows.push([
      shift.user_id,
      userName,
      userEmail,
      start.toISO() ?? "",
      end?.toISO() ?? "",
      durationHours ? durationHours.toFixed(2) : "",
      isOpen ? "true" : "false",
    ]);
  }

  const summaries = Array.from(summariesByUser.values());
  const csvContent = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

  return { summaries, csvContent };
}

function csvEscape(value: string) {
  const escaped = value.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function buildEmailBody(payPeriod: PayPeriod, summaries: UserSummary[], timezone: string) {
  const lines = [
    `Payroll summary for ${payPeriod.start.toFormat("yyyy-LL-dd")} to ${payPeriod.end.toFormat(
      "yyyy-LL-dd"
    )} (${timezone})`,
    "",
    "Totals per user:",
  ];

  if (summaries.length === 0) {
    lines.push("- No shifts recorded in this pay period.");
  } else {
    for (const summary of summaries) {
      lines.push(
        `- ${summary.userName} (${summary.userEmail || "no email"}): ${summary.totalHours.toFixed(
          2
        )} hours, ${summary.shiftCount} shifts (${summary.openShiftCount} open)`
      );
    }
  }

  lines.push("", "CSV attachment includes detailed shift breakdown (open shifts flagged).");

  return lines.join("\n");
}

function parseRecipients(recipients?: string) {
  return (recipients ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function sendEmail(options: {
  recipients: string[];
  sender: string;
  subject: string;
  body: string;
  csvContent: string;
  payPeriod: PayPeriod;
}) {
  const attachmentName = `payroll-${options.payPeriod.start.toISODate()}-${options.payPeriod.end.toISODate()}.csv`;
  const payload = {
    personalizations: [
      {
        to: options.recipients.map((email) => ({ email })),
      },
    ],
    from: { email: options.sender },
    subject: options.subject,
    content: [
      {
        type: "text/plain",
        value: options.body,
      },
    ],
    attachments: [
      {
        content: toBase64(options.csvContent),
        filename: attachmentName,
        type: "text/csv",
      },
    ],
  };

  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send payroll email: ${response.status} ${errorText}`);
  }
}

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function hasSentLog(db: D1Database, start: string, end: string) {
  const result = await db
    .prepare("SELECT 1 FROM sent_log WHERE pay_period_start = ? AND pay_period_end = ? LIMIT 1")
    .bind(start, end)
    .first();

  return Boolean(result);
}

async function insertSentLog(db: D1Database, start: string, end: string) {
  await db
    .prepare(
      "INSERT INTO sent_log (pay_period_start, pay_period_end, sent_at) VALUES (?, ?, ? )"
    )
    .bind(start, end, DateTime.utc().toISO())
    .run();
}
