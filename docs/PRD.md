# Portable Time Clock Web App — PRD

## Overview
The Portable Time Clock web app allows multiple users to punch **IN** and **OUT** using a 4-digit PIN. Punch events are append-only, with shifts derived for reporting. The system includes lockout protections, payroll configuration, and automated biweekly payroll summaries.

## Goals
- Enable fast, reliable IN/OUT punches with optional memos.
- Ensure data integrity with append-only events and derived shifts.
- Provide clear visibility into open shifts and payroll summaries.
- Support secure PIN handling and brute-force protections.
- Run on Cloudflare Pages + Worker + D1 with scheduled email delivery.

## Non-Goals
- No real-time GPS or geofencing.
- No auto clock-out behavior.
- No full HR system features beyond punch tracking and payroll summaries.

## Users & Roles
- **Employee/User**: punches IN/OUT using a 4-digit PIN and can add a short memo to each punch.
- **Admin/Payroll**: configures payroll recipients, timezone, and pay period anchor date; reviews summaries.

## Functional Requirements
### Punching
- Users punch **IN** or **OUT** using a 4-digit PIN.
- If a user is already punched **IN**, a new **IN** attempt must be blocked with a clear message (no auto OUT).
- Each punch (IN or OUT) captures an optional short memo.
- Punch events are append-only; all reporting is derived from events.

### Shifts & Summaries
- Shifts are derived by pairing IN → OUT events.
- Open shifts (IN without OUT) must appear in summaries and be clearly flagged.

### Security & Abuse Prevention
- PINs must never be stored in plaintext; store Argon2id or bcrypt hashes.
- Per-user lockout: after 4 failed PIN attempts, lock the user for 30 minutes.
- Basic request rate limiting to deter brute-force attempts.

### Payroll
- Configurable payroll recipient list (email addresses).
- Configurable timezone (default **America/Toronto**).
- Configurable biweekly pay period anchor date to ensure unambiguous periods.
- Biweekly payroll summary email sent morning of payroll day in America/Toronto timezone.

## User Experience
- Punch screen: numeric PIN entry, IN/OUT buttons, memo field.
- Clear error states:
  - "PIN incorrect" (remaining attempts).
  - "Locked out until <time>".
  - "Already punched in; please punch out first."
- Success states:
  - "Punched IN at <time>" or "Punched OUT at <time>".

## Data Requirements
- Append-only `punch_events` table.
- Derived shifts for reports (no stored shifts table required).
- Store lockout metadata per user (failed attempts, lockout timestamp).

## Email & Reporting Requirements
- Biweekly summary email with:
  - Pay period range (start/end dates).
  - Per-user totals (hours, number of shifts).
  - Open shifts flagged clearly.
- CSV attachment containing punch-derived shifts and open shifts status.

## Success Metrics
- < 2 seconds median time to complete a punch.
- Zero invalid "double IN" acceptances.
- Payroll summary delivered on schedule with correct period boundaries.

## Constraints
- Cloudflare Pages (frontend), Cloudflare Worker (API), Cloudflare D1 (SQLite), Cloudflare Cron Triggers (email job).
- Minimal latency and offline-friendly UI (optional cache).

## Open Questions
- Maximum memo length (default proposal: 120 characters).
- How admin roles are provisioned (invite link or manual DB seed).
- Desired export frequency beyond biweekly payroll.
