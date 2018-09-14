CREATE TABLE `relation` (
    `_id`      INT UNSIGNED NOT NULL auto_increment,
    `clientId` VARCHAR( 191 ) NOT NULL UNIQUE,
    `userA`    VARCHAR( 191 ) NOT NULL,
    `userB`    VARCHAR( 191 ) NOT NULL,
    `roomId`   VARCHAR( 191 ) NULL,
    PRIMARY KEY( _id ),
    UNIQUE KEY( userA, userB ),
    UNIQUE KEY( userB, userA ),
    FOREIGN KEY( userA ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( userB ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( roomId ) REFERENCES room( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;