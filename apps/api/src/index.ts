export interface Env {
  DB: D1Database;
  TIMEZONE: string;
  PAY_PERIOD_ANCHOR_DATE: string;
  PAYROLL_RECIPIENTS: string;
  EMAIL_FROM: string;
}

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    ...init,
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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

    if (url.pathname === '/') {
      return jsonResponse({
        name: 'WRO Timeclock API',
        message: 'See /health for status.',
      });
    }

    return jsonResponse({ error: 'Not Found' }, { status: 404 });
  },
};
