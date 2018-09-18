'use strict';

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

const log = require( './Log')( 'RoomCtrl' );
const uuid = require( './UuidPrefix' )( 'room' );
const ContactRoom = require( './RoomContact' );
const Emitter = require( './Events' ).Emitter;
const dFace = require( './DFace' );
const Room = require( './Room' );

const util = require( 'util' );

var ns = {};
ns.RoomCtrl = function( dbPool, idCache, worgs ) {
	const self = this;
	
	Emitter.call( self );
	
	self.dbPool = dbPool;
	self.idCache = idCache;
	self.worgs = worgs;
	self.roomDb = null;
	self.accDb = null;
	
	self.rooms = {};
	self.roomIds = [];
	self.roomLoads = {};
	
	self.relations = {};
	self.relationIds = [];
	self.relationLoads = {};
	
	self.init();
}

util.inherits( ns.RoomCtrl, Emitter );

// Public

ns.RoomCtrl.prototype.openContact = async function( accId, contactId ) {
	const self = this;
	log( 'openContact', [
		accId,
		contactId,
	]);
	
	let room = null;
	try {
		room = await self.getContactRoom( accId, contactId );
	} catch( e ) {
		return null;
	}
	
	const join = {
		type : 'contact-join',
		data : null,
	};
	self.emit( contactId, join, accId );
	const user = room.connect( accId );
	return user;
}

ns.RoomCtrl.prototype.connectContact = async function( accId, contactId ) {
	const self = this;
	log( 'connectContact', accId );
	const relation = await self.getRelation( accId, contactId );
	if ( !relation )
		return false;
	
	const room = await self.getRoom( relation.roomId );
	if ( !room )
		return null;
	
	const user = room.connect( accId );
	log( 'connectContact - done', !!user );
	return user;
}

ns.RoomCtrl.prototype.createRoom = function( account, conf, callback ) {
	const self = this;
	if ( !account || !account.clientId || !account.name )
		throw new Error( 'RoomCtrl.joinRoom - invalid account' );
	
	conf = conf || {};
	if ( null == conf.name )
		self.createAnonRoom( account, callback );
	else
		self.createNamedRoom( account, conf, callback );
}

ns.RoomCtrl.prototype.joinRoom = function( account, conf, callback ) {
	const self = this;
	if ( !account || !account.clientId || !account.name )
		throw new Error( 'RoomCtrl.joinRoom - invalid account' );
	
	if ( conf.token )
		self.joinWithInvite( account, conf, callback );
	else
		self.joinWithAuth( account, conf, callback );
}

ns.RoomCtrl.prototype.authorizeGuestInvite = function( bundle, callback ) {
	const self = this;
	const token = bundle.token;
	const roomId = bundle.roomId;
	const room = self.rooms[ roomId ];
	if ( room )
		authWithRoom( token, room, callback );
	else
		authWithDb( token, roomId, callback );
	
	function authWithDb( token, roomId, callback ) {
		self.invDb.checkForRoom( token, roomId )
			.then( checkBack )
			.catch( invErr );
		
		function checkBack( dbToken ) {
			if ( !dbToken || !dbToken.isValid ) {
				callback( false );
				return;
			}
			
			if ( !!dbToken.singleUse )
				self.invDb.invalidate( token )
					.then( () => {})
					.catch( () => log( 'invalidate fail', token ));
			
			callback( roomId );
		}
		
		function invErr( e ) {
			log( 'authorizeGuestInvite - invErr', e );
			callback( false );
		}
	}
	
	function authWithRoom( token, room, callback ) {
		room.authenticateInvite( token )
			.then( checkBack );
			
		function checkBack( isValid ) {
			if ( isValid )
				callback( roomId );
			else
				callback( false );
		}
	}
}

ns.RoomCtrl.prototype.guestJoinRoom = function( account, roomId, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	let room = null;
	self.getRoom( roomId )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( res ) {
		if ( !res ) {
			callback( 'ERR_NO_ROOM', null );
			return;
		}
		
		room = res;
		account.guest = true;
		self.addToRoom( account, roomId, addBack );
	}
	
	function addBack( err, res ) {
		if ( err ) {
			log( 'guestJoinRoom - addBack', err.stack || err );
			callback( err, null );
		}
		
		const user = room.connect( account );
		callback( null, user );
	}
	
	function roomErr( err ) {
		log( 'guestJoinRoom - getRoom err', err.stack || err );
		callback( err, null );
	}
}

ns.RoomCtrl.prototype.connectWorkgroup = function( account, roomId, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	let room = null;
	self.getRoom( roomId )
		.then( roomBack )
		.catch( roomErr );
		
	function roomErr( err ) {
		log( 'workgroupJoinRoom - getRoom err', err.stack || err );
		callback( 'ERR_NO_ROOM' );
	}
	
	function roomBack( res ) {
		if ( !res ) {
			callback( 'ERR_NO_ROOM' );
			return;
		}
		
		room = res;
		self.addToRoom( account, roomId, addBack );
	}
	
	function addBack( err, res ) {
		const user = room.connect( account );
		callback( null, user );
	}
}

// go online in a room  - the room will start sending events to this client
// only an authorized user can .connect directly
ns.RoomCtrl.prototype.connect = function( account, roomId, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	self.getRoom( roomId )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( room ) {
		if ( !room ) {
			log( 'connect - roomBack, no room', {
				roomId : roomId,
				room   : room,
			});
			callback( 'ERR_NO_ROOM', null );
			return;
		}
		
		account.authed = true;
		const user = room.connect( account );
		if ( !user )
			callback( 'ERR_NOT_IN_ROOM' );
		else
			callback( null, user );
	}
	
	function roomErr( err ) {
		log( 'connect - getRoom err', err.stack || err );
		callback( err, null );
	}
}

// closes roomCtrl, not a room
ns.RoomCtrl.prototype.close = function() {
	const self = this;
	if ( self.roomDb )
		self.roomDb.close();
	
	if ( self.accDb )
		self.accDb.close();
	
	if ( self.invDb )
		self.invDb.close();
	
	// TODO : close rooms
	
	delete self.idCache;
	delete self.worgs;
	delete self.roomDb;
	delete self.accDb;
	delete self.invDb;
	delete self.dbPool;
}

// Private

ns.RoomCtrl.prototype.init = function() {
	const self = this;
	log( 'room ctrl init =^y^=' );
	self.roomDb = new dFace.RoomDB( self.dbPool );
	self.accDb = new dFace.AccountDB( self.dbPool );
	self.invDb = new dFace.InviteDB( self.dbPool );
	const tiny = require( './TinyAvatar' );
	tiny.generateGuest()
		.then( res => {
			self.guestAvatar = res
		})
		.catch( err => {
			log( 'init - failed to generate guest avatar', err );
			self.guestAvatar = null;
		});
}

ns.RoomCtrl.prototype.createNamedRoom = function( account, conf, callback ) {
	const self = this;
	log( 'createNamedRoom - NYI', conf );
}

ns.RoomCtrl.prototype.createAnonRoom = function( account, callback ) {
	const self = this;
	const ownerId = account.clientId;
	const roomId = uuid.get();
	let room = null;
	const roomConf = {
		clientId   : roomId,
		ownerId    : ownerId,
		name       : '[ temp ] created by: ' + account.name,
	};
	self.setRoom( roomConf )
		.then( roomOpen )
		.catch( roomErr );
	
	function roomOpen( res ) {
		if ( !res ) {
			callback( 'ERR_NO_ROOM_???', null );
			return;
		}
		
		room = res;
		self.addToRoom( account, roomId, authBack );
	}
	
	function authBack( err, uid ) {
		const user = room.connect( account );
		callback( null, user );
	}
	
	function roomErr( err ) {
		log( 'createAnonRoom - setRoom err', err.stack || err );
		callback( null );
	}
}

ns.RoomCtrl.prototype.joinWithInvite = function( account, conf, callback ) {
	const self = this;
	if ( !callback )
		return false;
	
	const rid = conf.roomId;
	let room = null;
	self.getRoom( rid )
		.then( roomBack )
		.catch( roomErr );
	
	function roomBack( res ) {
		if ( !res ) {
			callback( 'ERR_NO_ROOM', null );
			return;
		}
		
		room = res;
		room.authenticateInvite( conf.token )
			.then( inviteBack );
			
		function inviteBack( isValid ) {
			if ( !isValid ) {
				callback( 'ERR_INVITE_INVALID', null );
				return;
			}
			
			self.authorizeForRoom( account, rid, authBack );
		}
	}
	
	function authBack( err, uid ) {
		self.addToRoom( account, rid, addBack );
	}
	
	function addBack( err , uid ) {
		const user = room.connect( account );
		callback( null, user );
	}
	
	function roomErr( err ) {
		log( 'joinWithInvite - getRoom err', err.stack || err );
		callback( err, null );
	}
}

ns.RoomCtrl.prototype.joinWithAuth = function( account, conf, callback ) {
	const self = this;
	callback( 'ERR_NYI_FUCKO', null );
	return false;
}

ns.RoomCtrl.prototype.setRoom = function( roomConf ) {
	const self = this;
	const roomId = roomConf.clientId;
	const isContactRoom = checkIsContactRoom( roomConf.ownerId );
	if ( isContactRoom )
		return new Promise( openContactRoom );
	else
		return new Promise( openRoom );
	
	function openContactRoom( resolve, reject ) {
		const roomId = roomConf.clientId;
		const room = new ContactRoom(
			roomConf,
			self.dbPool,
			self.idCache,
		);
		
		room.once( 'open', onOpen );
		self.bindContactRoom( room );
		
		function onOpen() {
			self.rooms[ roomId ] = room;
			self.roomIds = Object.keys( self.rooms );
			resolve( self.rooms[ roomId ]);
		}
	}
	
	function openRoom( resolve, reject ) {
		roomConf.guestAvatar = self.guestAvatar;
		const roomId = roomConf.clientId;
		const room = new Room(
			roomConf,
			self.dbPool,
			self.idCache,
			self.worgs
		);
		
		room.once( 'open', onOpen );
		self.bindRoom( room );
		
		function onOpen() {
			self.rooms[ roomId ] = room;
			self.roomIds = Object.keys( self.rooms );
			resolve( self.rooms[ roomId ]);
		}
	}
	
	function checkIsContactRoom( ownerId ) {
		return !!self.relations[ ownerId ];
	}
}

ns.RoomCtrl.prototype.bindRoom = function( room ) {
	const self = this;
	let roomId = room.id;
	room.on( 'empty', onEmpty );
	room.on( 'workgroup-assigned', worgAss );
	room.on( 'workgroup-dismissed', worgDiss );
	
	function onEmpty( e ) { self.removeRoom( roomId ); }
	function worgAss( e ) { self.handleWorkgroupAssigned( e, roomId ); }
	function worgDiss( e ) {  }
}

ns.RoomCtrl.prototype.bindContactRoom = function( room ) {
	const self = this;
	let rId = room.id;
	room.on( 'empty', onEmpty );
	function onEmpty( e ) { self.removeRoom( roomId ); }
}

ns.RoomCtrl.prototype.handleWorkgroupAssigned = function( worg, roomId ) {
	const self = this;
	const userList = self.worgs.getUserList( worg.cId );
	const join = {
		type : 'workgroup-join',
		data : null,
	};
	userList.forEach( accId => {
		self.emit( accId, join, roomId );
	});
}

ns.RoomCtrl.prototype.persistRoom = function( room ) {
	const self = this;
	self.roomDb.set( room.id, room.name, room.ownerId, true )
		.then( setBack )
		.catch( setErr );
	
	function setBack( res ) {
		//log( 'persistRoom - persist back', res );
	}
	
	function setErr( err ) {
		log( 'persistRoom - persist err', {
			room : room,
			err  : err,
		});
	}
}

ns.RoomCtrl.prototype.getRoom = function( rid ) {
	const self = this;
	return new Promise( getRoom );
	function getRoom( resolve, reject ) {
		let room = self.rooms[ rid ];
		if ( room ) {
			resolve( room );
			return;
		}
		
		let loading = self.roomLoads[ rid ];
		if ( loading ) {
			loading
				.then( loadingLoaded )
				.catch( loadingErr );
			return;
		}
		
		loading = new Promise( loadRoom );
		self.roomLoads[ rid ] = loading;
		loading
			.then( loadingLoaded )
			.catch( loadingErr );
			
		function loadingLoaded( room ) {
			resolve( room );
		}
		
		function loadingErr( err ) {
			reject( err );
		}
		
		function loadRoom( roomResolve, roomReject ) {
			self.roomDb.get( rid )
				.then( loaded )
				.catch( loadErr );
				
			function loaded( roomConf ) {
				if ( !roomConf ) {
					roomResolve( null );
					return;
				}
				
				roomConf.persistent = true;
				self.setRoom( roomConf )
					.then( roomOpen )
					.catch( loadErr );
					
				function roomOpen( room ) {
					delete self.roomLoads[ room.id ];
					roomResolve( room );
				}
			}
			
			function loadErr( err ) {
				log( 'getRoom - db err', {
					rid : rid,
					err : err,
				});
				roomReject( err );
			}
		}
	}
}

ns.RoomCtrl.prototype.removeRoom = function( rid ) {
	const self = this;
	const room = self.rooms[ rid ];
	if ( !room )
		return;
	
	room.close( closeBack );
	function closeBack() {
		delete self.rooms[ rid ];
		self.roomIds = Object.keys( self.rooms );
	}
}

ns.RoomCtrl.prototype.getContactRoom = async function( accId, contactId ) {
	const self = this;
	let room = null;
	let relation = null;
	let contact = await self.idCache.get( contactId );
	log( 'getContactRoom - contact', contact );
	if ( !contact ) {
		log( 'getContactRoom - no identity found for', contactId );
		return null;
	}
	
	relation = await self.getRelation( accId, contactId );
	log( 'getContactRoom - loaded relation', relation );
	if ( !relation )
		relation = await self.setRelation( accId, contactId );
	
	
	if ( !relation )
		return null;
	
	log( 'getContactRoom - relation', relation );
	if ( relation.roomId ) {
		log( 'load room' );
		room = await loadRoom( relation.roomId );
	}
	else {
		log( 'create room');
		try {
			room = await createRoom( relation.clientId, accId, contactId );
		} catch ( e ) {
			log( 'F', e );
		}
	}
	
	return room;
	
	async function loadRoom( roomId ) {
		log( 'getContactRoom.loadRoom', roomId );
		let room = await self.getRoom( roomId );
		if ( !room )
			return null;
		
		log( 'getRoom res', room );
		return room;
	}
	
	async function createRoom( relationId, accId, contactId ) {
		log( 'getContactRoom.createRoom' );
		const relation = self.relations[ relationId ];
		let room = null;
		let roomId = null;
		try {
			roomId = await self.createContactRoom( relationId );
		} catch( e ) {
			log( 'e', e );
		}
		if ( !roomId )
			return null;
		
		relation.roomId = roomId;
		room = await self.getRoom( roomId );
		log( 'getRoom res', room );
		if ( !room )
			return null;
		
		await room.setRelation( relation );
		return room;
		
		function authBack( err, res ) {
			log( 'authBack', [
				err,
				res,
			]);
		}
	}
}

ns.RoomCtrl.prototype.createContactRoom = async function( relationId ) {
	const self = this;
	log( 'createContactRoom', relationId );
	const roomId = uuid.get( 'cont' );
	let roomConf = null;
	try {
		roomConf = await self.roomDb.set(
			roomId,
			'contact-room',
			relationId,
			true,
		);
	} catch ( e ) {
		log( 'createContactRoom - db failed to create', e.stack || e );
		return null;
	}
	
	if ( !roomConf )
		return null;
	
	try {
		await self.roomDb.assignRelationRoom( relationId, roomId );
	} catch( e ) {
		log( 'createContactRoom - assignRelationRoom failed', e.stack || e );
		// TODO : DESTROY ROOM / FLAG ?
		return null;
	}
	
	log( 'createContactRoom - roomConf', roomConf );
	return roomConf.clientId;
}

ns.RoomCtrl.prototype.setRelation = async function( accIdA, accIdB ) {
	const self = this;
	log( 'setRelation', [
		accIdA,
		accIdB,
	]);
	let relation = null;
	try {
		relation = await self.roomDb.setRelation( accIdA, accIdB );
	} catch( e ) {
		log( 'setRelation - db err setting realtion', {
			accA : accIdA,
			accB : accIdB,
			err  : e.stack || e,
		});
		return null;
	}
	
	if ( !relation ) {
		log( 'setRelation - failed to set realtion for', {
			a : accIdA,
			b : accIdB,
		});
		return null;
	}
	
	log( 'setRelation - relation', relation );
	self.relations[ relation.clientId ] = relation;
	self.relationIds = Object.keys( self.relations );
	return relation;
}

ns.RoomCtrl.prototype.getRelation = async function( accIdA, accIdB ) {
	const self = this;
	let relation;
	try {
		relation = await self.roomDb.getRelation( accIdA, accIdB );
	} catch( e ) {
		log( 'getRelation - db.getRelation failed', e.stack || e );
		return null;
	}
	
	log( 'getRelation rel', relation );
	if ( !relation )
		return null;
	
	self.relations[ relation.clientId ] = relation;
	return relation || null;
}

// account

ns.RoomCtrl.prototype.loadAccount = function( accountId, callback ) {
	const self = this;
	self.accDb.getById( accountId )
		.then( loadBack )
		.catch( fail );
	
	function loadBack( acc ) {
		if ( !acc.name ) {
			callback( 'ERR_ACCOUNT_NONAME', null );
			return;
		}
		
		callback( null, acc );
	}
	
	function fail( err ) {
		callback( err, null );
	}
}

// use for real users
// dont use this for guests ( they dont have a real account anyway so will fail )
ns.RoomCtrl.prototype.authorizeForRoom = function( accId, roomId, callback ) {
	const self = this;
	log( 'authorizeForRoom', accId );
	const room = self.rooms[ roomId ];
	if ( !room ) {
		callback( 'ERR_NO_ROOM' )
		return;
	}
	
	room.authorizeUser( accId, callback );
	
}

// dont use this for real accounts, the authorization wont be persisted
ns.RoomCtrl.prototype.addToRoom = function( account, roomId, callback ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room ) {
		callback( 'ERR_NO_ROOM', null );
	}
	
	const user = {
		accountId   : account.clientId,
		accountName : account.name,
		admin       : account.admin,
		authed      : account.authed,
		guest       : account.guest,
		workgroups  : account.workgroups,
	};
	room.addUser( user, callback );
}

ns.RoomCtrl.prototype.removeFromRoom = function( accountId, roomId ) {
	const self = this;
	log( 'removeFromRoom - NYI', accountId );
}


module.exports = ns.RoomCtrl;
