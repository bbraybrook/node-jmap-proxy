var config = require('config');
var fs = require('fs');
var util = require('util');
var express = require('express');
var busboy = require('express-busboy');
var mkdirp = require('mkdirp');

var bodyParser = require('body-parser');

var serverport = config.get('ConfigServer.port') || 3001;
var hashLevels = config.get('ConfigServer.hashLevels') || 0;
var dataDir = config.get('ConfigServer.dataDir');
var fsHash = require('./lib/fshash.js');
var app = express();
busboy.extend(app, { upload: false } );

app.get('/:user',function(req,res,next) {
  var user = req.params.user;
  var hashPath = fsHash.genhash(user,hashLevels);
  var configFile = dataDir + '/' + hashPath + '/config.json';
  if (fs.existsSync(configFile)) {
    var data = fs.readFileSync(configFile);
    res.status('200').send(data);
  } else {
    res.status('200').send('{}');
  }
});
  
app.post('/:user', function (req,res) {
  var user = req.params.user;
  var hashPath = fsHash.genhash(user,hashLevels);
  var configFile = dataDir + '/' + hashPath + '/config.json';

  if (! fs.existsSync(configFile)) {
    if (!fs.existsSync(dataDir + '/' + hashPath)) {
      mkdirp.sync(dataDir + '/' + hashPath);
    }
  }
  fs.writeFile(configFile, JSON.stringify(req.body), function(err){
    if (err) {
      res.status('500').send('{"type":"internalError","description":"failed to write config: '+err+'"}');
    } else {
      console.log(user+': wrote '+configFile);
      res.status('200').send('{}');
    }
  });
});

app.listen(serverport, function () {
  console.log('fs config server listening on port '+serverport);
});
