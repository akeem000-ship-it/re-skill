package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

// openWindow: the game in Edge's app mode (else Chrome's) with a profile of its own, waiting until that window is closed; with neither,
// the default browser and a message box to quit by
func openWindow(url, data string) {
	env := func(k string) string { return os.Getenv(k) }
	cands := []string{
		filepath.Join(env("ProgramFiles(x86)"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(env("ProgramFiles"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(env("LOCALAPPDATA"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(env("ProgramFiles"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(env("ProgramFiles(x86)"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(env("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
	}
	for _, b := range cands {
		if _, err := os.Stat(b); err != nil {
			continue
		}
		cmd := exec.Command(b, "--app="+url, "--user-data-dir="+filepath.Join(data, "browser"), "--window-size=1280,800",
			"--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--disable-features=Translate")
		if err := cmd.Start(); err == nil {
			cmd.Wait()
			return
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	msg, _ := syscall.UTF16PtrFromString("MTenn3D is running in your web browser:\n" + url + "\n\nPress OK to quit it.")
	title, _ := syscall.UTF16PtrFromString("MTenn3D")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x40)
}
