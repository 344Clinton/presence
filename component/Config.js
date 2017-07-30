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

var log = require( './Log')( 'Config' );

var exampleConfObj = require( '../example.config.js' );
var confObj = require('../config.js');

var ns = {};

(function( ns, undefined ) {
	ns.Config = function() {
		const self = this;
		self.init();
	}
	
	ns.Config.prototype.init = function() {
		const self = this;
		var config = self.setMissing( confObj, exampleConfObj );
		self.server = config.server;
		self.shared = config.shared;
		self.shared.wsHost = self.getWsHost();
		global.config = self;
	}
	
	ns.Config.prototype.get = function() {
		const self = this;
		var conf = {
			server : self.server,
			shared : self.shared,
		};
		return global.config;
	}
	
	ns.Config.prototype.getWsHost = function() {
		const self = this;
		const domain = self.server.domain;
		const port = self.server.ws.port;
		const proxy = self.server.ws.proxy;
		var host = null;
		if ( null != proxy )
			host = domain + proxy;
		else
			host = domain + ':' + port;
		
		return host;
	}
	
	// "static" method, no self allowed here
	ns.Config.prototype.setMissing = function( dest, src ) {
		return sync( dest, src );
		
		function sync( dest, src ) {
			if ( typeof( dest ) === 'undefined' ) {
				dest = src;
				return dest;
			}
			
			if (( typeof( src ) !== 'object' ) || ( src === null ))
				return dest;
			
			var srcKeys = Object.keys( src );
			if ( srcKeys.length )
				srcKeys.forEach( goDeeper );
			
			return dest;
			
			function goDeeper( key ) {
				var deeperDest = dest[ key ];
				var deeperSrc = src[ key ];
				dest[ key ] = sync( deeperDest, deeperSrc );
			}
		}
	}
	
})( ns );

module.exports = new ns.Config();
