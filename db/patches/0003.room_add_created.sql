ALTER TABLE `room`
ADD COLUMN `created` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
AFTER `isPrivate`;