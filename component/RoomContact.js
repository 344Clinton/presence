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

const log = require( './Log' )( 'ContactRoom' );
const Room = require( './Room' );
const components = require( './RoomComponents' );
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const util = require( 'util' );

var ns = {};

ns.ContactRoom = function( conf, db, idCache ) {
    const self = this;
    Room.call( self, conf, db, idCache );
    
    //self.init();
}

util.inherits( ns.ContactRoom, Room );

ns.ContactRoom.prototype.setRelation = async function( relation ) {
    const self = this;
    log( 'setRelation', relation );
    self.accIdA = relation.accountA;
    self.accIdB = relation.accountB;
}

ns.ContactRoom.prototype.getOtherAccount = function( accId ) {
    const self = this;
    log ( 'getOtherAccount', {
        a : self.accIdA,
        b : self.accIdB,
    });
    
    let otherId;
    if ( accId === self.accIdA )
        otherId = self.accIdB;
    else
        otherId = self.accIdA;
    
    return self.users[ otherId ];
}

ns.ContactRoom.prototype.init = function() {
    const self = this;
    self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
    self.settings = new ns.ContactSettings(
        self.dbPool,
        self.id,
        self.users,
        self.onlineList,
        settingsDone
    );
    
    async function settingsDone( err , res ) {
        log( 'Log' );
        self.log = new components.Log(
            self.dbPool,
            self.id,
            self.users,
            self.idCache,
            self.persistent,
        );
        
        log( 'Chat' );
        self.chat = new components.Chat(
            self.id,
            self.users,
            self.onlineList,
            self.log
        );
        
        log( 'Live' );
        self.live = new components.Live(
            self.users,
            self.onlineList,
            self.log,
            null,
            self.settings
        );
        
        try {
            await self.loadUsers();
        } catch( e ) {
            log( 'load fail', e );
        }
        self.setOpen();
    }
}

ns.ContactRoom.prototype.loadUsers = async function() {
    const self = this;
    log( 'loadUsers' );
    let auths = null;
    try {
        auths = await self.roomDb.loadAuthorizations( self.id );
    } catch ( e ) {
        log( 'loading auths failed', e.stack || e );
        return false;
    }
    
    if ( !auths || 2 !== auths.length ) {
        log( 'loadUsers - invalid number of users', auths );
        return false;
    }
    
    try {
        await Promise.all( auths.forEach( await add ));
    } catch ( e ) {
        log( 'opps', e.stack || e );
    }
    log( 'loadUsers accs set', {
        a : self.accIdA,
        b : self.accIdB,
        u : self.users,
    });
    return true;
    
    async function add( dbUser ) {
        log( 'add', dbUser );
        let uid = dbUser.clientId;
        let user = await self.idCache.get( uid );
        
        self.users[ uid ] = {
            accountId   : uid,
            accountName : user.name,
            avatar      : user.avatar,
            authed      : true,
        };
        
        if ( self.accIdA )
            self.accIdB = uid;
        else
            self.accIdA = uid;
        
        return true;
    }
}

ns.ContactRoom.prototype.bindUser = function( account ) {
    const self = this;
    log( 'bindUser', account );
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
    
    const otherAcc = self.getOtherAccount( userId );
    log( 'otherAcc', otherAcc );
    const otherId = otherAcc.accountId;
    const otherName = otherAcc.accountName;
    // add signal user obj
    const sigConf = {
        roomId      : otherId,
        roomName    : otherName,
        isPrivate   : true,
        persistent  : true,
        accountId   : conf.accountId,
        accountName : conf.accountName,
        avatar      : conf.avatar,
        owner       : conf.accountId === self.ownerId,
        admin       : account.admin,
        authed      : account.authed || conf.authed || false,
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
    self.chat.bind( userId );
    self.settings.bind( userId );
    
    // show online
    self.setOnline( userId );
    return user;
}

ns.ContactRoom.prototype.setOnline = function( userId ) {
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
            workgroups : null,
        }
    };
    self.broadcast( online );
    return user;
}

ns.ContactRoom.prototype.initialize =  function( requestId, userId ) {
    const self = this;
    const otherAcc = self.getOtherAccount( userId );
    const state = {
        id          : otherAcc.accountId,
        name        : otherAcc.accountName,
        ownerId     : self.ownerId,
        persistent  : self.persistent,
        isPrivate   : true,
        settings    : self.settings.get(),
        guestAvatar : self.guestAvatar,
        users       : buildBaseUsers(),
        online      : self.onlineList,
        identities  : self.identities,
        peers       : self.live.peerIds,
        workgroups  : null,
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
                workgroups : null,
            };
        }
    }
}

ns.ContactRoom.prototype.addUser = async function( acc, callback ) {
    const self = this;
    // add to users
    log( 'addUser', acc );
    const uid = acc.accountId;
    if ( self.users[ uid ]) {
        callback( null, uid );
        return;
    }
    
    let user = null;
    user = await self.idCache.get( uid );
    log( 'user', user );
    acc.avatar = acc.avatar || user.avatar;
    acc.authed = true;
    self.users[ uid ] = acc;
    const joinEvent = {
        type : 'join',
        data : {
            clientId   : uid,
            name       : acc.accountName,
            avatar     : acc.avatar,
            owner      : acc.accountId === self.ownerId,
            admin      : acc.admin || undefined,
            authed     : acc.authed || undefined,
            guest      : acc.guest || undefined,
            workgroups : null,
        },
    };
    self.broadcast( joinEvent, uid );
    callback( null, uid );
}


/*
    ContactSettings
*/

const sLog = require( './Log' )( 'Room > Settings' );
ns.ContactSettings = function(
    dbPool,
    roomId,
    users,
    onlineList,
    callback
) {
    const self = this;
    components.Settings.call( self,
        dbPool,
        null,
        roomId,
        users,
        onlineList,
        true,
        null,
        callback
    );
}

util.inherits( ns.ContactSettings, components.Settings );

ns.ContactSettings.prototype.init = function( dbPool, ignore, callback ) {
    const self = this;
    self.conn = new components.UserSend( 'settings', self.users, self.onlineList );
    self.handlerMap = {
    };
    
    self.list = Object.keys( self.handlerMap );
    self.db = new dFace.RoomDB( dbPool, self.roomId );
    self.db.getSettings()
        .then( settings )
        .catch( loadErr );
    
    function settings( res ) {
        self.setDbSettings( res );
        done();
    }
    
    function loadErr( err ) {
        sLog( 'loadErr', err );
        self.setDefaults();
        done( err );
    }
    
    function done( err ) {
        sLog( 'done' );
        callback( err, self.setting );
    }
}

ns.ContactSettings.prototype.setDbSettings = function( settings ) {
    const self = this;
    let keys = Object.keys( settings );
    keys.forEach( add );
    self.settingStr = JSON.stringify( self.setting );
    
    function add( key ) {
        let value = settings[ key ];
        self.setting[ key ] = value;
    }
}

ns.ContactSettings.prototype.setDefaults = function() {
    const self = this;
    //self.set( 'userLimit', 0 );
    //self.set( 'isStream', false );
}

module.exports = ns.ContactRoom;
