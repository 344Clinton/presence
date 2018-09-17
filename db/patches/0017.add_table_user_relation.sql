CREATE TABLE `user_relation` (
    `_id`      INT UNSIGNED NOT NULL auto_increment,
    `clientId` VARCHAR( 191 ) NOT NULL UNIQUE,
    `accountA` VARCHAR( 191 ) NOT NULL,
    `accountB` VARCHAR( 191 ) NOT NULL,
    `roomId`   VARCHAR( 191 ) NULL,
    PRIMARY KEY( _id ),
    UNIQUE KEY( accountA, accountB ),
    UNIQUE KEY( accountB, accountA ),
    FOREIGN KEY( accountA ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( accountB ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( roomId ) REFERENCES room( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;