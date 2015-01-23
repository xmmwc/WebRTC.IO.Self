var PeerConnection = window.PeerConnection || window.webkitPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
var SessionDescription = window.RTCSessionDescription || window.webkitSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;
var IceCandidate = window.RTCIceCandidate || window.webkitIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate;
var URL = window.URL || window.webkitURL || window.msURL || window.oURL;
var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

(function(){

    var rtc = this.rtc = {};

    rtc.socket = null;
    rtc.events = {};

    rtc.SERVER = {
        iceServers: [
            {url: "stun:stun.l.google.com:19302"}
        ]
    };

    // Referenc e to the lone PeerConnection instance.
    rtc.peerConnections = {};

    // Array of known peer socket ids
    rtc.connections = [];
    // Stream-related variables.
    rtc.streams = [];
    rtc.numStreams = 0;
    rtc.initializedStreams = 0;

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
            rtc.fire('connections', rtc.connections);
        });

        rtc.socket.on('disconnect',function(data) {
            rtc.fire('disconnect stream', rtc.socket.id);
            delete rtc.peerConnections[rtc.socket.id];
        });

        rtc.socket.on('receive_ice_candidate',function(data){
            var candidate = new IceCandidate(data);
            rtc.peerConnections[data.socketId].addIceCandidate(candidate);
            rtc.fire('receive ice candidate', candidate);
        });

        rtc.socket.on('new_peer_connected',function(data){
            rtc.connections.push(data.socketId);
            var pc = rtc.createPeerConnection(data.socketId);
            for (var i = 0; i < rtc.streams.length; i++) {
                var stream = rtc.streams[i];
                pc.addStream(stream);
            }
        });

        rtc.socket.on('remove_peer_connected',function(data){
            rtc.fire('disconnect stream', data.socketId);
            delete rtc.peerConnections[data.socketId];
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
        var pc = rtc.peerConnections[id] = new PeerConnection(rtc.SERVER);
        pc.onicecandidate = function(event) {
            if (event.candidate) {
                rtc.socket.emit('send_ice_candidate',{
                    label: event.candidate.label,
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
        pc.createOffer(function (session_description) {
            pc.setLocalDescription(session_description);
            rtc.socket.emit('send_offer',{
                socketId: socketId,
                sdp: session_description
            });
        },function(error){
            if (error) {
                console.log(error);
            }
        });
    };

    rtc.receiveOffer = function(socketId, sdp) {
        var pc = rtc.peerConnections[socketId];
        pc.setRemoteDescription(new SessionDescription(sdp));
        rtc.sendAnswer(socketId);
    };

    rtc.sendAnswer = function(socketId) {
        var pc = rtc.peerConnections[socketId];
        pc.createAnswer(function (session_description) {
            pc.setLocalDescription(session_description);
            rtc.emit('send_answer',{
                socketId: socketId,
                sdp: session_description
            });
            var offer = pc.remoteDescription;
        },function(error){
            if (error) {
                console.log(error);
            }
        });
    };

    rtc.receiveAnswer = function(socketId, sdp) {
        var pc = rtc.peerConnections[socketId];
        pc.setRemoteDescription(new SessionDescription(sdp));
    };

    rtc.createStream = function(opt, onSuccess, onFail) {
        var options;
        onSuccess = onSuccess ||
        function() {};
        onFail = onFail ||
        function() {};

        if(opt.audio && opt.video){
            options = {
                video: true,
                audio: true
            };
        }else if(opt.video){
            options = {
                video: true,
                audio: false
            };
        }else if(opt.audio){
            options = {
                video: false,
                audio: true
            };
        }else {
            options = {
                video: false,
                audio: false
            };
        }

        if (getUserMedia) {
            rtc.numStreams++;
            getUserMedia.call(navigator, options, function(stream) {

                rtc.streams.push(stream);
                rtc.initializedStreams++;
                onSuccess(stream);
                if (rtc.initializedStreams === rtc.numStreams) {
                    rtc.read();
                }
            }, function() {
                alert("没有获取到视频流");
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
                    rtc.peerConnections[connection].addStream(stream);
                }
            }
        }
    };

    rtc.attachStream = function(stream, domId) {
        if(typeof edomId == 'string'){
            document.getElementById(domId).src = URL.createObjectURL(stream);
        }else{
            domId.src = URL.createObjectURL(stream);
        }

    };

    rtc.ready = function() {
        rtc.createPeerConnections();
        rtc.addStreams();
        rtc.sendOffers();
    };


    rtc.onClose = function(data) {
        rtc.on('close_stream', function() {
            rtc.fire('close_stream', data);
        });
    };


}).call(this);