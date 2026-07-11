CREATE TRIGGER groups_single_root_insert
BEFORE INSERT ON groups
WHEN NEW.parent_id IS NULL AND EXISTS (SELECT 1 FROM groups WHERE parent_id IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'root group already exists');
END;

CREATE TRIGGER groups_non_root_cannot_detach
BEFORE UPDATE OF parent_id ON groups
WHEN OLD.parent_id IS NOT NULL AND NEW.parent_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'non-root group requires a parent');
END;

CREATE TRIGGER groups_cycle_insert
BEFORE INSERT ON groups
WHEN NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id
BEGIN
    SELECT RAISE(ABORT, 'group cycle detected');
END;

CREATE TRIGGER groups_cycle_update
BEFORE UPDATE OF parent_id ON groups
WHEN NEW.parent_id IS NOT NULL
BEGIN
    SELECT CASE WHEN EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT id, parent_id FROM groups WHERE id = NEW.parent_id
            UNION ALL
            SELECT parent.id, parent.parent_id
            FROM groups parent
            JOIN ancestors child ON child.parent_id = parent.id
        )
        SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN RAISE(ABORT, 'group cycle detected') END;
END;

CREATE TRIGGER groups_root_delete_guard
BEFORE DELETE ON groups
WHEN OLD.parent_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'root group cannot be deleted');
END;
