/**
 * Created by xmmwc on 15/1/22.
 **/

var express = require('express');
var webrtc = require('./lib/webrtc');

var server = webrtc.listen(9011);

var client = express();

client.use(express.static(__dirname + '/public'));
client.get('/',function(req,res){
    res.sendFile(__dirname + '/public/index.html');
});
var app = client.listen(9010,function() {
    console.log('客户端在' + app.address().address + '的' + app.address().port + '端口');
});

