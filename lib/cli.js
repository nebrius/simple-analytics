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

var program = require('commander'),
    server = require('./server'),
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto'),
    prompt = require('prompt');

var SALT_LENGTH = 64, // Length of the salt, in bytes
    HASH_LENGTH = 64, // Length of the hash, in bytes
    HASH_ITERATIONS = 1000; // Number of pbkdf2 iterations

module.exports = function (argv) {
  program
    .version(require('../package.json').version)
    .option('-c, --config [path]', 'The path to the config file. Defaults to "./simple-analytics.example.conf"')
    .option('-a, --auth [value]', 'Create authentication credentials')
    .parse(argv);

  function auth() {
    var schema = {
      properties: {
        username: {
          description: 'Enter a username',
          pattern: /^[a-zA-Z\s\-]+$/,
          message: 'Username must be only letters, spaces, or dashes',
          required: true
        },
        password1: {
          description: 'Enter a password',
          hidden: true
        },
        password2: {
          description: 'Repeat the password',
          hidden: true
        }
      }
    };

    prompt.start();
    prompt.get(schema, function (err, result) {
      if (err) {
        process.exit(1);
      }
      if (result.password1 != result.password2) {
        console.error('Passwords do not match');
        process.exit(1);
      }

      // Create the salt
      crypto.randomBytes(SALT_LENGTH, function (err, salt) {
        if (err) {
          console.error(err);
          process.exit(1);
        } else {
          var usernameHash = crypto.pbkdf2Sync(result.username, salt, HASH_ITERATIONS, HASH_LENGTH),
              passwordHash = crypto.pbkdf2Sync(result.password1, salt, HASH_ITERATIONS, HASH_LENGTH);
          fs.writeFileSync(program.auth, Buffer.concat([salt, usernameHash, passwordHash]));
          console.log('Auth file created at ' + program.auth);
        }
      });
    });
  }

  function run() {
    if (!program.config) {
      program.config = path.join(__dirname, '..', 'simple-analytics.example.conf');
    }
    if (!fs.existsSync(program.config)) {
      console.error('Config file "' + program.config + '" does not exist');
      process.exit(1);
    }
    console.log('Using config file ' + program.config);
    var config;
    try {
      config = fs.readFileSync(program.config).toString();
      config = JSON.parse(config);
    } catch(e) {
      console.error('Could not read config file "' + program.config + '": ' + e);
      process.exit(1);
    }
    server.run(config);
  }

  if (program.auth) {
    auth();
  } else {
    run();
  }
};
