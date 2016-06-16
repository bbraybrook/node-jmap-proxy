var Base64 = require('js-base64').Base64;
var striptags = require('striptags');
var randomToken = require('random-token').create('abcdefghijklmnopqrstuvwxzyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
var util = require('util');

exports.parseToEmailer = function(str) {
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

exports.preview_from_body = function(str) {
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

exports.newId = function(folder,uid) {
  return Base64.encode(folder+"\t"+uid)
};

exports.decodeId = function(id) {
  return Base64.decode(id).split("\t");
};

exports.flags_from_msg = function(msg) {
  var ret = {'plusFlags':[],'minusFlags':[]};
  if ("isFlagged" in msg) {
    if (msg.isFlagged == true) {
      ret.plusFlags.push('\FLAGGED');
    } else {
      ret.minusFlags.push('\FLAGGED');
    }
  }
  if ("isUnread" in msg) {
    if (msg.isFlagged == true) {
      ret.minusFlags.push('\SEEN');
    } else {
      ret.plusFlags.push('\SEEN');
    }
  }
  if ("isAnswered" in msg) {
    if (msg.isFlagged == true) {
      ret.plusFlags.push('\ANSWERED');
    } else {
      ret.minusFlags.push('\ANSWERED');
    }
  }
  if ("isDraft" in msg) {
    if (msg.isFlagged == true) {
      ret.plusFlags.push('\DRAFT');
    } else {
      ret.minusFlags.push('\DRAFT');
    }
  }
  return ret;
}

exports.unixtime = function() {
  return parseInt((new Date).getTime());
}

exports.vdata_to_contact = function(data) {
  // some fields are not defined in the JCAL spec, keep them so we can write them out on modify
  var response = {};
  if (!data.VCARD) return(response);
  response.id = data.VCARD.UID;
  response.isFlagged = false;
  var n = data.VCARD.N.split(';');
  response.firstName = n[0];
  response.lastName = n[1];
  response.middleName = n[2];
  response.prefix = n[3];
  response.suffix = n[4];
  response.nickname = data.VCARD.NICKNAME;
  response.birthday = data.VCARD.BDAY;
  response.anniversary = data.VCARD['X-ANNIVERSARY'];
  response.manager = data.VCARD['X-MANAGER'];
  response.gender = data.VCARD['X-GENDER'];
  response.assistant = data.VCARD['X-ASSISTANT'];
  response.spouse = data.VCARD['X-SPOUSE'];
  if (data.VCARD.ORG) {
    var o = data.VCARD.ORG.split(';');
    response.company = o[0];
    response.department = o[1];
  }
  response.title = data.VCARD.TITLE;
  response.emails = [];
  for (var i in data.VCARD.EMAIL) {
    var obj = data.VCARD.EMAIL[i];
    response.emails.push({'value':obj.value, 'type':obj.params[0].TYPE, 'isDefault':false});
  }
  response.phones = [];
  for (var i in data.VCARD.TEL) {
    var obj = data.VCARD.TEL[i];
    response.phones.push({'value':obj.value, 'type':obj.params[0].TYPE, 'isDefault':false});
  }
  response.online = [];
  for (var i in data.VCARD.URL) {
    var obj = data.VCARD.URL[i];
    response.online.push({'type':obj.params[0].TYPE, 'uri':obj.value});
  }
  response.addresses = [];
  for (var i in data.VCARD.ADR) {
    var obj = data.VCARD.ADR[i];
    var s = obj.value.split(';');
    response.addresses.push({'type':obj.params[0].TYPE, 'isDefault':false,
      'street': s[2],
      'locality': s[3],
      'region': s[4],
      'postcode': s[5],
      'country': s[6]
    });
  }
  response.notes = data.VCARD.NOTE;
  return(response);
}

exports.contact_to_vcard = function(data) {
  var vcard = ['BEGIN:VCARD','VERSION:3.0','PRODID:node-jmap-proxy'];
  if (!data.id) data.id = randomToken(36);
  vcard.push('UID:'+data.id);
  vcard.push('REV:TODO');
  vcard.push('N:'+['','',data.firstName,'',data.lastName,data.prefix,data.suffix].join(';'));
  if (data.company || data.department) vcard.push('ORG:'+[data.company,data.department].join(';'));
  vcard.push('FN:'+ data.firstName + ' ' + data.lastName);
  vcard.push('NICKNAME:'+data.nickname);
  if (data.bday) vcard.push('BDAY:'+data.birthday);
  if (data.anniversary) vcard.push('X-ANNIVERSARY:'+data.anniversary);
  if (data.manager) vcard.push('X-MANAGER:'+data.anniversary);
  if (data.gender) vcard.push('X-GENDER:'+data.anniversary);
  if (data.assistant) vcard.push('X-ASSISTANT:'+data.anniversary);
  if (data.spouse) vcard.push('X-SPOUSE:'+data.anniversary);
  if (data.notes) {
    data.notes.replace("\n","\\n");
    vcard.push('NOTE:'+data.notes);
  }
  for (var i in data.emails) {
    var obj = data.emails[i];
    vcard.push('EMAIL;TYPE='+obj.type+':'+obj.value);
  }
  for (var i in data.phones) {
    var obj = data.phones[i];
    vcard.push('TEL;TYPE='+obj.type+':'+obj.value);
  }
  for (var i in data.online) {
    var obj = data.online[i];
    vcard.push('URL;TYPE='+obj.type+':'+obj.uri);
  }
  for (var i in data.addresses) {
    var obj = data.addresses[i];
    vcard.push('ADR;TYPE='+obj.type+':'+['','',obj.street,obj.locality,obj.region,obj.postcode,obj.country].join(';'));
  }
  vcard.push('END:VCARD');
  return({'vcard':vcard.join("\n"),'id':data.id});
};
