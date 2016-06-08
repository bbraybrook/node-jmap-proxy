var randomToken = require('random-token').create('abcdefghijklmnopqrstuvwxzyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
var Imap = require('imap');
var myConfig = require(__base + '/lib/config.js');

exports.authenticate = function(req,res) {
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
      var response = {'username':username,'accessToken':token,'versions':[1],'extensions':[],'apiUrl':'/jmap/','eventSourceUrl':'/event','uploadUrl':'/upload','downloadUrl':'/download','api':'/jmap','eventSource':'/event','upload':'/upload','download':'/download'};
      myConfig.get(username,token).then(function(userConfig){
        state.active[token].config = userConfig;
        res.status('201').send(JSON.stringify(response));
      });
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

