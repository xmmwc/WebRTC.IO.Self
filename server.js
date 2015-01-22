/**
 * Created by xmmwc on 15/1/22.
 **/

var io = require('socket.io');
var express = require('express');
var webrtc = require('webrtc.io').listen(8080);

var client = express();
client.use(express.static(__dirname + '/public'));
client.get('/io',function(req,res){
    io().serve(req,res);
});
client.get('/',function(req,res){
    res.sendFile(__dirname + '/public/index.html');
});
var app = client.listen(9090,function() {
    console.log('客户端在' + app.address().address + '的80端口');
});

