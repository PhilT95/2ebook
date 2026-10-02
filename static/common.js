'use strict'

// Helpers for the ereader page (download.html).
// Plain ES5 on purpose: ereader browsers are old.

// Appends a message string to the #logs div at the bottom of the page.
// Used for surfacing JavaScript errors, since ereader browsers have no DevTools.
function log(str) {
    var node = document.createElement("div")
    node.textContent = str
    logs.appendChild(node)
}
// Catch unhandled JS errors and show them in the log div instead of
// silently swallowing them
window.addEventListener("error", function (event) {
    log(event.filename + ":" + event.lineno + " " + event.message)
}, false)

// Minimal XHR wrapper for GET/POST requests without a body.
// Calls cb(xhr) on both success and network error so the caller
// can always inspect xhr.status and xhr.responseText.
// After a network error, xhr.status is 0.
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
