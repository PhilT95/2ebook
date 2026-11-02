# 2ebook

A self hostable service for sending ebooks to a Kobo or Kindle ereader through the built-in browser.

Based on [send2ereader](https://github.com/daniel-j/send2ereader) by djazz, rewritten in TypeScript with Fastify.

## How it works

1. Open the site on your ereader. It shows a 6-character key.
2. Open the site on your computer, enter the key and upload an ebook.
3. The ebook appears as a download link on the ereader.

## Privacy

Uploaded files are encrypted with AES-256-GCM before they are written to disk. Every file gets its own random key, and that key only exists in the server's memory. It is never written to disk, so the file cannot be read from the disk or from a backup. When a session expires (about 30 seconds after the ereader closes the page) or the server restarts, the key is gone and the file is deleted.

If a conversion option (Kepubify, KindleGen) is used, the file is briefly written unencrypted to a private temporary folder while the converter runs, and removed right afterwards. The Docker setup mounts `/tmp` as RAM (`tmpfs`), so this plaintext never touches the disk either.

This does not protect against someone who can read the server's memory while it is running.

Analytics are off by default. If you set `PLAUSIBLE_ENABLED=true`, the upload page loads the Plausible script through your reverse proxy and shows a short notice. Visitor IP addresses pass through the proxy to Plausible. The ereader page never loads the script.

## How To Run

### On Your Host OS

1. Have a current Node.js LTS version installed (22 or newer)
2. Install this service's dependencies by running `$ npm ci`
3. Install [Kepubify](https://github.com/pgaskin/kepubify), and have the kepubify executable in your PATH.
4. Install [KindleGen](http://web.archive.org/web/*/http://kindlegen.s3.amazonaws.com/kindlegen*), and have the kindlegen executable in your PATH.
5. Compile and start the service: `$ npm run build && npm start`, then access it on HTTP port 3001 (set the `PORT` environment variable to change it)

For development, `$ npm run dev` runs the TypeScript source directly and restarts on changes.

### Containerized
1. You need [Docker](https://www.docker.com/) and [docker compose](https://docs.docker.com/compose/) installed
2. Clone this repo
```
git clone https://github.com/PhilT95/2ebook.git
```
3. Build the image
```
docker compose build
```
4. Run the container (-d to keep running in the background)
```
docker compose up -d
```
5. Access the service on HTTP, default port 3001 (http://localhost:3001)

The container is only reachable from the same machine.

### Behind A Reverse Proxy

The service speaks plain HTTP. When you host it publicly, put it behind a reverse proxy that provides HTTPS. [`examples/nginx/2ebook.conf.example`](examples/nginx/2ebook.conf.example) is a complete nginx configuration. Keep its buffering settings: with nginx's defaults, large uploads and downloads can be written unencrypted to its temporary files on disk.

Settings for the container go in a `.env` file next to `docker-compose.yaml`. Apply changes with `docker compose up -d`.

```
TRUST_PROXY=true
PLAUSIBLE_ENABLED=true
```

- `TRUST_PROXY`: set this to `true` behind a reverse proxy, otherwise all visitors share one rate limit. The proxy must set `X-Forwarded-For` to the visitor's address, and the app must not be directly reachable, or visitors can fake their address.
- `PLAUSIBLE_ENABLED`: optional. Adds Plausible to the upload page. The proxy must forward `/js/script.js` and `/api/event` to your Plausible server, as the example shows.
