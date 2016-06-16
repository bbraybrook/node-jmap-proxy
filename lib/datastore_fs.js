var fs = require('fs');
var util = require('util');
var mkdirp = require('mkdirp');
var config = require('config');
var myUtil = require(__base + '/lib/util.js');
var myConfig = require(__base + '/lib/config.js');
var vdata = require('vdata-parser');

var hashLevels = config.datastore_fs.hashLevels;
var configBaseDir = config.datastore_fs.configBaseDir;
var contactBaseDir = config.datastore_fs.contactBaseDir;
var calendarBaseDir = config.datastore_fs.calendarBaseDir;

var maxInt = 4294967296;
var multiplier = 33;
var maxLen = 9;
genhash = function(str,levels) {
  if (levels == 0) {
    return str;
  }
  var hash = '0';
  for (var i=0; i < str.length; i++) {
    hash = (hash * multiplier) + str[i].charCodeAt();
    // simulate 32bit int wrap-around
    if (hash >= maxInt) {
      hash = hash % maxInt;
    }
  }
  hash = ('0000000000' + hash).substr(maxLen);
  if (levels == 1) {
    return hash.substr(7,3) + '/' + str;
  } else if (levels == 2) {
    return hash.substr(4,3) + '/' + hash.substr(7,3) + '/' + str;
  } else {
    return hash;
  }
};

exports.getUserConfig = function(user) {
  return new Promise(function(yay,nay){
    var hashPath = genhash(user,hashLevels);
    var configFile = configBaseDir + '/' + hashPath + '/config.json';
    var response = {};
    if (fs.existsSync(configFile)) {
      response = fs.readFileSync(configFile);
    }
    yay(response);
  });
};

exports.setUserConfig = function(user) {
  return new Promise(function(yay,nay){
    var hashPath = genhash(user,hashLevels);
    var configFile = configBaseDir + '/' + hashPath + '/config.json';
    if (!fs.existsSync(configBaseDir + '/' + hashPath)) {
      mkdirp.sync(configBaseDir + '/' + hashPath);
    }
    fs.writeFile(configFile, JSON.stringify(req.body), function(err){
      yay((err) ? false : true);
    });
  });
};

exports.listContacts = function(token,user,filter,startPos,limit,full) {
  return new Promise(function(yay,nay) {
    if (!startPos) startPos = 0;
    if (!limit) limit = undefined;
    var hashPath = genhash(user,hashLevels);
    var contactDir = contactBaseDir + '/' + hashPath + '/contacts';
    var contacts = [];
    var response = {'total': 0, 'ids': [], 'data': []};
    if (!fs.existsSync(contactDir)) {
      mkdirp.sync(contactDir);
      yay(response);
    }

    var files = readdirSync(contactDir);
    for (var i in files) {
      var file = files[i];
      if (file.match(/\.vcf$/)) {
        var data = vdata.fromFileSync(contactDir + '/' + file);
        var parsed = myUtil.vdataParse.contact(data);
        if (filter) {
          // TODO: filtering
          contacts.push(parsed);
        } else {
          contacts.push(parsed);
        }
      }
    }

    var sort_by = myConfig.getConfigValue(token,'sort_by');
    var sort_order = myConfig.getConfigValue(token,'sort_order');
    var sorted = [];
    if (sort_order === 'ascending') {
      sorted = contacts.sort(function(a,b){
        if (a[sort_by] < b[sort_by]) return -1;
        if (a[sort_by] > b[sort_by]) return 1;
        return 0;
      });
    } else {
      sorted = contacts.sort(function(a,b){
        if (a[sort_by] < b[sort_by]) return 1;
        if (a[sort_by] > b[sort_by]) return -1;
        return 0;
      });
    }

    response.total = sorted.length;
    response.data = sorted.slice(startPos,limit);
    for (var i in response.data) {
      response.ids.push(response.data[i].id);
    }
    if (!full) delete response.data;
    yay(response);
  });
};

exports.getContact = function(user,id) {
  return new Promise(function(yay,nay){
    var hashPath = genhash(user,hashLevels);
    var contactDir = contactBaseDir + '/' + hashPath + '/contacts';
    if (!fs.existsSync(contactDir)) mkdirp.sync(contactDir);
    if (fs.existsSync(contactDir + '/' + id + '.vcs')) {
      var data = vdata.fromFileSync(contactDir + '/' + id + '.vcs');
      yay(myUtil.vdataParse.contact(data));
    } else {
      yay(false);
    }
  });
};

exports.setContact = function(user,id,vcard) {
  return new Promise(function(yay,nay){
    var hashPath = genhash(user,hashLevels);
    var contactDir = contactBaseDir + '/' + hashPath + '/contacts';
    if (!fs.existsSync(contactDir)) mkdirp.sync(contactDir);
    fs.writeFile(contactDir + '/' + id + '.vcs',vcard,function(err) {
      yay((err) ? false : true);
    });
  });
};

exports.deleteContact = function(user,id) {
  return new Promise(function(yay,nay){
    var hashPath = genhash(user,hashLevels);
    var contactDir = contactBaseDir + '/' + hashPath + '/contacts';
    if (!fs.existsSync(contactDir)) mkdirp.sync(contactDir);
    if (!fs.existsSync(contactDir + '/' + id + '.vcs')) {
      // silently succeed
      yay(true);
    } else {
      if (fs.unlinkFileSync(contactDir + '/' + id + '.vcs')) {
        yay(true);
      } else {
        yay(false);
      }
    }
  });
};
