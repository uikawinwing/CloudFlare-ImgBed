-- Give public albums an explicit CharInfo character identity.
-- packId is derived from the owner's validated public_handle.
-- profileId is derived from the album's stable UUID id.
ALTER TABLE albums ADD COLUMN char_info_character_name TEXT;
