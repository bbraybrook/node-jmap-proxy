var request = require('request');
var config = require('config');

exports.get = function(user,token) {
  return new Promise(function(yay,nay) {
    request.get({url:'http://localhost:'+config.ConfigServer.port+'/'+user}, function(err,res,body){
      if (err) {
        console.log(state.active[token].username+'/'+token+': failed to get config: '+err);
        yay(false);
      } else {
        var data = JSON.parse(body);
        if (!data.mailboxes) data.mailboxes = {};
        yay(JSON.parse(body));
      }
    });
  });
};

exports.set = function(user,data,token) {
  return new Promise(function(yay,nay) {
    request.post({url:'http://localhost:'+config.ConfigServer.port+'/'+user, form:data}, function(err,res,body){
      if (err) {
        console.log(state.active[token].username+'/'+token+': failed to save config: '+err);
        console.log('aaargh:'+err);
        yay(false);
      } else {
        console.log(state.active[token].username+'/'+token+': saved config');
        yay(true);
      }
    });
  });
};
