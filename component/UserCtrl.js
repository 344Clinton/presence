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

const log = require( './Log' )( 'UserCtrl' );

const ns = {};
ns.UserCtrl = function( dbPool, worgs ) {
	const self = this;
	self.worgs = worgs;
	self.db = null;
	
	self.accounts = {};
	self.accIds = [];
	self.guests = {};
	self.guestIds = [];
	
	self.init( dbPool );
}

// Public

ns.UserCtrl.prototype.addAccount = function( account ) {
	const self = this;
	log( 'addAccount', account );
	let aId = account.id;
	if ( self.accounts[ aId ])
		return;
	
	self.accounts[ aId ] = account;
	self.accIds.push( aId );
	self.updateAllTheThings( aId );
}

ns.UserCtrl.prototype.addGuest = function( guest ) {
	const self = this;
	log( 'addGuest', guest );
}

ns.UserCtrl.prototype.remove = function( accountId ) {
	const self = this;
	if ( !self.accounts[ accountId ])
		return;
	
	delete self.accounts[ accountId ];
	self.accIds = Object.keys( self.accounts );
}

ns.UserCtrl.prototype.close = function() {
	const self = this;
	delete self.worgs;
}

// Private

ns.UserCtrl.prototype.init = function( dbPool ) {
	const self = this;
	log( ':3' );
}

ns.UserCtrl.prototype.updateAllTheThings = function( accId ) {
	const self = this;
	const acc = self.accounts[ accId ];
	const accWorgs = acc.getWorkgroups();
	log( 'worgs', accWorgs, 3 );
	if ( accWorgs )
		self.worgs.setForUser( accId, accWorgs );
	
	
}

module.exports = ns.UserCtrl;
