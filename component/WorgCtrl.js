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

const log = require( './Log' )( 'WorgCtrl' );
const Emitter = require( './Events' ).Emitter;
const util = require( 'util' );
const ns =  {};

ns.WorgCtrl = function( dbPool ) {
	const self = this;
	Emitter.call( self );
	
	self.db = null;
	
	self.fMap = {}; // fId to worg mapping
	self.cMap = {}; // clientId to worg mapping
	self.fIds = [];
	self.cIds = [];
	self.worgUsers = {} // each workgroup has a list of members
	
	
	self.init( dbPool );
}

util.inherits( ns.WorgCtrl, Emitter );

// Public

ns.WorgCtrl.prototype.add = function( worg ) {
	const self = this;
	if ( !worg.fId || !worg.clientId ) {
		log( 'add - invalid worg', worg );
		return null;
	}
	
	let fId = worg.fId;
	let cId = worg.clientId;
	if ( self.fMap[ fId ])
		return null;
	
	log( 'add', worg );
	self.fMap[ fId ] = worg;
	self.cMap[ cId ] = worg;
	self.fIds.push( fId );
	self.cIds.push( cId );
	self.worgUsers[ cId ] = [];
	
	return cId;
}

ns.WorgCtrl.prototype.remove = function( clientId ) {
	const self = this;
	log( 'remove', cId );
}

ns.WorgCtrl.prototype.removeByFID = function( fId ) {
	const self = this;
	log( 'removeByFID', fId );
}

ns.WorgCtrl.prototype.setForUser = function( accId, worgs ) {
	const self = this;
	log( 'setForUser', {
		accId : accId,
		worgs : worgs,
	}, 3 );
	self.updateAvailable( worgs.available );
	const worgList = self.addUserToWorgs( accId, worgs.member );
	return worgList;
}

ns.WorgCtrl.prototype.getUserList = function( worgId ) {
	const self = this;
	return self.worgUsers[ worgId ] || [];
}

ns.WorgCtrl.removeUser = function( accId, worgId ) {
	const self = this;
	log( 'removeUser', [ accId, worgId ]);
}

ns.WorgCtrl.prototype.close = function() {
	const self = this;
	log( 'close' );
}

// Private

ns.WorgCtrl.prototype.init = function( dbPool ) {
	const self = this;
	log( 'WorgCtrl o7 o7 o8 o7' );
}

ns.WorgCtrl.prototype.updateAvailable = function( worgs ) {
	const self = this;
	if ( !worgs || !worgs.length )
		return;
	
	const currentMap = {};
	worgs.forEach( addNew );
	self.cIds.forEach( removeStale );
	
	function addNew( worg ) {
		if ( !worg.fId || !worg.clientId ) {
			log( 'updateAvailable - invalid worg', worg );
			return;
		}
		
		currentMap[ worg.clientId ] = true;
		if ( self.fMap[ worg.fId ])
			return;
		
		self.add( worg );
	};
	
	function removeStale( cId ) {
		if ( currentMap[ cId ] )
			return;
		
		self.remove( cId );
	}
}

ns.WorgCtrl.prototype.addUserToWorgs = function( accId, worgs ) {
	const self = this;
	log( 'addUserToWorgs', worgs );
	if ( !worgs || !worgs.length )
		return;
	
	const memberMap = {};
	const memberList = worgs.map( addTo );
	self.cIds.forEach( removeMembership );
	return memberList;
	
	function addTo( worg ) {
		log( 'addTo', worg );
		let wId = worg.clientId;
		memberMap[ wId ] = true;
		let isMember =  checkIsMemberOf( wId, accId );
		if ( !isMember ) {
			self.emit( 'user-add', accId, wId );
			self.worgUsers[ wId ].push( accId );
		}
		
		return wId;
	}
	
	function removeMembership( worgId ) {
		if ( memberMap[ worgId ])
			return;
		
		// not a member
		let isInList = checkIsMemberOf( worgId, accId );
		if ( !isInList )
			return;
		
		let uList = self.worgUsers[ worgId ];
		let index = uList.indexOf( accId );
		log( 'outdated membership', {
			accId  : accId,
			worgId : worgId,
			index  : index,
		});
		
		uList.splice( index, 1 );
		self.emit( 'user-remove', accId, worgId );
		log( 'after splice', self.worgUsers[ worgId ]);
	}
	
	function checkIsMemberOf( worgId, accId ) {
		let worg = self.worgUsers[ worgId ];
		if ( !worg || !worg.length )
			return false;
		
		return worg.some( mId => mId === accId );
	}
}

module.exports = ns.WorgCtrl;
