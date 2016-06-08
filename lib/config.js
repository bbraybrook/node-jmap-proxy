var request = require('request');
var config = require('config');

exports.get = function(user) {
  return new Promise(function(yay,nay) {
    request.get({url:'http://localhost:'+config.ConfigServer.port+'/'+user}, function(err,res,body){
      if (err) {
        console.log('aaargh:'+err);
        yay(false);
      } else {
  console.log('got body='+body);
        yay(JSON.parse(body));
      }
    });
  });
};

exports.set = function(user,data) {
  return new Promise(function(yay,nay) {
    request.post({url:'http://localhost:'+config.ConfigServer.port+'/'+user, form:data}, function(err,res,body){
      if (err) {
        console.log('aaargh:'+err);
        yay(false);
      } else {
        yay(true);
      }
    });
  });
};
