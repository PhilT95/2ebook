#!/usr/bin/env node

// ──────────────────────────────────────────────────────────────────────────────
// Dependencies
// ──────────────────────────────────────────────────────────────────────────────

const http = require('http')
const Koa = require('koa')                        // Minimal async web framework
const Router = require('@koa/router')             // URL routing (GET/POST/DELETE)
const multer = require('@koa/multer')             // Multipart file upload handling
const logger = require('koa-logger')              // HTTP request logging to stdout
const sendfile = require('koa-sendfile')          // Efficient file streaming to the response
const serve = require('koa-static')              // Serves the static/ directory
const { mkdirp } = require('mkdirp')             // Creates directories recursively (like mkdir -p)
const fs = require('fs')
const { spawn } = require('child_process')        // Runs external tools (kepubify, kindlegen, etc.)
const { join, extname, basename, dirname } = require('path')
const resolvepath = require('path').resolve
const FileType = require('file-type')             // Detects real file type from magic bytes (not from browser-supplied MIME)
const { transliterate } = require('transliteration') // Converts non-ASCII characters to ASCII equivalents
const sanitize = require('sanitize-filename')    // Strips characters that are unsafe in filenames

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

const port = 3001
const expireDelay = 30          // Seconds of ereader inactivity before a session is deleted
const maxExpireDuration = 1 * 60 * 60  // Hard maximum session lifetime: 1 hour
const maxFileSize = 1024 * 1024 * 800  // 800 MB upload cap

// MIME types accepted for upload
const TYPE_EPUB = 'application/epub+zip'
const TYPE_MOBI = 'application/x-mobipocket-ebook'

const allowedTypes = [TYPE_EPUB, TYPE_MOBI, 'application/pdf', 'application/vnd.comicbook+zip', 'application/vnd.comicbook-rar', 'text/html', 'text/plain', 'application/zip', 'application/x-rar-compressed']
const allowedExtensions = ['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'html', 'txt']

// Characters used in the 4-character session key shown on the ereader.
// Look-alike characters are intentionally excluded (0/O, 1/I/L, B/8, S/5, etc.)
// so the key is easy for the user to read and type correctly.
const keyChars = "23456789ACDEFGHJKLMNPRSTUVWXYZ"
const keyLength = 4


// ──────────────────────────────────────────────────────────────────────────────
// Helper: filename transliteration
// ──────────────────────────────────────────────────────────────────────────────

// Converts non-ASCII characters in a filename to their ASCII equivalents
// (e.g. "Ü" → "U", "é" → "e"), while leaving the file extension untouched.
// This avoids encoding issues when the filename appears in a download URL.
function doTransliterate(filename) {
  let name = filename.split(".")
  const ext = "." + name.splice(-1).join(".")
  name = name.join(".")

  return transliterate(name) + ext
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: session key generation
// ──────────────────────────────────────────────────────────────────────────────

// Generates a random 4-character key from keyChars (e.g. "K7MR").
// Strategy: pick a random integer in [0, 30^4), convert it to base-30,
// then map each base-30 digit to the corresponding character in keyChars.
//
// NOTE: Math.random() is not cryptographically secure. A future improvement
// is to replace it with crypto.randomInt().
function randomKey () {
  const choices = Math.pow(keyChars.length, keyLength)  // 30^4 = 810,000 possible keys
  const rnd = Math.floor(Math.random() * choices)

  return rnd.toString(keyChars.length).padStart(keyLength, '0').split('').map((chr) => {
    return keyChars[parseInt(chr, keyChars.length)]
  }).join('')
}

// ──────────────────────────────────────────────────────────────────────────────
// Session lifecycle: expiry and removal
// ──────────────────────────────────────────────────────────────────────────────

// Fully removes a session: cancels its timer, deletes the file from disk,
// and removes the entry from the in-memory Map.
// Called either by the expiry timer or by the hard 1-hour cap.
function removeKey (key) {
  console.log('Removing expired key', key)
  const info = app.context.keys.get(key)
  if (info) {
    clearTimeout(app.context.keys.get(key).timer)
    if (info.file) {
      // Delete the uploaded (or converted) file from disk
      console.log('Deleting file', info.file.path)
      fs.unlink(info.file.path, (err) => {
        if (err) console.error(err)
      })
      info.file = null
    }
    app.context.keys.delete(key)
  } else {
    console.log('Tried to remove non-existing key', key)
  }
}

// Resets the 30-second inactivity timer for a session.
// Called every time the ereader does something (polls /status, downloads a file).
// As long as the ereader keeps polling, the session stays alive.
function expireKey (key) {
  // console.log('key', key, 'will expire in', expireDelay, 'seconds')
  const info = app.context.keys.get(key)
  const timer = setTimeout(removeKey, expireDelay * 1000, key)
  if (info) {
    clearTimeout(info.timer)  // cancel the previous countdown
    info.timer = timer
    info.alive = new Date()
  }
  return timer
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: HTTP response for upload results
// ──────────────────────────────────────────────────────────────────────────────

// Sends a plain-text response body and sets the status code.
// The upload page reads this text directly and displays it to the user.
// On failure, Connection: close signals to the browser that the upload was rejected.
function flash (ctx, data) {
  console.log(data)
  //ctx.cookies.set('flash', encodeURIComponent(JSON.stringify(data)), {overwrite: true, httpOnly: false, sameSite: 'strict', maxAge: 10 * 1000})
  ctx.response.status = data.success ? 200 : 400
  if (!data.success) {
    ctx.set("Connection", "close")
  }
  ctx.body = data.message
}

// ──────────────────────────────────────────────────────────────────────────────
// App setup
// ──────────────────────────────────────────────────────────────────────────────

const app = new Koa()

// The entire "database" — all active sessions live here for the lifetime of the
// process. Nothing is persisted to disk; a server restart clears everything.
// Each key maps to an info object: { created, agent, file, urls, timer, alive }
app.context.keys = new Map()

app.use(logger())

const router = new Router()

// ──────────────────────────────────────────────────────────────────────────────
// Multer: file upload configuration
// ──────────────────────────────────────────────────────────────────────────────

const upload = multer({
  // diskStorage writes the received file straight to disk.
  // The file is stored in uploads/ with a unique name to avoid collisions.
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads')
    },
    filename: function (req, file, cb) {
      // Unique suffix: timestamp + random 9-digit number
      const uniqueSuffix = Date.now() + '-' + Math.floor(Math.random() * 1E9)
      cb(null, file.fieldname + '-' + uniqueSuffix + extname(file.originalname).toLowerCase())
    }
  }),
  limits: {
    fileSize: maxFileSize,
    files: 1   // only one file per request
  },
  // fileFilter runs before the file body is written to disk.
  // It can accept or reject the upload early.
  fileFilter: (req, file, cb) => {
    // Multer misreads UTF-8 filenames as Latin-1 due to a spec ambiguity.
    // This re-encodes the bytes correctly.
    // See: https://github.com/expressjs/multer/issues/1104#issuecomment-1152987772
    file.originalname = sanitize(Buffer.from(file.originalname, 'latin1').toString('utf8'))

    console.log('Incoming file:', file)

    // The session key is submitted as a form field alongside the file
    const key = req.body.key.toUpperCase()
    if (!app.context.keys.has(key)) {
      console.error('FileFilter: Unknown key: ' + key)
      cb("Unknown key " + key, false)
      return
    }

    // Reject files whose MIME type or extension is not on the allowlist.
    // Note: the browser-supplied MIME type is not fully trusted; a deeper
    // check using file-type (magic bytes) happens later in the upload handler.
    if ((!allowedTypes.includes(file.mimetype) && file.mimetype != "application/octet-stream") || !allowedExtensions.includes(extname(file.originalname.toLowerCase()).substring(1))) {
      console.error('FileFilter: File is of an invalid type ', file)
      cb("Invalid filetype: " + JSON.stringify(file), false)
      return
    }
    cb(null, true)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Route: POST /generate — ereader calls this to start a session
// ──────────────────────────────────────────────────────────────────────────────

router.post('/generate', async ctx => {
  const agent = ctx.get('user-agent')

  // Generate a key that isn't already in use
  let key = null
  let attempts = 0
  console.log('There are currently', ctx.keys.size, 'key(s) in use.')
  console.log('Generating unique key...', ctx.ip, agent)
  do {
    key = randomKey()
    if (attempts > ctx.keys.size) {
      // This should only happen if almost all 810,000 possible keys are in use
      console.error('Can\'t generate more keys, map is full.', attempts, ctx.keys.size)
      ctx.body = 'error'
      return
    }
    attempts++
  } while (ctx.keys.has(key))

  console.log('Generated key ' + key + ', '+attempts+' attempt(s)')

  // Session info object stored in the Map for this key
  const info = {
    created: new Date(),
    agent: agent,   // User-Agent of the ereader — used later to verify download requests
    file: null,     // Populated once the desktop uploads a file
    urls: []        // Optional URLs the desktop can relay to the ereader
  }
  ctx.keys.set(key, info)

  // Start the 30-second inactivity timer
  expireKey(key)

  // Hard cap: delete the session after 1 hour regardless of activity.
  // The identity check (=== info) guards against a race where the key was
  // reused after expiry — we only remove it if it's still the same session.
  setTimeout(() => {
    if(ctx.keys.get(key) === info) removeKey(key)
  }, maxExpireDuration * 1000)

  // Set a cookie so the ereader can recover its key across page refreshes
  // (currently the JS reads the response body directly, but the cookie is a fallback)
  ctx.cookies.set('key', key, {overwrite: true, httpOnly: false, sameSite: 'strict', maxAge: expireDelay * 1000})

  // Return the key as plain text — the ereader's JS displays it on screen
  ctx.body = key
})

/*
router.get('/download/:key', async ctx => {
  const key = ctx.cookies.get('key')
  if (!key) {
    await next()
    return
  }

  const info = ctx.keys.get(key)

  if (!info || !info.file) {
    await next()
    return
  }

  ctx.redirect('/' + encodeURIComponent(info.file.name));
})
*/

// ──────────────────────────────────────────────────────────────────────────────
// Handler: file download — used by GET /:filename
// ──────────────────────────────────────────────────────────────────────────────

// The ereader constructs the download URL as: /<filename>?key=<KEY>
// Both the filename and the key must match what's stored in the session.
async function downloadFile (ctx, next) {
  const key = ctx.query.key
  if (!key) {
    await next()
    return
  }

  const filename = decodeURIComponent(ctx.params.filename)
  const info = ctx.keys.get(key)

  // Bail out if the key is unknown, no file is ready, or the filename doesn't match.
  // Calling next() falls through to koa-static, which will return a 404.
  if (!info || !info.file || info.file.name !== filename) {
    await next()
    return
  }

  // The User-Agent must match the one that generated the key.
  // This is a weak guard — it prevents the desktop browser from accidentally
  // downloading the file, but it is trivially spoofable.
  if (info.agent !== ctx.get('user-agent')) {
    console.error("User Agent doesnt match: " + info.agent + " VS " + ctx.get('user-agent'))
    return
  }

  // Reset the inactivity timer — the ereader is clearly still active
  expireKey(key)

  console.log('Sending file', [info.file.path, info.file.name])

  // Kindle's browser requires Content-Disposition: attachment with the filename
  // to recognise the downloaded file correctly; other browsers don't need this.
  if (info.agent.includes('Kindle')) {
    ctx.attachment(info.file.name)
  }

  // Stream the file from disk to the HTTP response
  await sendfile(ctx, info.file.path)
}

// ──────────────────────────────────────────────────────────────────────────────
// Route: POST /upload — desktop sends a file (and/or a URL) for the ereader
// ──────────────────────────────────────────────────────────────────────────────

router.post('/upload', async (ctx, next) => {

  // Run multer: receive and write the uploaded file to disk.
  // On failure (bad key, bad file type, size exceeded), multer throws and
  // we respond with an error message.
  try {
    await upload.single('file')(ctx, () => {})
  } catch (err) {
    flash(ctx, {
      message: err,
      success: false
    })
    // ctx.throw(400, err)
    // ctx.res.end(err)
    await next()
    return
  }

  // NOTE: this is called after the file has already been fully received.
  // Ideally writeContinue() should be sent *before* the body to handle
  // the Expect: 100-continue handshake properly, but moving it would
  // require restructuring the multer integration.
  ctx.res.writeContinue()

  const key = ctx.request.body.key.toUpperCase()

  if (ctx.request.file) {
    console.log('Uploaded file:', ctx.request.file)
  }

  // Re-validate the key after upload (multer's fileFilter already checked it,
  // but the key could have expired in the time it took to upload a large file)
  if (!ctx.keys.has(key)) {
    flash(ctx, {
      message: 'Unknown key ' + key,
      success: false
    })
    if (ctx.request.file) {
      fs.unlink(ctx.request.file.path, (err) => {
        if (err) console.error(err)
        else console.log('Removed file', ctx.request.file.path)
      })
    }
    await next()
    return
  }

  const info = ctx.keys.get(key)
  expireKey(key)

  // Optional: the desktop can submit a URL instead of (or in addition to) a file.
  // The URL is stored in the session and returned to the ereader via /status.
  let url = null
  if (ctx.request.body.url) {
    url = ctx.request.body.url.trim()
    if (url.length > 0 && !info.urls.includes(url)) {
      info.urls.push(url)
    }
  }

  let conversion = null  // name of the converter used, if any (for the success message)
  let filename = ""

  if (ctx.request.file) {
    // Reject empty files early
    if (ctx.request.file.size === 0) {
      let data = {
        message: 'Invalid file submitted (empty file)',
        success: false,
        key: key
      }
      flash(ctx, data)
      fs.unlink(ctx.request.file.path, (err) => {
        if (err) console.error(err)
        else console.log('Removed file', ctx.request.file.path)
      })
      await next()
      return
    }

    let mimetype = ctx.request.file.mimetype

    // Re-detect the MIME type from the file's magic bytes (the first few bytes
    // of the file that identify its format). This is independent of — and more
    // reliable than — the MIME type the browser sent in the multipart header.
    const type = await FileType.fromFile(ctx.request.file.path)

    // If the browser said "application/octet-stream" (i.e. unknown), trust the
    // magic-byte detection instead
    if (mimetype == "application/octet-stream" && type) {
      mimetype = type.mime
    }

    // Normalise a non-standard EPUB MIME type that some tools emit
    if (mimetype == "application/epub") {
      mimetype = TYPE_EPUB
    }

    // Reject if neither the magic-byte type nor the browser-supplied type is allowed
    if ((!type || !allowedTypes.includes(type.mime)) && !allowedTypes.includes(mimetype)) {
      flash(ctx, {
        message: 'Uploaded file is of an invalid type: ' + ctx.request.file.originalname + ' (' + (type? type.mime : 'unknown mimetype') + ')',
        success: false,
        key: key
      })
      fs.unlink(ctx.request.file.path, (err) => {
        if (err) console.error(err)
        else console.log('Removed file', ctx.request.file.path)
      })
      await next()
      return
    }

    let data = null  // will hold the final file path (after any conversion)
    filename = ctx.request.file.originalname

    // Optionally convert non-ASCII filename characters to ASCII
    if (ctx.request.body.transliteration) {
      filename = sanitize(doTransliterate(filename))
    }

    // Kindle's browser only handles safe ASCII filenames
    if (info.agent.includes('Kindle')) {
      filename = filename.replace(/[^\.\w\-"'\(\)]/g, '_')
    }

    // ── Conversion branch ─────────────────────────────────────────────────────
    // Each converter is wrapped in a Promise so we can await it.
    // On success the Promise resolves with the output file path.
    // On failure it rejects with the tool's error output.
    // In both cases the original uploaded file is deleted from disk.

    if (mimetype === TYPE_EPUB && info.agent.includes('Kindle') && ctx.request.body.kindlegen) {
      // EPUB → MOBI for Kindle, using KindleGen
      conversion = 'kindlegen'
      const outname = ctx.request.file.path.replace(/\.epub$/i, '.mobi')
      filename = filename.replace(/\.kepub\.epub$/i, '.epub').replace(/\.epub$/i, '.mobi')
      let stderr = ''

      let p = new Promise((resolve, reject) => {
        // Run kindlegen in the uploads/ directory so it can find the input file
        // by its basename (kindlegen doesn't handle absolute paths well)
        const kindlegen = spawn('kindlegen', [basename(ctx.request.file.path), '-dont_append_source', '-c1', '-o', basename(outname)], {
          // stdio: 'inherit',
          cwd: dirname(ctx.request.file.path)
        })

        // If the process itself fails to start (e.g. kindlegen not installed)
        kindlegen.once('error', function (err) {
          fs.unlink(ctx.request.file.path, (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path)
          })
          // Also clean up any partial .mobi8 intermediate file kindlegen may have created
          fs.unlink(ctx.request.file.path.replace(/\.epub$/i, '.mobi8'), (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path.replace(/\.epub$/i, '.mobi8'))
          })
          reject('kindlegen error: ' + err)
        })

        kindlegen.once('close', (code) => {
          // Always delete the original .epub after conversion attempt
          fs.unlink(ctx.request.file.path, (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path)
          })
          // kindlegen exits with code 1 for warnings (still a valid output),
          // and code 2 for actual errors. Treat 0 and 1 both as success.
          fs.unlink(ctx.request.file.path.replace(/\.epub$/i, '.mobi8'), (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path.replace(/\.epub$/i, '.mobi8'))
          })
          if (code !== 0 && code !== 1) {
            reject('kindlegen error code: ' + code + '\n' + stderr)
            return
          }

          resolve(outname)
        })
        kindlegen.stdout.on('data', function (str) {
          stderr += str
          console.log('kindlegen: ' + str)
        })
        kindlegen.stderr.on('data', function (str) {
          stderr += str
          console.log('kindlegen: ' + str)
        })
      })
      try {
        data = await p
      } catch (err) {
        // Scrub internal file paths from the error before sending it to the browser
        flash(ctx, {
          success: false,
          message: err.replaceAll(basename(ctx.request.file.path), "infile.epub").replaceAll(basename(outname), "outfile.mobi")
        })
        return
      }

    } else if (mimetype === TYPE_EPUB && info.agent.includes('Kobo') && ctx.request.body.kepubify) {
      // EPUB → Kobo EPUB (.kepub.epub) for Kobo, using kepubify
      conversion = 'kepubify'
      const outname = ctx.request.file.path.replace(/\.epub$/i, '.kepub.epub')
      filename = filename.replace(/\.kepub\.epub$/i, '.epub').replace(/\.epub$/i, '.kepub.epub')

      let p = new Promise((resolve, reject) => {
        let stderr = ''
        const kepubify = spawn('kepubify', ['-v', '-u', '-o', basename(outname), basename(ctx.request.file.path)], {
          //stdio: 'inherit',
          cwd: dirname(ctx.request.file.path)
        })
        kepubify.once('error', function (err) {
          fs.unlink(ctx.request.file.path, (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path)
          })
          reject('kepubify error: ' + err)
        })
        kepubify.once('close', (code) => {
          // Always delete the original .epub after conversion attempt
          fs.unlink(ctx.request.file.path, (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path)
          })
          if (code !== 0) {
            reject('Kepubify error code: ' + code + '\n' + stderr)
            return
          }

          resolve(outname)
        })
        kepubify.stdout.on('data', function (str) {
          stderr += str
          console.log('kepubify: ' + str)
        })
        kepubify.stderr.on('data', function (str) {
          stderr += str
          console.log('kepubify: ' + str)
        })
      })
      try {
        data = await p
      } catch (err) {
        flash(ctx, {
          success: false,
          message: err.replaceAll(basename(ctx.request.file.path), "infile.epub").replaceAll(basename(outname), "outfile.kepub.epub")
        })
        return
      }

    } else if (mimetype == 'application/pdf' && ctx.request.body.pdfcropmargins) {
      // PDF → cropped PDF, using pdfcropmargins
      const dir = dirname(ctx.request.file.path)
      const base = basename(ctx.request.file.path, '.pdf')
      const outfile = resolvepath(join(dir, `${base}_cropped.pdf`))
      let p = new Promise((resolve, reject) => {
        let stderr = ''
        const pdfcropmargins = spawn('pdfcropmargins', ['-s', '-u', '-o', outfile, basename(ctx.request.file.path)], {
          // stdio: 'inherit',
          cwd: dirname(ctx.request.file.path)
        })
        pdfcropmargins.once('error', function (err) {
          fs.unlink(ctx.request.file.path, (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path)
          })
          reject('pdfcropmargins error: ' + err)
        })
        pdfcropmargins.once('close', (code) => {
          // Always delete the original PDF after conversion attempt
          fs.unlink(ctx.request.file.path, (err) => {
            if (err) console.error(err)
            else console.log('Removed file', ctx.request.file.path)
          })
          if (code !== 0) {
            reject('pdfcropmargins error code: ' + code + '\n' + stderr)
            return
          }

          resolve(outfile)
        })
        pdfcropmargins.stdout.on('data', function (str) {
          stderr += str
          console.log('pdfcropmargins: ' + str)
        })
        pdfcropmargins.stderr.on('data', function (str) {
          stderr += str
          console.log('pdfcropmargins: ' + str)
        })
      })
      try {
        data = await p
      } catch (err) {
        flash(ctx, {
          success: false,
          message: err.replaceAll(basename(ctx.request.file.path), "infile.pdf").replaceAll(outfile, "outfile.pdf")
        })
        return
      }

    } else {
      // No conversion needed — use the uploaded file as-is
      data = ctx.request.file.path
      filename = filename.replace(/\.epub$/i, '.epub').replace(/\.pdf$/i, '.pdf')
    }

    // Reset the timer again — processing may have taken a while
    expireKey(key)

    // If a previous file was already associated with this key, delete it from
    // disk before storing the new one (e.g. user uploaded twice)
    if (info.file && info.file.path) {
      await new Promise((resolve, reject) => fs.unlink(info.file.path, (err) => {
        if (err) return reject(err)
        else console.log('Removed previously uploaded file', info.file.path)
        resolve()
      }))
    }

    // Store the final file path and display name in the session.
    // The ereader's next /status poll will see info.file !== null and show the link.
    info.file = {
      name: filename,
      path: data,
      // size: ctx.request.file.size,
      uploaded: new Date()
    }
  }

  // Build the success message shown to the desktop user
  let messages = []
  if (ctx.request.file) {
    ctx.request.file.skip = true
    messages.push('Upload successful! ' + (conversion ? 'Ebook was converted with ' + conversion + ' and sent' : 'Sent')+' to '+(info.agent.includes('Kobo') ? 'a Kobo device.' : (info.agent.includes('Kindle') ? 'a Kindle device.' : 'a device.')))
    messages.push('Filename: ' + filename)
  }
  if (url) {
    messages.push("Added url: " + url)
  }

  if (messages.length === 0) {
    flash(ctx, {
      message: 'No file or url selected',
      success: false,
      key: key
    })
    await next()
    return
  }

  // NOTE: messages.join("<br/>") is rendered via innerHTML in upload.html.
  // If `filename` contained HTML special characters that survived sanitize-filename,
  // this would be an XSS vector. A future fix is to HTML-encode the filename here.
  flash(ctx, {
    message: messages.join("<br/>"),
    success: true,
    key: key,
    url: url
  })

  await next()
})

// ──────────────────────────────────────────────────────────────────────────────
// Route: DELETE /file/:key — ereader signals it has finished downloading
// ──────────────────────────────────────────────────────────────────────────────

// BUG: this only clears the in-memory reference; it does not delete the file
// from disk. The file will remain until the session expires and removeKey() runs.
router.delete('/file/:key', async ctx => {
  const key = ctx.params.key.toUpperCase()
  const info = ctx.keys.get(key)
  if (!info) {
    ctx.throw(400, 'Unknown key: ' + key)
  }
  info.file = null
  ctx.body = 'ok'
})

// ──────────────────────────────────────────────────────────────────────────────
// Route: GET /status/:key — ereader polls this every 5 seconds
// ──────────────────────────────────────────────────────────────────────────────

router.get('/status/:key', async ctx => {
  const key = ctx.params.key.toUpperCase()
  const info = ctx.keys.get(key)
  if (!info) {
    ctx.response.status = 404
    ctx.body = {error: 'Unknown key'}
    return
  }

  // Verify the request comes from the same device that generated the key.
  // This prevents the desktop browser from keeping the session alive accidentally.
  if (info.agent !== ctx.get('user-agent')) {
    // don't send this error to client
    console.error("User Agent doesnt match: " + info.agent + " VS " + ctx.get('user-agent'))
    return
  }

  // Each poll resets the inactivity timer — this is the keepalive mechanism
  expireKey(key)
  // ctx.cookies.set('key', key, {overwrite: true, httpOnly: false, sameSite: 'strict', maxAge: expireDelay * 1000})

  // Return only the filename (not the server-side path) so the ereader can
  // construct the download URL as: /<filename>?key=<KEY>
  ctx.body = {
    alive: info.alive,
    file: info.file ? {
      name: info.file.name,
      // size: info.file.size
    } : null,
    urls: info.urls
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Routes: HTML pages
// ──────────────────────────────────────────────────────────────────────────────

// Explicit route for ereaders that need a direct URL to the download page
router.get('/receive', async ctx => {
  await sendfile(ctx, 'static/download.html')
})

// Root: auto-detect the visitor's device by User-Agent and serve the
// appropriate page — download.html for ereaders, upload.html for everything else
router.get('/', async ctx => {
  const agent = ctx.get('user-agent')
  console.log(ctx.ip, agent)
  await sendfile(ctx, agent.includes('Kobo') || agent.includes('Kindle') || agent.toLowerCase().includes('tolino') || agent.includes('eReader') /*"eReader" is on Tolino*/ ? 'static/download.html' : 'static/upload.html')
})

// Catch-all for file downloads: GET /<filename>?key=<KEY>
router.get('/:filename', downloadFile)

// ──────────────────────────────────────────────────────────────────────────────
// Middleware stack (order matters in Koa)
// ──────────────────────────────────────────────────────────────────────────────

// 1. Serve files from static/ (CSS, JS, HTML) — if a file matches, stop here
app.use(serve("static"))
// 2. Try the router routes; if none match, Koa returns 404
app.use(router.routes())
app.use(router.allowedMethods())


// ──────────────────────────────────────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────────────────────────────────────

// Wipe and recreate the uploads directory on every startup.
// Any files left over from a previous run (e.g. after a crash) are deleted,
// since the in-memory session Map that tracked them is gone.
fs.rm('uploads', {recursive: true}, (err) => {
  if (err) throw err
  mkdirp('uploads').then (() => {
    // Use a raw http.Server instead of app.listen() so we can attach a
    // 'checkContinue' listener for the Expect: 100-continue upload handshake.
    // Without this, Node would auto-respond to 100-continue before our handlers run.
    // app.listen(port)
    const fn = app.callback()
    const server = http.createServer(fn)
    server.on('checkContinue', (req, res) => {
      console.log("check continue!")
      fn(req, res)
    })
    server.listen(port)
    console.log('server is listening on port ' + port)
  })
})
