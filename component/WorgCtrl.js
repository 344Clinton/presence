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
const ns =  {};

ns.WorgCtrl = function( dbPool ) {
	const self = this;
	self.db = null;
	
	self.fMap = {}; // fId to worg mapping
	self.cMap = {}; // clientId to worg mapping
	self.fIds = [];
	self.cIds = [];
	self.worgUsers = {} // each workgroup has a list of members
	
	self.init( dbPool );
}

// Public

ns.WorgCtrl.prototype.setForUser = function( accId, worgs ) {
	const self = this;
	log( 'setForUser', {
		accId : accId,
		worgs : worgs,
	}, 3 );
	self.updateAvailable( worgs.available );
	self.addUserToWorgs( accId, worg.member );
}

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
}

module.exports = ns.WorgCtrl;
