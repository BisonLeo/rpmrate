# Build & Distribution Guide for rpmrate

## Quick Start (No Build Step Required)

This is a **zero-build** project. All files are ready to serve as-is.

```bash
# 1. Verify the dist folder is up to date
cd D:/work/node_projs/rpmrate
cp -r public/* dist/

# 2. Test locally
npm start
# Opens at http://localhost:8080

# 3. Deploy to nginx
scp -r dist/* user@server:/var/www/html/rpmrate/
```

---

## Full Distribution Build Commands

### 1. Prepare Distribution Package

```bash
# Navigate to project
cd D:/work/node_projs/rpmrate

# Clean and rebuild dist
rm -rf dist
mkdir -p dist
cp -r public/* dist/

# Verify all files are present
ls -la dist/
ls -la dist/js/
ls -la dist/css/
```

### 2. Optional: Minify JavaScript (for smaller file size)

If you want to minify JS files, use a tool like `terser`:

```bash
# Install terser globally (one-time)
npm install -g terser

# Minify all JS files
terser dist/js/special-fn.js -o dist/js/special-fn.min.js -c -m
terser dist/js/bpm-engine.js -o dist/js/bpm-engine.min.js -c -m
terser dist/js/renderer.js -o dist/js/renderer.min.js -c -m
terser dist/js/input.js -o dist/js/input.min.js -c -m
terser dist/js/main.js -o dist/js/main.min.js -c -m

# Update index.html to use minified versions
# (or keep original for development)
```

### 3. Optional: Minify CSS

```bash
# Install csso-cli globally (one-time)
npm install -g csso-cli

# Minify CSS
csso dist/css/style.css -o dist/css/style.min.css
```

### 4. Create Distribution Archive

```bash
# Create a tarball for distribution
tar -czf rpmrate-dist.tar.gz dist/

# Or create a zip file
zip -r rpmrate-dist.zip dist/

# Verify archive contents
tar -tzf rpmrate-dist.tar.gz | head -20
```

### 5. Verify File Sizes

```bash
# Check uncompressed sizes
du -sh dist/
du -sh dist/js/*
du -sh dist/css/*

# Check gzipped sizes (what users will download)
gzip -c dist/js/bpm-engine.js | wc -c
gzip -c dist/css/style.css | wc -c
```

---

## Deployment Commands

### Deploy to Nginx (Linux/Mac)

```bash
# SSH into server
ssh user@yourserver.com

# Create nginx directory
sudo mkdir -p /var/www/html/rpmrate
sudo chown -R nginx:nginx /var/www/html/rpmrate

# Exit and copy files
exit

# Copy from local machine
scp -r dist/* user@yourserver.com:/var/www/html/rpmrate/

# Or use rsync (faster for updates)
rsync -avz dist/ user@yourserver.com:/var/www/html/rpmrate/
```

### Nginx Configuration

```bash
# SSH into server
ssh user@yourserver.com

# Edit nginx config
sudo nano /etc/nginx/conf.d/rpmrate.conf
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name rpmrate.yourdomain.com;

    root /var/www/html/rpmrate;
    index index.html;

    # Enable gzip compression
    gzip on;
    gzip_types text/css application/javascript text/plain;
    gzip_min_length 1000;

    # Cache static assets
    location ~* \.(js|css|png|svg|ico)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Serve index.html for SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

Then reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Complete Build Script

Create `build.sh`:

```bash
#!/bin/bash
set -e

echo "🔨 Building rpmrate for distribution..."

# Clean
rm -rf dist
mkdir -p dist

# Copy files
cp -r public/* dist/

# Optional: minify (uncomment if terser installed)
# echo "📦 Minifying JavaScript..."
# terser dist/js/special-fn.js -o dist/js/special-fn.min.js -c -m
# terser dist/js/bpm-engine.js -o dist/js/bpm-engine.min.js -c -m
# terser dist/js/renderer.js -o dist/js/renderer.min.js -c -m
# terser dist/js/input.js -o dist/js/input.min.js -c -m
# terser dist/js/main.js -o dist/js/main.min.js -c -m

# Create archive
echo "📦 Creating distribution archive..."
tar -czf rpmrate-dist.tar.gz dist/

# Show stats
echo ""
echo "✅ Build complete!"
echo ""
echo "📊 Distribution stats:"
du -sh dist/
echo ""
echo "📦 Archive: rpmrate-dist.tar.gz"
ls -lh rpmrate-dist.tar.gz
echo ""
echo "🚀 Ready to deploy!"
```

Run it:

```bash
chmod +x build.sh
./build.sh
```

---

## File Size Summary

| File | Size | Gzipped |
|------|------|---------|
| index.html | ~1.1 KB | ~0.5 KB |
| style.css | ~3.5 KB | ~1.2 KB |
| special-fn.js | ~2.0 KB | ~0.8 KB |
| bpm-engine.js | ~12 KB | ~3.5 KB |
| renderer.js | ~15 KB | ~4.5 KB |
| input.js | ~2.5 KB | ~1.0 KB |
| main.js | ~1.5 KB | ~0.6 KB |
| **Total** | **~37 KB** | **~12 KB** |

---

## Verification Checklist

Before deploying:

```bash
# 1. All files present
ls -la dist/js/
ls -la dist/css/
ls dist/index.html

# 2. No syntax errors
node -c dist/js/special-fn.js
node -c dist/js/bpm-engine.js
node -c dist/js/renderer.js
node -c dist/js/input.js
node -c dist/js/main.js

# 3. Test locally
npm start
# Visit http://localhost:8080 and test tapping

# 4. Check file permissions
chmod 644 dist/index.html
chmod 644 dist/css/*
chmod 644 dist/js/*
chmod 755 dist/
chmod 755 dist/css/
chmod 755 dist/js/
```

---

## One-Line Deploy

After building:

```bash
# Deploy to nginx
rsync -avz --delete dist/ user@server:/var/www/html/rpmrate/ && \
ssh user@server "sudo systemctl reload nginx" && \
echo "✅ Deployed to http://server/rpmrate/"
```
