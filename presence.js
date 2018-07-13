/*©agpl*************************************************************************
*                                                                              *
* This file is part of FRIEND UNIFYING PLATFORM.                               *
*                                                                              *
* This program is free software: you can redistribute it and/or modify         *
* it under the terms of the GNU Affero General Public License as published by  *
* the Free Software Foundation, either version 3 of the License, or            *
* (at your option) any later version.                                          *
*                                                                              *
* This program is distributed in the hope that it will be useful,              *
* but WITHOUT ANY WARRANTY; without even the implied warranty of               *
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                 *
* GNU Affero General Public License for more details.                          *
*                                                                              *
* You should have received a copy of the GNU Affero General Public License     *
* along with this program.  If not, see <http://www.gnu.org/licenses/>.        *
*                                                                              *
*****************************************************************************©*/

'use strict';

const log = require( './component/Log' )( 'presence' );
const MySQLPool = require( './component/MysqlPool' );
const UserCtrl = require( './component/UserCtrl' );
const RoomCtrl = require( './component/RoomCtrl' );
const NML = require( './component/NoMansLand' );
let conf = require( './component/Config' ); // not really bothering with saving the obj,
                                            // it writes itself to global.config

log( 'conf', conf, 4 );

const fcReq = require( './component/FCRequest' )( global.config.server.friendcore );

const presence = {
	conn  : null,
	db    : null,
	users : null,
	rooms : null,
};

presence.db = new MySQLPool( global.config.server.mysql, dbReady );
function dbReady( ok ) {
	if ( !ok )
		throw new Error( 'db failed?' );
	
	presence.users = new UserCtrl( presence.db );
	
	presence.rooms = new RoomCtrl( presence.db );
	openComms();
}

function openComms() {
	presence.conn = new NML( presence.db, presence.users, presence.rooms, fcReq );
}

