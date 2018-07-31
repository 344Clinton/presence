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
ns.UserCtrl = function( dbPool, idCache, worgs ) {
	const self = this;
	self.idc = idCache;
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
	log( 'remove', accountId );
	if ( !self.accounts[ accountId ])
		return;
	
	const acc = self.accounts[ accountId ];
	const worgs = acc.getWorkgroups();
	
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
	
	self.worgs.on( 'user-add', ( accId, worgId ) =>
		self.handleWorgUserAdded( accId, worgId ));
	self.worgs.on( 'user-remove', ( accId, worgId ) =>
		self.handleWorgUserRemoved( accId, worgId ));
}

ns.UserCtrl.prototype.handleWorgUserAdded = async function( accId, worgId ) {
	const self = this;
	log( 'handleworgUserAdded', [ accId, worgId ]);
	let worgUserList = self.worgs.getUserList( worgId );
	let addedIdentity = null;
	try {
		addedIdentity = await self.idc.get( accId );
	} catch( e ) {
		log( 'failed to load id', e );
	}
	
	log( 'handleworguseradded - the things', {
		userList : worgUserList,
		id       : addedIdentity,
	});
	
	worgUserList.forEach( addTo );
	function addTo( accId ) {
		let acc = self.accounts[ accId ];
		if ( !acc )
			return;
		
		acc.addContact( addedIdentity );
	}
}

ns.UserCtrl.prototype.handleWorgUserRemoved = function( accId, worgId ) {
	const self = this;
	log( 'handleWorgUserRemoved', [ accId, worgId ]);
	const worgUserList = self.worgs.getUserList( worgId );
	worgUserList.forEach( maybeRemoveFrom );
	function maybeRemoveFrom( accId ) {
		
	}
}

ns.UserCtrl.prototype.updateAllTheThings = async function( accId ) {
	const self = this;
	const acc = self.accounts[ accId ];
	const accWorgs = acc.getWorkgroups();
	log( 'worgs', accWorgs, 3 );
	if ( accWorgs )
		self.worgs.setForUser( accId, accWorgs );
	
	const list = self.buildContactListFor( accId );
	let ids;
	try {
		ids = await self.idc.getList( list );
	} catch( e ) {
		log( 'updateAllTheThings - failed to load ids', e );
		ids = [];
	};
	acc.setContactList( ids );
	
}

ns.UserCtrl.prototype.buildContactListFor = function( accId ) {
	const self = this;
	log( 'buildContactListFor', accId );
	const acc = self.accounts[ accId ];
	const worgs = acc.getWorkgroups();
	const member = worgs.member || [];
	const allLists = member.map( getWorgUserList );
	const flatted = {};
	allLists.forEach( flatten );
	const list = Object.keys( flatted );
	return list;
	
	function getWorgUserList( worg ) {
		let cId = worg.clientId;
		let list = self.worgs.getUserList( cId );
		return list;
	}
	
	function flatten( list ) {
		list.forEach( accId => {
			flatted[ accId ] = true;
		});
	}
}

module.exports = ns.UserCtrl;
