from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, date, time
from functools import wraps
from typing import Iterable

from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


DATABASE_PATH = os.environ.get("WRO_TIMECLOCK_DB", "timeclock.db")

app = Flask(__name__)
app.secret_key = os.environ.get("WRO_TIMECLOCK_SECRET", "dev-secret")


@dataclass
class Punch:
    id: int
    user_id: int
    user_name: str
    direction: str
    punched_at: datetime


@dataclass
class Shift:
    user_id: int
    user_name: str
    start: datetime
    end: datetime


@dataclass
class Anomaly:
    user_id: int
    user_name: str
    occurred_at: datetime
    kind: str
    detail: str


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    with conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pin_hash TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                is_admin INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS punches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
                punched_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
    conn.close()


@app.before_request
def ensure_db() -> None:
    init_db()


@app.route("/")
def index():
    return redirect(url_for("admin_login"))


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        pin = request.form.get("pin", "").strip()
        if not name or not pin:
            flash("Name and PIN are required.")
            return render_template("admin/login.html")
        conn = get_db()
        admin = conn.execute(
            "SELECT * FROM users WHERE name = ? AND is_admin = 1",
            (name,),
        ).fetchone()
        conn.close()
        if not admin or not admin["enabled"]:
            flash("Invalid admin credentials.")
            return render_template("admin/login.html")
        if not check_password_hash(admin["pin_hash"], pin):
            flash("Invalid admin credentials.")
            return render_template("admin/login.html")
        session["admin_id"] = admin["id"]
        return redirect(url_for("admin_dashboard"))
    return render_template("admin/login.html")


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("admin_id", None)
    return redirect(url_for("admin_login"))


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        admin_id = session.get("admin_id")
        if not admin_id:
            return redirect(url_for("admin_login"))
        conn = get_db()
        admin = conn.execute(
            "SELECT * FROM users WHERE id = ? AND is_admin = 1",
            (admin_id,),
        ).fetchone()
        conn.close()
        if not admin or not admin["enabled"]:
            session.pop("admin_id", None)
            abort(403)
        return view(*args, **kwargs)

    return wrapped


@app.route("/admin")
@admin_required
def admin_dashboard():
    return render_template("admin/dashboard.html")


@app.route("/admin/users")
@admin_required
def admin_users():
    conn = get_db()
    users = conn.execute(
        "SELECT * FROM users ORDER BY name"
    ).fetchall()
    conn.close()
    return render_template("admin/users.html", users=users)


@app.route("/admin/users/new", methods=["GET", "POST"])
@admin_required
def admin_user_new():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        pin = request.form.get("pin", "").strip()
        is_admin = 1 if request.form.get("is_admin") == "on" else 0
        if not name:
            flash("Name is required.")
            return render_template("admin/user_new.html")
        if len(pin) != 4 or not pin.isdigit():
            flash("PIN must be exactly 4 digits.")
            return render_template("admin/user_new.html")
        conn = get_db()
        with conn:
            conn.execute(
                "INSERT INTO users (name, pin_hash, enabled, is_admin) VALUES (?, ?, 1, ?)",
                (name, generate_password_hash(pin), is_admin),
            )
        conn.close()
        flash("User created.")
        return redirect(url_for("admin_users"))
    return render_template("admin/user_new.html")


@app.route("/admin/users/<int:user_id>/toggle", methods=["POST"])
@admin_required
def admin_user_toggle(user_id: int):
    conn = get_db()
    with conn:
        user = conn.execute(
            "SELECT enabled FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            conn.close()
            abort(404)
        new_status = 0 if user["enabled"] else 1
        conn.execute(
            "UPDATE users SET enabled = ? WHERE id = ?",
            (new_status, user_id),
        )
    conn.close()
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<int:user_id>/reset-pin", methods=["GET", "POST"])
@admin_required
def admin_user_reset_pin(user_id: int):
    conn = get_db()
    user = conn.execute(
        "SELECT id, name FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not user:
        conn.close()
        abort(404)
    if request.method == "POST":
        pin = request.form.get("pin", "").strip()
        if len(pin) != 4 or not pin.isdigit():
            flash("PIN must be exactly 4 digits.")
            return render_template("admin/reset_pin.html", user=user)
        with conn:
            conn.execute(
                "UPDATE users SET pin_hash = ? WHERE id = ?",
                (generate_password_hash(pin), user_id),
            )
        conn.close()
        flash("PIN updated.")
        return redirect(url_for("admin_users"))
    conn.close()
    return render_template("admin/reset_pin.html", user=user)


@app.route("/admin/reports/punches")
@admin_required
def admin_punches():
    start_date, end_date = parse_date_range(request)
    punches = fetch_punches(start_date, end_date)
    shifts, anomalies = derive_shifts_and_anomalies(punches)
    return render_template(
        "admin/punches.html",
        punches=punches,
        shifts=shifts,
        anomalies=anomalies,
        start_date=start_date,
        end_date=end_date,
    )


@app.route("/admin/reports/anomalies")
@admin_required
def admin_anomalies():
    start_date, end_date = parse_date_range(request)
    punches = fetch_punches(start_date, end_date)
    _, anomalies = derive_shifts_and_anomalies(punches)
    return render_template(
        "admin/anomalies.html",
        anomalies=anomalies,
        start_date=start_date,
        end_date=end_date,
    )


def parse_date_range(req) -> tuple[date, date]:
    today = date.today()
    start_str = req.args.get("start")
    end_str = req.args.get("end")
    try:
        start_date = datetime.strptime(start_str, "%Y-%m-%d").date() if start_str else today
    except ValueError:
        start_date = today
    try:
        end_date = datetime.strptime(end_str, "%Y-%m-%d").date() if end_str else today
    except ValueError:
        end_date = today
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    return start_date, end_date


def fetch_punches(start_date: date, end_date: date) -> list[Punch]:
    start_dt = datetime.combine(start_date, time.min).isoformat()
    end_dt = datetime.combine(end_date, time.max).isoformat()
    conn = get_db()
    rows = conn.execute(
        """
        SELECT punches.id, punches.user_id, users.name as user_name, punches.direction, punches.punched_at
        FROM punches
        JOIN users ON punches.user_id = users.id
        WHERE punches.punched_at BETWEEN ? AND ?
        ORDER BY punches.punched_at ASC
        """,
        (start_dt, end_dt),
    ).fetchall()
    conn.close()
    return [
        Punch(
            id=row["id"],
            user_id=row["user_id"],
            user_name=row["user_name"],
            direction=row["direction"],
            punched_at=datetime.fromisoformat(row["punched_at"]),
        )
        for row in rows
    ]


def derive_shifts_and_anomalies(punches: Iterable[Punch]) -> tuple[list[Shift], list[Anomaly]]:
    shifts: list[Shift] = []
    anomalies: list[Anomaly] = []
    last_direction: dict[int, str] = {}
    current_in: dict[int, Punch] = {}
    for punch in punches:
        last_dir = last_direction.get(punch.user_id)
        if punch.direction == "IN":
            if punch.user_id in current_in:
                anomalies.append(
                    Anomaly(
                        user_id=punch.user_id,
                        user_name=punch.user_name,
                        occurred_at=punch.punched_at,
                        kind="Multiple INs",
                        detail="IN recorded before previous OUT.",
                    )
                )
            current_in[punch.user_id] = punch
        else:
            if punch.user_id not in current_in:
                kind = "OUT without IN"
                detail = "OUT recorded without a matching IN."
                if last_dir == "OUT":
                    kind = "Multiple OUTs"
                    detail = "Repeated OUT recorded without IN."
                anomalies.append(
                    Anomaly(
                        user_id=punch.user_id,
                        user_name=punch.user_name,
                        occurred_at=punch.punched_at,
                        kind=kind,
                        detail=detail,
                    )
                )
            else:
                start_punch = current_in.pop(punch.user_id)
                shifts.append(
                    Shift(
                        user_id=punch.user_id,
                        user_name=punch.user_name,
                        start=start_punch.punched_at,
                        end=punch.punched_at,
                    )
                )
        last_direction[punch.user_id] = punch.direction
    for user_id, in_punch in current_in.items():
        anomalies.append(
            Anomaly(
                user_id=user_id,
                user_name=in_punch.user_name,
                occurred_at=in_punch.punched_at,
                kind="IN without OUT",
                detail="IN recorded without a closing OUT.",
            )
        )
    return shifts, anomalies


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
