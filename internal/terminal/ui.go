package terminal

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ServeUI mounts the Vite production build if ATLAS_WEB_DIR or web/dist exists.
func ServeUI(mux *http.ServeMux, dir string) {
	if dir == "" {
		dir = os.Getenv("ATLAS_WEB_DIR")
	}
	if dir == "" {
		dir = "web/dist"
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return
	}
	files := http.FileServer(http.Dir(dir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(dir, filepath.Clean(strings.TrimPrefix(r.URL.Path, "/")))
		if _, err := os.Stat(path); err != nil {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
}
