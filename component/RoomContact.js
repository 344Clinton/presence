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
}

ns.ContactRoom.prototype.getOtherAccount = function( accId ) {
    const self = this;
    if ( accId === self.accIdA )
        return self.accIdB;
    else
        return self.accIdA;
}

ns.ContactRoom.prototype.init = async function() {
    const self = this;
    self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
    
    self.settings = new ns.ContactSettings(
        self.dbPool,
        self.id,
        self.users,
        self.onlineList,
        self.persistent,
        self.name,
        settingsDone
    );
    
    function settingsDone( err , res ) {
        self.log = new components.Log(
            self.dbPool,
            self.id,
            self.users,
            self.idCache,
            self.persistent,
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
            self.settings
        );
        
        await self.loadUsers();
        self.setOpen();
    }
}

ns.Room.prototype.loadUsers = async function() {
    const self = this;
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
    
    await Promise.all( auths.forEach( await add ));
    log( 'loadUsers accs set', {
        a : self.accIdA,
        b : self.accIdB,
        u : self.users,
    });
    return true;
    
    async function add( dbUser ) {
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
    }
}

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
    
    const otherAcc = self.getOtherAccount( userId );
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


/*
    ContactSettings
*/

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

util.inherits( ns.ContactSettings, component.Settings );

ns.ContactSettings.prototype.init = function( dbPool, null, callback ) {
    const self = this;
    self.conn = new ns.UserSend( 'settings', self.users, self.onlineList );
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
