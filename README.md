# node-jmap-proxy

** Work in Progress **

This is an IMAP to JMAP proxy, developed for use with roundcube-next.

** Setup **

npm install
  or
npm install --production   (to skip the testing modules)

** Running **

IMAP_SERVER=mail.domain.net IMAP_PORT=143 node ./node-jmap-proxy.js

** Test Suite **

node-jmap-proxy.js must already be running.

IMAP_USER=username IMAP_PASS=password mocha -C test/test.js

IMAP_USER must be the username used to authenticate to IMAP as (fully realmed, if your server requires that)
