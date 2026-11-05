-- property_imports.snapshot: the preview's snapshot changed format (PR #132).
-- It was one sha256 in hex; now it is "v2." and base64url of a short JSON
-- (one hash per reviewed field and per photo, see snapshotOf in
-- src/lib/agency/imports.ts). The old check refused v2 and the final save of
-- every import failed. Both formats are accepted, with a size limit.
-- The same pattern is in SNAPSHOT_PATTERN (imports.ts) and its test reads it
-- from here: change them together.
begin;
alter table public.property_imports drop constraint if exists property_imports_snapshot_check;
alter table public.property_imports add constraint property_imports_snapshot_check
 check (snapshot is null or (char_length(snapshot) <= 12000 and snapshot ~ '^([0-9a-f]{64}|v2\.[A-Za-z0-9_-]+)$'));
commit;
