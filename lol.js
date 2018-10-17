process.setMaxListeners(0);
var chalk = require( "chalk" );
var fs = require('fs');
var request = require('request');
const events = require('events');
var mime = require('mime');
var util = require('util');

const FANNGUYEN= 30; //  multiple of the 262144 byte chunk granularity
const OUT_TIME_MINS= 10; // timeout theo so fut
const openload= require('../v2/openloadApi');
const rapid= require('../v2/rapidApi');

function resumableUpload() {
	this.byteCount = 0; //init variables
	this.tokens = {};
    this.filepath = '';
    this.leech = {};
    /**{ length: '984231520',
        url: 'https://oqbkic.olo..' } */
	this.query = '';
	this.retry = -1;
	this.host = 'photoslibrary.googleapis.com';
    this.api = '/v1/uploads';
    events.EventEmitter.call(this);
};

util.inherits(resumableUpload, events.EventEmitter);
const tokenApi= require('../gd/token');
const debug = true;
//Init the upload by POSTing google for an upload URL (saved to self.location)
resumableUpload.prototype.upload = function () {
    var self = this;
	if(typeof(self.tickOut)!= 'undefined') {
        clearTimeout(self.tickOut);
        self.tickOut= undefined;
	}
	if(self.leech){
		if(self.leech.docId){
			tokenApi.get(function(err, data){
				if(err) return self.upload();
				self.tokens = data;
				require('request').get({
					url: 'https://www.googleapis.com/drive/v2/files/'+ self.leech.docId,
					headers: {
						'Authorization': 'Bearer ' + self.tokens.access_token
					},
					json: true
				}, function (err, resp, body){
					if(err) return self.upload();
					var x= {
						fileSize: parseInt(body.fileSize),
						downloadUrl: body.downloadUrl
					};
					if(x && x.fileSize && x.downloadUrl){
						self.leech= {
							url: x.downloadUrl,
							length: x.fileSize,
							headers: {
								'Authorization': 'Bearer ' + self.tokens.access_token
							}
						}
						// return self.upload();
						// download thu file xem the nao
						var getUrl= require('url').parse(x.downloadUrl);
						var get_options = {
							host: getUrl.host,
							port: 443,
							path: getUrl.path,
							method: 'GET',
							headers: {
								'Authorization': 'Bearer ' + self.tokens.access_token
							}
						};
						const fileCuaTui= require('../dir').DOWNLOAD_FOLDER+ 'test1.mp4';
						var file = fs.createWriteStream(fileCuaTui);
						var get_request = require('https').request(get_options, function(response) {
							response.pipe(file);
							response.on('end', function() {
								console.log('download thu file xem the nao: done');
								console.log(fileCuaTui);
							});
						});
						get_request.on('error', function(err_dl){
							console.log('download thu file xem the nao: error');
							console.error(err_dl);
						});
						get_request.end();
					}
					else {
						console.log('Loi v2/files:downloadUrl');
					}
				})
			});
			return;
		} else {
			if(isFinite(self.leech.length)){
				self.leech.length = parseInt(self.leech.length);
			} else{
				self.emit('error', new Error('Tham so loi leech.length'));
				return;
			}
		}
	}
    if((!self.filepath) && (!self.leech.url)) {
        self.emit('error', new Error('Tham so loi leech.url'));
        return;
	}
    
	if(self.location){
        self.NON= FANNGUYEN* 256 * 1024;
		self.getSessionOld(function(err){
			if(err){
				if(err.netWorking){
					if ((self.retry > 0) || (self.retry <= -1)) {
						self.retry--;
						self.upload(); // retry
					} else {
						self.emit('error', new Error('Max upload retry, reason: resume session upload'));
					}
				} else {
					self.emit('error', err);
				}
			} else self.send();
		});
		return;
    }
    
    // truong hop co san resume upload id
    /*
    POST https://photoslibrary.googleapis.com/v1/uploads
    Authorization: 'Bearer '+ self.tokens.access_token
    Content-Length: 0
    X-Goog-Upload-Command: start
    X-Goog-Upload-Content-Type: 'application/octet-stream'
    X-Goog-Upload-File-Name: ''+ self.id+ '.mp4'
    X-Goog-Upload-Protocol: 'resumable'
    X-Goog-Upload-Raw-Size: lenMe
    */

    const lenMe = (self.filepath)? fs.statSync(self.filepath).size : self.leech.length;
    var mimeMe = (self.filepath)? mime.getType(self.filepath) : 'application/octet-stream'; // noi chung la video
	var options = {
		url: 'https://' + self.host + self.api,
		headers: {
			Authorization: 'Bearer '+ self.tokens.access_token,
            'Content-Length': 0,
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Content-Type': mimeMe,
            'X-Goog-Upload-File-Name': ''+ self.id+ '.mp4',
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Raw-Size': lenMe
		}
	};
	// console.log(options);
	//Send request and start upload if success
	request.post(options, function (err, resp, body) {
		if (err) {
			self.emit('warn', new Error(err)); // error network
			if ((self.retry > 0) || (self.retry <= -1)) {
				self.retry--;
				self.upload(); // retry
			} else {
				self.emit('error', new Error('Max upload retry, reason: network1'));
			}
		} else if (resp.statusCode==200){
            try{
                const respHead= resp.headers;
                if(!respHead['x-goog-upload-url'] || !isFinite(respHead['x-goog-upload-chunk-granularity'])){
                    return self.emit('error', body || new Error('LOL 1 :D'));
                }
                // 2,5 MB per 1 session post to photos
                self.NON= FANNGUYEN* parseInt(respHead['x-goog-upload-chunk-granularity']);
				self.location= respHead['x-goog-upload-url'];
				//console.log('Need restore:', self.location);
                return self.send();
            } catch(exx){
                return self.emit('error', body || new Error('LOL 2 :D'));
            }
        } if(resp.statusCode==401){ // refresh token
			self.emit('warn', new Error('Error gApi access token1'));
			tokenApi.get(function(err, data){
				if(err) return self.emit('error', err);
				if(debug) console.log('new token1:', data);
				self.tokens = data;
				return self.upload();
			});
		} else {
            return self.emit('error', body || new Error('Limmit guessWhat?'));
        }
	});
}

//Pipes uploadPipe to self.location (Google's Location header)
resumableUpload.prototype.send = function () {
	var self = this;
	if(typeof(self.tickOut)!= 'undefined') {
        clearTimeout(self.tickOut);
		self.tickOut= undefined;
    }
	if(debug){
		console.log('[send call this]');
		console.log('\tselfByteCount:', self.byteCount);
		console.log('\tlocation:', self.location);
	}
    const lenMe = (self.filepath)? fs.statSync(self.filepath).size : self.leech.length;
	var data = {
		buffer: [], // chunk up len gdrive trong 1 phien
		len: 0, // tong cac bytes post len photos server trong 1 phien
		needStop: false,
		moiFatDauTien: true
    };
    const diepGA= {
        'X-Goog-Upload-Command': 'upload',
        "Final": false
    }
    var NON= self.NON;
    // reSize
    function reSize(){
        if( ((lenMe- self.byteCount)/ 262144)<= 1 ){
            NON= lenMe- self.byteCount;
            diepGA['X-Goog-Upload-Command']+= ', finalize';
            diepGA['Final']= true;
        }
        else if( ((lenMe- self.byteCount)/ 262144)<= FANNGUYEN ){
            NON= 262144;
        }
    }
    reSize();
    if(NON==0){
        return self.emit('error', new Error('Upload been terminated'));
    }
    // reLeech
    function reLeech(){
        var tmp= (self.leech) ? self.leech.origin : undefined;
		if( tmp ){
			var api= (tmp.includes('/openload.co/'))? openload : rapid;
			api(tmp, function(err4x, dataResp){
				if(err4x) {
					self.emit('warn', err4x);
					setTimeout(function(){
                        self.send();
                    }, 3000);
				}
				else {
					if(dataResp.length!== self.leech.length) {
						self.emit('warn', new Error('Video api lan 2 khac size'));
					}
					else self.leech.url= dataResp.url;
					self.send();
				}
			})
		} else setTimeout(function(){
            self.send();
        }, 3000); // 3s leech lai server goc
    }
    // creates file stream, pipes it to self.location
    var uploadPipe;
    if(self.filepath) uploadPipe= fs.createReadStream(self.filepath, {
        start: self.byteCount,
        end: lenMe
    });
    else {
		var optLeech= {
            url: self.leech.url,
            headers: {}
		};
		optLeech.headers= Object.assign({
			//
		}, self.leech.headers, {
			'Range': `bytes=${self.byteCount}-`
		});
        uploadPipe = request.get(optLeech);
    }
	/** Leech stream from openload or rapid server */
	uploadPipe.on('error', function(err){
		uploadPipe.abort();
		data.needStop = true;
		self.emit('warn', err);
		reLeech();
	});
	uploadPipe.on('data', function(buffer){
		data.buffer.push(buffer);
		data.len+= buffer.length;
		if(data.moiFatDauTien && (data.len>=NON)){
			data.moiFatDauTien = false;
			poolPut();
		}
	});
	// tao timeout
	self.tickOut= setTimeout(function(){
		uploadPipe.abort();
		data.needStop = true;
		self.emit('warn', new Error('Timeout Resumable Upload'));
		reLeech();
    }, 1000* 60* OUT_TIME_MINS);

	uploadPipe.on('end', function(){
		self.emit('warn', 'dung leech tu server goc');
	})
	/** Put chunk stream to drive server */
	var poolPut = function(){
        if(data.needStop) return;
        // NON khong the la 0
		var lenUp, xUp = parseInt(data.len  /NON);
		if(xUp>0) {
			lenUp= xUp * NON;
		} else return setTimeout(poolPut, 3000);
		data.len-= lenUp;
		try{
			data.buffer = Buffer.concat(data.buffer);
			var dataUp = data.buffer.slice(0, lenUp);
			data.buffer = [data.buffer.slice(lenUp, data.buffer.length)];
		} catch (ex){
			self.emit('warn', ex);
			data.needStop= true;
			uploadPipe.abort();
			return self.upload();
		}
		/*var options = {
			url: self.location, //self.location becomes the Google-provided URL to PUT to
			headers: {
				// 'Authorization': 'Bearer ' + self.tokens.access_token,
                'Content-Length': lenUp,
                'X-Goog-Upload-Command': diepGA['X-Goog-Upload-Command'],
                'X-Goog-Upload-Offset': self.byteCount,
			},
			body: dataUp
		};*/
		var postUrl= require('url').parse(self.location);
		var post_options = {
			host: postUrl.host,
			port: 443,
			path: postUrl.path,
			method: 'POST',
			headers: {
                'Content-Length': lenUp,
                'X-Goog-Upload-Command': diepGA['X-Goog-Upload-Command'],
                'X-Goog-Upload-Offset': self.byteCount,
			}
		};
		var post_req = require('https').request(post_options, function(response) {
			var statusCode = response.statusCode;
			var body= '';
			response.on('data', function(chunk) {
				body += chunk;
			});
			response.on('end', function() {
				if(statusCode===200){
					self.byteCount+= lenUp;
					if(debug) {
						const
							x= self.byteCount/(1024*1024),
							y= lenMe/ (1024*1024),
							z= Math.round((x/y)* 100);
						console.log('Upload done: '+ x+ '/'+ y+ ' MB ~ '+ z+ ' %');
					}
					if(self.byteCount >= lenMe){
						uploadPipe.abort();
						if(typeof(self.tickOut)!= 'undefined') {
							clearTimeout(self.tickOut);
							self.tickOut= undefined;
						}
						return self.emit('success', body); // body is uploadToken
					} else {
						reSize();
						setTimeout(poolPut, 3000);
					}
					
				} else {
					uploadPipe.abort();
					if(body || body.includes('been terminated')){
						return self.emit('error', body);
					}
					else if ((self.retry > 0) || (self.retry <= -1)) {
						self.retry--;
						self.emit('warn', new Error('interrupted upload'));
						return self.upload();
					} else {
						return self.emit('error', new Error('Max upload retry, reason: interrupted upload'));
					}
				}
			});
		});
		// post the data
		post_req.write(dataUp);
		post_req.on('error', function(err){
			uploadPipe.abort();
			if ((self.retry > 0) || (self.retry <= -1)) {
				self.retry--;
				return self.send();
			} else {
				return self.emit('error', new Error('Max upload retry, reason: network2'));
			}
		});
		post_req.end();
		
		/*request.post(options, function (err, response, body) {
			if(err){
				uploadPipe.abort();
				if ((self.retry > 0) || (self.retry <= -1)) {
					self.retry--;
					return self.send();
				} else {
					return self.emit('error', new Error('Max upload retry, reason: network2'));
				}
			}
            var statusCode = response.statusCode;
            
            *//*if(diepGA['Final']){
                console.log({
                    statusCode: response.statusCode,
                    byteCount: self.byteCount,
                    lenMe,
                    headers: response.headers,
                    body
                });
			}*//*

			if(statusCode===200){
				self.byteCount+= lenUp;
				if(debug) {
					const
						x= self.byteCount/(1024*1024),
						y= lenMe/ (1024*1024),
						z= Math.round((x/y)* 100);
					console.log('Upload done: '+ x+ '/'+ y+ ' MB ~ '+ z+ ' %');
				}
                if(self.byteCount >= lenMe){
                    uploadPipe.abort();
                    if(typeof(self.tickOut)!= 'undefined') {
                        clearTimeout(self.tickOut);
                        self.tickOut= undefined;
                    }
				    return self.emit('success', body); // body is uploadToken
                } else {
                    reSize();
                    setTimeout(poolPut, 3000);
                }
			} else {
                uploadPipe.abort();
                if(body || body.includes('been terminated')){
                    return self.emit('error', body);
                }
                else if ((self.retry > 0) || (self.retry <= -1)) {
					self.retry--;
					self.emit('warn', new Error(body || 'interrupted upload'));
                    return self.upload();
				} else {
					return self.emit('error', new Error('Max upload retry, reason: interrupted upload'));
				}
			}
		})*/
	};
}

resumableUpload.prototype.getSessionOld = function (cb) {
	var self = this;
	if(!self.location) return;
	var options = {
		url: self.location,
		headers: {
            'Content-Length': 0,
            'X-Goog-Upload-Command': 'query'
		}
	};
	request.post(options, function (err, resp, body) {
		if(err) return cb({netWorking: true});
        if (resp && resp.statusCode==200) {
            const lenMe = (self.filepath)? fs.statSync(self.filepath).size : self.leech.length;
            var tmp = resp.headers['x-goog-upload-size-received'];
			if(isFinite(tmp)&& parseInt(tmp)>=0){
                self.byteCount = parseInt(tmp);
                if(self.byteCount>= lenMe){
                    return self.emit('success', body); // body is uploadToken
                }
                else cb(null);
			}
            else {
                if(debug) console.log({
                    respStatusCode: resp.statusCode,
                    headers: resp.headers,
                    body
                })
                return cb({err: body || new Error('Session upload failed')});
            }
		} else {
            if(debug) console.log({
                respStatusCode: resp.statusCode,
                headers: resp.headers,
                body
            })
            return cb({err: body || new Error('Session upload expired')});
		}
	});
}

module.exports = resumableUpload;
