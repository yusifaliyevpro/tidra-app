-- Registry documents are now cached trimmed; the old full-size ones (tens of MB each) were reread on every check.
DELETE FROM `http_cache` WHERE `key` LIKE 'abbr:%' OR `key` LIKE 'full:%';
