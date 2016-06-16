var request = require('request');
var config = require('config');

exports.getConfigValue = function(token,key) {
  var value;
  if (key == 'sort_by') {
    value = Config.Options.contacts.sort_by;
    if (state.active[token].config.contacts.sort_by) value = state.active[token].config.contacts.sort_by;
  } else if (key == 'sort_order') {
    value = Config.Options.contacts.sort_order;
    if (state.active[token].config.contacts.sort_order) value = state.active[token].config.contacts.sort_order;
  }
  return(value);
}
