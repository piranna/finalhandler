/*!
 * finalhandler
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

var accepts = require('accepts')
var debug = require('debug')('finalhandler')
var escapeHtml = require('escape-html')
var http = require('http')
var onFinished = require('on-finished')
var unpipe = require('unpipe')

/**
 * Module variables.
 * @private
 */

/* istanbul ignore next */
var defer = typeof setImmediate === 'function'
  ? setImmediate
  : function(fn){ process.nextTick(fn.bind.apply(fn, arguments)) }
var isFinished = onFinished.isFinished

/**
 * Module exports.
 * @public
 */

module.exports = finalhandler

/**
 * Create a function to handle the final response.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {Object} [options]
 * @return {Function}
 * @public
 */

function finalhandler(req, res, options) {
  var opts = options || {}

  // get error callback
  var onerror = opts.onerror

  // get stack trace option
  var stacktrace = opts.stacktrace || false;

  return function (err) {
    var body
    var constructBody
    var msg
    var status = res.statusCode

    // ignore 404 on in-flight response
    if (!err && res._header) {
      debug('cannot 404 after headers sent')
      return
    }

    // unhandled error
    if (err) {
      // respect err.statusCode
      if (err.statusCode) {
        status = err.statusCode
      }

      // respect err.status
      if (err.status) {
        status = err.status
      }

      // default status code to 500
      if (!status || status < 400) {
        status = 500
      }

      // production gets a basic error message
      msg = stacktrace
        ? err.stack || String(err)
        : http.STATUS_CODES[status]
    } else {
      status = 404
      msg = 'Cannot ' + req.method + ' ' + (req.originalUrl || req.url)
    }

    debug('default %s', status)

    // schedule onerror callback
    if (err && onerror) {
      defer(onerror, err, req, res)
    }

    // cannot actually respond
    if (res._header) {
      return req.socket.destroy()
    }

    // negotiate
    var accept = accepts(req)
    var type = accept.types('html', 'text')

    // construct body
    switch (type) {
      case 'html':
        constructBody = constructHtmlBody
        break
      default:
        // default to plain text
        constructBody = constructTextBody
        break
    }

    // construct body
    body = constructBody(status, msg)

    // send response
    send(req, res, status, body)
  }
}

/**
 * Get HTML body string
 *
 * @param {number} status
 * @param {string} message
 * @return {Buffer}
 * @api private
 */

function constructHtmlBody(status, message) {
  var msg = escapeHtml(message)
    .replace(/\n/g, '<br>')
    .replace(/  /g, ' &nbsp;')

  var html = '<!doctype html>\n'
    + '<html lang=en>\n'
    + '<head>\n'
    + '<meta charset=utf-8>\n'
    + '<title>' + escapeHtml(http.STATUS_CODES[status]) + '</title>\n'
    + '</head>\n'
    + '<body>\n'
    + msg + '\n'
    + '</body>\n'

  var body = new Buffer(html, 'utf8')

  body.type = 'text/html; charset=utf-8'

  return body
}

/**
 * Get plain text body string
 *
 * @param {number} status
 * @param {string} message
 * @return {Buffer}
 * @api private
 */

function constructTextBody(status, message) {
  var msg = message + '\n'
  var body = new Buffer(msg, 'utf8')

  body.type = 'text/plain; charset=utf-8'

  return body
}

/**
 * Send response.
 *
 * @param {IncomingMessage} req
 * @param {OutgoingMessage} res
 * @param {number} status
 * @param {Buffer} body
 * @private
 */

function send(req, res, status, body) {
  function write() {
    res.statusCode = status

    // security header for content sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff')

    // standard headers
    res.setHeader('Content-Type', body.type)
    res.setHeader('Content-Length', body.length)

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    res.end(body, 'utf8')
  }

  if (isFinished(req)) {
    write()
    return
  }

  // unpipe everything from the request
  unpipe(req)

  // flush the request
  onFinished(req, write)
  req.resume()
}
