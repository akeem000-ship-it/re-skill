// MTenn3D for Windows: one .exe that carries the game picker, Mario Tennis and Mario Golf (the Android app's web files), serves them
// to this PC only (127.0.0.1, a fixed port so the browser keeps your saves and settings between runs) and opens them in Microsoft
// Edge's app mode (a window of its own, no browser bars; Chrome if there is no Edge), with a profile of its own under
// %LOCALAPPDATA%\MTenn3D. It quits when that window is closed. The layout of the files is the app's (assets/web, assets/rom,
// assets/golf/web, assets/golf/rom), so the pages find each other as they do there; desktop.js stands in for the app's bridges.
// A private build carries your ROMs (site/rom, site/golf/rom); a shareable one does not, and each game asks for its ROM once.
// Built by build.sh (site/ is put together there, never committed).
package main

import (
	"bytes"
	"embed"
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

//go:embed all:site
var site embed.FS

//go:embed desktop.js
var desktopJS []byte

const port = 48713

var version = "dev" // (build.sh: -X main.version)

var types = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
	".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
	".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm",
	".gbc": "application/octet-stream", ".gb": "application/octet-stream", ".gz": "application/gzip", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
}

func dataDir() string {
	d := os.Getenv("LOCALAPPDATA")
	if d == "" {
		d, _ = os.UserCacheDir()
	}
	d = filepath.Join(d, "MTenn3D")
	os.MkdirAll(d, 0o755)
	return d
}

func downloads() string {
	h, _ := os.UserHomeDir()
	d := filepath.Join(h, "Downloads", "MTenn3D")
	os.MkdirAll(d, 0o755)
	return d
}

func handler() http.Handler {
	root, _ := fs.Sub(site, "site")
	golfRom := filepath.Join(dataDir(), "mario_golf.gbc")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		p := r.URL.Path
		switch {
		case p == "/" || p == "/assets/" || p == "/assets/web/":
			http.Redirect(w, r, "/assets/web/picker.html", http.StatusFound)
			return
		case p == "/app/desktop.js":
			w.Header().Set("Content-Type", types[".js"])
			w.Write(desktopJS)
			return
		case p == "/app/golfrom" && r.Method == http.MethodPost:
			b, _ := io.ReadAll(io.LimitReader(r.Body, 16<<20))
			if rom, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b))); err == nil && len(rom) > 0 {
				os.WriteFile(golfRom, rom, 0o644)
			}
			return
		case p == "/app/golfrom/forget" && r.Method == http.MethodPost:
			os.Remove(golfRom)
			return
		case p == "/app/save" && r.Method == http.MethodPost:
			name := filepath.Base(r.URL.Query().Get("name"))
			b, _ := io.ReadAll(io.LimitReader(r.Body, 512<<20))
			if data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b))); err == nil && name != "." && name != "/" {
				os.WriteFile(filepath.Join(downloads(), name), data, 0o644)
			}
			return
		case p == "/assets/golf/rom/mario_golf.gbc":
			if b, err := os.ReadFile(golfRom); err == nil { // (the ROM you picked; else the one carried, a private build)
				w.Header().Set("Content-Type", types[".gbc"])
				w.Write(b)
				return
			}
		}
		if !strings.HasPrefix(p, "/assets/") {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(path.Clean(p), "/assets/")
		b, err := fs.ReadFile(root, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ext := strings.ToLower(path.Ext(name))
		if t, ok := types[ext]; ok {
			w.Header().Set("Content-Type", t)
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		if ext == ".html" { // the app's stand-ins first, before the page's own scripts
			tag := []byte(`<script src="/app/desktop.js"></script>`)
			if i := bytes.Index(bytes.ToLower(b), []byte("<head>")); i >= 0 {
				b = append(b[:i+6:i+6], append(tag, b[i+6:]...)...)
			} else {
				b = append(tag, b...)
			}
		}
		w.Write(b)
	})
}

func main() {
	serveOnly := flag.Bool("serve", false, "serve only (no window): for tests")
	flag.Parse()
	url := fmt.Sprintf("http://127.0.0.1:%d/assets/web/picker.html", port)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil { // already running: just another window onto it
		if !*serveOnly {
			openWindow(url, dataDir())
		}
		return
	}
	srv := &http.Server{Handler: handler()}
	go srv.Serve(ln)
	if *serveOnly {
		select {}
	}
	openWindow(url, dataDir())
}
