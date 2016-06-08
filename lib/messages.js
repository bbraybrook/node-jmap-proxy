var Imap = require('imap');
var config = require('config');
var myImap = require(__base + 'lib/imap.js');
var myUtil = require(__base + 'lib/util.js');
var isHtml = require('is-html');
var quotedPrintable = require('quoted-printable');
var fs = require('fs');

exports._getMessages = function(token,idlist) {
  var imap = state.active[token].imap;
  return new Promise(function(yay, nay) {
    var promise = Promise.resolve(null);
    var messages = [];
    // sequential promise loop from https://www.joezimjs.com/javascript/patterns-asynchronous-programming-promises/
    // must be done in sequence as there is no guarantee all messages are from the same folder, and the folder
    // select could switch folders prior to a message being retrieved if we allow this to run asynchronously
    idlist.forEach(function(id){
      var a = Base64.decode(id).split("\t");
      var folder = a[0];
      var uid = a[1];
      promise = promise.then(function() {
        var myuid = uid;
        return getMessage(token,folder,uid);
      }).then(function(result){
        messages.push(result);
      });
    });
    return promise.then(function() {
      yay(messages);
    });
  });
}
  
exports.getMessage = function(token,folder,uid) {
  return new Promise(function(yay,nay){
    var imap = state.active[token].imap;
    var id = myUtil.newId(folder,uid);
    var thismsg = {'id':id,'blobId':id,threadId:id,mailboxIds:[folder],'preview':'','textBody':'','htmlBody':'','attachments':[],'attachedMessages':[]};
    // use these to sort out how to retrieve the body
    var hasText = false;
    var hasHtml = false;
    var bodyIsMessage = true;
    var selectPromise = myImap.selectFolder(token,folder);
    selectPromise.then(function(){
      var promise1 = new Promise(function(yay,nay){
        var fetch = imap.fetch(uid,{'struct':true,'size':true,'bodies':['HEADER']});
        fetch.on('message',function(msgevent,thismsgid){
          msgevent.on('attributes',function(attrs){
            thismsg.isUnread = attrs.flags.indexOf('\Seen') > -1 ? false : true;
            thismsg.isFlagged = attrs.flags.indexOf('\Flagged') > -1 ? true : false;
            thismsg.isAnswered = attrs.flags.indexOf('\Answered') > -1 ? true : false;
            thismsg.isDraft = attrs.flags.indexOf('\Draft') > -1 ? true : false;
            thismsg.date = attrs.date;
            thismsg.size = attrs.size;

            // sort out attachments
            var structjunk = attrs.struct.shift();
            for (var i in attrs.struct) {
              var obj = attrs.struct[i][0];
              if (!hasText && obj.type == 'text' && obj.subtype == 'plain') {
                hasText = {'part':obj.partID,'encoding':obj.encoding};
                bodyIsMessage = false;
              } else if (!hasHtml && obj.type == 'text' && obj.subtype == 'html') {
                hasHtml = {'part':obj.partID,'encoding':obj.encoding};
                bodyIsMessage = false;
              } else {
                // an attachment we should track
                var attach = {
                  'blobId': id + Base64.encode("\tBody."+obj.partID),
                  'type': obj.type + '/' + obj.subtype,
                  'name': obj.description,
                  'size': obj.size,
                  'cid': 'TDB',
                  'isInline': (obj.disposition && obj.disposition.type && obj.disposition.type == 'inline') ? true : false,
                  'width': null,
                  'height': null
                };
                thismsg.attachments.push(attach);
              }
            }
          });
          msgevent.on('body',function(stream,info){
            var buffer = '';
            stream.on('data',function(chunk){
              buffer += chunk;
            });
            stream.on('end',function(){
              var headers = {};
              var a = buffer.split("\n");
              var hdr = '';
              for (var j in a) {
                a[j] = a[j].replace(/\r/g,'');
                if (a[j].charAt(0) == ' ' || a[j].charAt(0) == "\t") {
                  a[j] = a[j].replace(/\t/g,'');
                  headers[hdr] += ' ' + a[j];
                } else {
                  var b = a[j].split(': ');
                  hdr = b.shift().toLowerCase();
                  if (headers[b[0]]) {
                    headers[hdr] += "\n" + b.join(': ');
                  } else {
                    headers[hdr] = b.join(': ');
                  }
                }
              }
              thismsg.headers = headers;
              thismsg.sender = myUtil.parseToEmailer(headers['return-path']);
              thismsg.from = myUtil.parseToEmailer(headers['from']);
              thismsg.to = myUtil.parseToEmailer(headers['to']);
              thismsg.cc = myUtil.parseToEmailer(headers['cc']);
              thismsg.bcc = myUtil.parseToEmailer(headers['bcc']);
              thismsg.replyto = myUtil.parseToEmailer(headers['reply-to']);
              thismsg.subject = headers['subject'];
            });
          });
          msgevent.on('end',function(){
            yay(); // satisfy promise1
          });
        }); // end of fetch.on
      }); // end of promise1
      promise1.then(function(){
        console.log(state.active[token].username+'/'+token+': requesting body for uid '+uid+' bodyIsMessage='+bodyIsMessage+' hasHtml='+hasHtml+' hasText='+hasText);
        var fetch;
        var buffer = '';
        if (bodyIsMessage == true) {
          fetch = imap.fetch(uid,{'bodies':['TEXT']});
        } else if (hasHtml) {
          fetch = imap.fetch(uid,{'bodies':[hasHtml.part]});
        } else if (hasText) {
          fetch = imap.fetch(uid,{'bodies':[hasText.part]});
        }
        fetch.on('message',function(msgevent,thismsgid){
          msgevent.on('body',function(stream,info){
            var buffer = '';
            stream.on('data',function(chunk){
              buffer += chunk;
            });
            stream.on('end',function(){
              if (hasHtml) {
                thismsg.htmlBody = buffer;
              } else {
                var body = '';
                if (thismsg.headers['content-transfer-encoding'] && thismsg.headers['content-transfer-encoding'] == 'base64') {
                  body = Base64.decode(buffer);
                } else if (hasText && hasText.encoding == 'quoted-printable') {
                  body = quotedPrintable.decode(buffer);
                } else {
                  body = buffer;
                }
                if (isHtml(body)) {
                  thismsg.htmlBody = body;
                } else {
                  thismsg.textBody = body;
                }
              }
              thismsg.preview = myUtil.preview_from_body(thismsg.textBody || thismsg.htmlBody);
              yay(thismsg); // return to getMessage() caller
            });
          });
        });
      });
      promise1.catch(function(err){ log(err); });
    });
    selectPromise.catch(function(err){ log(err); });
  }); // end of promise
};

exports.importMessages = function(token,data,seq,res) {
  var imap = state.active[token].imap;
  var user = data.accountId || state.active[token].username;
  var response = {'created':{},'notCreated':{}};
  if (!data.messages) {
    res.status('200').send(JSON.stringify({'type':'invalidArguments','description':'must provide messages'}));
    return;
  }

  var toDo = [];
  var clientIds = Object.keys(data.messages);
  
  var promise = Promise.resolve(null);
  var messages = [];
  // sequential promise loop from https://www.joezimjs.com/javascript/patterns-asynchronous-programming-promises/
  // must be done in sequence so we can get uidnext each time
  Object.keys(data.messages).forEach(function(clientId) {
    var msg = data.messages[clientId];
    var file = config.Server.uploadPath + '/' + msg.blobId;
    if (!fs.existsSync(file)) {
      response.notCreated[clientId] = {'type':'notFound','description':'blobId not found. perhaps expired?'};
    } else {
      promise = promise.then(function() {
        return myImap.appendMessage(token,clientId,msg).then(function(res){
          if (res.data.type) {
            // error
            response.notCreated[res.clientId] = res.data;
          } else {
            response.created[res.clientId] = res.data;
          }
        }).catch(function(err){console.log('appenderror:'+err)});;
      });
    }
  });
  return promise.then(function() {
    res.status('201').send(JSON.stringify([['messages',response,seq]]));
  });
}

exports.setMessages = function(token,data,seq,res) {
  var imap = state.active[token].imap;
  if (data.ifInState && data.ifInState != state.active[token].state) {
    res.status('200').send(JSON.stringify({'type':'stateMismatch','description':'requested state:'+data.ifInState+' does not match current state:'+state.active[token].state}));
    return;
  }
  if (data.destroy) {
    // note: we will set \Deleted flag on each message, then purge
    var purgePromise = purgeMessages(token,data.destroy);
    purgePromise.then(function(result){
      // TBD - respond to client
    });
    purgePromise.catch(function(err){ 
      log(err); 
      // TBD - respond to client
    });
  } else if (data.create) {
    // TBD
  } else if (data.update) {
    var messages = isArray(data.update) ? data.update : [data.update];
    var response = {};
    var promises = [];
    messages.forEach(function(msg){
      var msgPromise = new Promise(function(msgYay,msgNay) {
        var msgUpdated = false;
        if (!msg.id) {
          response.notUpdated.push({'type':'invalidArguments','description':'must provide message id property'});
          return;
        }
        var a = Base64.decode(msg.id).split("\t");
        var folder = a[0];
        var uid = a[1];
        var selectPromise = myImap.selectFolder(token,folder);
        selectPromise.then(function(){
          var flagPromise = new Promise(function(yay, nay) {
            if (msg.isFlagged || msg.isUnread || msg.isAnswered) {
              // changing flags
              var flagState = myUtil.flags_from_msg(msg);
              var plusPromise = myImap.setFlags(token,folder,uid,'+FLAGS',flagState.plusFlags);
              plusPromise.then(function(plusRes) {
                if (plusRes == true) {
                  msgUpdated = true;
                } else {
                  var myres = {};
                  myres[msg.id] = {'type':'internalError','description':'failed to store +FLAGS'};
                  response.notUpdated.push(myres);
                }
                var minusPromise = myImap.setFlags(token,folder,uid,'-FLAGS',flagState.minusFlags);
                minusPromise.then(function(minusRes) {
                  if (minusRes == true) {
                    msgUpdated = true;
                  } else {
                    var myres = {};
                    myres[msg.id] = {'type':'internalError','description':'failed to store -FLAGS'};
                    response.notUpdated.push(myres);
                  }
                  yay();
                });
              });
            } else {
              yay();
            }
          });
          flagPromise.then(function(){
            var folderPromise = new Promise(function(yay, nay) {
              if (msg.mailboxIds) {
                if (msg.mailboxIds.length > 1) {
                  // we don't allow a message to exist in multiple mailboxes
                  if (!response.notUpdated) response.notUpdated = [];
                  response.notUpdated.push({'type':'invalidArguments','description':'cannot move message into multiple mailboxes'});
                  yay();
                } else {
                  // can move
                  var newfolder = msg.mailboxIds[0];
                  if (curfolder !== newfolder) {
                    var movePromise = myImap.moveMessage(token,folder,uid,newfolder);
                    movePromise.then(function(moveRes){
                      if (minusRes == true) {
                        msgUpdated = true;
                      } else {
                        var myres = {};
                        myres[msg.id] = {'type':'internalError','description':'failed to move message'};
                        response.notUpdated.push(myres);
                      }
                      if (msgUpdated) {
                        if (!response.updated) response.updated = [];
                        response.updated.push(msg.id);
                      }
                    });
                  } else {
                    // not actually moving, why bother including the property?
                    yay();
                  }
                }
              } else {
                yay();
              }
            });
          });
          flagPromise.then(function() {
            msgYay();
          });
        });
      });
      promises.push(msgPromise);
    });
    Promise.all(promises).then(function() {
      res.status('201').send(JSON.stringify([['messages',response,seq]]));
    });
  }
};

function purgeMessages(token,idlist) {
  var imap = state.active[token].imap;
  return new Promise(function(yay,nay){
    var promises = [];
    // we need a list of already \Deleted flagged messages, so we can unflag them,
    // purge, then reflag them
    var deleted = {};
    idlist.forEach(function(id){
      var a = Base64.decode(id).split("\t");
      var folder = a[0];
      var mid = a[1];
      if (!deleted[folder]) deleted[folder] = {'current':[],'todo':[]};
      deleted[folder].todo.push(mid);
    });
    Object.keys(deleted).forEach(function(folder){
      var deletedPromise = new Promise(function(yay,nay){
        var selectPromise = myImap.selectFolder(token,folder);
        selectPromise.then(function(){
          var cmd = 'UID SEARCH DELETED';
          console.log(state.active[token].username+'/'+token+': '+cmd);
          imap._enqueue(cmd,function(err,result){
            deleted[folder].current = result;
            if (result.length > 0) {
              var flag1promise = new Promise(function(yay2,nay2){
                var cmd = 'UID STORE ' + result.join(',') + ' -FLAGS (\Deleted)';
                console.log(state.active[token].username+'/'+token+': '+cmd);
                imap._enqueue(cmd,function(err,result){ yay(); yay2(); });
              });
              promises.push(flag1promise);
            }
          });
        });
      });
      promises.push(deletedPromise);
    });
    Promise.all(promises).then(function() {
      // we have finished finding \Deleted messages and temporarily reflagging them

      // must be done in sequence as there is no guarantee all messages are from the same folder, and the folder
      // select could switch folders prior to a message being deleted if we allow this to run asynchronously
      var promise = Promise.resolve(null);
      var deletedPromise = new Promise(function(yay,nay){
        var selectPromise = myImap.selectFolder(token,folder);
        selectPromise.then(function(){
          var cmd = 'UID STORE ' + deleted[folder].todo.join(',') + ' +FLAGS (\Deleted)';;
          console.log(state.active[token].username+'/'+token+': '+cmd);
          imap._enqueue(cmd,function(err,result){ 
            var cmd = 'EXPUNGE';
            console.log(state.active[token].username+'/'+token+': '+cmd);
            imap._enqueue(cmd,function(err,result){
              yay(); 
            });
          });
        });
        selectPromise.catch(function(err){ log(err); });
      });
      deletedPromise.then(function(){
        if (deleted[folder].current.length > 1) {
          var selectPromise = myImap.selectFolder(token,folder);
          selectPromise.then(function(){
            var cmd = 'UID STORE ' + result.join(',') + ' -FLAGS (\Deleted)';
            console.log(state.active[token].username+'/'+token+': '+cmd);
            imap._enqueue(cmd,function(err,result){ yay(); });
          });
        } else {
          // nothing to reset
          // return?
        }
      });
    });
  });
};
