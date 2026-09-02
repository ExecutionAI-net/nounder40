-- Course name becomes optional: when empty, the UI shows the lesson type
-- name localized in the viewer's language (Carlo: the course identity is
-- the HQ lesson type, not a free-text name)
ALTER TABLE courses ALTER COLUMN name DROP NOT NULL;
