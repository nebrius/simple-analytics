Simple Analytics Server
=======================

Simple node.js based site analytics server. It is not intended to be powerful, configurable, or scalable. Instead, it's really just to serve as a stop-gap until [Ghost Blog](https://ghost.org/) gets its dashboard released.

To install:

```
npm install -g simple-analytics
```

Once this is done, create a configuration file and put it at ```/etc/simple-analytics/simple-analytics.conf```. You can use [simple-analytics.example.conf](https://github.com/bryan-m-hughes/simple-analytics/blob/master/simple-analytics.example.conf) as a starting point.

The configuration file has five options:
* siteName: The name of your website. This value gets put into the analytics page in a few places
* rootUrlPath: The root url path for the analytics page (used for redirecting)
* dataFile: Path to the JSON file that stores the page visit information
* port: The server's listen port
* logFile: The file to log to
* auth: The file that stores the admin login information

After your configuration file is all set up, you will need to create the authentication information. Run:

```[sudo] simple-analytics -a```

This will create the salted and hashed (via pbkdf2) authentication file at ```/etc/simple-analytics/auth```. You can optionally specify a path specifying where to store the authentication information.

Once this is done, to start the server run:

```
simple-analytics
```

This will use the default ```/etc/simple-analytics/simple-analytics.conf``` configuration file.

You can specify an optional configuration file using the -p flag (this is required on Windows):

```
simple-analytics -p path/to/configuration/file.json
```

To have this service run at startup, use one of the mechanism described for [Ghost Blog deploy](http://docs.ghost.org/installation/deploy/).

Simple Analytics is designed to be run locally only, meaning you will need to setup a proxy in front of it. If you want analytics to be available at ```http://example.com/analytics``` and are using nginx:

```
location /analytics/ {
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://localhost:6529/;
    proxy_set_header Host $host;
    proxy_buffering off;
}
```

License
=======

The MIT License (MIT)

Copyright (c) 2013-2014 Bryan Hughes bryan@theoreticalideations.com (https://theoreticalideations.com)

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
