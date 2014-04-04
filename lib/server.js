/*
The MIT License (MIT)

Copyright (c) 2014 Bryan Hughes <bryan@theoreticalideations.com> (http://theoreticalideations.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

var express = require('express'),
    Logger = require('transport-logger'),
    path = require('path'),
    fs = require('fs'),
    url = require('url');

module.exports.run = function(options) {

  // Create the logger
  var logger;
  if (options.logFile) {
    logger = new Logger([{
      destination: options.logFile,
      minLevel: 'debug'
    }, {
      minLevel: 'info'
    }]);
  } else {
    logger = new Logger();
  }

  // Read the data
  var data,
      dataFile = options.dataFile;
  if (fs.existsSync(dataFile)) {
    data = require(dataFile);
  } else {
    data = {
      posts: {}
    };
    saveData();
  }

  var writingData = false,
      needsRewrite = false;
  function saveData() {
    if (writingData) {
      needsRewrite = true;
      return;
    }
    writingData = true;
    fs.writeFile(dataFile, JSON.stringify(data), function(err) {
      var doesNeedRewrite = needsRewrite;
      writingData = needsRewrite = false;
      if (err) {
        logger.error('Could not save data, trying again in 60 seconds: ' + err);
      } else if (doesNeedRewrite) {
        saveData();
      }
    });
  }

  function getClientIp(req) {
    var ipAddress,
        forwardedIpsStr = req.header('x-forwarded-for');
    if (forwardedIpsStr) {
      ipAddress = forwardedIpsStr.split(',')[0];
    }
    if (!ipAddress) {
      ipAddress = req.connection.remoteAddress;
    }
    return ipAddress;
  }

  // Create the server
  var app = express();
  app.use(express.static(path.join(__dirname, '..', 'templates')));
  //app.use(express.json());

  app.all('*', function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
   });

  // Get the list of posts
  app.get('/api/posts', function (request, response) {
    console.log(getClientIp(request));
    logger.info('Serving post data');
    response.send(data.posts);
  });

  // Save a visit
  var postIdRegex = /^[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/[a-zA-Z0-9_\-]*$/;
  app.post('/api/posts/:id/visits', function (request, response) {

    // Cleanup the postId
    var postId = decodeURIComponent(request.url.split('/')[3]);
    if (postId[0] == '/') {
      postId = postId.slice(1);
    }
    if (postId[postId.length - 1] == '/') {
      postId = postId.slice(0, -1);
    }

    // Create the postId entry if it doesn't exist and postId is valid
    if (!data.posts[postId]) {
      if (postIdRegex.test(postId) && postId.length < 256) {
        data.posts[postId] = {
          visits: []
        };
      } else {
        logger.warn('Client tried to add visit for invalid post id "' + postId + '"');
        response.send(400, 'Invalid request');
      }
    }

    // Validate the referrer
    var referrer = request.query.referrer;
    if (!url.parse(referrer).hostname) {
      referrer = '';
    }

    // Save the visit
    data.posts[postId].visits.push({
      timestamp: Date.now(),
      ip: getClientIp(request),
      userAgent: request.headers['user-agent'],
      postId: postId,
      referrer: referrer
    });
    saveData();
  });

  // Start the server
  app.listen(options.port);
  logger.info('Server listening on port ' + options.port);
};