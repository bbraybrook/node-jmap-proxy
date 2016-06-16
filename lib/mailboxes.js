var Imap = require('imap');
var config = require('config');
var myImap = require(__base + 'lib/imap.js');
var myUtil = require(__base + 'lib/util.js');
var datastore = require(__base + '/lib/datastore_fs.js');
var util = require('util');

// getMailboxes
// we must get a list of mailboxes
// then select each one to get the count of messages
exports.getMailboxes = function(token,data,seq,res) {
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
      for (var i = 1; i < 50; i++) {
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
exports.getMailboxUpdates = function(token,data,seq,res) {
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
    var selectPromise = myImap.selectFolder(token,id);
    promises.push(selectPromise);
    selectPromise.then(function(obj){
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
    selectPromise.catch(function(err){ log(err); });
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
      if (conf.mailboxes[entry.id] && conf.mailboxes[entry.id].sortOrder) {
        entry.sortOrder = conf.mailboxes[entry.id].sortOrder;
      } else {
        entry.sortOrder = 1;
      }
      entry.role = 'inbox';
      entry.mayRename = false;
      entry.mayDelete = false;
    } else if (boxes[mailbox].special_use_attrib && config.Server.prefer_RFC6154) {
      if (conf.mailboxes[entry.id] && conf.mailboxes[entry.id].sortOrder) {
        entry.sortOrder = conf.mailboxes[entry.id].sortOrder;
      } else {
        entry.sortOrder = 10;
      }
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
      if (conf.mailboxes[entry.id] && conf.mailboxes[entry.id].sortOrder) {
        entry.sortOrder = conf.mailboxes[entry.id].sortOrder;
      } else {
        entry.sortOrder = 10;
      }
      entry.role = config.Options.special_folders[mailbox];
      entry.mayRename = false;
      entry.mayDelete = false;
    } else {
      if (conf.mailboxes[entry.id] && conf.mailboxes[entry.id].sortOrder) {
        entry.sortOrder = conf.mailboxes[entry.id].sortOrder;
      } else {
        entry.sortOrder = 25;
      }
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

exports.setMailboxes = function(token,data,seq,res) {
  var user = data.accountId || state.active[token].username;
  var imap = state.active[token].imap;
  var response = {
    'accountId': user,
    'oldState': state.active[token].state,
    'newState': state.active[token].state,
    'created': {},
    'updated': [],
    'destroyed': [],
    'notCreated': {},
    'notUpdated': {},
    'notDestroyed': {}
  };
  var promises = [];
  if (data.create) {
    Object.keys(data.create).forEach(function(createId){
      promises.push(new Promise(function(yay,nay){
        var mbx = data.create[createId];
        var id = (mbx.parentId) ? mbx.parentId + '.' + mbx.name : mbx.name;
// TBD: sort out user defined roles/order
        imap.addBox(id,function(err){
          if (err) {
            if (err.textCode == 'ALREADYEXISTS') {
              response.notCreated[createId] = {'type':'invalidArguments','description':'mailbox already exists'};
            } else {
              response.notCreated[createId] = {'type':'internalError','description':'failed to create mailbox: '+err};
  console.log(util.inspect(err));
            }
            yay();
          } else {
            response.created[createId] = {
              'id': id,
              'parentId': mbx.parentId,
              'role': null,
              'sortOrder': 25,
              'mustBeOnlyMailbox': true,
              'mayReadItems': true,
              'mayAddItems': true,
              'mayRemoveItems': true,
              'mayCreateChild': true,
              'mayRename': true,
              'mayDelete': true,
              'totalMessages': 0,
              'unreadMessages': 0,
              'totalThreads': 0,
              'unreadThreads': 0
            };
            console.log(state.active[token].username+'/'+token+': created folder '+id);
            response.newState = myUtil.unixtime();
            state.active[token].state = response.newState;
            state.active[token].mailboxes[id] = {'uidnext':1,'total':0,'new':0};
            if (mbx.sortOrder || mbx.role) {
              var userConfig = state.active[token].config;
              if (!userConfig.mailboxes[id]) userConfig.mailboxes[id] = {};
              if (mbx.sortOrder) userConfig.mailboxes[id].sortOrder = mbx.sortOrder;
              if (mbx.role) userConfig.mailboxes[id].role = mbx.role;
              state.active[token].config = userConfig;
              datastore.setUserConfig(user,userConfig).then(function(confRes){
                yay();
              });
            } else {
              yay();
            }
          }
        });
      }));
    });
  }
  if (data.update) {
    var disallowed = ['id','role','mustBeOnlyMailbox','mayReadItems','mayAddItems','mayRemoveItems','mayCreateChild','mayRename','mayDelete','totalMessages','unreadMessages','totalThreads','unreadThreads'];
    data.update.forEach(function(id){
      promises.push(new Promise(function(yay,nay){
        for (var i in disallowed) {
          var prop = disallowed[i];
          if (prop in data.update[id]) {
            if (!response.notUpdated[id]) response.notUpdated[id] = {'type':'invalidArguments','description':'invalid attributes provided', 'properties':[]};
            response.notUpdated[id].properties.push(prop);
          }
        }
        if (response.notUpdated[id]) {
          yay();
        } else {
          var selectPromise = myImap.selectFolder(token,id);
          var delim;
          selectPromise.then(function(box){
            if (box == undefined) {
              response.notUpdated[id] = {'type':'notFound','description':'mailbox does not exist'};
              yay2();
            } else {
              delim = box.delim;
            }
            var configPromise = new Promise(function(yay2,nay2){
              if (data.update[id].role || data.update[id].sortOrder) {
                var userConfig = state.active[token].config;
                if (!userConfig.mailboxes[id]) userConfig.mailboxes[id] = {};
                if (data.update[id].role) userConfig.mailboxes[id].role = data.update[id].role;
                if (data.update[id].sortOrder) userConfig.mailboxes[id].sortOrder = data.update[id].sortOrder;
                state.active[token].config = userConfig;
                datastore.setUserConfig(user,userConfig).then(function(confRes){
                  if (confRes) {
                    response.updated.push(id);
                  } else {
                    response.notUpdated[id] = {'type':'internalError','description':'failed to save config options'};
                  }
                  yay2();
                });
              } else {
                yay2();
              }
            });
            configPromise.then(function(){
              if (delim && (data.update[id].name || data.update[id].parentId)) {
                var newId = (data.update[id].parentId) ? data.update[id].parentId + delim + data.update[id].name : data.update[id].name;
                imap.renameBox(id,newId,function(err,box){
                  if (err) {
                    response.notUpdated[id] = {'type':'internalError','description':'failed to rename mailbox: '+err};
                  } else {
                    if (response.updated.indexOf == -1) response.updated.push(id);
                    state.active[token].mailboxes[newId] = state.active[token].mailboxes[id];
                    delete state.active[token].mailboxes[id];
                  }
                  yay();
                });
              } else {
                yay();
              }
            });
          });
        }
      }));
    });
  }
  if (data.destroy) {
    data.destroy.forEach(function(id){
      promises.push(new Promise(function(yay,nay){
        myImap.selectFolder(token,id).then(function(box){
          if (box == undefined) {
            response.notDestroyed[id] = {'type':'notFound','description':'mailbox does not exist'};
            yay();
          } else if (box.messages.total > 0) {
            response.notDestroyed[id] = {'type':'invalidArguments','description':'mailbox not empty'};
            yay();
          } else {
            // select INBOX, else the server will disconnect us after deleting the currently selected folder
            myImap.selectFolder(token,'INBOX').then(function() {
              imap.delBox(id,function(err){
                if (err) {
                  response.notDestroyed[id] = {'type':'internalError','description':'failed to delete mailbox: '+err};
                  yay();
                } else {
                  response.destroyed.push(id);
                  console.log(state.active[token].username+'/'+token+': deleted folder '+id);
                  response.newState = myUtil.unixtime();
                  state.active[token].state = response.newState;
                  delete state.active[token].mailboxes[id];
                  if (state.active[token].config.mailboxes && state.active[token].config.mailboxes[id]) {
                    var userConfig = state.active[token].config;
                    delete userConfig.mailboxes[id];
                    state.active[token].config = userConfig;
                    datastore.setUserConfig(user,userConfig).then(function(confRes){
                      yay();
                    });
                  } else {
                    yay();
                  }
                }
              });
            });
          }
        });
      }));
    })
  }
  Promise.all(promises).then(function(){
    if (Object.keys(response.created).length > 0) {
      res.status('201').send(JSON.stringify([['mailboxes',response,seq]]));
    } else {
      res.status('200').send(JSON.stringify([['mailboxes',response,seq]]));
    }
  });
};
