// some promise based imap commands

var Imap = require('imap');
var myUtil = require(__base + 'lib/util.js');
var fs = require('fs');
var config = require('config');

exports.selectFolder = function(token,mailbox) {
  var imap = state.active[token].imap;
  return new Promise(function(yay,nay){
    var curbox = (imap._box && imap._box.name) ? imap._box.name : null;
    if (curbox == mailbox) {
      yay(imap._box);
    } else {
      imap.openBox(mailbox,function(err,box){
        console.log(state.active[token].username+'/'+token+': selected mailbox '+mailbox);
        yay(box);
      });
    }
  });
};

exports.setFlags = function(token,folder,uid,mode,flags) {
  var imap = state.active[token].imap;
  var selectPromise = exports.selectFolder(token,folder);
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

exports.moveMessage = function(token,folder,uid,destfolder) {
  var imap = state.active[token].imap;
  var selectPromise = exports.selectFolder(token,folder);
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

exports.appendMessage = function(token,clientId,msg) {
  var imap = state.active[token].imap;
  var file = config.Server.uploadPath + '/' + msg.blobId;
  var folder = msg.mailboxIds[0]; // only support a single folder
  var flagState = myUtil.flags_from_msg(msg);
  var stats = fs.statSync(file);
  var size = stats.size;
  var msgBuffer = fs.readFileSync(file);
  return new Promise(function(yay,nay){
    var selectPromise = exports.selectFolder(token,folder);
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
          var id = myUtil.newId(folder,uid);
          yay({'clientId':clientId,'data':{'id':id,'threadId':id,'blobId':id,'size':size}});
        }
      });
    }).catch(function(err){ console.log('error on select:'+err); });
  });
};
