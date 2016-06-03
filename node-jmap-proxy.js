global.__base = __dirname + '/';
global.state = { 'auth':{}, 'active':{} };
var config = require('config');
global.imaphost = config.get('IMAP.host');
global.imapport = config.get('IMAP.port');
global.imapssl  = config.get('IMAP.ssl');
global.serverport = config.get('Server.port') || 3000;

var util = require('util');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var Imap = require('imap');
var randomToken = require('random-token').create('abcdefghijklmnopqrstuvwxzyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
var Base64 = require('js-base64').Base64;
var striptags = require('striptags');
var quotedPrintable = require('quoted-printable');
var isHtml = require('is-html');
var busboy = require('express-busboy');
var app = express();
busboy.extend(app, { upload: true, path: config.Server.uploadPath} );
var textmode = (config.Server['utf-8'] == true) ? 'UTF-8' : 'US-ASCII';
var myAuth = require('./lib/authenticate.js');
var myAccounts = require('./lib/accounts.js');
var myMailboxes = require('./lib/mailboxes.js');
var myMessageLists = require('./lib/messagelists.js');
var myMessages = require('./lib/messages.js');

app.options('*',function(req,res) {
  res.set({
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':"Origin, X-Requested-With, Content-Type, Accept, Authorization"
  });
  res.send();
});

app.all('*',function(req,res,next) {
  res.set({
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':"Origin, X-Requested-With, Content-Type, Accept, Authorization"
  });
  next();
});
  

app.post('/authenticate',function (req,res) {
  myAuth.authenticate(req,res);
});
app.post('/.well-known/jmap',function (req,res) {
  myAuth.authenticate(req,res);
});

app.post('/upload',function (req,res) {
  var token = req.get('Authorization');
  if (! token) {
    // token not provided, don't allow
    console.log('token was not provided');
    res.status('401').end();
  } else if (state.active[token] == undefined) {
    console.log(token+': token does not exist');
    // token no longer active, don't allow
    res.status('401').send();
  }
  var user = req.get('X-JMAP-AccountId') || state.active[token].username;
  var files = Object.keys(req.files);
  if (files.length !== 1) {
    res.status('400').send('Only upload one file at a time');
  } else {
    var fobj = req.files[files[0]];
    var blobId = Base64.encode([user,fobj.uuid,fobj.filename].join("\t"))+'.'+unixtime();
    fs.rename(fobj.file,config.Server.uploadPath + '/' + blobId,function(err) {
      // clean up temp file upload dirs
      fs.rmdir(config.Server.uploadPath + '/' + fobj.uuid + '/' + fobj.field,function(err) {
        fs.rmdir(config.Server.uploadPath + '/' + fobj.uuid,function(err) {
          // don't really care about errors
        });
      });
      var response = {'accountId':user,'blobId':blobId,'type':fobj.mimetype,'expires':(unixtime() + config.Server.uploadExpireLength)};
      console.log(state.active[token].username+'/'+token+': uploaded '+fobj.filename+' as '+blobId);
      res.status('201').send(JSON.stringify(response));
    });
  }
});

app.post('/jmap',function (req,res) {
  var token = req.get('Authorization');
  if (! token) {
    // token not provided, don't allow
    console.log('token was not provided');
    res.status('401').end();
    return;
  } else if (state.active[token] == undefined) {
    console.log(token+': token does not exist');
    // token no longer active, don't allow
    res.status('401').send();
    return;
  }

  var method = req.body[0][0];
  var data = req.body[0][1];
  var seq = req.body[0][2];
  var imap = state.active[token].imap;

  if (data && data.ifInState && data.ifInState != state.active[token].state) {
    console.log(state.active[token].username+'/'+token+': state mismatch');
    res.status('200').send(JSON.stringify({'type':'stateMismatch','description':'requested state:'+data.ifInState+' does not match current state:'+state.active[token].state}));
    return;
  }

  var authPromise = new Promise(function(yay,nay){
    if (imap.state == 'authenticated') {
      yay();
    } else if (imap.state == 'disconnected') {
      // socket came unconnected somehow, reconnect
      console.log(state.active[token].username+'/'+token+': disconnected, logging back in');
      imap.once('ready', function() {
        console.log(state.active[token].username+'/'+token+': logged back in');
        yay();
      });
      imap.connect();
    }
  });

  authPromise.then(function() {
    console.log(state.active[token].username+'/'+token+': JMAP request payload='+util.inspect(req.body[0]));
    switch (method) {
      case 'getAccounts':
        myAccounts.getAccounts(token,data,seq,res);
        break;
      case 'getMailboxes':
        myMailboxes.getMailboxes(token,data,seq,res);
        break;
      case 'getMailboxUpdates':
        myMailboxes.getMailboxUpdates(token,data,seq,res);
        break;
      case 'setMailboxes':
        myMailboxes.setMailboxes(token,data,seq,res);
        break;
      case 'getMessageList':
        myMessageLists.getMessageList(token,data,seq,res);
        break;
      case 'setMessages':
        myMessages.setMessages(token,data,seq,res);
        break;
      case 'importMessages':
        myMessages.importMessages(token,data,seq,res);
        break;
    }
  });
});


selectFolder = function(token,folder,force) {
  var imap = state.active[token].imap;
  return new Promise(function(yay,nay){
    var curbox = (imap._box && imap._box.name) ? imap._box.name : null;
    if (curbox == folder && !force) {
      yay();
    } else {
      imap.openBox(folder,function(err,box){
        console.log(state.active[token].username+'/'+token+': selected folder '+folder);
        yay(box);
      });
    }
  });
};

setFlags = function(token,folder,uid,mode,flags) {
  var imap = state.active[token].imap;
  var selectPromise = selectFolder(token,folder);
  selectPromise.then(function() {
    return new Promise(function(yay,nay) {
      if (flags.length > 0) {
        var cmd = 'UID STORE '+uid+' '+mode+' ('+flags.join(' ')+')';
        console.log(state.active[token].username+'/'+token+': '+cmd);
        imap._enqueue(cmd,function(err,result){
          if (err) {
            console.log(state.active[token].username+'/'+token+': '+err);
            yay();
          } else {
            yay(true);
          }
        });
      } else {
        yay();
      }
    });
  });
};

moveMessage = function(token,folder,uid,destfolder) {
  var imap = state.active[token].imap;
  var selectPromise = selectFolder(token,folder);
  selectPromise.then(function() {
    return new Promise(function(yay,nay) {
      var cmd = 'UID MOVE '+uid+' "'+destfolder+'"';
      console.log(state.active[token].username+'/'+token+': '+cmd);
      imap._enqueue(cmd,function(err,result){
        if (err) {
          console.log(state.active[token].username+'/'+token+': '+err);
          yay();
        } else {
          yay(true);
        }
      });
    });
  });
};

parseToEmailer = function(str) {
  if (str) {
    var res = {'name':'','email':''};
    if (str.indexOf('<') > -1) {
      var a = str.match(/(.*)\<(.*)\>/);
      res.name = a[1].trim();
      res.email = a[2].trim();
    } else {
      res.email = str;
    }
    return res;
  } else {
    return null;
  }
};

preview_from_body = function(str) {
  str = str.substr(0,16000);
  // striptags can't deal with multiline <style> sections
  var a = str.indexOf('<style');
  var b = str.indexOf('</style>');
  if (b) {
    preview = str.slice(0,a) + '<style>' + str.slice(b);
  }
  preview = striptags(preview).trim().replace(/&nbsp;/g,' ').substr(0,256);
  return preview;
};

function appendMessage(token,clientId,msg) {
  var imap = state.active[token].imap;
  var file = config.Server.uploadPath + '/' + msg.blobId;
  var folder = msg.mailboxIds[0]; // only support a single folder
  var flagState = flags_from_msg(msg);
  var stats = fs.statSync(file);
  var size = stats.size;
  var msgBuffer = fs.readFileSync(file);
  return new Promise(function(yay,nay){
    var selectPromise = selectFolder(token,folder,true);
    selectPromise.then(function(box) {
      var uid = box.uidnext; // select tells us what the UID will be
      console.log(state.active[token].username+'/'+token+': calling imap APPEND');
      imap.append(msgBuffer,{'mailbox':folder,'flags':flagState.plusFlags},function(err){
        if (err) {
          if (err.textCode == 'OVERQUOTA') {
            yay({'clientId':clientId,'data':{'type':'maxQuotaReached','description':'imap error: '+err}});
          } else {
            yay({'clientId':clientId,'data':{'type':'internalError','description':'imap error: '+err}});
          }
        } else {
          var id = newId(folder,uid);
          yay({'clientId':clientId,'data':{'id':id,'threadId':id,'blobId':id,'size':size}});
        }
      });
    });
  });
};
    
function newId(folder,uid) {
  return Base64.encode(folder+"\t"+uid)
}

function flags_from_msg(msg) {
  var ret = {'plusFlags':[],'minusFlags':[]};
  if ("isFlagged" in msg) {
    if (msg.isFlagged == true) {
      ret.plusFlags.push('\FLAGGED');
    } else {
      ret.minusFlags.push('\FLAGGED');
    }
  }
  if ("isUnread" in msg) {
    if (msg.isFlagged == true) {
      ret.minusFlags.push('\SEEN');
    } else {
      ret.plusFlags.push('\SEEN');
    }
  }
  if ("isAnswered" in msg) {
    if (msg.isFlagged == true) {
      ret.plusFlags.push('\ANSWERED');
    } else {
      ret.minusFlags.push('\ANSWERED');
    }
  }
  if ("isDraft" in msg) {
    if (msg.isFlagged == true) {
      ret.plusFlags.push('\DRAFT');
    } else {
      ret.minusFlags.push('\DRAFT');
    }
  }
  return ret;
}

app.listen(serverport, function () {
  console.log('JMAP proxy listening on port '+serverport);
  if (imapssl) {
    console.log('proxying IMAP requests to '+imaphost+':'+imapport+' using SSL');
  } else {
    console.log('proxying IMAP requests to '+imaphost+':'+imapport);
  }
});

unixtime = function() {
  return parseInt((new Date).getTime());
}

// cleanup scans upload dirs and removes files that have expired
cleanup = function() {
  fs.readdir(config.Server.uploadPath,function(err,files) {
    files.forEach(function(file){
      var a = file.match(/\.(\d+)$/);
      if (a[1]) {
        var removetime = unixtime() + config.Server.uploadExpireLength;
        if (a[1] > removetime) {
          fs.unlink(config.Server.uploadPath + '/' + file,function(err){
            if (err) {
              console.log('cleanup: failed to remove '+file);
            } else {
              console.log('cleanup: removed expired upload file '+file);
            }
          });
        }
      }
    });
  });
  setTimeout(function() { cleanup() },config.Server.cleanupTime);
};
cleanup();
