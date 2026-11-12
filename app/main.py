"""
UIUX_Proj - Collaborative Design Tool: Conflict Handling  (MySQL / XAMPP version)
Run:  python main.py   ->  http://127.0.0.1:5000
Needs: pip install flask mysql-connector-python
"""
import mysql.connector
from flask import Flask, g, jsonify, render_template, request

# ---- change these if your MySQL setup is different (XAMPP default: root, no password) ----
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "",
    "database": "uiuxproj_db",
}

app = Flask(__name__)


# ---------- database helpers ----------
def get_db():
    if "db" not in g:
        g.db = mysql.connector.connect(**DB_CONFIG)
    return g.db


@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def run(sql, args=None):
    """Execute a write query, return the cursor (use .lastrowid)."""
    cur = get_db().cursor(dictionary=True)
    cur.execute(sql, args)
    return cur


def rows(sql, args=None):
    cur = get_db().cursor(dictionary=True)
    cur.execute(sql, args)
    out = cur.fetchall()
    cur.close()
    return out


def one(sql, args=None):
    r = rows(sql, args)
    return r[0] if r else None


def apply_edit(object_id, user_id, new_value, action="edit"):
    """Write a new value to an object, bump its version, log it in edits."""
    obj = one("SELECT * FROM objects WHERE id=%s", (object_id,))
    run("INSERT INTO edits (object_id,user_id,action,old_value,new_value) VALUES (%s,%s,%s,%s,%s)",
        (object_id, user_id, action, obj["label"], new_value))
    run("UPDATE objects SET label=%s, version=version+1 WHERE id=%s", (new_value, object_id))
    get_db().commit()
    return one("SELECT * FROM objects WHERE id=%s", (object_id,))


def reset_data():
    """Empty all tables and re-insert the starting data."""
    run("SET FOREIGN_KEY_CHECKS=0")
    for t in ("conflicts", "edits", "objects", "users"):
        run(f"TRUNCATE TABLE {t}")
    run("SET FOREIGN_KEY_CHECKS=1")
    run("INSERT INTO users (id,name,initials,color) VALUES "
        "(1,'Joseph','J','#E11D48'),(2,'Sarah','R','#7C3AED'),(3,'Alex','M','#0891B2')")
    run("INSERT INTO objects (name,label,version) VALUES ('Login button','Login',1)")
    run("INSERT INTO edits (object_id,user_id,action,old_value,new_value) VALUES (1,1,'edit','Submit','Login')")
    get_db().commit()


# ---------- page ----------
@app.route("/")
def index():
    return render_template("index.html")


# ---------- API ----------
@app.route("/api/state")
def api_state():
    users = rows("SELECT * FROM users")
    objects = rows("SELECT * FROM objects ORDER BY id")
    history = rows("""SELECT e.id, e.object_id, e.user_id, e.action, e.old_value, e.new_value, e.undone,
                             DATE_FORMAT(e.created_at, '%H:%i') AS time, u.name AS user_name, u.color AS user_color,
                             o.name AS object_name
                      FROM edits e JOIN users u ON u.id=e.user_id JOIN objects o ON o.id=e.object_id
                      ORDER BY e.id DESC LIMIT 20""")
    conflicts = rows("""SELECT c.*, o.name AS object_name, a.name AS theirs_name
                        FROM conflicts c JOIN objects o ON o.id=c.object_id
                        JOIN users a ON a.id=c.theirs_user
                        WHERE c.status='open' ORDER BY c.id DESC""")
    return jsonify(users=users, objects=objects, history=history, conflicts=conflicts)


@app.route("/api/presence", methods=["POST"])
def api_presence():
    d = request.get_json()
    if d.get("editing"):
        run("UPDATE objects SET editing_user_id=%s, editing_since=NOW() WHERE id=%s",
            (d["user_id"], d["object_id"]))
    else:
        run("UPDATE objects SET editing_user_id=NULL, editing_since=NULL WHERE id=%s AND editing_user_id=%s",
            (d["object_id"], d["user_id"]))
    get_db().commit()
    return jsonify(ok=True)


@app.route("/api/edit", methods=["POST"])
def api_edit():
    """Optimistic concurrency: if the object changed since the user opened it
    (base_version is stale) AND someone else made that change -> conflict."""
    d = request.get_json()
    new_value = (d.get("new_value") or "").strip()
    if not new_value:
        return jsonify(error="Label can't be empty."), 400
    obj = one("SELECT * FROM objects WHERE id=%s", (d["object_id"],))
    if not obj:
        return jsonify(error="Object not found."), 404
    last = one("SELECT * FROM edits WHERE object_id=%s ORDER BY id DESC LIMIT 1", (obj["id"],))
    stale = d["base_version"] < obj["version"]
    if stale and last and last["user_id"] != d["user_id"] and last["new_value"] != new_value:
        cur = run("""INSERT INTO conflicts (object_id,mine_user,theirs_user,mine_value,theirs_value)
                     VALUES (%s,%s,%s,%s,%s)""",
                  (obj["id"], d["user_id"], last["user_id"], new_value, obj["label"]))
        get_db().commit()
        c = one("""SELECT c.*, u.name AS theirs_name FROM conflicts c JOIN users u ON u.id=c.theirs_user
                   WHERE c.id=%s""", (cur.lastrowid,))
        return jsonify(conflict=c), 409
    obj = apply_edit(obj["id"], d["user_id"], new_value)
    return jsonify(object=obj)


@app.route("/api/conflict/<int:cid>/resolve", methods=["POST"])
def api_resolve(cid):
    choice = request.get_json().get("choice")
    c = one("SELECT * FROM conflicts WHERE id=%s AND status='open'", (cid,))
    if not c:
        return jsonify(error="Conflict already resolved."), 404
    if choice == "mine":
        apply_edit(c["object_id"], c["mine_user"], c["mine_value"], "resolve")
        msg = "Kept your version."
    elif choice == "theirs":
        msg = f"Kept {c['theirs_value']!r}."
    elif choice == "both":
        orig = one("SELECT * FROM objects WHERE id=%s", (c["object_id"],))
        cur = run("INSERT INTO objects (name,label,version) VALUES (%s,%s,1)",
                  (orig["name"] + " (copy)", c["mine_value"]))
        run("INSERT INTO edits (object_id,user_id,action,old_value,new_value) VALUES (%s,%s,%s,%s,%s)",
            (cur.lastrowid, c["mine_user"], "resolve", None, c["mine_value"]))
        msg = "Kept both. Duplicate created."
    else:
        return jsonify(error="Unknown choice."), 400
    run("UPDATE conflicts SET status='resolved', choice=%s WHERE id=%s", (choice, cid))
    get_db().commit()
    return jsonify(message=msg)


@app.route("/api/undo", methods=["POST"])
def api_undo():
    """Personal undo: reverts only THIS user's latest change, never a teammate's."""
    uid = request.get_json()["user_id"]
    e = one("""SELECT * FROM edits WHERE user_id=%s AND undone=0 AND action IN ('edit','resolve','restore')
               AND old_value IS NOT NULL ORDER BY id DESC LIMIT 1""", (uid,))
    if not e:
        return jsonify(error="Nothing to undo."), 404
    obj = one("SELECT * FROM objects WHERE id=%s", (e["object_id"],))
    if obj["label"] != e["new_value"]:
        return jsonify(error="A teammate changed this after you. Use History > Restore instead.",
                       blocked=True), 409
    apply_edit(obj["id"], uid, e["old_value"], "undo")
    run("UPDATE edits SET undone=1 WHERE id=%s", (e["id"],))
    get_db().commit()
    return jsonify(message=f"Undid your change: {e['new_value']!r} -> {e['old_value']!r}.")


@app.route("/api/undo/peek")
def api_undo_peek():
    uid = request.args.get("user_id", type=int)
    e = one("""SELECT e.*, o.name AS object_name FROM edits e JOIN objects o ON o.id=e.object_id
               WHERE e.user_id=%s AND e.undone=0 AND e.action IN ('edit','resolve','restore')
               AND e.old_value IS NOT NULL ORDER BY e.id DESC LIMIT 1""", (uid,))
    return jsonify(edit=e)


@app.route("/api/history/<int:eid>/restore", methods=["POST"])
def api_restore(eid):
    uid = request.get_json()["user_id"]
    e = one("SELECT * FROM edits WHERE id=%s", (eid,))
    if not e or e["new_value"] is None:
        return jsonify(error="Version not found."), 404
    apply_edit(e["object_id"], uid, e["new_value"], "restore")
    return jsonify(message=f"Restored {e['new_value']!r}.")


@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    """Demo helper: a teammate (Alex) edits the same object while you are editing."""
    d = request.get_json()
    obj = apply_edit(d["object_id"], 3, d.get("new_value", "Log in"), "edit")
    return jsonify(object=obj)


@app.route("/api/reset", methods=["POST"])
def api_reset():
    reset_data()
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(debug=True)