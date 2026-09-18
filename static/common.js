'use strict'

// Appends a message string to the #logs div at the bottom of the page.
// Used for surfacing JavaScript errors during development.
function log(str) {
    var node = document.createElement("div")
    node.textContent = str
    logs.appendChild(node)
}
// Catch unhandled JS errors and show them in the log div instead of
// silently swallowing them (useful on ereader browsers with no DevTools)
window.addEventListener("error", function (event) {
    log(event.filename + ":" + event.lineno + " " + event.message)
}, false)

// Minimal XHR wrapper for GET/POST requests without a body.
// Calls cb(xhr) on both success and network error so the caller
// can always inspect xhr.status and xhr.responseText.
function xhr(method, url, cb) {
	var x = new XMLHttpRequest()
	x.onload = function () {
		cb(x)
	}
	x.onerror = function () {
		cb(x)
	}
	x.open(method, url, true)
	x.send(null)
}

// iOS detection — used in upload.html to remove the `accept` attribute from
// the file input, because iOS Safari incorrectly blocks .mobi files when
// accept is set to a MIME type list.
var isIOS = /iPad|iPhone|iPod/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Parses document.cookie into a plain object.
// Handles both quoted and unquoted values, and attempts JSON.parse on each
// value so structured data stored in cookies is automatically decoded.
function getCookies() {
	var cookieRegex = /([\w\.]+)\s*=\s*(?:"((?:\\"|[^"])*)"|(.*?))\s*(?:[;,]|$)/g
	var cookies = {}
	var match
	while( (match = cookieRegex.exec(document.cookie)) !== null ) {
		var value = match[2] || match[3]
		cookies[match[1]] = decodeURIComponent(value)
		try {
			cookies[match[1]] = JSON.parse(cookies[match[1]])
		} catch (err) {}
	}
	return cookies
}
// function deleteCookie(name) {
// 	document.cookie = name + "= ; expires = Thu, 01 Jan 1970 00:00:00 GMT"
// }
