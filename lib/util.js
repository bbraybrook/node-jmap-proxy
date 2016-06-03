var Base64 = require('js-base64').Base64;
var striptags = require('striptags');

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
