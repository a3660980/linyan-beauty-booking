CREATE TRIGGER limit_group_members BEFORE INSERT ON bookings WHEN NEW.group_code IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'GROUP_FULL') WHERE (SELECT COUNT(*) FROM bookings WHERE group_code=NEW.group_code AND status IN ('pending','confirmed','completed'))>=2;
END;
