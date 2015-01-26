/**
 * Created by xmmwc on 15/1/24.
 */
var socketServer = require('socket.io');

module.exports.listen = function(server) {
    var manager = socketServer.listen(server);
    attachEvents(manager);
    return manager;
};

function attachEvents(manager){

    var getOther = function(id,room){
        var thatRoom = manager.sockets.adapter.rooms[room] || [];
        var other = [];
        for(var i in thatRoom){
            if(i != id && thatRoom.hasOwnProperty(i)){
                other.push(i);
            }
        }
        return other;
    };

    var getSocket = function(id){
        var allClient = manager.sockets.adapter.nsp.connected;

        for(var i in allClient){
            if(i == id && allClient.hasOwnProperty(i)){
                return allClient[i];
            }
        }
    };


    manager.sockets.on('connection',function(socket){

        socket.on('disconnect',function(){
            socket.broadcast.emit('remove_peer_connected',{
                socketId:socket.id
            })
        });

        socket.on('join_room',function(room){
            socket.join(room);

            console.log('new_peer_connected to other in ' + room);
            socket.broadcast.to(room).emit('new_peer_connected',{
                socketId:socket.id
            });

            console.log('get_peers');
            socket.emit('get_peers',{
                "connections": getOther(socket.id,room),
                "you": socket.id
            });
        });

        socket.on('send_ice_candidate',function(data){
            var sendTo = getSocket(data.socketId);
            if(sendTo){
                console.log('send_ice_candidate to ' + data.socketId);
                sendTo.emit('receive_ice_candidate',{
                    label:data.label,
                    candidate:data.candidate,
                    socketId:socket.id
                });
            }
        });

        socket.on('send_offer',function(data){
            var sendTo = getSocket(data.socketId);
            if(sendTo) {
                console.log('send_offer to ' + data.socketId);
                sendTo.emit('receive_offer', {
                    sdp: data.sdp,
                    socketId: socket.id
                })
            }
        });

        socket.on('send_answer', function (data) {
            var sendTo = getSocket(data.socketId);
            if(sendTo) {
                console.log('send_answer to ' + data.socketId);
                sendTo.emit('receive_answer', {
                    sdp: data.sdp,
                    socketId: socket.id
                });
            }
        })

    });
}