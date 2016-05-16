var http = require('http');
var util = require('util');
var request = require('request');
var querystring = require('querystring');
var expect = require('chai').expect;
var user = process.env.IMAP_USER;
var pass = process.env.IMAP_PASS;
var hostname = 'http://localhost:3000';
var token;

describe('NodeJS IMAP->JMAP Proxy',function() {
  describe('Authentication',function() {
    var logintoken;
    describe('phase 1 - sending username',function() {
      var resdata;
      before(function(done) {
        var postData = {
          'clientName': 'tester',
          'clientVersion': '0.0.1',
          'deviceName': 'RoundcubeShell',
          'username': user
        };
        request.post({url:hostname+'/.well-known/jmap', form:postData}, function(err,res,body){
          resdata = JSON.parse(body);
          resdata.code = res.statusCode;
          logintoken = resdata.continuationToken;
          done();
        });
      });
      it('statuscode == 200',function() {
        expect(resdata.code).to.equal(200);
      });
      it('continuationToken is string',function() {
        expect(resdata.continuationToken).to.be.a('string');
      });
      it('prompt is string',function() {
        expect(resdata['prompt']).to.be.a('string');
      });
      it('methods is array',function() {
        expect(resdata['methods']).to.be.a('array');
      });
      it('methods is length 1',function() {
        expect(resdata['methods'].length).to.equal(1);
      });
      it('methods only contains password',function() {
        expect(resdata['methods'][0]).to.equal('password');
      });
    });
    describe('phase 2 - sending invalid password',function() {
      this.timeout(10000);
      var resdata = {};
      before(function(done) {
        request.post({url:hostname+'/.well-known/jmap', form:{'method':'password','token':logintoken,'password':pass+'weflihewfifhe'}}, function(err,res,body){
          resdata.code = res.statusCode;
          done();
        });
      });
      it('statusCode == 401',function() {
        expect(resdata.code).to.equal(401);
      });
    });
    describe('phase 2 - sending valid password',function() {
      this.timeout(10000);
      var resdata = {};
      before(function(done) {
        request.post({url:hostname+'/.well-known/jmap', form:{'method':'password','token':logintoken,'password':pass}}, function(err,res,body){
          resdata = JSON.parse(body);
          resdata.code = res.statusCode;
          token = resdata.accessToken;
          done();
        });
      });
      it('statusCode == 201',function() {
        expect(resdata.code).to.equal(201);
      });
      it('accessToken is string',function() {
        expect(resdata.accessToken).to.be.a('string');
      });
      it('versions is array',function() {
        expect(resdata.versions).to.be.a('array');
      });
      it('extensions is array',function() {
        expect(resdata.versions).to.be.a('array');
      });
      it('api == /jmap',function() {
        expect(resdata.api).to.equal('/jmap');
      });
      it('eventSource == /event',function() {
        expect(resdata.eventSource).to.equal('/event');
      });
      it('upload == /upload',function() {
        expect(resdata.upload).to.equal('/upload');
      });
      it('download == /download',function() {
        expect(resdata.download).to.equal('/download');
      });
      it('username == '+user,function() {
        expect(resdata.username).to.equal(user);
      });
    });
  });
  describe('Accounts',function() {
    describe('GetAccounts',function() {
      var resdata = {};
      before(function(done) {
        var postData = [[
          'getAccounts',
          {'x':'x'},
          '#0'
        ]]; // bogus post data else request.post won't send anything
        request.post({url:hostname+'/jmap', form:postData, headers:{'Authorization':token}}, function(err,res,body){
          resdata = JSON.parse(body);
          resdata.code = res.statusCode;
          done();
        });
      });
      it('statusCode == 200',function() {
        expect(resdata.code).to.equal(200);
      });
      it('response == accounts',function() {
        expect(resdata[0][0]).to.equal('accounts');
      });
      it('sequence == #0',function() {
        expect(resdata[0][2]).to.equal('#0');
      });
      it('response.list length == 1',function() {
        expect(resdata[0][1].list.length).to.equal(1);
      });
      it('calendars exists',function() {
        expect("calendars" in resdata[0][1].list[0]).to.equal(true);
      });
      it('hasCalendars == false',function() {
        expect(resdata[0][1].list[0].hasCalendars).to.equal(false);
      });
      it('contacts exists',function() {
        expect("contacts" in resdata[0][1].list[0]).to.equal(true);
      });
      it('hasContacts == false',function() {
        expect(resdata[0][1].list[0].hasContacts).to.equal(false);
      });
      it('mail exists',function() {
        expect("mail" in resdata[0][1].list[0]).to.equal(true);
      });
      it('mail.isReadOnly == false',function() {
        expect(resdata[0][1].list[0].mail.isReadOnly).to.equal(false);
      });
      it('mail.maxSizeMessageAttachments == false',function() {
        expect(resdata[0][1].list[0].mail.maxSizeMessageAttachments).to.equal(50000000);
      });
      it('mail.messageListSortOptions == array',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions).to.be.a('array');
      });
      it('mail.messageListSortOptions contains id',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions.indexOf('id') > -1).to.equal(true);
      });
      it('mail.messageListSortOptions contains date',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions.indexOf('date') > -1).to.equal(true);
      });
      it('mail.messageListSortOptions contains subject',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions.indexOf('subject') > -1).to.equal(true);
      });
      it('mail.messageListSortOptions contains from',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions.indexOf('from') > -1).to.equal(true);
      });
      it('mail.messageListSortOptions contains to',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions.indexOf('to') > -1).to.equal(true);
      });
      it('mail.messageListSortOptions contains internaldate',function() {
        expect(resdata[0][1].list[0].mail.messageListSortOptions.indexOf('internaldate') > -1).to.equal(true);
      });
      it('hasMail == true',function() {
        expect(resdata[0][1].list[0].hasMail).to.equal(true);
      });
      it('id == '+user,function() {
        expect(resdata[0][1].list[0].id).to.equal(user);
      });
      it('name== '+user,function() {
        expect(resdata[0][1].list[0].id).to.equal(user);
      });
      it('capabilities exists',function() {
        expect("capabilities" in resdata[0][1].list[0]).to.equal(true);
      });
      it('capabilities.maxSizeUpload == 1000000000',function() {
        expect(resdata[0][1].list[0].capabilities.maxSizeUpload).to.equal(1000000000);
      });
    });
  });
  describe('Mailboxes',function() {
    describe('GetMailboxes',function() {
      this.timeout(10000);
      var resdata = {};
      before(function(done) {
        var postData = [[
          'getMailboxes',
          {'account':user},
          '#0'
        ]]; // bogus post data else request.post won't send anything
        request.post({url:hostname+'/jmap', form:postData, headers:{'Authorization':token}}, function(err,res,body){
          resdata = JSON.parse(body);
          resdata.code = res.statusCode;
          done();
        });
      });
      it('statusCode == 200',function() {
        expect(resdata.code).to.equal(200);
      });
      it('response == mailboxes',function() {
        expect(resdata[0][0]).to.equal('mailboxes');
      });
      it('sequence == #0',function() {
        expect(resdata[0][2]).to.equal('#0');
      });
      var inbox = {};
      it('INBOX exists',function() {
        var match = false;
        for (var i in resdata[0][1].list) {
          var obj = resdata[0][1].list[i];
          if (obj.name === 'INBOX') {
            inbox = obj;
            match = true;
          }
        }
        expect(match).to.equal(true);
      });
      it('INBOX id == INBOX',function() {
        expect(inbox.id).to.equal('INBOX');
      });
      it('INBOX parentId == null',function() {
        expect(inbox.parentId).to.equal(null);
      });
      it('INBOX sortOrder == 1',function() {
        expect(inbox.sortOrder).to.equal(1);
      });
      it('INBOX role == inbox',function() {
        expect(inbox.role).to.equal('inbox');
      });
      it('INBOX mayrename == false',function() {
        expect(inbox.mayRename).to.equal(false);
      });
      it('INBOX maydelete == false',function() {
        expect(inbox.mayDelete).to.equal(false);
      });
      it('INBOX mustbeonlymailbox == true',function() {
        expect(inbox.mustBeOnlyMailbox).to.equal(true);
      });
      it('INBOX mayReadItems == true',function() {
        expect(inbox.mayReadItems).to.equal(true);
      });
      it('INBOX mayRemoveItems == true',function() {
        expect(inbox.mayRemoveItems).to.equal(true);
      });
      it('INBOX mayReadItems == true',function() {
        expect(inbox.mayReadItems).to.equal(true);
      });
      it('INBOX mayCreateChild == true',function() {
        expect(inbox.mayCreateChild).to.equal(true);
      });
      it('INBOX totalMessages == number',function() {
        expect(inbox.totalMessages).to.be.a('number');
      });
      it('INBOX unreadMessages == number',function() {
        expect(inbox.unreadMessages).to.be.a('number');
      });
      it('INBOX totalThreads == number',function() {
        expect(inbox.totalThreads).to.be.a('number');
      });
      it('INBOX unreadThreads == number',function() {
        expect(inbox.unreadThreads).to.be.a('number');
      });
    });
  });
});
