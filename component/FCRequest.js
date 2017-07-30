'use strict';

/*©agpl*************************************************************************
*                                                                              *
* Friend Unifying Platform                                                     *
* ------------------------                                                     *
*                                                                              *
* Copyright 2014-2016 Friend Software Labs AS, all rights reserved.            *
* Hillevaagsveien 14, 4016 Stavanger, Norway                                   *
* Tel.: (+47) 40 72 96 56                                                      *
* Mail: info@friendos.com                                                      *
*                                                                              *
*****************************************************************************©*/

var log = require( './Log' )( 'FcRequest' );
var https = require( 'https' );
var querystring = require( 'querystring' );

var ns = {};
ns.FcRequest = function( conf ) {
	if ( !( this instanceof ns.FcRequest ))
		return new ns.FcRequest( conf );
	
	const self = this;
	self.host = conf.host;
	self.port = conf.port;
	self.method = 'POST';
	
	self.init();
}

ns.FcRequest.prototype.init = function() {
	const self = this;
	if ( typeof( self.host ) === 'undefined' )
		throw new Error( 'FcRequest.host is not set' );
	if ( typeof( self.port ) === 'undefined' )
		throw new Error( 'FcRequest.port is not set' );
}

ns.FcRequest.prototype.post = function( conf ) {
	const self = this;
	var query = querystring.stringify( conf.data );
	var opts = self.buildPostOptions( conf.path, query.length );
	var req = https.request( opts, reqBack );
	req.on( 'error', oops );
	req.write( query );
	function reqBack( res ) {
		var chunks = '';
		res.on( 'data', read );
		res.on( 'end', end );
		
		function read( chunk ) {
			chunks += chunk;
		}
		
		function end() {
			self.response( chunks, conf );
		}
	}
	
	function oops( e ) {
		log( 'err', e );
		conf.error( e );
	}
}

ns.FcRequest.prototype.response = function( data, conf ) {
	const self = this;
	data = data.split( 'ok<!--separate-->' ).join( '' ); // derp
	data = parse( data );
	conf.success( data );
}

ns.FcRequest.prototype.buildPostOptions = function( path, queryLength ) {
	const self = this;
	var opts = {
		hostname : self.host,
		port : self.port,
		method : 'POST',
		path : path,
		rejectUnauthorized : false,
		headers : buildPostHeader( queryLength ),
	};
	
	return opts;
	
	function buildPostHeader( dataLength ) {
		var header = {
			'Content-Type' : 'application/x-www-form-urlencoded',
			'Content-Length' : dataLength,
		};
		return header;
	}
}

module.exports = function( conf ) {
	return new ns.FcRequest( conf );
}

function parse( string ) {
	try {
		return JSON.parse( string );
	} catch( e ) {
		return null;
	}
}