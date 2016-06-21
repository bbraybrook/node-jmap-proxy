var util = require('util');
var myUtil = require(__base + 'lib/util.js');
var datastore = require(__base + 'lib/datastore_fs.js');

exports.getContactList = function(token,data,seq,res) {
  var user = data.accountId || state.active[token].username;
  var promise = datastore.listContacts(token,user,data.filter,data.position,data.limit,data.fetchContacts);
  promise.then(function(result) {
    var response = {'accountId':user, filter:data.filter, state:1, position:data.position, total:result.total, contactIds:result.ids};
    if (data.fetchContacts) {
      var response2 = {'accountId':user, state: 1, list:results.data};
      res.status('200').send(JSON.stringify([['contactList',response,seq],['contacts',response2,seq]]));
    } else {
      res.status('200').send(JSON.stringify([['contactList',response,seq]]));
    }
  });
};

exports.getContacts = function(token,data,seq,res) {
  var user = data.accountId || state.active[token].username;
  var response = {'accountId':user, 'state': 1, 'list':[], 'notFound':[]};
  var promises = [];
  data.ids.forEach(function(id){
    var promise = datastore.getContact(user,id);
    promise.then(function(result){
      if (data.properties) {
        data.properties.push(id); // always return id
        var keys = Object.keys(result);
        for (var i in keys) {
          if (!keys[i] in data.properties) {
            delete result[keys[i]];
          }
        }
      }
      response.list.push(result);
    });
  });
  Promise.all(function(){
    res.status('200').send(JSON.stringify([['contacts',response,seq]]));
  });
};

exports.setContacts = function(token,data,seq,res) {
  var user = data.accountId || state.active[token].username;
  var response = {'accountId':user, 'oldState':1, 'newState':1, 'created':[], 'updated':[], 'destroyed':[], 'notCreated':[], 'notUpdated':[], 'notDestroyed':[]};
  var promise = Promise.resolve(null);
  if (data.create) {
    Object.keys(data.create).forEach(function(clientId){
      var vcard = myUtil.contact_to_vcard(data.create[clientId]);
      promise = promise.then(function(){
        return datastore.setContact(user,vcard.id,vcard.vcard);
      }).then(function(result){
        if (result) {
          var myres = {};
          myres[clientId] = {'id':vcard.id};
          response.created.push(myres);
        } else {
          response.notCreated.push({'type':'internalError','description':'failed to save contact'});
        }
      });
      return promise.then(function(){ });
    });
  }
  if (data.update) {
    Object.keys(data.update).forEach(function(clientId){
      var current = contacts.getContact(user,clientId);
      var contact = myUtil.vdata_to_contact(current);
      for (var attr in data.update[clientId]) {
        contact[attr] = data.update[clientId][attr];
      }
      delete contact.rev; // force a new revision timestamp
      var vcard = myUtil.contact_to_vcard(data.create[createId]);
      promise = promise.then(function(){
        return datastore.setContact(user,vcard.id,vcard.vcard);
      }).then(function(result){
        if (result) {
          response.updated.push(clientId);
        } else {
          response.notUpdated.push({'type':'internalError','description':'failed to save contact'});
        }
      });
      return promise.then(function(){ });
    });
  }
  if (data.destroy) {
    Object.keys(data.destroy).forEach(function(clientId){
      promise = promise.then(function(){
        return datastore.deleteContact(user,clientId);
      }).then(function(result){
        if (result) {
          response.destroyed.push(clientId);
        } else {
          response.notDestroyed.push({'type':'internalError','description':'failed to delete contact'});
        }
      });
    });
  };
  promise.then(function(){
    res.status('200').send(JSON.stringify([['contactsSet',response,seq]]));
  });
};
