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

const log = require( './Log' )( 'Room' );
const uuid = require( './UuidPrefix' )( 'msg' );
const Emitter = require( './Events' ).Emitter;
const WebRTCProxy = require( './WebRTCProxy' );
const components = require( './RoomComponents' );
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const util = require( 'util' );

var ns = {};


/* Room

*/
ns.Room = function( conf, db, idCache, worgCtrl ) {
	const self = this;
	if ( !conf.clientId )
		throw new Error( 'Room - clientId missing' );
	
	log( 'conf', conf );
	self.id = conf.clientId;
	self.ownerId = conf.ownerId;
	self.name = conf.name || null;
	self.isPrivate = conf.isPrivate;
	self.persistent = conf.persistent || false;
	self.guestAvatar = conf.guestAvatar;
	self.dbPool = db;
	self.idCache = idCache;
	
	self.open = false;
	self.invite = null;
	self.log = null;
	self.chat = null;
	self.live = null;
	self.worgs = null;
	self.settings = null;
	self.users = {};
	self.identities = {};
	self.onlineList = [];
	self.authorized = [];
	self.accessKey = null;
	self.roomDb = null;
	self.emptyTimeout = 1000 * 20;
	self.emptyTimer = null;
	
	Emitter.call( self );
	
	self.init( worgCtrl );
}

util.inherits( ns.Room, Emitter );

// Public

// when users come online
ns.Room.prototype.connect = function( account ) {
	const self = this;
	const signal = self.bindUser( account );
	if ( self.emptyTimer ) {
		clearTimeout( self.emptyTimer );
		self.emptyTimer = null;
	}
	
	return signal;
}

// when user goes offline
ns.Room.prototype.disconnect = function( accountId ) {
	const self = this;
	if ( isAuthorized( accountId ))
		self.releaseUser( accountId );
	else
		self.removeUser( accountId );
	
	function isAuthorized( accId ) {
		return self.authorized.some( authId => authId === accId );
	}
}

// for real accounts, not for guests
// authorizes an account to connect to this room
ns.Room.prototype.authorizeUser = function( userId, callback ) {
	const self = this;
	self.persistAuthorization( userId );
	if ( callback )
		callback( null, userId );
}

// add to users list, they can now .connect()
ns.Room.prototype.addUser = function( user, callback ) {
	const self = this;
	// add to users
	const uid = user.accountId;
	if ( self.users[ uid ]) {
		callback( null, uid );
		return;
	}
	
	if ( !self.persistent && !user.guest )
		user.authed = true;
	
	self.users[ uid ] = user;
	
	if ( !user.avatar && !user.guest ) {
		self.idCache.get( uid )
			.then( id => {
				setAvatar( id.avatar );
			}).catch( err => {
				setAvatar( '' );
			});
	} else
		announceUser( user );
	
	function setAvatar( pngStr ) {
		user.avatar = pngStr;
		announceUser( user );
	}
	
	function announceUser( user ) {
		// tell peoples
		const aId = user.accountId;
		const joinEvent = {
			type : 'join',
			data : {
				clientId   : aId,
				name       : user.accountName,
				avatar     : user.avatar,
				owner      : user.accountId === self.ownerId,
				admin      : user.admin || undefined,
				authed     : user.authed || undefined,
				guest      : user.guest || undefined,
				workgroups : self.worgs.getUserWorkgroupList( aId ),
			},
		};
		self.broadcast( joinEvent, uid );
		callback( null, uid );
	}
}

// 
ns.Room.prototype.removeUser = function( accountId ) {
	const self = this;
	const user = self.users[ accountId ];
	if ( !user ) {
		log( 'removeUser - invalid user', {
			aid : accountId,
			usr : self.users,
		}, 3 );
		return false;
	}
	
	// unbind / set offline
	self.releaseUser( accountId );
	
	// remove
	if ( user.guest )
		self.removeIdentity( accountId );
	
	delete self.users[ accountId ];
	self.revokeAuthorization( accountId );
	
	// tell everyone
	const leave = {
		type : 'leave',
		data : accountId,
	};
	self.broadcast( leave, accountId );
	if ( user.close )
		user.close();
	
	return true;
}

ns.Room.prototype.authenticateInvite = async function( token ) {
	const self = this;
	let valid = false;
	try {
		valid = await self.invite.authenticate( token );
	} catch ( e ) {
		log( 'authenticateInvite - failed', e );
	}
	return valid;
}

ns.Room.prototype.close = function( callback ) {
	const self = this;
	self.open = false;
	if ( self.roomDb )
		self.roomDb.close();
	
	if ( self.live )
		self.live.close();
	
	if ( self.invite )
		self.invite.close();
	
	if ( self.chat )
		self.chat.close();
	
	if ( self.log )
		self.log.close();
	
	if ( self.worgs )
		self.worgs.close();
	
	if ( self.settings )
		self.settings.close();
	
	self.emitterClose();
	
	delete self.live;
	delete self.invite;
	delete self.chat;
	delete self.log;
	delete self.worgs;
	delete self.settings;
	
	self.onlineList.forEach( release );
	delete self.onlineList;
	delete self.authorized;
	delete self.users;
	
	delete self.idCache;
	delete self.dbPool;
	delete self.onempty;
	
	if ( callback )
		callback();
	
	function release( uid ) { self.releaseUser( uid ); }
}

// Private

ns.Room.prototype.init = function( worgCtrl ) {
	const self = this;
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	
	self.settings = new components.Settings(
		self.dbPool,
		worgCtrl,
		self.id,
		self.users,
		self.onlineList,
		self.persistent,
		self.name,
		settingsDone
	);
	
	self.settings.on( 'roomName', roomName );
	function roomName( e ) { self.handleRename( e ); }
	
	function settingsDone( err , res ) {
		self.worgs = new components.Workgroup(
			worgCtrl,
			self.dbPool,
			self.id,
			self.users,
			self.onlineList,
			self.settings,
		);
		self.worgs.on( 'remove-user', removeUser );
		self.worgs.on( 'dismissed', worgDismissed );
		self.worgs.on( 'assigned', worgAssigned );
		
		function removeUser( userId ){ self.removeUser( userId ); }
		function worgDismissed( e ) { self.handleWorkgroupDismissed( e ); }
		function worgAssigned( e ) { self.emit( 'workgroup-assigned', e ); }
		
		self.log = new components.Log(
			self.dbPool,
			self.id,
			self.users,
			self.idCache,
			self.persistent,
		);
		
		self.invite = new components.Invite(
			self.dbPool,
			self.id,
			self.users,
			self.onlineList,
			self.persistent
		);
		
		self.chat = new components.Chat(
			self.id,
			self.users,
			self.onlineList,
			self.log
		);
		
		self.live = new components.Live(
			self.users,
			self.onlineList,
			self.log,
			self.worgs,
			self.settings
		);
		
		if ( self.persistent )
			self.loadUsers();
		else
			self.setOpen();
		
	}
}

ns.Room.prototype.handleWorkgroupDismissed = function( worg ) {
	const self = this;
	self.emit( 'workgroup-dismissed', worg );
}

ns.Room.prototype.setOpen = function() {
	const self = this;
	self.open = true;
	setTimeout( emitOpen, 1 );
	function emitOpen() {
		self.emit( 'open', Date.now());
	}
}

ns.Room.prototype.loadUsers = function() {
	const self = this;
	self.userLoads = {};
	self.roomDb.loadAuthorizations( self.id )
		.then( authBack )
		.catch( loadFailed );
	
	function authBack( rows ) {
		if ( !rows || !rows.length )
			self.setOpen();
		else
			addUsers( rows );
	}
	
	function loadFailed( err ) {
		log( 'loadAuthorizations - load failed', {
			e : err,
			s : err.stack,
		});
	}
	
	function addUsers( users ) {
		const tinyAvatar = require( './TinyAvatar' );
		users.forEach( add );
		
		function add( dbUser, index ) {
			const uid = dbUser.clientId;
			self.authorized.push( uid );
			self.userLoads[ uid ] = true;
			if ( self.users[ uid ])
				return;
			
			if ( !dbUser.avatar )
				self.idCache.get( uid )
					.then( id => {
						setUser( id.avatar );
					}).catch( err => setUser( null ));
			else
				setUser( dbUser.avatar );
			
			function setUser( avatar ) {
				avatar = avatar || '';
				const user = {
					accountId   : uid,
					accountName : dbUser.name,
					avatar      : avatar,
					authed      : true,
				};
				
				self.users[ uid ] = user;
				isLoaded( uid );
			}
		}
	}
	
	function isLoaded( uid ) {
		self.userLoads[ uid ] = false;
		const ids = Object.keys( self.userLoads );
		const allDone = ids.every( id => !self.userLoads[ id ] )
		if ( !allDone )
			return;
		
		self.setOpen();
	}
}

ns.Room.prototype.checkOnline = function() {
	const self = this;
	if ( 0 !== self.onlineList.length )
		return;
	
	if ( self.emptyTimer )
		return;
	
	self.emptyTimer = setTimeout( roomIsEmpty, self.emptyTimeout );
	function roomIsEmpty() {
		self.emptyTimer = null;
		if ( 0 !== self.onlineList.length )
			return; // someone joined during the timer. Lets not then, i guess
		
		self.emit( 'empty', Date.now());
		//self.onempty();
	}
}

// room events

ns.Room.prototype.bindUser = function( account ) {
	const self = this;
	const userId = account.clientId;
	const conf = self.users[ userId ];
	if ( !conf ) {
		log( 'bindUSer - no user for id', {
			roomId : self.id,
			userId : userId,
			users  : self.users,
		}, 4 );
		try {
			throw new Error( 'blah' );
		} catch( e ) {
			log( 'trace', e.stack || e );
		}
		return null;
	}
	
	if ( conf.close ) {
		log( 'bindUser - user already bound', {
			userId : userId,
			online  : self.onlineList,
		}, 4 );
		return conf;
	}
	
	// removing basic user obj
	delete self.users[ userId ];
	
	// add signal user obj
	const sigConf = {
		roomId      : self.id,
		roomName    : self.name,
		isPrivate   : self.isPrivate,
		persistent  : self.persistent,
		accountId   : conf.accountId,
		accountName : conf.accountName,
		avatar      : conf.avatar,
		owner       : conf.accountId === self.ownerId,
		admin       : account.admin, // <-- using account
		authed      : account.authed || conf.authed || false,
		guest       : conf.guest,
	};
	const user = new Signal( sigConf );
	self.users[ userId ] = user;
	
	// bind room events
	user.on( 'initialize', init );
	user.on( 'persist', persist );
	user.on( 'identity', identity );
	user.on( 'disconnect', goOffline );
	user.on( 'leave', leaveRoom );
	user.on( 'live-join', joinLive );
	user.on( 'live-leave', leaveLive );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function persist( e ) { self.handlePersist( e, uid ); }
	function identity( e ) { self.setIdentity( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function leaveRoom( e ) { self.handleLeave( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	
	// add to components
	self.invite.bind( userId );
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	// show online
	self.setOnline( userId );
	return user;
}

ns.Room.prototype.initialize =  function( requestId, userId ) {
	const self = this;
	const state = {
		id          : self.id,
		name        : self.name,
		ownerId     : self.ownerId,
		persistent  : self.persistent,
		settings    : self.settings.get(),
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers(),
		online      : self.onlineList,
		identities  : self.identities,
		peers       : self.live.peerIds,
		workgroups  : self.worgs.getAssigned(),
		lastMessage : self.log.getLast( 1 )[ 0 ],
	};
	
	const init = {
		type : 'initialize',
		data : state,
	};
	
	self.send( init, userId );
	
	function buildBaseUsers() {
		const users = {};
		const uIds = Object.keys( self.users );
		uIds.forEach( build );
		return users;
		
		function build( uid ) {
			const user = self.users[ uid ];
			if ( !user )
				return undefined;
			
			let aId = user.accountId;
			users[ aId ] = {
				clientId   : aId,
				name       : user.accountName,
				avatar     : user.avatar,
				admin      : user.admin,
				authed     : user.authed,
				guest      : user.guest,
				workgroups : self.worgs.getUserWorkgroupList( aId ),
			};
		}
	}
}

ns.Room.prototype.handlePersist = function( event, userId ) {
	const self = this;
	if ( self.persistent )
		return;
	
	if ( !event.name || !event.name.length )
		return;
	
	self.persistent = true;
	self.name = event.name;
	self.persistRoom( persistBack );
	function persistBack( res ) {
		if ( !res )
			return;
		
		self.settings.setPersistent( true, self.name );
		self.log.setPersistent( true );
		self.invite.setPersistent( true );
		self.onlineList.forEach( update );
		function update( userId ) {
			const user = self.users[ userId ];
			if ( !user || !user.setRoomPersistent )
				return;
			
			user.setRoomPersistent( true, event.name );
		}
	}
	
}

ns.Room.prototype.persistRoom = function( callback ) {
	const self = this;
	self.roomDb.set(
		self.id,
		self.name,
		self.ownerId
	)
		.then( roomOk )
		.catch( err );
		
	function roomOk( res ) {
		persistAuths();
	}
	
	function persistAuths() {
		const userIds = Object.keys( self.users );
		const accIds = userIds.filter( notGuest );
		self.authorized = accIds;
		self.authorized.forEach( updateClients );
		self.roomDb.authorize( self.id, accIds )
			.then( authSet )
			.catch( err );
	}
	
	function notGuest( uid ) {
		const user = self.users[ uid ];
		return !user.guest;
	}
	
	function authSet( res ) {
		callback( true );
	}
	
	function err( err ) {
		log( 'persistRoom err', err );
		callback( null );
	}
	
	function updateClients( userId ) {
		self.updateUserAuthorized( true, userId );
	}
}

ns.Room.prototype.persistAuthorization = function( userId ) {
	const self = this;
	const accIds = [ userId ];
	self.roomDb.authorize( self.id, accIds )
		.then( authorized )
		.catch( authFailed );
		
	function authorized( res ) {
		self.authorized.push( userId );
	}
	
	function authFailed( err ) {
		log( 'persistAuthorization - authFailed', err.stack || err );
	}
}

ns.Room.prototype.revokeAuthorization = function( userId, callback ) {
	const self = this;
	self.roomDb.revoke( self.id, userId )
	.then( revokeDone )
	.catch( revokeFailed );
	
	function revokeDone( res ) {
		self.authorized = self.authorized.filter( uid => userId !== uid );
		done( null, res );
	}
	
	function revokeFailed( err ) {
		log( 'revokeAuthorization - err', err.stack || err );
		done( err, null );
	}
	
	function done( err, res ) {
		const user = self.users[ userId ];
		if ( user )
			user.authed = false;
		
		if ( callback )
			callback( err, userId );
	}
}

// tell the user / client, it has been authorized for this room
ns.Room.prototype.updateUserAuthorized = function( isAuthed, userId ) {
	const self = this;
	const user = self.users[ userId ];
	user.setIsAuthed( isAuthed );
}

ns.Room.prototype.handleRename = function( name, userId ) {
	const self = this;
	self.name = name;
}

ns.Room.prototype.setIdentity = function( id, userId ) {
	const self = this;
	if ( id.clientId !== userId ) {
		log( 'setIdentity - clientId does not match userId', {
			id     : id,
			userId : userId,
		});
		return;
	}
	const user = self.users[ userId ];
	if ( user && user.guest )
		user.accountName = id.name;
	
	self.identities[ userId ] = id;
	const uptd = {
		type : 'identity',
		data : {
			userId   : userId,
			identity : id,
		},
	};
	self.broadcast( uptd );
}

ns.Room.prototype.removeIdentity = function( userId ) {
	const self = this;
	delete self.identities[ userId ];
	// TODO, tell clientS? eh.. v0v
}

// cleans up a users signal connection to this room
ns.Room.prototype.releaseUser = function( userId ) {
	const self = this;
	var user = self.users[ userId ];
	if ( !user ) {
		log( 'releaseUser - no user', {
			u : userId,
			users : Object.keys( self.users ),
		}, 3 );
		return;
	}
	
	if ( !user.close ) // not signal, so not bound
		return;
	
	self.live.remove( userId );
	
	self.setOffline( userId );
	// no need to release each event, .release() is magic
	user.release();
	user.close();
	self.checkOnline();
}

ns.Room.prototype.setOnline = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return null;
	
	self.onlineList.push( userId );
	const online = {
		type : 'online',
		data : {
			clientId   : userId,
			admin      : user.admin || false,
			authed     : user.authed || false,
			workgroups : self.worgs.getUserWorkgroupList( userId ),
		}
	};
	self.broadcast( online );
	return user;
}

ns.Room.prototype.setOffline = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	
	// deleteing signal
	delete self.users[ userId ];
	// adding basic obj
	self.users[ userId ] = {
		accountId    : user.accountId,
		accountName  : user.accountName,
		avatar       : user.avatar,
		admin        : user.admin,
		authed       : user.authed,
		guest        : user.guest,
	};
	
	const userIndex = self.onlineList.indexOf( userId );
	if ( -1 !== userIndex ) {
		let removed = self.onlineList.splice( userIndex, 1 );
	}
	
	const offline = {
		type : 'offline',
		data : userId,
	};
	self.broadcast( offline );
}

// peer things

ns.Room.prototype.handleLeave = function( uid ) {
	const self = this;
	// check if user is authorized, if so, remove
	self.roomDb.check( uid )
		.then( authBack )
		.catch( leaveErr );
		
	function authBack( isAuthorized ) {
		if ( isAuthorized )
			self.revokeAuthorization( uid, revokeBack );
		else {
			const user = self.users[ uid ];
			user.authed = false;
			checkHasWorkgroup( uid );
		}
	}
	
	function revokeBack( err, revokeUid ) {
		if ( err ) {
			leaveErr( err );
			return;
		}
		
		checkHasWorkgroup( uid );
	}
	
	function checkHasWorkgroup( uid ) {
		// check if user is in a workgroup assigned to this room
		// if so, dont close connection and move user to workgroup ( in ui )
		// else close
		const user = self.users[ uid ];
		if ( !user )
			return;
		
		let ass = self.worgs.getAssignedForUser( uid );
		if ( !ass || !ass.length )
			disconnect( uid );
		else
			showInWorkgroup( uid, ass[ 0 ]);
	}
	
	function showInWorkgroup( uid, wg ) {
		const authed = {
			type : 'authed',
			data : {
				userId   : uid,
				worgId   : wg,
				authed   : user.authed,
			},
		};
		self.broadcast( authed );
	}
	
	function disconnect( uid ) {
		self.removeUser( uid );
	}
	
	function leaveErr( err ) {
		log( 'handleLeave auth check err', err );
		self.removeUser( uid );
	}
}

ns.Room.prototype.handleJoinLive = function( event, uid ) {
	const self = this;
	var user = self.users[ uid ];
	if ( !user ) {
		log( 'handleJoinLive - no user?', {
			id : uid,
			user : user,
			users : self.users,
		});
		return;
	}
	
	self.live.add( uid );
}

ns.Room.prototype.handleLeaveLive = function( event, uid ) {
	const self = this;
	self.live.remove( uid );
}

// very private

ns.Room.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.onlineList.forEach( sendTo );
	function sendTo( uid ) {
		if ( sourceId && uid === sourceId )
			return;
		
		self.send( event, uid );
	}
}

ns.Room.prototype.send = function( event, targetId ) {
	const self = this;
	if ( !event )
		throw new Error( 'Room.send - no event' );
	
	var user = self.users[ targetId ];
	if ( !user || !user.send )
		return;
	
	user.send( event );
}

/* Room Settings */

ns.ConferenceSettings = function() {
	
}

module.exports = ns.Room;
