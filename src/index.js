#!/usr/bin/env node

'use strict'

var
  assert       = require('assert'),
  bole         = require('bole'),
  logstring    = require('common-log-string'),
  makeReceiver = require('npm-hook-receiver'),
  slack        = require('@slack/client');

const gh = require('parse-github-url')
const rp = require('request-promise')

var logger = bole(process.env.SERVICE_NAME || 'hooks-bot');
bole.output({ level: 'info', stream: process.stdout });

var token = process.env.SLACK_API_TOKEN || '';
assert(token, 'you must supply a slack api token in process.env.SLACK_API_TOKEN');

var channelID = process.env.SLACK_CHANNEL;
assert(channelID, 'you must supply a slack channel ID in process.env.SLACK_CHANNEL');

var port = process.env.PORT || '6666';

// This is how we post to slack.
var web = new slack.WebClient(token);

// Make a webhooks receiver and have it act on interesting events.
// The receiver is a restify server!
var opts = {
  name:   process.env.SERVICE_NAME || 'hooks-bot',
  secret: process.env.SHARED_SECRET,
  mount:  process.env.MOUNT_POINT || '/incoming',
};
// console.log(opts)
var server = makeReceiver(opts);

function npmUrl (pkg) {
  return `https://www.npmjs.com/package/${pkg}`
}

function markdownToSlackFormat (md) {
  const marked = require('marked')
  const html = marked(md)
  const slackify = require('slackify-html')
  const message = slackify(html)
  return message
}

function isOnGitHub (payload) {
  return payload.repository &&
    payload.repository.url &&
    payload.repository.url.indexOf('github.com') !== -1
}

const ghToken = process.env.GITHUB_TOKEN
function githubReleaseUrl (payload) {
  if (!isOnGitHub(payload)) {
    console.log('package not on github')
    return
  }
  const url = payload.repository.url
  const parsed = gh(url)

  const me = process.env.GITHUB_USERNAME
  return `https://${me}:${ghToken}@api.github.com/repos/${parsed.repo}/releases/latest`
}

function onPackagePublished ({pkg, name, version, payload}) {
  const url = npmUrl(pkg)
  const message = `:package: \<${url}|${name}\>@${version} published!`;
  web.chat.postMessage(channelID, message);

  if (!ghToken) {
    console.log('no GITHUB_TOKEN, will not get the release notes')
    return
  }

  console.log('repo', payload.repository)
  console.log('payload fields', Object.keys(payload))

  const releaseUrl = githubReleaseUrl(payload)
  if (releaseUrl) {
    console.log('hosted on GitHub, grabbing release', releaseUrl)
    const options = {
      uri: releaseUrl,
      headers: {
        'User-Agent': process.env.GITHUB_USERNAME
      },
      json: true
    }
    rp(options)
      .then((response) => {
        if (response.body) {
          // remove first line with anchor link <a name"1.21.0"></a>
          const msg = response.body.split('\n').slice(1).join('\n')
          console.log(msg)
          const slackFormat = `<${response.html_url}|${response.name}>\n` +
            markdownToSlackFormat(msg)
          console.log('slack format message')
          console.log(slackFormat)
          web.chat.postMessage(channelID, slackFormat);
        } else {
          console.log('response is missing body')
          console.log(response)
        }
      })
      .catch((err) => {
        console.error(err.message)
      })
  }
}

// All hook events, with special handling for some.
server.on('hook', function onIncomingHook(hook)
{
  var pkg = hook.name.replace('/', '%2F');
  var type = hook.type;
  var change = hook.event.replace(type + ':', '');

  var message;
  // console.log(hook.change);
  var user = hook.change ? hook.change.user : '';

  switch (hook.event)
  {
  case 'package:star':
    message = `★ \<https://www.npmjs.com/~${user}|${user}\> starred :package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\>`;
    break;

  case 'package:unstar':
    message = `✩ \<https://www.npmjs.com/~${user}|${user}\> unstarred :package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\>`;
    break;

  case 'package:publish':
    console.log('event', hook.event)
    console.log(hook.payload)

    return onPackagePublished({
      pkg,
      name: hook.name,
      version: hook.change.version,
      payload: hook.payload
    })

  case 'package:unpublish':
    message = `:package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\>@${hook.change.version} unpublished`;
    break;

  case 'package:dist-tag':
    message = `:package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\>@${hook.change.version} new dist-tag: \`${hook.change['dist-tag']}\``;
    break;

  case 'package:dist-tag-rm':
    message = `:package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\>@${hook.change.version} dist-tag removed: \`${hook.change['dist-tag']}\``;
    break;

  case 'package:owner':
    message = `:package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\> owner added: \`${hook.change.user}\``;

    break;

  case 'package:owner-rm':
    message = `:package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\> owner removed: \`${hook.change.user}\``;
    break;

  default:
    message = [
      `:package: \<https://www.npmjs.com/package/${pkg}|${hook.name}\>`,
      '*event*: ' + change,
      '*type*: ' + type,
    ].join('\n');
  }

  web.chat.postMessage(channelID, message);
});

server.on('hook:error', function(message)
{
  web.chat.postMessage(channelID, '*error handling web hook:* ' + message);
});

// now make it ready for production

server.on('after', function logEachRequest(request, response, route, error)
{
  logger.info(logstring(request, response));
});

server.get('/ping', function handlePing(request, response, next)
{
  response.send(200, 'pong');
  next();
});

server.listen(port, function()
{
  logger.info('listening on ' + port);
  // web.chat.postMessage(channelID, 'npm hooks slackbot coming on line beep boop');
});
