// getAccounts
// return a list of accounts for this login
// we'll just return a single account
exports.getAccounts = function(token,data,seq,res) {
  var response = [['accounts',{'list':[]},seq]];
  response[0][1].list[0] = {
    'id':state.active[token].username,
    'name':state.active[token].username,
    'isPrimary': true,
    'capabilities':{'maxSizeUpload':1000000000},
    'hasMail': true,
    'mail':{
      'isReadOnly':false,
      'maxSizeMessageAttachments':50000000,
      'canDelaySend':false,
      'messageListSortOptions': [ 'id','date','subject','from','to','internaldate' ],
    },
    'hasContacts': false,
    'contacts': null,
    'hasCalendars': false,
    'calendars': null
  };
  res.status('200').send(JSON.stringify(response));
};
