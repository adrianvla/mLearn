ALTER TABLE users ADD COLUMN identity_type TEXT NOT NULL DEFAULT 'learner'
    CHECK (identity_type IN ('admin', 'teacher', 'learner'));

ALTER TABLE users ADD COLUMN is_root INTEGER NOT NULL DEFAULT 0
    CHECK (is_root IN (0, 1));

UPDATE users
SET identity_type = status
WHERE status IN ('admin', 'teacher', 'learner');

UPDATE users
SET is_root = 1
WHERE id IN (
    SELECT target_id
    FROM audit_events
    WHERE action = 'identity.bootstrap_root'
);

UPDATE users
SET status = 'active'
WHERE status IN ('admin', 'teacher', 'learner');

CREATE TRIGGER users_status_insert_check
BEFORE INSERT ON users
WHEN NEW.status NOT IN ('active', 'suspended')
BEGIN
    SELECT RAISE(ABORT, 'invalid user status');
END;

CREATE TRIGGER users_status_update_check
BEFORE UPDATE OF status ON users
WHEN NEW.status NOT IN ('active', 'suspended')
BEGIN
    SELECT RAISE(ABORT, 'invalid user status');
END;
