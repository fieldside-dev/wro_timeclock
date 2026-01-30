# Portable Time Clock Web App — Architecture

## System Overview
- **Frontend**: Cloudflare Pages SPA for PIN entry, punch actions, and status feedback.
- **API**: Cloudflare Worker providing authentication, punch creation, summaries, and admin configuration endpoints.
- **Database**: Cloudflare D1 (SQLite) for users, configuration, punch events, and lockout metadata.
- **Cron**: Cloudflare Cron Triggers for biweekly payroll email delivery.

## Data Model
### users
| column | type | notes |
| --- | --- | --- |
| id | TEXT (UUID) | primary key |
| display_name | TEXT | employee name |
| pin_hash | TEXT | Argon2id or bcrypt hash of PIN |
| pin_updated_at | INTEGER | epoch ms |
| failed_pin_attempts | INTEGER | rolling failed count |
| lockout_until | INTEGER | epoch ms; NULL if not locked |
| created_at | INTEGER | epoch ms |
| updated_at | INTEGER | epoch ms |

**Indexes**
- `users_lockout_until_idx` on `lockout_until`
- `users_display_name_idx` on `display_name`

### punch_events (append-only)
| column | type | notes |
| --- | --- | --- |
| id | TEXT (UUID) | primary key |
| user_id | TEXT | foreign key -> users.id |
| event_type | TEXT | enum: IN, OUT |
| event_time | INTEGER | epoch ms (America/Toronto normalized for display) |
| memo | TEXT | optional short note |
| source_ip | TEXT | optional for audit |
| created_at | INTEGER | epoch ms |

**Indexes**
- `punch_events_user_time_idx` on `(user_id, event_time)`
- `punch_events_time_idx` on `(event_time)`
- `punch_events_type_time_idx` on `(event_type, event_time)`

### app_config
| column | type | notes |
| --- | --- | --- |
| id | TEXT | primary key, single row e.g. "global" |
| payroll_recipients | TEXT | JSON array of emails |
| timezone | TEXT | IANA TZ, default America/Toronto |
| pay_period_anchor | TEXT | ISO date, e.g. 2024-01-01 |
| created_at | INTEGER | epoch ms |
| updated_at | INTEGER | epoch ms |

## Punch State Machine
### States
- **OUT**: last event is OUT or no events.
- **IN**: last event is IN without a subsequent OUT.

### Rules
1. **IN from OUT**: allowed → record IN event.
2. **OUT from IN**: allowed → record OUT event.
3. **IN from IN**: blocked → return message "Already punched in; please punch out first."
4. **OUT from OUT**: blocked → return message "You are not currently punched in."

### Deriving Shifts
- For each user, pair each IN with the next OUT event in chronological order.
- Unpaired IN events represent **open shifts**.
- Shifts are computed on read for reports and summaries; no mutation of punch_events.

## Lockout & Rate Limiting
### PIN Validation
- Compare submitted PIN against `pin_hash` using Argon2id or bcrypt.
- Never store raw PINs; hash on creation/reset.

### Lockout Logic (Per User)
1. If `lockout_until` is in the future, deny with remaining lockout time.
2. On failed PIN attempt:
   - Increment `failed_pin_attempts`.
   - If attempts >= 4, set `lockout_until = now + 30 minutes` and reset attempts to 0.
3. On successful PIN attempt:
   - Reset `failed_pin_attempts` to 0 and clear `lockout_until`.

### Request Rate Limiting
- Apply basic per-IP rate limiting at the Worker (e.g., 30 requests / 5 minutes).
- Rate limiting applies to punch endpoints and PIN validation.

## Pay Period Computation
### Anchor Date
- `pay_period_anchor` is a fixed date (local to America/Toronto) that starts a biweekly period.
- To compute a pay period for a given date:
  1. Convert the target date to America/Toronto local date.
  2. Compute days between anchor date and target date.
  3. `period_index = floor(days_diff / 14)`.
  4. `period_start = anchor + (period_index * 14 days)`.
  5. `period_end = period_start + 13 days` (inclusive).

### Payroll Day
- Payroll summary runs **the morning of the first day after period_end** (i.e., period_end + 1 day) at a fixed time (e.g., 08:00 America/Toronto).

## Email Format
### Subject
`Payroll Summary: <period_start> to <period_end>`

### Body (Plain Text)
- Header with period range and generation timestamp (America/Toronto).
- Per-user totals:
  - Total hours (derived from paired shifts).
  - Shift count.
  - Count of open shifts.
- Warnings section for open shifts.

### CSV Attachment
Filename: `payroll_<period_start>_<period_end>.csv`

Columns:
- user_id
- display_name
- shift_start
- shift_end
- duration_hours
- memo_in
- memo_out
- is_open_shift (true/false)

Open shifts include `shift_end` blank and `is_open_shift=true`.

## API Endpoints (Worker)
- `POST /api/punch/in` — submit PIN + optional memo.
- `POST /api/punch/out` — submit PIN + optional memo.
- `GET /api/summary` — returns current pay period summary (admin).
- `GET /api/status` — returns per-user current state for UI.
- `POST /api/admin/config` — update payroll recipients, timezone, anchor date.

## Deployment
### Steps
1. **D1**: Create database, apply schema migrations (users, punch_events, app_config).
2. **Worker**: Deploy API with D1 binding and secrets for email service.
3. **Pages**: Build and deploy frontend; configure API base URL.
4. **Cron**: Configure biweekly schedule to trigger payroll summary job.

### Environment Variables / Secrets
- `D1_DATABASE_ID` — D1 binding ID.
- `EMAIL_API_KEY` — email provider API key.
- `EMAIL_FROM` — sender address.
- `PAYROLL_DEFAULT_RECIPIENTS` — comma-separated email list (initial seed).
- `PAYROLL_TIMEZONE` — default `America/Toronto`.
- `PAY_PERIOD_ANCHOR` — ISO date, e.g., `2024-01-01`.
- `RATE_LIMIT_MAX` — requests per window (e.g., 30).
- `RATE_LIMIT_WINDOW_SECONDS` — window size in seconds (e.g., 300).

## Failure Modes & Mitigations
- **Double IN attempts**: blocked by state machine; user-facing message.
- **Clock skew**: use Worker server time for event_time.
- **Email failure**: log error; retry on next scheduled run or manual re-trigger.
- **D1 unavailability**: return error state and do not accept punches.
