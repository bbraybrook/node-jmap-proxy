var util = require('util');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var busboy = require('express-busboy');
var Imap = require('imap');
var randomToken = require('random-token').create('abcdefghijklmnopqrstuvwxzyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
var Base64 = require('js-base64').Base64;
var striptags = require('striptags');
var quotedPrintable = require('quoted-printable');
var isHtml = require('is-html');
var config = require('config');
var app = express();
//app.use(bodyParser.json());
//app.use(bodyParser.urlencoded({extended: true})); 
busboy.extend(app, { upload: true, path: './upload'} );
//busboy.extend(app, { upload: true } );
var textmode = (config.Server['utf-8'] == true) ? 'UTF-8' : 'US-ASCII';
var state = { 'auth':{}, 'active':{} };

if (process.env.NODE_ENV === 'development') {
  var errorhandler = require('errorhandler');
  app.use(errorhandler())
};

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
  authenticate(req,res);
});
app.post('/.well-known/jmap',function (req,res) {
  authenticate(req,res);
});

function authenticate(req,res) {
  if (req.body.username) {
    var token = randomToken(16);
    console.log(req.body.username+'/'+token+': in pre-auth');
    state.auth[token] = {'username':req.body.username};
    var response = {'continuationToken':token,'methods':['password'],'prompt':'Password:'};
    res.status('200').send(JSON.stringify(response));
  } else if (req.body.token) {
    if (!state.auth[req.body.token]) {
      // auth token is missing or expired - client must restart
      res.status('403').end();
    }
    var username = state.auth[req.body.token].username;
    var imap = new Imap({
      user: username,
      password: req.body.password,
      host: imaphost,
      port: imapport,
      tls: (imapssl) ? true : false
    });
    imap.once('ready', function() {
      var token = randomToken(32);
      state.active[token] = {
        'username':username,
        'password':req.body.password,
        'imap':imap,
        'mailboxes':{},
        'state': 0
      };
      delete state.auth[req.body.token]; // remove auth state token
      console.log(username+'/'+req.body.token+': auth successful. new token='+token);
      var response = {'username':username,'accessToken':token,'versions':[1],'extensions':[],'api':'/jmap/','eventSource':'/event','upload':'/upload','download':'/download','api':'/jmap','eventSource':'/event','upload':'/upload','download':'/download'};
      res.status('201').send(JSON.stringify(response));
    });
    imap.once('error', function() {
      // login failure. tell client to retry
      console.log(username+'/'+req.body.token+': auth failure');
      res.status('401').send('');
    });
    imap.connect();
  } else {
    // malformed request - client must restart
    console.log('bad auth request!');
    console.log(util.inspect(req.body,false,null));
    res.status('400').end();
  }
};

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
  console.log(util.inspect(req));
  var files = Object.keys(req.files);
  if (files.length !== 1) {
    res.status('400').send('Only upload one file at a time');
  } else {
    var fobj = req.files[files[0]];
    var blobId = Base64.encode([user,fobj.uuid,fobj.filename].join("\t"))+'.'+(new Date).getTime();
    fs.rename(fobj.file,config.Server.uploadPath + '/' + blobId,function(err) {
      // clean up temp file upload dirs
      fs.rmdir(config.Server.uploadPath + '/' + fobj.uuid + '/' + fobj.field,function(err) {
        fs.rmdir(config.Server.uploadPath + '/' + fobj.uuid,function(err) {
          // don't really care about errors
        });
      });
      console.log('account='+user+' uuid='+fobj.uuid+' filename='+fobj.filename+' blobId='+blobId);
      var response = {'accountId':user,'blobId':blobId,'type':fobj.mimetype,'expires':((new Date).getTime() + config.Server.uploadExpireLength)};
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
  } else if (state.active[token] == undefined) {
    console.log(token+': token does not exist');
    // token no longer active, don't allow
    res.status('401').send();
  } else {
    console.log(state.active[token].username+'/'+token+': JMAP request payload='+util.inspect(req.body[0]));
    var method = req.body[0][0];
    var data = req.body[0][1];
    var seq = req.body[0][2];
    switch (method) {
      case 'getAccounts':
        getAccounts(token,data,seq,res);
        break;
      case 'getMailboxes':
        getMailboxes(token,data,seq,res);
        break;
      case 'getMailboxUpdates':
        getMailboxUpdates(token,data,seq,res);
        break;
      case 'getMessageList':
        getMessageList(token,data,seq,res);
        break;
      case 'setMessages':
        setMessages(token,data,seq,res);
        break;
    }
  }
});

// getAccounts
// return a list of accounts for this login
// we'll just return a single account
getAccounts = function(token,data,seq,res) {
  var response = [['accounts',{'list':[]},seq]];
  response[0][1].list[0] = {
    'id':state.active[token].username,
    'name':state.active[token].username,
    'isPrimary': true,
    'capabilities':{'maxSizeUpload':1000000000},
    'hasMail': true,
    'mail':{
      'isReadOnly':false,
      'maxSizeMessageAttachments':50000000,
      'canDelaySend':false,
      'messageListSortOptions': [ 'id','date','subject','from','to','internaldate' ],
    },
    'hasContacts': false,
    'contacts': null,
    'hasCalendars': false,
    'calendars': null
  };
  res.status('200').send(JSON.stringify(response));
};

// getMailboxes
// we must get a list of mailboxes
// then select each one to get the count of messages
function getMailboxes(token,data,seq,res) {
  var account = data.accountId;
  var imap = state.active[token].imap;
  imap.getBoxes(function(err,boxes){
    var response = {'accountId':account,'notFound':null,'state':null,'list':[]};

    // get a list of mailboxes with most data
    iterate_getMailboxes(response,boxes,null); // sync

    // select each mailbox to find the message count
    var promises = [];
    for (var i in response.list) {
      var id = response.list[i].id;
      var name = response.list[i].name;
      if (response.list[i].mayReadItems == true) {
        state.active[token].mailboxes[id] = {
          'name':name,
          'i':i
        } // store for getMailboxUpdates
        var promise = new Promise(function(resolve, reject){
          var pi = i;
          var pid = id;
          imap.openBox(pid,function(err,box){
            if (err) {
              reject({'id':pid,'i':pi,'err':err});
            }
            if (box.messages) {
              resolve({id:pid,'i':pi,'new':box.messages['new'], 'total':box.messages.total,'uidnext':box.uidnext});
            }
          });
        });
        promises.push(promise);
        promise.then(function(obj){
          response.list[obj.i].totalMessages = obj.total;
          response.list[obj.i].unreadMessages = obj['new'];
          state.active[token].mailboxes[obj.id].uidnext = obj.uidnext;
          state.active[token].mailboxes[obj.id].total = obj.total;
          state.active[token].mailboxes[obj.id]['new'] = obj['new'];
        });
        promise.catch(function(err){ log(err); });
      }
    }
    Promise.all(promises).then(function() {
      var date = new Date;
      response.state = date.getTime();
      state.active[token].state = response.state; // store the state for getMailboxUpdates
// temporary until roundcube sorts properly
      var resort = [];
      for (var i = 1; i < 4; i++) {
        for (var j in response.list) {
          if (response.list[j].sortOrder == i) {
            resort.push(response.list[j]);
          }
        }
      }
      response.list = resort;
// end temporary
      res.status('200').send(JSON.stringify([['mailboxes',response,seq]]));
    });
  });
};

// getMailboxUpdates
// select each mailbox, compare the message counts and uidnext to what is stored in state
// report on any changes
function getMailboxUpdates(token,data,seq,res) {
  var account = data.accountId;
  var imap = state.active[token].imap;
  var response = {
    'accountId': account,
    'oldState': state.active[token].state,
    'newState': state.active[token].state,
    'changed': [],
    'removed': [], // TBD
    'onlyCountsChanged': true
  };
  // select each mailbox to find the message count
  var promises = [];
  for (var id in state.active[token].mailboxes) {
    var promise = new Promise(function(resolve, reject){
      var pid = id;
      imap.openBox(pid,function(err,box){
        if (err) {
          reject({'id':pid,'i':pi,'err':err});
        }
        if (box.messages) {
          resolve({id:pid,'new':box.messages['new'], 'total':box.messages.total,'uidnext':box.uidnext});
        }
      });
    });
    promises.push(promise);
    promise.then(function(obj){
      if (obj.uidnext !== state.active[token].mailboxes[obj.id].uidnext) {
        response.onlyCountsChanged = false;
      }
      if (obj.total !== state.active[token].mailboxes[obj.id].total) {
        response.changed.push(obj.id);
      } else if (obj['new'] !== state.active[token].mailboxes[obj.id]['new']) {
        response.changed.push(obj.id);
      }
      state.active[token].mailboxes[obj.id].uidnext = obj.uidnext;
      state.active[token].mailboxes[obj.id].total = obj.total;
      state.active[token].mailboxes[obj.id]['new'] = obj['new'];
    });
    promise.catch(function(err){ log(err); });
  }
  Promise.all(promises).then(function() {
    var date = new Date;
    response.newState = date.getTime();
    state.active[token].state = response.newState;
    res.status('200').send(JSON.stringify([['mailboxes',response,seq]]));
  });
};

iterate_getMailboxes = function(response,boxes,parentmb) {
  for (var mailbox in boxes) {
    var obj = boxes[mailbox];
    var entry = {'name':mailbox};
    if (parentmb) {
      entry.id = parentmb + obj.delimiter + mailbox;
      entry.parentId = parentmb;
    } else {
      entry.id = mailbox;
      entry.parentId = null;
    }
    if (mailbox == 'INBOX' && !parentmb) {
      entry.sortOrder = 1;
      entry.role = 'inbox';
      entry.mayRename = false;
      entry.mayDelete = false;
    } else if (boxes[mailbox].special_use_attrib && config.Server.prefer_RFC6154) {
      entry.sortOrder = 2;
      if (boxes[mailbox].special_use_attrib.indexOf('\\Trash') > -1) {
        entry.role = 'trash';
      } else if (boxes[mailbox].special_use_attrib.indexOf('\\Sent') > -1) {
        entry.role = 'sent';
      } else if (boxes[mailbox].special_use_attrib.indexOf('\\Drafts') > -1) {
        entry.role = 'drafts';
      } else if (boxes[mailbox].special_use_attrib.indexOf('\\Junk') > -1) {
        entry.role = 'spam';
      }
      entry.mayRename = false;
      entry.mayDelete = false;
    } else if (config.Options.special_folders[entry.id]) {
      entry.sortOrder = 2;
      entry.role = config.Options.special_folders[mailbox];
      entry.mayRename = false;
      entry.mayDelete = false;
    } else {
      entry.sortOrder = 3;
      entry.mayRename = true;
      entry.mayDelete = true;
    }
    entry.mustBeOnlyMailbox = true;
    entry.mayReadItems = true;
    entry.mayAddItems = true;
    entry.mayRemoveItems = true;
    entry.mayCreateChild = true;
    entry.totalMessages = 0;
    entry.unreadMessages = 0;
    entry.totalThreads = 0;
    entry.unreadThreads = 0;
    if (!obj.delimiter || (boxes[mailbox].special_use_attrib && boxes[mailbox].special_use_attrib.indexOf('\\NOSELECT') > -1)) {
      // not a selectable mailbox
      entry.mayReadItems = false;
      entry.mayAddItems = false;
      entry.mayRemoveItems = false;
    }
    response.list.push(entry);
    if (obj.children) {
      iterate_getMailboxes(response,obj.children,entry.id)
    }
  }
};

function getMessageList(token,data,seq,res) {
  var response = [];
  var sort = data.sort;
  var direction = 'decending'; // default sort order
  if (sort.indexOf(' ') > -1) {
    var a = sort.split(' ');
    sort = a[0];
    if (a[1] == 'asc') {
      direction = 'ascending';
    }
  }
  var folder = data.filter.inMailboxes[0];
  var account = state.active[token].username;
  var limit = data.limit || 25;
  if (limit == 1) { limit = 0 };
  var position = data.position || 0;
  var fetchmessages = (data.fetchMessages && !data.fetchThreads) ? true : false;
  response[0] = {
    'accountId':account, 
    'filter':data.filter, 
    'sort':data.sort, 
    'state':state.active[token].state, 
    'canCalculateUpdates': false, 
    'collapseThreads': true, 
    'position':0, 
    'total':0, 
    'threadIds': [],
    'messageIds': []
  };
  var imap = state.active[token].imap;

  // must call imap SORT/SEACH to deal with the request
  imap.openBox(folder,false,function(err,box){
    if (err) { return; }
    if (box.messages.total < 1) {
      // no messages
    } else {
      var uids = [];
      var uidlist;
      var searchPromise = new Promise(function(yay, nay) {
        var cmd = 'UID SEARCH NOT DELETED '; // jmap never uses deleted state
        if (Object.keys(data.filter).length > 1) {
          if ('after' in data.filter) cmd += 'SINCE "' + data.filter.after + '"';
          if ('minsize' in data.filter) cmd += 'LARGER "' + data.filter.minsize + '"';
          if ('maxsize' in data.filter) cmd += 'SMALLER "' + data.filter.maxsize + '"';
          // threadIsFlagged - PITA to support
          // threadIsUnread - PITA to support
          if ('isFlagged' in data.filter) cmd += 'FLAGGED';
          if ('isUnread' in data.filter) cmd += 'NEW';
          if ('isAnswered' in data.filter) cmd += 'ANSWERED';
          if ('isDraft' in data.filter) cmd += 'DRAFT';
          // hasAttachment - PITA to support
          var textconds = ['FROM','TO','CC','BCC','SUBJECT'];
          if ('text' in data.filter) { // no body searches, doesn't align with IMAP text search either
            cmd += 'OR';
            for (var i in textconds) {
              var cond = textconds[i];
              cmd += ' ' + cond + ' "'+ data.filter.text + '"';
            }
          }
          // body - no body searches
          var simpleconds = ['before','from','to','cc','bcc','subject'];
          for (var i in simpleconds) {
            var cond = simpleconds[i];
            if (cond in data.filter) cmd += cond.toUpperCase() + ' "' + data.filter[cond] + '"';
          }
          console.log(state.active[token].username+'/'+token+': '+cmd);
          imap._enqueue(cmd,function(err,result){
            if (result.length > limit) {
              yay(result.slice(0,limit));
            } else {
              yay(result);
            }
          });
        } else {
          yay(['1:*']) ; // no search, let sort see all messages
        }
      });
      searchPromise.then(function(result) {
        var uidlist = result;
        var sortPromise = new Promise(function(yay, nay) {
          var cmd = 'UID SORT (' + sort.toUpperCase() + ') UTF-8 '+result.join(',');
          console.log(state.active[token].username+'/'+token+': '+cmd);
          imap._enqueue(cmd,function(err,result){
            if (result.length > limit) {
              yay(result.slice(0,limit));
            } else {
              yay(result);
            }
          });
        });

        sortPromise.then(function(result) {
          var uids = result;
          for (var i in uids) {
            response[0].messageIds.push(Base64.encode(folder+"\t"+uids[i]));
          }

          var threadPromise = new Promise(function(yay, nay) {
            var threads = [];
            var cmd = 'UID THREAD ' + config.Server['threads'] + ' ' + textmode +' 1:*'; // must call for all messages to find all threads
            console.log(state.active[token].username+'/'+token+': '+cmd);
            imap._enqueue(cmd,function(err,result){
              // the UID values may or may not be strings, always force to string
              for (var i in result) {
                for (var j in result[i]) {
                  result[i][j] = result[i][j].toString();
                }
                for (var k in uids) {
                  var pos = result[i].indexOf(uids[k].toString());
                  if (pos == 0) { // message is the start of a thread
                    threads.push(Base64.encode(folder+"\t"+uids[k]));
                  } else if (pos > 0) { // message is not the start of a thread
                    threads.push(Base64.encode(folder+"\t"+result[i][0]));
                  }
                }
              }
              yay(threads);
            });
          });
          threadPromise.then(function(result){
            response[0].threadIds = result;
            if (!fetchmessages) {
              res.status('200').send(JSON.stringify([['messageList',response[0],seq]]));
            } else {
              var msglist = response[0].messageIds.slice();
              response[1] = {};
              response[1] = {'accountId':state.active[token].username,'state':state.active[token].state,'notFound':null};
              var messagesPromise = _getMessages(token,msglist);
              messagesPromise.then(function(result){
                response[1].list = result;
                res.status('200').send(JSON.stringify([['messageList',response[0],seq],['messages',response[1],seq]]));
              });
              messagePromise.catch(function(err){ log(err); });
            }
          });
          threadPromise.catch(function(err){ log(err); });
        });
        sortPromise.catch(function(err){ log(err); });
      });
      searchPromise.catch(function(err){ log(err); });
    }
  });
}

_getMessages = function(token,idlist) {
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
  
getMessage = function(token,folder,uid) {
  return new Promise(function(yay,nay){
    var imap = state.active[token].imap;
    var id = Base64.encode(folder+"\t"+uid);
    var thismsg = {'id':id,'blobId':id,threadId:id,mailboxIds:[folder],'preview':'','textBody':'','htmlBody':'','attachments':[],'attachedMessages':[]};
    // use these to sort out how to retrieve the body
    var hasText = false;
    var hasHtml = false;
    var bodyIsMessage = true;
    var selectPromise = selectFolder(token,folder);
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
              thismsg.sender = parseToEmailer(headers['return-path']);
              thismsg.from = parseToEmailer(headers['from']);
              thismsg.to = parseToEmailer(headers['to']);
              thismsg.cc = parseToEmailer(headers['cc']);
              thismsg.bcc = parseToEmailer(headers['bcc']);
              thismsg.replyto = parseToEmailer(headers['reply-to']);
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
              thismsg.preview = preview_from_body(thismsg.textBody || thismsg.htmlBody);
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

selectFolder = function(token,folder) {
  var imap = state.active[token].imap;
  return new Promise(function(yay,nay){
    var curbox = (imap._box && imap._box.name) ? imap._box.name : null;
    if (curbox == folder) {
      yay();
    } else {
      imap.openBox(folder,function(err,box){
        console.log(state.active[token].username+'/'+token+': switching to folder '+folder);
        yay();
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


function setMessages(token,data,seq,res) {
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
        var selectPromise = selectFolder(token,folder);
        selectPromise.then(function(){
          var flagPromise = new Promise(function(yay, nay) {
            if (msg.isFlagged || msg.isUnread || msg.isAnswered) {
              // changing flags
              var plusFlags = [];
              var minusFlags = [];
              if ("isFlagged" in msg) {
                if (msg.isFlagged == true) {
                  plusFlags.push('\FLAGGED');
                } else {
                  minusFlags.push('\FLAGGED');
                }
              }
              if ("isUnread" in msg) {
                if (msg.isFlagged == true) {
                  minusFlags.push('\SEEN');
                } else {
                  plusFlags.push('\SEEN');
                }
              }
              if ("isAnswered" in msg) {
                if (msg.isFlagged == true) {
                  plusFlags.push('\ANSWERED');
                } else {
                  minusFlags.push('\ANSWERED');
                }
              }
              var plusPromise = setFlags(token,folder,uid,'+FLAGS',plusFlags);
              plusPromise.then(function(plusRes) {
                if (plusRes == true) {
                  msgUpdated = true;
                } else {
                  var myres = {};
                  myres[msg.id] = {'type':'internalError','description':'failed to store +FLAGS'};
                  response.notUpdated.push(myres);
                }
                var minusPromise = setFlags(token,folder,uid,'-FLAGS',minsFlags);
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
                    var movePromise = moveMessage(token,folder,uid,newfolder);
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
      res.status('200').send(JSON.stringify([['messages',response,seq]]));
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
        var selectPromise = selectFolder(token,folder);
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
        var selectPromise = selectFolder(token,folder);
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
          var selectPromise = selectFolder(token,folder);
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

var imaphost = config.get('IMAP.host');
var imapport = config.get('IMAP.port');
var imapssl  = config.get('IMAP.ssl');
var serverport = config.get('Server.port') || 3000;

app.listen(serverport, function () {
  console.log('JMAP proxy listening on port '+serverport);
  if (imapssl) {
    console.log('proxying IMAP requests to '+imaphost+':'+imapport+' using SSL');
  } else {
    console.log('proxying IMAP requests to '+imaphost+':'+imapport);
  }
});


cleanup = function() {
  fs.readdir(config.Server.uploadPath,function(err,files) {
    files.forEach(function(file){
      var a = file.match(/\.(\d+)$/);
      if (a[1]) {
        console.log("match:"+a[1]+' '+file);
        if (a[1] > (new Date).getTime() + config.Server.uploadExpireLength) {
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
};
cleanup();
