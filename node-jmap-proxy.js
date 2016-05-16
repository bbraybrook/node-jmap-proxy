var express = require('express');
var util = require('util');
var bodyParser = require('body-parser');
var Imap = require('imap');
var randomToken = require('random-token').create('abcdefghijklmnopqrstuvwxzyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
var Base64 = require('js-base64').Base64;
var striptags = require('striptags');
var quotedPrintable = require('quoted-printable');
var isHtml = require('is-html');
var config = require('config');
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true})); 

var state = { 'auth':{}, 'active':{} };
module.exports = state;

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
              console.log('err='+err);
              reject({'id':pid,'i':pi,'err':err});
            }
            if (box.messages) {
              resolve({id:pid,'i':pi,'new':box.messages['new'], 'total':box.messages.total});
            }
          });
        });
        promises.push(promise);
        promise.then(function(obj){
          response.list[obj.i].totalMessages = obj.total;
          response.list[obj.i].unreadMessages = obj['new'];
        });
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
    //iterate_getMailboxSizes(token,response,mailboxes,res,seq,'getMailboxes'); // async
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
  var mailboxes = [];
  for (var id in state.active[token].mailboxes) {
    mailboxes.push(id);
  }
  iterate_getMailboxSizes(token,response,mailboxes,res,seq,'getMailboxUpdates'); // async
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

iterate_getMailboxSizes = function(token,response,mailboxes,res,seq,mode) {
  if (mailboxes.length > 0) {
    var id = mailboxes.pop();
    var i = state.active[token].mailboxes[id].i;
    var imap = state.active[token].imap;
    console.log(state.active[token].username+'/'+token+': reading mailbox '+id+' for counts');
    imap.openBox(id,function(err,box){
      if (mode == 'getMailboxes') {
        response.list[i].totalMessages = box.messages.total;
        response.list[i].unreadMessages = box.messages['new'];
      } else if (mode == 'getMailboxUpdates') {
        if (box.uidnext !== state.active[token].mailboxes[id].uidnext) {
          // new messages have arrived
          response.onlyCountsChanged = false;
        }
        if (box.messages.total !== state.active[token].mailboxes[id].total
          || box.messages['new'] !== state.active[token].mailboxes[id]['new']) {
            // counts have changed
            response.changed.push(id);
        }
      }
      // store for getMailboxUpdates
      state.active[token].mailboxes[id].uidnext = box.uidnext;
      state.active[token].mailboxes[id].total = box.messages.total;
      state.active[token].mailboxes[id]['new'] = box.messages['new'];

      iterate_getMailboxSizes(token,response,mailboxes,res,seq,mode);
    });
  } else {
    if (mode == 'getMailboxes') {
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
    } else if (mode == 'getMailboxUpdates') {
      var date = new Date;
      response.newState = date.getTime();
      state.active[token].state = response.newState;
      res.status('200').send(JSON.stringify([['mailboxes',response,seq]]));
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

  if (sort == 'arrival' || sort == 'date') {
    // we can calculate these using the default MID orders to save processing
    imap.openBox(folder,false,function(err,box){
      if (err) { return; }
      var mids = [];
      var enduid = box.messages.total;
      var r1, r2;
      if (enduid < 1) {
        // no messages
      } else {
        if (direction == 'ascending') {
          r1 = position;
          r2 = r1 + limit;
        } else {
          if (position) {
            r1 = position;
            r2 = r1 + limit;
          } else {
            r2 = enduid;
            r1 = r2 - limit;
          }
        }
        if (r2 > enduid) {
          r2 = enduid;
        }
        for (var i = r1; i < r2; ++i) {
          mids.push(i+1);
          //var id = Base64.encode(folder + "\t" + i);
          //response[0].messageIds.push(id);
        }
      }
      // now fetch UIDs
      range = mids[0] + ':' + mids[mids.length - 1];
      var promise = new Promise(function(fulfill, reject) {
        var ids = [];
        fetch = imap.seq.fetch(range,{'struct':false,'size':false});
        fetch.on('message',function(msgevent,mid){
          var thismsg = {mailboxIds:[folder],'preview':'','textBody':'','htmlBody':'','attachments':[],'attachedMessages':[]};
          msgevent.on('attributes',function(attrs){
            var uid = attrs.uid;
            thismsg.id = Base64.encode(folder + "\t" + mid + "\t" + uid);
            thismsg.blobId = thismsg.id;
            thismsg.threadId = thismsg.id;
            ids.push(Base64.encode(folder+"\t"+mid+"\t"+uid));
          });
        });
        fetch.on('end',function(){
          fulfill(ids);
        });
      });

      promise.then(function(uids){
        response[0].messageIds = uids;
        response[0].total = response[0].messageIds.length;

        if (fetchmessages) {
          var msglist = response[0].messageIds.slice();
          response[1] = {};
          iterate_getMessages(token,response,msglist,res,seq,'getMessageList');
        } else {
          res.status('200').send(JSON.stringify([['messageList',response[0],seq]]));
        }
      });
    })
  } else {
    // must call imap FILTER/SORT to deal with the request
  }
}

iterate_getMessages = function(token,response,msglist,res,seq,mode) {
  var imap = state.active[token].imap;

  var index = (response[1]) ? 1 : 0;
  
  if (!response[index].accountId) {
    response[index] = {'accountId':state.active[token].username,'state':state.active[token].state,'notFound':null,'list':[]};
  }

  var curbox = null;
  if (imap._box && imap._box.name) {
    curbox = imap._box.name;
  }
  if (msglist.length > 0) {
    var id = msglist.shift();
    var uid;
    var a = Base64.decode(id).split("\t");
    var folder = a[0];
    var msgtype = a[1];
    var msgid = a[2];
    if (folder !== curbox) {
      msglist.unshift(id);
      imap.openBox(folder,function(err,box){
        console.log(state.active[token].username+'/'+token+': switching to folder '+folder+' for msgid '+msgid);
        iterate_getMessages(token,response,msglist,res,seq,mode);
      });
    } else {
      var retrmode = (msgtype == 'M') ? 'mid' : 'uid';
      var fetch;
      if (retrmode == 'mid') {
        console.log(state.active[token].username+'/'+token+': fetching struct,size,headers from folder '+folder+' for msgid '+msgid);
        fetch = imap.seq.fetch(msgid,{'struct':true,'size':true,'bodies':['HEADER']});
      } else {
        console.log(state.active[token].username+'/'+token+': fetching struct,size,headers from folder '+folder+' for uid '+msgid);
        fetch = imap.fetch(msgid,{'struct':true,'size':true,'bodies':['HEADER']});
      }

      // use these to determine when we can retrieve the body
      var hasHeaders = false;
      var hasAttributes = false;

      // use these to sort out how to retrieve the body
      var hasText = false;
      var hasHtml = false;
      var bodyIsMessage = true;

      fetch.on('message',function(msgevent,thismsgid){
        var thismsg = {'id':id,'blobId':id,threadId:id,mailboxIds:[folder],'preview':'','textBody':'','htmlBody':'','attachments':[],'attachedMessages':[]};
        msgevent.on('attributes',function(attrs){
          thismsg.isUnread = attrs.flags.indexOf('\Seen') > -1 ? false : true;
          thismsg.isFlagged = attrs.flags.indexOf('\Flagged') > -1 ? true : false;
          thismsg.isAnswered = attrs.flags.indexOf('\Answered') > -1 ? true : false;
          thismsg.isDraft = attrs.flags.indexOf('\Draft') > -1 ? true : false;
          thismsg.date = attrs.date;
          thismsg.size = attrs.size;
          uid = attrs.uid;

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
          hasAttributes = true;
          if (hasHeaders) {
            getMessageBody(token,response,thismsg,uid,res,seq,bodyIsMessage,hasText,hasHtml,mode,msglist);
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
            hasHeaders = true;
            if (hasAttributes) {
              getMessageBody(token,response,thismsg,uid,res,seq,bodyIsMessage,hasText,hasHtml,mode,msglist);
            }
          });
        });
      });
    }
  } else {
    console.log(state.active[token].username+'/'+token+': end of messages to iterate through');
    if (mode == 'getMessageList') {
      if (response[1]) {
        res.status('200').send(JSON.stringify([['messageList',response[0],seq],['messages',response[1],seq]]));
      } else {
        res.status('200').send(JSON.stringify([['messageList',response[0],seq]]));
      }
    }
  }
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

getMessageBody = function(token,response,thismsg,uid,res,seq,bodyIsMessage,hasText,hasHtml,mode,msglist) {
  console.log(state.active[token].username+'/'+token+': requesting body for uid '+uid+' bodyIsMessage='+bodyIsMessage+' hasHtml='+hasHtml+' hasText='+hasText);
  var index = (response[1]) ? 1 : 0;
  var imap = state.active[token].imap;
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
        response[index].list.push(thismsg);
        iterate_getMessages(token,response,msglist,res,seq,mode);
      });
    });
  });
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

var imaphost = config.get('IMAP.host');
var imapport = config.get('IMAP.port');
var imapssl  = config.get('IMAP.ssl');
var serverport = config.get('Server.port') || 3000;

if (!imaphost || !imapport) {
  console.log('must provide IMAP.host and IMAP.port in config/production.conf');
  throw new Error();
}

app.listen(serverport, function () {
  console.log('JMAP proxy listening on port '+serverport);
  if (imapssl) {
    console.log('proxying IMAP requests to '+imaphost+':'+imapport+' using SSL');
  } else {
    console.log('proxying IMAP requests to '+imaphost+':'+imapport);
  }
});
