var Imap = require('imap');
var config = require('config');
var myUtil = require(__base + 'lib/util.js');
var textmode = (config.Server['utf-8'] == true) ? 'UTF-8' : 'US-ASCII';
var myMessages = require(__base + 'lib/messages.js');

exports.getMessageList = function(token,data,seq,res) {
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
  var response = {
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
            response.messageIds.push(myUtil.newId(folder,uids[i]));
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
                    threads.push(myUtil.newId(folder,uids[k]));
                  } else if (pos > 0) { // message is not the start of a thread
                    threads.push(myUtil.newId(folder,result[i][0]));
                  }
                }
              }
              yay(threads);
            });
          });
          threadPromise.then(function(result){
            response.threadIds = result;
            response.total = response.messageIds.length;
            if (!fetchmessages) {
              res.status('200').send(JSON.stringify([['messageList',response,seq]]));
            } else {
              var msglist = response.messageIds.slice();
              var response2 = {'accountId':state.active[token].username,'state':state.active[token].state,'notFound':null};
              var messagesPromise = myMessages._getMessages(token,msglist);
              messagesPromise.then(function(result){
                response2.list = result;
                res.status('200').send(JSON.stringify([['messageList',response,seq],['messages',response2,seq]]));
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
