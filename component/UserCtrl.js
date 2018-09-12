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
const Account = require( './Account' );
const Guest = require( './GuestAccount' );

const ns = {};
ns.UserCtrl = function(
	dbPool,
	idCache,
	worgs,
	roomCtrl
) {
	const self = this;
	self.dbPool = dbPool;
	self.idc = idCache;
	self.worgs = worgs;
	self.roomCtrl = roomCtrl;
	self.db = null;
	
	self.accounts = {};
	self.accIds = [];
	self.guests = {};
	self.guestIds = [];
	
	self.init( dbPool );
}

// Public

ns.UserCtrl.prototype.addAccount = async function( session, conf ) {
	const self = this;
	log( 'addAccount', conf, 3 );
	const accId = conf.clientId;
	const worgs = conf.workgroups;
	delete conf.workgroups;
	
	self.worgs.addUser( accId, worgs );
	const account = new Account(
		session,
		conf,
		self.dbPool,
		self.roomCtrl,
		self.worgs,
	);
	
	let aId = account.id;
	if ( self.accounts[ aId ])
		return;
	
	self.accounts[ aId ] = account;
	self.accIds.push( aId );
	
	self.setContactList( aId );
}

ns.UserCtrl.prototype.addGuest = function( session, conf ) {
	const self = this;
	log( 'addGuest', conf );
	const accId = conf.id;
	const guest = new Guest(
		session,
		conf,
		self.roomCtrl,
	);
	self.accounts[ accId ] = guest;
	self.accIds.push( accId );
}

ns.UserCtrl.prototype.remove = function( accountId ) {
	const self = this;
	log( 'remove', accountId );
	if ( !self.accounts[ accountId ])
		return;
	
	const acc = self.accounts[ accountId ];
	delete self.accounts[ accountId ];
	self.accIds = Object.keys( self.accounts );
	
	const worgs = acc.getWorkgroups();
	self.worgs.removeUser( accountId );
}

ns.UserCtrl.prototype.close = function() {
	const self = this;
	delete self.dbPool;
	delete self.worgs;
	delete self.roomCtrl;
}

// Private

ns.UserCtrl.prototype.init = function( dbPool ) {
	const self = this;
	log( ':3' );
	
	self.worgs.on( 'user-add', ( accId, worgId ) =>
		self.handleWorgUserAdded( accId, worgId ));
	self.worgs.on( 'user-remove', ( accId, worgId ) =>
		self.handleWorgUserRemoved( accId, worgId ));
}

ns.UserCtrl.prototype.handleWorgUserAdded = async function( accId, worgId ) {
	const self = this;
	log( 'handleworgUserAdded', [ accId, worgId ]);
	let worgUserList = self.worgs.getUserList( worgId );
	log( 'handleAdded - userlist', worgUserList );
	let addedIdentity = null;
	try {
		addedIdentity = await self.idc.get( accId );
	} catch( e ) {
		log( 'failed to load id', e );
	}
	
	worgUserList.forEach( addTo );
	function addTo( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc )
			return;
		
		acc.addContact( addedIdentity );
	}
}

ns.UserCtrl.prototype.handleWorgUserRemoved = function( removedId, memberOf ) {
	const self = this;
	log( 'handleWorgUserRemoved', [ removedId, memberOf ]);
	memberOf.forEach( notifyOthers );
	function notifyOthers( worgId ) {
		const worgUsers = self.worgs.getUserList( worgId );
		worgUsers.forEach( removeContact );
	}
	
	function removeContact( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc )
			return;
		
		acc.removeContact( removedId );
	}
}

ns.UserCtrl.prototype.setContactList = async function( accId ) {
	const self = this;
	const acc = self.accounts[ accId ];
	let list;
	try {
		list = await self.buildContactListFor( accId );
	} catch( e ) {
		log( 'hepp', e );
		list = [];
	}
	
	acc.setContactList( list );
}

ns.UserCtrl.prototype.buildContactListFor = async function( accId ) {
	const self = this;
	log( 'buildContactListFor', accId );
	const list = self.worgs.getContactList( accId );
	let ids;
	try {
		ids = await self.idc.getList( list );
	} catch( e ) {
		log( 'buildContactListFor - failed to load ids', e );
		ids = [];
	};
	
	return ids;
}

module.exports = ns.UserCtrl;
