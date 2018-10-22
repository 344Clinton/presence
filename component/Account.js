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

const Emitter = require( './Events' ).Emitter;
const dFace = require( './DFace' );
const uuid = require( './UuidPrefix' )( '' );
const util = require( 'util' );

var ns = {};

/*
	ACCOUNT CONSTRUCTOR RETURNS A PROMISE
	dealwithit.jpg
*/
ns.Account = function(
	session,
	conf,
	dbPool,
	idCache,
	roomCtrl,
	worgCtrl,
) {
	const self = this;
	self.id = conf.clientId;
	self.login = conf.login;
	self.auth = conf.auth || {};
	self.identity = conf.identity;
	self.settings = conf.settings;
	self.session = session;
	self.dbPool = dbPool;
	self.idCache = idCache;
	self.roomCtrl = roomCtrl;
	self.worgCtrl = worgCtrl;
	
	self.rooms = null;
	self.contacts = {};
	self.contactIds = [];
	self.relations = {};
	
	return new Promise(( resolve, reject ) => {
		self.init()
			.then( initDone )
			.catch( initOpps );
		
		function initDone() {
			self.log( 'initDone' );
			resolve( self );
		}
		
		function initOpps( err ) {}
	});
}

// Public

ns.Account.prototype.close = function() {
	const self = this;
	self.logout( outBack );
	function outBack() {
		delete self.dbPool;
		delete self.idCache;
		delete self.roomCtrl;
		delete self.worgCtrl;
		delete self.onclose;
		delete self.contacts;
		delete self.contactIds;
		delete self.relations;
	}
}

ns.Account.prototype.getWorkgroups = function() {
	const self = this;
	if ( !self.worgCtrl )
		return null;
	
	return self.worgCtrl.get( self.id );
}

ns.Account.prototype.getContactList = function() {
	const self = this;
	return self.contactIds;
}

ns.Account.prototype.updateContactList = function( contacts ) {
	const self = this;
	contacts.forEach( id => self.addContact( id ));
}

ns.Account.prototype.addContact = function( identity ) {
	const self = this;
	const cId = identity.clientId;
	if ( cId === self.id )
		return;
	
	if ( self.contacts[ cId ])
		return;
	
	const contact = {
		clientId : cId,
		identity : identity,
		relation : self.relations[ cId ] || {},
	};
	
	self.rooms.listen( cId, contactEvent );
	self.contacts[ cId ] = contact;
	self.contactIds.push( cId );
	const cAdd = {
		type : 'contact-add',
		data : contact,
	};
	self.session.send( cAdd );
	
	function contactEvent( event ) {
		let contactId = cId;
		self.handleContactListen( event, contactId );
	}
}

ns.Account.prototype.removeContact = function( contactId ) {
	const self = this;
	self.log( 'removeContact', contactId );
	if ( self.relations[ contactId ])
		return;
	
	if ( !self.contacts[ contactId ])
		return;
	
	delete self.contacts[ contactId ];
	self.contactIds = Object.keys( self.contacts );
	const cRemove = {
		type : 'contact-remove',
		data : contactId,
	};
	self.session.send( cRemove );
}

ns.Account.prototype.updateContactStatus = function( contactId, type, value ) {
	const self = this;
	const event = {
		type : type,
		data : value,
	};
	
	self.sendContactEvent( contactId, event );
}

// Private

ns.Account.prototype.init = async function() {
	const self = this;
	// prepare 'personalized' logging
	var logStr = 'Account-' + self.login;
	self.log = require( './Log' )( logStr );
	
	self.roomCtrl.on( self.id, roomCtrlEvent );
	self.roomCtrlEvents = {
		'workgroup-join' : worgJoin,
		'contact-join'   : contactJoin,
		'contact-event'  : contactRoomEvent,
	};
	
	self.setIdentity();
	
	self.clientContactEvents = {
		'start' : startContactChat,
	};
	
	//
	self.session.on( 'initialize', init );
	self.session.on( 'identity', identity );
	self.session.on( 'settings', handleSettings );
	self.session.on( 'room', handleRoomMsg );
	self.session.on( 'join', joinRoom );
	self.session.on( 'create', createRoom );
	self.session.on( 'contact', handleContact );
	
	// rooms is a collection of chat rooms
	self.rooms = new ns.Rooms( self.session );
	self.rooms.on( 'close', roomClosed );
	//self.rooms.on( 'join', joinedRoom );
	//self.rooms.on( 'leave', leftRoom );
	
	await self.loadRooms();
	await self.loadRelations();
	await self.loadContacts();
	
	return true;
	
	function roomCtrlEvent( e, rid ) { self.handleRoomCtrlEvent( e, rid ); }
	function worgJoin( e, rid ) { self.handleWorkgroupJoin( e, rid ); }
	function contactJoin( e, rid ) { self.openContactChat( e, rid ); }
	function contactRoomEvent( e, rid ) { self.handleContactRoomEvent( e, rid ); }
	
	
	function init( e, cid ) { self.initializeClient( e, cid ); }
	function identity( e, cid ) { self.updateIdentity( e, cid ); }
	function handleSettings( e, cid ) { self.handleSettings( e, cid ); }
	function handleRoomMsg( e, cid ) { self.log( 'roomMsg', msg ); }
	function joinRoom( e, cid ) { self.joinRoom( e, cid ); }
	function createRoom( e, cid ) { self.createRoom( e, cid ); }
	function handleContact( e, cid ) { self.handleContactEvent( e, cid ); }
	
	function startContactChat( e, cId ) { self.handleStartContactChat( e, cId ); }
	
	function roomClosed( e ) { self.handleRoomClosed( e ); }
	//function joinedRoom( e, rid ) { self.handleJoinedRoom( e, rid ); }
	//function leftRoom( e, rid ) { self.handleLeftRoom( e, rid ); }
}

ns.Account.prototype.handleRoomCtrlEvent = function( event, roomId ) {
	const self = this;
	self.log( 'handleRoomCtrlEvent', [
		event,
		roomId,
	]);
	const handler = self.roomCtrlEvents[ event.type ];
	if ( !handler ) {
		self.log( 'handleRoomCtrlEvent - no handler for', event );
		return;
	}
	
	handler( event.data, roomId );
}

ns.Account.prototype.handleWorkgroupJoin = async function( event, roomId ) {
	const self = this;
	self.log( 'handleWorkgorupJoin', roomId );
	if ( self.rooms.isParticipant( roomId )) {
		self.log( 'handleWorkgroupJoin - is participant', roomId );
		return;
	}
	
	const account = self.buildRoomAccount();
	let room = null;
	room = await self.roomCtrl.connectWorkgroup( account, roomId );
	if ( !room )
		return;
	
	await self.joinedARoomHooray( room );
	return true;
}

ns.Account.prototype.openContactChat = async function( event, contactId ) {
	const self = this;
	self.log( 'openContactChat', [
		event,
		contactId,
	]);
	if ( !contactId )
		return;
	
	let room = self.rooms.get( contactId );
	if ( room ) {
		self.log( 'openContactChat - already in room', contactId );
		sendOpen();
		return room;
	}
	
	room = await self.roomCtrl.connectContact( self.id, contactId );
	if ( !room ) {
		self.log( 'openContactChat - failed to connect to room', contactId );
		return null;
	}
	
	self.relations[ contactId ] = true;
	await self.joinedARoomHooray( room );
	sendOpen();
	return room;
	
	function sendOpen() {
		const open = {
			type : 'open',
			data : true,
		};
		self.log( 'openContactChat - send open' );
		room.send( open );
	}
}

ns.Account.prototype.handleContactRoomEvent = function( event, contactId ) {
	const self = this;
	self.log( 'handleContactRoomEvent', {
		e : event,
		r : contactId,
	});
	
}

ns.Account.prototype.handleWorkgroupAssigned = function( addedWorg, roomId ) {
	const self = this;
	
}

ns.Account.prototype.initializeClient = function( event, clientId ) {
	const self = this;
	const state = {
		type : 'initialize',
		data : {
			account  : {
				host     : global.config.shared.wsHost,
				clientId : self.id,
				login    : self.login,
				name     : self.identity.name,
				auth     : self.auth,
			},
			rooms    : self.rooms.getRooms(),
			contacts : self.contacts,
		},
	};
	self.session.send( state, clientId );
	if ( self.initialized )
		return;
	
	self.initialized = true;
}

ns.Account.prototype.setIdentity = function( id ) {
	const self = this;
	id = id || self.identity || {};
	let name = id.name || id.alias;
	let avatar = id.avatar || self.settings.avatar;
	if ( !avatar ) {
		const tinyAvatar = require( './TinyAvatar' );
		avatar = tinyAvatar.generate( name )
			.then( res => setId( res ))
			.catch( err => setId( null ));
	} else
		setId( avatar );
	
	function setId( avatar ) {
		avatar = avatar || '';
		self.identity = {
			clientId : self.id,
			name     : name,
			avatar   : avatar,
			email    : id.email,
		};
		
		updateDb( self.identity.name );
	}
	
	function updateDb( name ) {
		const accDb = new dFace.AccountDB( self.dbPool );
		accDb.updateName( self.id, name )
			.then( nameOK )
			.catch( nameErr );
			
		function nameOK( res ) {
			//self.log( 'updateIdentity nameOK', res, 3 );
		}
		
		function nameErr( err ) {
			if ( !err )
				return;
			
			self.log( 'updateIdentity nameErr', err.stack || err );
		}
	}
}

ns.Account.prototype.updateIdentity = function( id, cid ) {
	const self = this;
	const name = id.name || id.alias || '';
	self.setIdentity( id );
}

ns.Account.prototype.handleSettings = function( msg, cid ) {
	const self = this;
	self.log( 'handleSettings - NYI', msg );
}

ns.Account.prototype.loadRooms = async function() {
	const self = this;
	const roomDb = new dFace.RoomDB( self.dbPool );
	const memberWorgs = self.worgCtrl.getMemberOfAsFID( self.id );
	let list = null;
	try {
		list = await roomDb.getForAccount( self.id, memberWorgs );
	} catch( e ) {
		self.log( 'loadRooms - failed to load room list' );
		return false;
	}
	
	self.log( 'loadRooms', list );
	await Promise.all( list.map( await connect ));
	return true;
	
	async function connect( roomConf ) {
		const account = self.buildRoomAccount();
		let room = null;
		if ( roomConf.wgs )
			room = await self.roomCtrl.connectWorkgroup( account, roomConf.clientId );
		else
			room = await self.roomCtrl.connect( account, roomConf.clientId );
		
		if ( !room )
			return false;
		
		await self.joinedARoomHooray( room );
		return true;
	}
}

ns.Account.prototype.loadRelations = async function() {
	const self = this;
	const roomDb = new dFace.RoomDB( self.dbPool );
	const msgDb = new dFace.MessageDB( self.dbPool );
	let dbRelations = null;
	try {
		dbRelations = await roomDb.getRelationsFor( self.id );
	} catch( e ) {
		self.log( 'loadRelations - db err', e.stack || e );
		return;
	}
	
	self.log( 'loadRelations', dbRelations );
	await Promise.all( dbRelations.map( await setRelation ));
	const contactList = dbRelations.map( rel => rel.contactId );
	const newList = contactList.filter( notInContacts );
	if ( !newList.length )
		return;
	
	const identityList = await self.idCache.getList( newList );
	self.updateContactList( identityList );
	try {
		dbRelations.forEach( checkRoomAvailability );
	} catch ( err ) {
		self.log( 'blah', err );
	}
	
	return true;
	
	function notInContacts( cId ) {
		return !self.contacts[ cId ];
	}
	
	async function setRelation( relation ) {
		let rId = relation.relationId;
		let cId = relation.contactId;
		if ( self.relations[ cId ])
			return;
		
		let state = await msgDb.getRelationState( rId, cId );
		if ( !state ) {
			self.relations[ cId ] = true;
			return;
		}
		
		self.relations[ cId ] = state;
	}
	
	async function checkRoomAvailability( rel ) {
		const roomId = rel.roomId;
		const isActive = self.roomCtrl.checkActive( roomId );
		self.log( 'checkRoomAvailability', {
			roomId   : roomId,
			isActive : isActive,
		});
		
		if ( !isActive )
			return;
		
		self.openContactChat( null, rel.contactId );
	}
}

ns.Account.prototype.loadContacts = async function() {
	const self = this;
	let contactIds = self.worgCtrl.getContactList( self.id );
	contactIds = contactIds.filter( notLoaded );
	const identities = await self.idCache.getList( contactIds );
	self.updateContactList( identities );
	return true;
	
	function notLoaded( cId ) {
		return !self.contacts[ cId ];
	}
}

ns.Account.prototype.joinRoom = function( conf, cid ) {
	const self = this;
	const account = self.buildRoomAccount();
	self.roomCtrl.joinRoom( account, conf.invite, roomBack );
	function roomBack( err, room ) {
		if ( err || !room ) {
			self.log( 'failed to join a room', {
				err  : err.stack || err,
				room : room,
				conf : conf, }, 4 );
			return;
		}
		
		self.joinedARoomHooray( room, conf.req );
	}
}

ns.Account.prototype.createRoom = function( conf, cid ) {
	const self = this;
	conf = conf || {};
	const account = self.buildRoomAccount();
	self.roomCtrl.createRoom( account, conf, roomBack );
	function roomBack( err, room ) {
		if ( err || !room ) {
			self.log( 'failed to set up a room', {
				err  : err.stack || err,
				room : room,
				conf : conf,
			}, 4 );
			return;
		}
		
		self.joinedARoomHooray( room, conf.req );
	}
}

ns.Account.prototype.connectedRoom = async function( room ) {
	const self = this;
	const connected = {
		type : 'connect',
		data : {
			clientId   : room.roomId,
			persistent : room.persistent,
			name       : room.roomName,
		},
	};
	let sendRes = await self.session.send( connected );
	self.rooms.add( room );
	room.setIdentity( self.identity );
}

ns.Account.prototype.joinedARoomHooray = async function( room, reqId  ) {
	const self = this;
	self.log( 'joinedARoomHooray' );
	if ( !room ) {
		self.log( 'joinedARoom - didnt join a room', room );
		return;
	}
	
	var res = {
		clientId    : room.roomId,
		persistent  : room.persistent,
		name        : room.roomName,
		isPrivate   : room.isPrivate,
		req         : reqId,
	};
	var joined = {
		type : 'join',
		data : res,
	};
	
	await self.session.send( joined );
	self.rooms.add( room );
	room.setIdentity( self.identity );
}

ns.Account.prototype.buildRoomAccount = function() {
	const self = this;
	return {
		clientId   : self.id,
		name       : self.identity.name,
		avatar     : self.identity.avatar,
		admin      : self.auth.isAdmin,
	};
}

ns.Account.prototype.handleRoomClosed = function( roomId ) {
	const self = this;
	self.log( 'handleRoomClosed', roomId );
	if ( self.contacts[ roomId ])
		return;
	
	const close = {
		type : 'close',
		data : roomId,
	};
	self.session.send( close );
}

ns.Account.prototype.handleContactListen = async function( event, contactId ) {
	const self = this;
	self.log( 'handleContactListen', [
		event,
		contactId,
	]);
	let room = await self.openContactChat( null, contactId );
	if ( !room ) {
		self.log( 'handleContactListen - could not room', contactId );
		return null;
	}
	
	room.toRoom( event );
}

ns.Account.prototype.handleContactEvent = function( event, clientId ) {
	const self = this;
	self.log( 'handleContact', [
		event,
		clientId,
	]);
	let handler = self.clientContactEvents[ event.type ];
	if ( !handler )
		return;
	
	handler( event.data, clientId );
}

ns.Account.prototype.sendContactEvent = function( contactId, event ) {
	const self = this;
	const wrap = {
		type : 'contact-event',
		data : {
			contactId : contactId,
			event     : event,
		},
	};
	self.session.send( wrap );
}

ns.Account.prototype.handleStartContactChat = async function( contactId, clientId ) {
	const self = this;
	self.log( 'handleStartContactChat', contactId );
	if ( self.contacts[ contactId ])
		return;
	
	const identity = await self.idCache.get( contactId );
	self.addContact( identity );
}

ns.Account.prototype.someContactFnNotInUse = async function( event, clientId ) {
	const self = this;
	self.log( 'someContactFnNotInUse', event );
	const contactId = event.clientId;
	const room = self.rooms.get( contactId );
	if ( room )
		return room;
	
	const contact = await self.roomCtrl.connectContact( self.id, contactId );
	if ( !contact )
		return;
	
	await self.joinedARoomHooray( contact );
	return contact;
}

ns.Account.prototype.logout = function( callback ) {
	const self = this;
	if ( self.roomCtrl )
		self.roomCtrl.release( self.id );
	
	if ( self.rooms )
		self.rooms.close();
	
	if ( self.session )
		self.session.close();
	
	delete self.roomCtrl;
	delete self.rooms;
	delete self.session;
	
	if ( callback )
		callback();
}

// ROOMS

const rlog = require( './Log' )( 'account > rooms' );

ns.Rooms = function( session ) {
	const self = this;
	Emitter.call( self );
	self.session = session;
	
	self.rooms = {};
	self.list = [];
	
	self.init();
}

util.inherits( ns.Rooms, Emitter );

// Public

ns.Rooms.prototype.send = function( event, roomId ) {
	const self = this;
	var room = self.rooms[ roomId ];
	if ( !room )
		return;
	
	room.toRoom( event );
}

ns.Rooms.prototype.isParticipant = function( roomId ) {
	const self = this;
	return !!self.rooms[ roomId ];
}

ns.Rooms.prototype.listen = function( roomId, callback ) {
	const self = this;
	self.session.once( roomId, callback );
}

ns.Rooms.prototype.add = function( room ) {
	const self = this;
	const rid = room.roomId;
	if ( self.rooms[ rid ]) {
		rlog( 'add - already added', rid );
		return;
	}
	
	self.rooms[ rid ] = room;
	self.list.push( rid );
	self.session.on( rid, fromClient );
	room.setToAccount( fromRoom );
	room.setOnclose( onClose );
	function fromRoom( e ) { self.handleRoomEvent( e, rid ); }
	function fromClient( e ) { self.handleClientEvent( e, rid ); }
	function onClose( e ) { self.handleRoomClosed( rid ); }
}

ns.Rooms.prototype.get = function( roomId ) {
	const self = this;
	return self.rooms[ roomId ] || null;
}

ns.Rooms.prototype.remove = function( roomId ) {
	const self = this;
	const rid = roomId;
	self.session.release( rid );
	const room = self.rooms[ rid ];
	if ( !room )
		return null;
	
	delete self.rooms[ rid ];
	self.list = Object.keys( self.rooms );
}

ns.Rooms.prototype.getRooms = function() {
	const self = this;
	const rooms = self.list
		.map( roomConf )
		.filter( conf => !!conf );
		
	return rooms;
	
	function roomConf( rid ) {
		const room = self.rooms[ rid ];
		if ( room.isPrivate )
			return null;
		
		return {
			clientId   : rid,
			persistent : room.persistent,
			name       : room.roomName,
		};
	}
}

ns.Rooms.prototype.close = function() {
	const self = this;
	self.release();
	releaseClients();
	leaveRooms();
	
	delete self.session;
	self.rooms = {};
	
	function releaseClients() {
		for( const rid in self.rooms )
			self.session.release( rid );
	}
	
	function leaveRooms() {
		if ( !self.rooms )
			return;
		
		for ( const rid in self.rooms )
			self.rooms[ rid ].disconnect();
	}
}

// Private

ns.Rooms.prototype.init = function() {
	const self = this;
	
}

ns.Rooms.prototype.handleRoomEvent = function( event, roomId ) {
	const self = this;
	// TODO : use EventNode
	var res = self.emit( event.type, event.data, roomId );
	if ( null == res ) // event was sent
		return;
	
	// noone want this event.. lets package and send to clients
	const eventWrap = {
		type : roomId,
		data : event,
	};
	self.session.send( eventWrap );
}

ns.Rooms.prototype.handleClientEvent = function( event, roomId ) {
	const self = this;
	const room = self.rooms[ roomId ];
	if ( !room ) {
		rlog( 'no room for event', {
			e : event,
			r : roomId,
		});
		return;
	}
	
	room.toRoom( event );
}

ns.Rooms.prototype.handleRoomClosed = function( roomId ) {
	const self = this;
	self.remove( roomId );
	self.emit( 'close', roomId );
}

module.exports = ns.Account;
