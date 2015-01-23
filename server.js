/**
 * Created by xmmwc on 15/1/22.
 **/

var express = require('express');
var webrtc = require('./lib/webrtc');

var server = webrtc.listen(8080);

var client = express();

client.use(express.static(__dirname + '/public'));
client.get('/io',function(req,res){
    server.serve(req,res);
});
client.get('/',function(req,res){
    res.sendFile(__dirname + '/public/index.html');
});
var app = client.listen(9090,function() {
    console.log('客户端在' + app.address().address + '的9090端口');
});

