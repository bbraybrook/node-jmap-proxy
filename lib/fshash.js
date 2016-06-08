var maxInt = 4294967296;
var multiplier = 33;
var maxLen = 9;
exports.genhash = function(str,levels) {
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
