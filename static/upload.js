// Behaviour of the upload page.
// Loaded with <script type="module">: modules run after the HTML is parsed,
// so every element below already exists. Unlike common.js (which the ereader
// page still uses), this file may use modern JavaScript.

// Keep in sync with MAX_FILE_SIZE in src/config.ts. The server enforces it
// anyway, this only gives instant feedback before a big upload starts.
const MAX_FILE_SIZE = 100 * 1024 * 1024

const byId = (id) => document.getElementById(id)
const form = byId('uploadform')
const dropzone = byId('dropzone')
const fileinput = byId('fileinput')
const fileinfo = byId('fileinfo')
const urlinput = byId('urlinput')
const status = byId('uploadstatus')
const submitButton = byId('submitbutton')
const progressWrap = byId('progresswrap')
const progress = byId('progress')
const progressLabel = byId('progresslabel')
const siteurl = byId('siteurl')

// Read the accepted types BEFORE the iOS workaround below clears the attribute
const accepted = fileinput.accept.split(',')

// iOS Safari wrongly blocks .mobi files when `accept` contains MIME types
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1)
if (isIOS) fileinput.accept = ''


// ---- status message (green = success, red = error) ----

function showStatus(message, kind) {
    status.className = kind
    status.textContent = message.trim() // textContent, never innerHTML: the text can contain a filename
}

function hideStatus() {
    status.className = ''
    status.textContent = ''
}

status.addEventListener('click', hideStatus)


// ---- choosing a file ----

function formatSize(bytes) {
    return bytes < 1024 * 1024
        ? `${Math.ceil(bytes / 1024)} kB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Returns an error message, or null if the file is fine
function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
        return `File too large (maximum ${MAX_FILE_SIZE / 1024 / 1024} MB)`
    }
    const name = file.name.toLowerCase()
    const allowed = accepted.some((item) =>
        item.startsWith('.') ? name.endsWith(item) : file.type === item
    )
    return allowed ? null : `Invalid file: ${file.name}\nPlease select another file.`
}

function updateFileInfo() {
    const file = fileinput.files[0]
    if (!file) {
        fileinfo.textContent = ''
        return
    }
    const error = validateFile(file)
    if (error) {
        fileinput.value = ''
        fileinfo.textContent = ''
        showStatus(error, 'error')
        return
    }
    hideStatus()
    fileinfo.textContent = `${file.name}\n${formatSize(file.size)}`
}

fileinput.addEventListener('change', updateFileInfo)


// ---- drag and drop ----

for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
        event.preventDefault() // without this the browser refuses the drop
        dropzone.classList.add('dragover')
    })
}

dropzone.addEventListener('dragleave', (event) => {
    // dragleave also fires when the pointer moves onto a child element
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragover')
})

dropzone.addEventListener('drop', (event) => {
    event.preventDefault()
    dropzone.classList.remove('dragover')
    const file = event.dataTransfer.files[0]
    if (!file) return
    // Only one file is allowed, so copy just the first into the real input
    const files = new DataTransfer()
    files.items.add(file)
    fileinput.files = files.files
    updateFileInfo()
})

// A file dropped next to the drop area would make the browser open it
for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (event) => event.preventDefault())
}


// ---- submitting ----

function setBusy(busy) {
    submitButton.disabled = busy // prevents sending twice by double-clicking
    progressWrap.hidden = !busy
    if (busy) {
        progress.value = 0
        progressLabel.textContent = 'Uploading… 0%'
    }
}

// The server answers with plain text, but Fastify's own errors
// (for example the rate limit) are JSON with a "message" field
function responseMessage(xhr) {
    const text = xhr.responseText.trim()
    if (xhr.getResponseHeader('content-type')?.includes('application/json')) {
        try {
            return JSON.parse(text).message ?? text
        } catch {
            // not valid JSON after all, fall through and show the raw text
        }
    }
    return text || `Request failed (${xhr.status})`
}

// XMLHttpRequest instead of fetch(): fetch cannot report upload progress
form.addEventListener('submit', (event) => {
    event.preventDefault()
    hideStatus()
    setBusy(true)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', form.action)

    xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return
        if (e.loaded < e.total) {
            const percent = Math.round(100 * e.loaded / e.total)
            progress.value = percent
            progressLabel.textContent = `Uploading… ${percent}%`
        } else {
            // Everything is sent, now the server converts and encrypts.
            // A <progress> without a value shows an endless animation.
            progress.removeAttribute('value')
            progressLabel.textContent = 'Processing uploaded file… please wait'
        }
    }

    xhr.onload = () => {
        setBusy(false)
        const ok = xhr.status === 200
        showStatus(responseMessage(xhr), ok ? 'success' : 'error')
        if (ok) {
            // Keep the key so the next file can go to the same ereader
            fileinput.value = ''
            fileinfo.textContent = ''
            urlinput.value = ''
        }
    }

    xhr.onerror = () => {
        setBusy(false)
        showStatus('Upload failed. Check your connection and the key.', 'error')
    }

    xhr.send(new FormData(form))
})


// Show this page's address so it can be opened on the ereader
siteurl.textContent = location.href
siteurl.href = location.href
siteurl.target = '_self'
