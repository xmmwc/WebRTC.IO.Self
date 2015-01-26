var PeerConnection = (window.PeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
var URL = (window.URL || window.webkitURL || window.msURL || window.oURL);
var getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);
var nativeRTCIceCandidate = (window.mozRTCIceCandidate || window.RTCIceCandidate);
var nativeRTCSessionDescription = (window.mozRTCSessionDescription || window.RTCSessionDescription);

var sdpConstraints = {
    'mandatory': {
        'OfferToReceiveAudio': true,
        'OfferToReceiveVideo': true
    }
};

if (navigator.webkitGetUserMedia) {
    if (!webkitMediaStream.prototype.getVideoTracks) {
        webkitMediaStream.prototype.getVideoTracks = function() {
            return this.videoTracks;
        };
        webkitMediaStream.prototype.getAudioTracks = function() {
            return this.audioTracks;
        };
    }

    // New syntax of getXXXStreams method in M26.
    if (!webkitRTCPeerConnection.prototype.getLocalStreams) {
        webkitRTCPeerConnection.prototype.getLocalStreams = function() {
            return this.localStreams;
        };
        webkitRTCPeerConnection.prototype.getRemoteStreams = function() {
            return this.remoteStreams;
        };
    }
}

(function(){

    var rtc = this.rtc = {};

    rtc.socket = null;
    rtc.events = {};
    rtc.me = null;
    rtc.debug = true;

    rtc.SERVER = function() {
        if (navigator.mozGetUserMedia) {
            return {
                "iceServers": [{
                    "url": "stun:23.21.150.121"
                }]
            };
        }
        return {
            "iceServers": [{
                "url": "stun:stun.l.google.com:19302"
            }]
        };
    };

    // Referenc e to the lone PeerConnection instance.
    rtc.peerConnections = {};

    // Array of known peer socket ids
    rtc.connections = [];
    // Stream-related variables.
    rtc.streams = [];
    rtc.numStreams = 0;
    rtc.initializedStreams = 0;

    rtc.dataChannels = {};

    // PeerConnection datachannel configuration
    rtc.dataChannelConfig = {
        "optional": [{
            "RtpDataChannels": true
        }, {
            "DtlsSrtpKeyAgreement": true
        }]
    };

    rtc.pc_constraints = {
        "optional": [{
            "DtlsSrtpKeyAgreement": true
        }]
    };

    // check whether data channel is supported.
    rtc.checkDataChannelSupport = function() {
        try {
            // raises exception if createDataChannel is not supported
            var pc = new PeerConnection(rtc.SERVER(), rtc.dataChannelConfig);
            var channel = pc.createDataChannel('supportCheck', {
                reliable: false
            });
            channel.close();
            return true;
        } catch (e) {
            return false;
        }
    };

    rtc.dataChannelSupport = rtc.checkDataChannelSupport();

    rtc.on = function(eventName,callback){
        rtc.events[eventName] = rtc.events[eventName] || [];
        rtc.events[eventName].push(callback);
    };

    rtc.fire = function(eventName,_){
        var events = rtc.events[eventName];
        var args = Array.prototype.slice.call(arguments, 1);

        if (!events) {
            return;
        }

        for (var i = 0, len = events.length; i < len; i++) {
            events[i].apply(null, args);
        }
    };

    rtc.connect = function(server,room) {
        room = room || '';

        rtc.socket = io.connect(server);

        rtc.socket.emit('join_room',room);

        rtc.socket.on('get_peers',function(data){
            rtc.connections = data.connections;
            if (rtc.offerSent) {
                rtc.createPeerConnections();
                rtc.addStreams();
                rtc.addDataChannels();
                rtc.sendOffers();
            }
            rtc.fire('connections', rtc.connections);
        });

        rtc.socket.on('disconnect',function(data) {
            var id = rtc.socket.id;
            rtc.fire('disconnect stream', id);
            if (typeof(rtc.peerConnections[id]) !== 'undefined')
                rtc.peerConnections[id].close();
            delete rtc.peerConnections[id];
            delete rtc.dataChannels[id];
            var index = rtc.connections.indexOf(id);
            if(index>=0){
                rtc.connections.splice(index,1);
            }
        });

        rtc.socket.on('receive_ice_candidate',function(data){
            var candidate = new nativeRTCIceCandidate(data);
            rtc.peerConnections[data.socketId].addIceCandidate(candidate);
            rtc.fire('receive ice candidate', candidate);
        });

        rtc.socket.on('new_peer_connected',function(data){
            var id = data.socketId;
            rtc.connections.push(id);
            delete rtc.offerSent;

            var pc = rtc.createPeerConnection(id);
            for (var i = 0; i < rtc.streams.length; i++) {
                var stream = rtc.streams[i];
                pc.addStream(stream);
            }
        });

        rtc.socket.on('remove_peer_connected',function(data){
            var id = data.socketId;
            rtc.fire('disconnect stream', id);
            if (typeof(rtc.peerConnections[id]) !== 'undefined')
                rtc.peerConnections[id].close();
            delete rtc.peerConnections[id];
            delete rtc.dataChannels[id];
            var index = rtc.connections.indexOf(id);
            if(index>=0){
                rtc.connections.splice(index,1);
            }
        });

        rtc.socket.on('receive_non_stream',function(data){
            rtc.fire('add remote stream', null, data.socketId);
        });

        rtc.socket.on('receive_offer',function(data){
            rtc.receiveOffer(data.socketId, data.sdp);
            rtc.fire('receive offer', data);
        });

        rtc.socket.on('receive_answer',function(data){
            rtc.receiveAnswer(data.socketId, data.sdp);
            rtc.fire('receive answer', data);
        });
    };

    rtc.createPeerConnections = function() {
        for (var i = 0; i < rtc.connections.length; i++) {
            rtc.createPeerConnection(rtc.connections[i]);
        }
    };

    rtc.sendOffers = function() {
        for (var i = 0, len = rtc.connections.length; i < len; i++) {
            var socketId = rtc.connections[i];
            rtc.sendOffer(socketId);
        }
    };

    rtc.createPeerConnection = function(id) {
        console.log('createPeerConnection');
        var config = rtc.pc_constraints;

        if (rtc.dataChannelSupport) config = rtc.dataChannelConfig;

        var pc = rtc.peerConnections[id] = new PeerConnection(rtc.SERVER(),config);
        pc.onicecandidate = function(event) {
            if (event.candidate) {
                rtc.socket.emit('send_ice_candidate',{
                    label: event.candidate.sdpMLineIndex,
                    candidate: event.candidate.candidate,
                    socketId: id
                });
            }
            rtc.fire('ice candidate', event.candidate);
        };

        pc.onopen = function() {
            // TODO: Finalize this API
            rtc.fire('peer connection opened');
        };

        pc.onaddstream = function(event) {
            // TODO: Finalize this API
            rtc.fire('add remote stream', event.stream, id);
        };
        return pc;
    };

    rtc.sendOffer = function(socketId) {
        var pc = rtc.peerConnections[socketId];
        var constraints = {
            "optional": [],
            "mandatory": {
                "MozDontOfferDataChannel": true
            }
        };
        // temporary measure to remove Moz* constraints in Chrome
        if (navigator.webkitGetUserMedia) {
            for (var prop in constraints.mandatory) {
                if (prop.indexOf("Moz") != -1) {
                    delete constraints.mandatory[prop];
                }
            }
        }
        constraints = mergeConstraints(constraints, sdpConstraints);
        pc.createOffer(function (session_description) {
            session_description.sdp = preferOpus(session_description.sdp);
            pc.setLocalDescription(session_description);
            rtc.socket.emit('send_offer',{
                socketId: socketId,
                sdp: session_description
            });
        },function(error){
            if (error) {
                console.log(error);
            }
        },sdpConstraints);
    };

    rtc.receiveOffer = function(socketId, sdp) {
        var pc = rtc.peerConnections[socketId];
        rtc.sendAnswer(socketId,sdp);
    };

    rtc.sendAnswer = function(socketId,sdp) {
        var pc = rtc.peerConnections[socketId];
        pc.setRemoteDescription(new nativeRTCSessionDescription(sdp));
        pc.createAnswer(function (session_description) {
            pc.setLocalDescription(session_description);
            rtc.socket.emit('send_answer',{
                socketId: socketId,
                sdp: session_description
            });
            if(rtc.isNonStream)
                rtc.socket.emit('send_non_stream',{
                    socketId: socketId,
                });
            var offer = pc.remoteDescription;
        },function(error){
            if (error) {
                console.log(error);
            }
        },sdpConstraints);
    };

    rtc.receiveAnswer = function(socketId, sdp) {
        var pc = rtc.peerConnections[socketId];
        pc.setRemoteDescription(new nativeRTCSessionDescription(sdp));
    };

    rtc.createStream = function(opt, onSuccess, onFail) {
        var options;
        onSuccess = onSuccess || function() {};
        onFail = onFail || function() {};

        options = {
            video: !! opt.video,
            audio: !! opt.audio
        };

        if (getUserMedia) {
            rtc.numStreams++;
            getUserMedia.call(navigator, options, function(stream) {
                rtc.streams.push(stream);
                rtc.initializedStreams++;
                onSuccess(stream);
                if (rtc.initializedStreams === rtc.numStreams) {
                    rtc.ready();
                }
            }, function() {
                if(!options.video){
                    options.video = false;
                    rtc.createStream(options,onSuccess,onFail);
                }else if(!options.audio){
                    options.audio = false;
                    rtc.createStream(options,onSuccess,onFail);
                }else{
                    rtc.streams.push(null);
                    rtc.isNonStream = true;
                    rtc.initializedStreams++;
                    if (rtc.initializedStreams === rtc.numStreams) {
                        rtc.ready();
                    }
                }
                onFail();
            });
        } else {
            alert('您的浏览器不支持WebRTC');
        }
    };

    rtc.addStreams = function() {
        for (var i = 0; i < rtc.streams.length; i++) {
            var stream = rtc.streams[i];
            for (var connection in rtc.peerConnections) {
                if(rtc.peerConnections.hasOwnProperty(connection)){
                    if(stream){
                        rtc.peerConnections[connection].addStream(stream);
                    }else{
                        rtc.socket.emit('send_non_stream',{
                            socketId:connection
                        });
                    }
                }
            }
        }
    };

    rtc.attachStream = function(stream, element) {
        if (typeof(element) === "string")
            element = document.getElementById(element);
        if (navigator.mozGetUserMedia) {
            if (rtc.debug) console.log("Attaching media stream");
            element.mozSrcObject = stream;
            element.play();
        } else {
            element.src = webkitURL.createObjectURL(stream);
        }

    };

    rtc.createDataChannel = function(pcOrId, label) {
        if (!rtc.dataChannelSupport) {
            //TODO this should be an exception
            alert('webRTC data channel is not yet supported in this browser,' +
            ' or you must turn on experimental flags');
            return;
        }

        var id, pc;
        if (typeof(pcOrId) === 'string') {
            id = pcOrId;
            pc = rtc.peerConnections[pcOrId];
        } else {
            pc = pcOrId;
            id = undefined;
            for (var key in rtc.peerConnections) {
                if (rtc.peerConnections[key] === pc) id = key;
            }
        }

        if (!id) throw new Error('attempt to createDataChannel with unknown id');

        if (!pc || !(pc instanceof PeerConnection)) throw new Error('attempt to createDataChannel without peerConnection');

        // need a label
        label = label || 'fileTransfer' || String(id);

        // chrome only supports reliable false atm.
        var options = {
            reliable: false
        };

        var channel;
        try {
            if (rtc.debug) console.log('createDataChannel ' + id);
            channel = pc.createDataChannel(label, options);
        } catch (error) {
            if (rtc.debug) console.log('seems that DataChannel is NOT actually supported!');
            throw error;
        }

        return rtc.addDataChannel(id, channel);
    };

    rtc.addDataChannel = function(id, channel) {

        channel.onopen = function() {
            if (rtc.debug) console.log('data stream open ' + id);
            rtc.fire('data stream open', channel);
        };

        channel.onclose = function(event) {
            delete rtc.dataChannels[id];
            delete rtc.peerConnections[id];
            delete rtc.connections[id];
            if (rtc.debug) console.log('data stream close ' + id);
            rtc.fire('data stream close', channel);
        };

        channel.onmessage = function(message) {
            if (rtc.debug) console.log('data stream message ' + id);
            rtc.fire('data stream data', channel, message.data);
        };

        channel.onerror = function(err) {
            if (rtc.debug) console.log('data stream error ' + id + ': ' + err);
            rtc.fire('data stream error', channel, err);
        };

        // track dataChannel
        rtc.dataChannels[id] = channel;
        return channel;
    };

    rtc.addDataChannels = function() {
        if (!rtc.dataChannelSupport) return;

        for (var connection in rtc.peerConnections)
            if (rtc.peerConnections.hasOwnProperty(connection)) {
                rtc.createDataChannel(connection);
            }

    };

    rtc.ready = function() {
        rtc.createPeerConnections();
        rtc.addStreams();
        rtc.addDataChannels();
        rtc.sendOffers();
        rtc.offerSent = true;
    };


    rtc.onClose = function(data) {
        rtc.on('close_stream', function() {
            rtc.fire('close_stream', data);
        });
    };

    function preferOpus(sdp) {
        var sdpLines = sdp.split('\r\n');
        var mLineIndex = null;
        // Search for m line.
        for (var i = 0; i < sdpLines.length; i++) {
            if (sdpLines[i].search('m=audio') !== -1) {
                mLineIndex = i;
                break;
            }
        }
        if (mLineIndex === null) return sdp;

        // If Opus is available, set it as the default in m line.
        for (var j = 0; j < sdpLines.length; j++) {
            if (sdpLines[j].search('opus/48000') !== -1) {
                var opusPayload = extractSdp(sdpLines[j], /:(\d+) opus\/48000/i);
                if (opusPayload) sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], opusPayload);
                break;
            }
        }

        // Remove CN in m line and sdp.
        sdpLines = removeCN(sdpLines, mLineIndex);

        sdp = sdpLines.join('\r\n');
        return sdp;
    }

    function extractSdp(sdpLine, pattern) {
        var result = sdpLine.match(pattern);
        return (result && result.length == 2) ? result[1] : null;
    }

    function setDefaultCodec(mLine, payload) {
        var elements = mLine.split(' ');
        var newLine = [];
        var index = 0;
        for (var i = 0; i < elements.length; i++) {
            if (index === 3) // Format of media starts from the fourth.
                newLine[index++] = payload; // Put target payload to the first.
            if (elements[i] !== payload) newLine[index++] = elements[i];
        }
        return newLine.join(' ');
    }

    function removeCN(sdpLines, mLineIndex) {
        var mLineElements = sdpLines[mLineIndex].split(' ');
        // Scan from end for the convenience of removing an item.
        for (var i = sdpLines.length - 1; i >= 0; i--) {
            var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
            if (payload) {
                var cnPos = mLineElements.indexOf(payload);
                if (cnPos !== -1) {
                    // Remove CN payload from m line.
                    mLineElements.splice(cnPos, 1);
                }
                // Remove CN line in sdp
                sdpLines.splice(i, 1);
            }
        }

        sdpLines[mLineIndex] = mLineElements.join(' ');
        return sdpLines;
    }

    function mergeConstraints(cons1, cons2) {
        var merged = cons1;
        for (var name in cons2.mandatory) {
            merged.mandatory[name] = cons2.mandatory[name];
        }
        merged.optional.concat(cons2.optional);
        return merged;
    }


}).call(this);