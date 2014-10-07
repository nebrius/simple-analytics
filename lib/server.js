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

var SALT_LENGTH = 64, // Length of the salt, in bytes
    HASH_LENGTH = 64, // Length of the hash, in bytes
    HASH_ITERATIONS = 1000, // Number of pbkdf2 iterations
    AUTH_TOKEN_LENGTH = 64,

    SUMMARY_CHART_NUM_DAYS = 30,
    DAY_IN_MS = 24 * 60 * 60 * 1000,
    WEEK_IN_MS = 7 * DAY_IN_MS;

var express = require('express'),
    Logger = require('transport-logger'),
    path = require('path'),
    fs = require('fs'),
    url = require('url'),
    mustache = require('mustache'),
    crypto = require('crypto'),
    async = require('async');

module.exports.run = function(options) {

  options = options || {};
  options.auth = options.auth || '/etc/simple-analytics/auth';
  options.logFile = options.logFile || '/var/log/simple-analytics';
  options.dataFile = options.dataFile || '/etc/simple-analytics/database.json';

  var writingData = false,
      needsRewrite = false;
  function saveData(filename, data) {
    if (writingData) {
      needsRewrite = true;
      return;
    }
    writingData = true;
    fs.writeFile(filename, JSON.stringify(data), function(err) {
      var doesNeedRewrite = needsRewrite;
      writingData = needsRewrite = false;
      if (err) {
        logger.error('Could not save data, trying again in 60 seconds: ' + err);
      } else if (doesNeedRewrite) {
        saveData(filename, data);
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

  function compareBuffers(a, b) {
    if (a.length != b.length) {
      return false;
    }
    for (var i = 0, len = a.length; i < len; i++) {
      if (a[i] != b[i]) {
        return false;
      }
    }
    return true;
  }

  // Create the logger
  var logger;
  if (options.logFile) {
    logger = new Logger([{
      destination: options.logFile,
      minLevel: 'debug',
      timestamp: true,
      prependLevel: true
    }, {
      minLevel: 'info'
    }]);
  } else {
    logger = new Logger();
  }

  async.parallel({

    // Read the auth information
    auth: function(next) {

      // Read the auth information
      fs.readFile(options.auth, function (err, buf) {
        if (err) {
          next(err);
        } else if (buf.length != SALT_LENGTH + 2 * HASH_LENGTH) {
          next('Invalid auth file');
        } else {
          next(null, {
            salt: buf.slice(0, SALT_LENGTH),
            usernameHash: buf.slice(SALT_LENGTH, SALT_LENGTH + HASH_LENGTH),
            passwordHash: buf.slice(SALT_LENGTH + HASH_LENGTH),
            authTokens: {}
          });
        }
      });
    },

    // Read the post data
    data: function(next) {
      var data,
          dataFile = options.dataFile;
      if (fs.existsSync(dataFile)) {
        data = JSON.parse(fs.readFileSync(dataFile).toString());
      } else {
        data = {
          posts: {}
        };
        saveData(dataFile, data);
      }
      next(null, data);
    }
  }, function(err, results) {

    if (err) {
      console.error(err);
      process.exit(1);
    }
    var auth = results.auth,
        data = results.data,
        rootUrlPath = options.rootUrlPath;
    if (rootUrlPath[rootUrlPath.length - 1] != '/') {
      rootUrlPath += '/';
    }

    function isValidUser(request) {
      var token = request.cookies.analyticsAuthToken;
      return token && auth.authTokens[token];
    }

    function redirect(response, newUrl) {
      response.statusCode = 302;
      response.setHeader('Location', rootUrlPath + newUrl);
      response.end();
    }

    // Once per day, purge old records
    setInterval(function () {
      var post,
          visits,
          i,
          cutoff = Date.now() - SUMMARY_CHART_NUM_DAYS * DAY_IN_MS;

      for (post in data.posts) {
        post = data.posts[post];
        if (typeof post.numVisits != 'number') {
          post.numVisits = post.visits.length;
        }
        visits = post.visits;
        i = 0;
        while (i < visits.length && visits[i].timestamp < cutoff) {
          i++;
        }
        post.visits = visits.slice(i);
      }
      saveData(options.dataFile, data);
    }, DAY_IN_MS);

    // Create the server
    var app = express();
    app.use(express.static(path.join(__dirname, '..', 'static')));
    app.use(express.bodyParser());
    app.use(express.cookieParser());

    app.all('*', function(req, res, next) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', '*');
      next();
    });

    // Login endpoint
    var loginTemplate = fs.readFileSync(path.join(__dirname, '..', 'templates', 'login.html')).toString();
    app.get('/login', function (request, response) {
       if (isValidUser(request)) {
         redirect(response, '');
       }
      logger.info('Serving login page to ' + getClientIp((request)));
      response.send(mustache.render(loginTemplate, {
        title: options.siteName,
        rootUrlPath: rootUrlPath
      }));
    });

    app.get('/logout', function (request, response) {
      var token = request.cookies.analyticsAuthToken;
      if (token) {
        response.clearCookie('analyticsAuthToken');
        delete auth.authTokens[token];
      }
      redirect(response, 'login');
    });

    // Auth endpoint
    app.post('/auth', function(request, response) {
      var username = request.body.username,
          password = request.body.password;

      if (!username || !password) {
        response.send(401, 'Unauthorized user');
        return;
      }

      if (compareBuffers(crypto.pbkdf2Sync(username, auth.salt, HASH_ITERATIONS, HASH_LENGTH), auth.usernameHash) &&
           compareBuffers(crypto.pbkdf2Sync(password, auth.salt, HASH_ITERATIONS, HASH_LENGTH), auth.passwordHash)) {
        crypto.randomBytes(AUTH_TOKEN_LENGTH, function (err, authTokenBuffer) {
          var authToken = authTokenBuffer.toString('base64');
          auth.authTokens[authToken] = true;
          response.cookie('analyticsAuthToken', authToken);
          redirect(response, '');
        });
      } else {
        response.send(401, 'Unauthorized user');
        return;
      }
    });

    // Analytics endpoint
    var analyticsTemplate = fs.readFileSync(path.join(__dirname, '..', 'templates', 'analytics.html')).toString();
    app.get('/', function (request, response) {

      // Validate the user
      if (!isValidUser(request)) {
        redirect(response, 'login');
        return;
      }
      logger.info('Serving analytics page to ' + getClientIp((request)));

      // Calculate the analytics for the daily visits chart
      var summaryData = {},
        i, len,
        p, post,
        startDate = Date.now() - SUMMARY_CHART_NUM_DAYS * DAY_IN_MS,
        formattedDate;
      for (i = 0, len = SUMMARY_CHART_NUM_DAYS + 1; i < len; i++) {
        formattedDate = new Date(startDate + DAY_IN_MS * i);
        summaryData[formattedDate.getMonth() + 1 + '/' + formattedDate.getDate()] = 0;
      }
      for (p in data.posts) {
        if (data.posts.hasOwnProperty(p)) {
          post = data.posts[p].visits;
          for (i = 0, len = post.length; i < len; i++) {
            if (post[i].timestamp >= startDate) {
              formattedDate = new Date(post[i].timestamp);
              formattedDate = formattedDate.getMonth() + 1 + '/' + formattedDate.getDate();
              summaryData[formattedDate]++;
            }
          }
        }
      }
      var visitsChartLabels = Object.keys(summaryData),
          visitsChartData = [];
      for (i = 0, len = visitsChartLabels.length; i < len; i++) {
        visitsChartData.push(summaryData[visitsChartLabels[i]]);
      }

      function sortTable(table, key) {
        return table.sort(function(a, b) {
          if (a[key] > b[key]) {
            return -1;
          } else if (a[key] < b[key]) {
            return 1;
          } else {
            return 0;
          }
        });
      }

      function calculateVisitsTable(start, end) {
        var visitsTable = [],
            numVisits;
        for (var p in data.posts) {
          if (data.posts.hasOwnProperty(p)) {
            numVisits = 0;
            post = data.posts[p].visits;
            for (var i = 0, len = post.length; i < len; i++) {
              if (post[i].timestamp >= start && post[i].timestamp < end) {
                numVisits++;
              }
            }
            if (numVisits) {
              visitsTable.push({
                post: p,
                visits: numVisits
              });
            }
          }
        }

        visitsTable = sortTable(visitsTable, 'visits');

        visitsTable.push({
          post: 'Total',
          visits: visitsTable.reduce(function(sum, val) { return sum + val.visits; }, 0)
        });

        return visitsTable;
      }

      function calculateReferrersTable(start, end) {
        var referrersTable = {};
        for (var p in data.posts) {
          if (data.posts.hasOwnProperty(p)) {
            post = data.posts[p].visits;
            for (var i = 0, len = post.length; i < len; i++) {
              if (post[i].timestamp >= start && post[i].timestamp < end && post[i].referrer) {
                if (!referrersTable[post[i].referrer]) {
                  referrersTable[post[i].referrer] = 1;
                } else {
                  referrersTable[post[i].referrer]++;
                }
              }
            }
          }
        }
        var parsedReferrersTable = [];
        for (p in referrersTable) {
          parsedReferrersTable.push({
            post: p,
            referrers: referrersTable[p]
          });
        }

        parsedReferrersTable = sortTable(parsedReferrersTable, 'referrers');

        parsedReferrersTable.push({
          post: 'Total',
          referrers: parsedReferrersTable.reduce(function(sum, val) { return sum + val.referrers; }, 0)
        });

        return parsedReferrersTable;
      }

      // Calculate the all-time visits table
      var allTimeVisitsTable = [];
      for (p in data.posts) {
        allTimeVisitsTable.push({
          post: p,
          visits: data.posts[p].numVisits
        });
      }

      allTimeVisitsTable = sortTable(allTimeVisitsTable, 'visits');

      allTimeVisitsTable.push({
        post: 'Total',
        visits: allTimeVisitsTable.reduce(function(sum, post) {
          return sum + post.visits;
        }, 0)
      });

      // Calculate the analytics for today's and yesterday's visits
      var now = Date.now(),
          startOfToday = new Date();
      startOfToday.setHours(0);
      startOfToday.setMinutes(0);
      startOfToday.setSeconds(0);
      response.send(mustache.render(analyticsTemplate, {
        title: options.siteName,
        rootUrlPath: rootUrlPath,
        visitsChartLabels: JSON.stringify(visitsChartLabels),
        visitsChartData: JSON.stringify(visitsChartData),
        todaysVisitsTable: calculateVisitsTable(startOfToday, now),
        todaysReferrersTable: calculateReferrersTable(startOfToday, now),
        yesterdaysVisitsTable: calculateVisitsTable(startOfToday - DAY_IN_MS, startOfToday),
        yesterdaysReferrersTable: calculateReferrersTable(startOfToday - DAY_IN_MS, startOfToday),
        thisWeeksVisitsTable: calculateVisitsTable(now - WEEK_IN_MS, now),
        thisWeeksReferrersTable: calculateReferrersTable(now - WEEK_IN_MS, now),
        lastWeeksVisitsTable: calculateVisitsTable(now - 2 * WEEK_IN_MS, now - WEEK_IN_MS),
        lastWeeksReferrersTable: calculateReferrersTable(now - 2 * WEEK_IN_MS, now - WEEK_IN_MS),
        allTimeVisitsTable: allTimeVisitsTable
      }));
    });

    // Save a visit
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
        if (postId.length < 256) {
          data.posts[postId] = {
            numVisits: 0,
            visits: []
          };
        } else {
          logger.warn('Client tried to add visit for invalid post id "' + postId + '"');
          response.send(400, 'Invalid request');
          return;
        }
      }

      // Validate the referrer
      var referrer = request.query.referrer || '';
      if (referrer && !url.parse(referrer).hostname) {
        referrer = '';
      }

      // Save the visit
      if (typeof data.posts[postId].numVisits != 'number') {
        data.posts[postId].numVisits = data.posts[postId].visits.length;
      }
      data.posts[postId].numVisits++;
      var visits = data.posts[postId].visits;
      visits.push({
        timestamp: Date.now(),
        ip: getClientIp(request),
        userAgent: request.headers['user-agent'],
        postId: postId,
        referrer: referrer
      });
      logger.info('Saving visit data from ' + visits[visits.length - 1].ip);
      saveData(options.dataFile, data);
      response.send(200, 'OK');
    });

    // Start the server
    app.listen(options.port, '127.0.0.1');
    logger.info('Server listening on port ' + options.port);
  });
};