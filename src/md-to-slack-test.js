const md = `
## 1.21.0 (2016-06-15)

#### Bug Fixes

* **test:** testing slack publish bot ([93f6e99f](https://github.com/bahmutov/stitch-notify/commit/93f6e99f))
`

const marked = require('marked')
const html = marked(md)
console.log('html')
console.log(html)

const slackify = require('slackify-html')
const message = slackify(html)
console.log('slack format')
console.log(message)
