/**
 * Created by xmmwc on 15/1/22.
 **/

var express = require('express');
var webrtc = require('./lib/webrtc');
var path = require('path');
var router = express.Router();


var client = express();

client.set('views',path.join(__dirname,'public'));
client.engine('.html', require('ejs').__express);
client.set('view engine', 'html');


client.use(express.static(path.join(__dirname,'public')));

router.get('/',function(req,res,next){
    res.render('index',{
        title:'p2p聊天室'
    });
});

client.use('/',router);

var app = client.listen(9010,function() {
    console.log('客户端在' + app.address().address + '的' + app.address().port + '端口');
});
webrtc.listen(app);

