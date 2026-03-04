# rpmrate - Deployment Instructions

## Quick Deploy to Nginx

The `dist/` folder contains all static files ready to serve. Simply copy the contents to your nginx web root.

### Option 1: Copy to nginx subfolder

```bash
# Copy to nginx subfolder (e.g., /var/www/html/rpmrate/)
sudo cp -r dist/* /var/www/html/rpmrate/

# Or via rsync
rsync -av dist/ user@server:/var/www/html/rpmrate/
```

Access at: `http://yourserver.com/rpmrate/`

### Option 2: Copy to nginx root

```bash
# Copy to nginx root
sudo cp -r dist/* /var/www/html/

# Or via rsync
rsync -av dist/ user@server:/var/www/html/
```

Access at: `http://yourserver.com/`

### Nginx Configuration

No special configuration needed. The default nginx config works fine:

```nginx
location /rpmrate/ {
    alias /var/www/html/rpmrate/;
    index index.html;
    try_files $uri $uri/ /rpmrate/index.html;
}
```

For root deployment:

```nginx
location / {
    root /var/www/html;
    index index.html;
    try_files $uri $uri/ /index.html;
}
```

### MIME Types

Ensure nginx has correct MIME types (usually in `/etc/nginx/mime.types`):

```nginx
types {
    text/html                             html htm;
    text/css                              css;
    application/javascript                js;
}
```

### Testing Locally

Before deploying, test with the included Node.js server:

```bash
npm start
# Opens at http://localhost:8080
```

### File Structure

```
dist/
  index.html
  css/
    style.css
  js/
    main.js
    bpm-engine.js
    renderer.js
    input.js
    special-fn.js
```

All files are vanilla HTML/CSS/JS with ES modules. No build step required.
