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
	self.worgUsers = {}; // each workgroup has a list of members.
	self.userWorgs = {}; // each user has a list of memberships.
	self.streamers = {}; // each streamer has a list of streamWorgs
	
	self.init( dbPool );
}

util.inherits( ns.WorgCtrl, Emitter );

// Public

ns.WorgCtrl.prototype.add = function( worg ) {
	const self = this;
	log( 'maybe add', worg );
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

ns.WorgCtrl.prototype.get = function() {
	const self = this;
	return self.cMap;
}

ns.WorgCtrl.prototype.getList = function() {
	const self = this;
	return self.cIds;
}

ns.WorgCtrl.prototype.resolveList = function( worgIds ) {
	const self = this;
	log( 'resolveList', worgIds );
	const worgs = {};
	worgIds.forEach( wId => {
		worgs[ wId ] = self.cMap[ wId ];
	});
	return worgs;
}

ns.WorgCtrl.prototype.remove = function( clientId ) {
	const self = this;
	log( 'remove', clientId );
}

ns.WorgCtrl.prototype.removeByFID = function( fId ) {
	const self = this;
	log( 'removeByFID', fId );
}

ns.WorgCtrl.prototype.addUser = function( accId, worgs ) {
	const self = this;
	log( 'addUser', {
		accId : accId,
		worgs : worgs,
	}, 3 );
	addNewWorgs( worgs );
	registerUser( accId, worgs );
	
	function addNewWorgs( worgs ) {
		if ( worgs.available )
			self.updateAvailable( worgs.available );
		else {
			if ( worgs.member && worgs.member.length )
				worgs.member.forEach( worg => self.add( worg ));
		}
	}
	
	function registerUser( accId, worgs ) {
		if ( worgs.member )
			self.updateUserWorgs( accId, worgs.member );
		
		if ( worgs.stream )
			self.updateStreamWorgs( accId, worgs.stream );
	}
}

ns.WorgCtrl.prototype.getUserList = function( worgId ) {
	const self = this;
	return self.worgUsers[ worgId ] || [];
}

ns.WorgCtrl.prototype.getMemberOfList = function( accId ) {
	const self = this;
	return self.userWorgs[ accId ] || [];
}

ns.WorgCtrl.prototype.getContactList = function( accId, worgs ) {
	const self = this;
	const member = worgs.member || [];
	const allLists = member.map( getWorgUserList );
	const flatted = {};
	allLists.forEach( flatten );
	const list = Object.keys( flatted );
	return list;
	
	function getWorgUserList( worg ) {
		let cId = worg.clientId;
		let list = self.getUserList( cId );
		return list;
	}
	
	function flatten( list ) {
		list.forEach( accId => {
			flatted[ accId ] = true;
		});
	}
}

ns.WorgCtrl.prototype.removeUser = function( accId ) {
	const self = this;
	log( 'removeUser', accId );
	let member = self.userWorgs[ accId ];
	if ( !member || !member.length )
		return;
	
	member.forEach( removeFrom );
	delete self.userWorgs[ accId ];
	delete self.streamers[ accId ];
	self.emit( 'user-remove', accId, member );
	
	function removeFrom( worgId ) {
		log( 'removeFrom', worgId );
		let worg = self.worgUsers[ worgId ];
		self.worgUsers[ worgId ] = worg.filter( wAccId => wAccId !== accId );
		log( 'worg after remove', self.worgUsers[ worgId ]);
	}
}

ns.WorgCtrl.prototype.checkUserIsStreamerFor = function( accId, worgList ) {
	const self = this;
	const streamer = self.streamers[ accId ];
	if ( !streamer )
		return false;
	
	const isStreamer = streamer.some( streamerWorgId => {
		return worgList.some( listWorgId => listWorgId === streamerWorgId );
	});
	
	return isStreamer;
}

ns.WorgCtrl.prototype.removeStreamWorkgroup = function( worgId ) {
	const self = this;
	log( 'removeStreamWorkgroup', worgId );
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
	log( 'updateAvailable', worgs );
	if ( !worgs || !worgs.length )
		return;
	
	const currentMap = {};
	worgs.forEach( addNew );
	self.cIds.forEach( removeStale );
	
	function addNew( worg ) {
		log( 'addNew', worg );
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

ns.WorgCtrl.prototype.updateUserWorgs = function( accId, worgs ) {
	const self = this;
	log( 'updateUserWorgs', worgs );
	if ( !worgs || !worgs.length )
		return;
	
	const memberMap = {};
	const memberList = worgs.map( addTo );
	self.userWorgs[ accId ] = memberList;
	self.cIds.forEach( removeMembership );
	return memberList;
	
	function addTo( worg ) {
		log( 'addTo', worg );
		let wId = worg.clientId;
		memberMap[ wId ] = true;
		let isMember =  self.checkIsMemberOf( wId, accId );
		if ( !isMember ) {
			self.worgUsers[ wId ].push( accId );
			self.emit( 'user-add', accId, wId );
		}
		
		return wId;
	}
	
	function removeMembership( worgId ) {
		if ( memberMap[ worgId ])
			return;
		
		// not a member
		let isInList = self.checkIsMemberOf( worgId, accId );
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
}

ns.WorgCtrl.prototype.updateStreamWorgs = function( accId, streamWorgNames ) {
	const self = this;
	console.log( 'updateStreamWorgs', streamWorgNames );
	if ( !streamWorgNames || !streamWorgNames.length )
		return;
	
	const current = {};
	const added = [];
	streamWorgNames.forEach( addMaybe );
	// TODO emit added probably
	const remove = self.streamWorgs.filter( isStale );
	remove.forEach( wId => self.removeStreamWorg( wId ));
	
	function addMaybe( worgName ) {
		let worg = self.getWorgByName( worgName );
		if ( !worg )
			return;
		
		let wId = worg.clientId;
		current[ wId ] = true;
		if ( !isSet( wId )) {
			self.addStreamWorg( wId );
			added.push( wId );
		}
	}
	
	function isSet( worgId ) {
		return self.streamWorgs.some( streamWorgId => worgId === streamWorgId );
	}
	
	function isStale( streamWorgId ) {
		return !current[ streamWorgId ];
	}
}

ns.WorgCtrl.prototype.getWorgByName = function( worgName ) {
	const self = this;
	log( 'getWorgByName', worgName );
	let namedWorg = null;
	self.cIds.some( lookup );
	return namedWorg;
	
	function lookup( wId ) {
		let worg = self.cMap[ wId ];
		if ( worgName === worg.name ) {
			namedWorg = worg;
			return true;
		}
		
		return false;
	};
}

ns.WorgCtrl.prototype.addStreamWorg = function( worgId ) {
	const self = this;
	self.streamWorgs.push( worgId );
	let userList = self.getUserList( worgId );
	userList.forEach( accId => self.setStreamer( accId, worgId ));
}

ns.WorgCtrl.prototype.setStreamer = function( accId, worgId ) {
	const self = this;
	if ( !self.streamers[ accId ])
		setNew( accId, worgId );
	else
		addToExistingMaybe( accId, worgId );
	
	function setNew( accId ) {
		self.streamers[ accId ] = [
			worgId,
		];
	}
	
	function addToExistingMaybe( accId, worgId ) {
		let streamer = self.streamers[ accId ];
		let added = streamer.some( wId => wId === worgId );
		if ( added )
			return;
		
		streamer.push( worgId );
	}
}

ns.WorgCtrl.prototype.checkIsMemberOf = function( worgId, accId ) {
	const self = this;
	let worg = self.worgUsers[ worgId ];
	if ( !worg || !worg.length )
		return false;
	
	return worg.some( mId => mId === accId );
}

module.exports = ns.WorgCtrl;
